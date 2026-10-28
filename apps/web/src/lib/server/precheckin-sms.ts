// 事前チェックイン P4（docs/pre-checkin.md §3・§9・§18）のサーバー側: NTT CPaaS の SMS 送信（手動・当日 9:00 の自動）と
// 到達結果（DLR）・返信の Webhook。純関数は $lib/precheckin-sms.ts。
//
// DB: autumn-shared 20261028223741_book_precheckin_p4_sms.sql（RPC のシグネチャはここと一致させる）
//   管理画面（authenticated）: admin_precheckin_dispatch_begin(p_facility, p_stay_id, p_channel, p_force) /
//     admin_precheckin_dispatch_finish(p_facility, p_dispatch, p_ok, p_message_id, p_provider_status, p_error, p_permanent) /
//     admin_precheckin_sms_status(p_facility, p_from, p_to) / admin_precheckin_sms_detail(p_facility, p_stay_id)
//   サーバー（service_role）: precheckin_autosend_targets(p_date) / precheckin_autosend_begin(p_stay_id, p_channel) /
//     precheckin_dispatch_finish(...) / precheckin_dlr_apply(p_reports) / precheckin_sms_inbound_save(p_rows)
//
// 【環境変数（Cloudflare Pages の secret。値はリポジトリ・ログに出さない）】
//   NTT_CPAAS_BASE_URL / NTT_CPAAS_API_KEY / NTT_CPAAS_SENDER … どれか欠けると SMS は送らず「SMS未設定」を返す
//   NTT_CPAAS_WEBHOOK_SECRET … Webhook の Basic 認証（「ユーザー名:パスワード」）。未設定なら Webhook は 503
//   PRECHECKIN_AUTOSEND … '1' のときだけ自動送信が実際に送る（未設定・'0' は dry-run）
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import type { BookClient } from '$lib/server/admin-app-data';
import { sendHtmlEmail } from '$lib/server/mailer';
import { partnerMailSender } from '$lib/server/partners/mail';
import { facilities } from '$lib/server/store';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { buildPrecheckinMail } from '$lib/precheckin';
import {
	buildPrecheckinSms,
	checkWebhookAuth,
	dispatchErrorText,
	normalizeDlr,
	normalizeInbound,
	nttConfigFrom,
	planAutosend,
	sendSmsWith,
	type AutosendTarget,
	type NttConfig,
	type SmsStatusRow
} from '$lib/precheckin-sms';

// 開発中はログを出す（リリース前に false）。宛先・本文・トークンは出さない
const DEBUG = true;
function dbg(...args: unknown[]) {
	if (DEBUG) console.log('[DBG precheckin-sms]', ...args);
}

export function nttConfig(): NttConfig | null {
	return nttConfigFrom(privateEnv as Record<string, string | undefined>);
}

/** SMS を送れる設定があるか（管理画面のボタンの出し分け） */
export const smsReady = () => nttConfig() !== null;

/** 施設の電話（core.facilities.phone が空なら、サイトの施設情報の電話） */
function facilityPhone(facilityUuid: string, fromDb: string | null | undefined): string | null {
	if (fromDb && fromDb.trim()) return fromDb.trim();
	const key = Object.entries(FACILITY_UUID).find(([, v]) => v === facilityUuid)?.[0];
	return facilities.find((f) => f.id === key)?.phone ?? null;
}

type BeginOk = {
	ok: true;
	dispatch_id: string;
	precheckin_id: string;
	stay_id: string;
	channel: 'sms' | 'email';
	token: string;
	to: string;
	to_masked: string;
	guest_name: string;
	booking_code: string;
	check_in: string;
	check_out: string;
	nights: number;
	locale: string;
	facility_id: string;
	facility_name: string;
	facility_slug: string;
	facility_phone: string | null;
	expires_at: string;
	editable_until: string;
};
type BeginNg = { ok: false; error: string; last_at?: string };
type BeginResult = BeginOk | BeginNg;

type FinishArgs = { ok: boolean; messageId?: string; providerStatus?: string; error?: string; permanent?: boolean };

/** 受付済みの 1 件を実際に送る（SMS / メール）。結果は呼び出し側が finish で残す */
async function deliver(b: BeginOk, origin: string, cfg: NttConfig | null, mailDb: SupabaseClient | null): Promise<FinishArgs> {
	const url = `${origin}/ci/${b.token}`;
	if (b.channel === 'sms') {
		const text = buildPrecheckinSms({ facilityName: b.facility_name, url, phone: facilityPhone(b.facility_id, b.facility_phone) });
		const r = await sendSmsWith(cfg, { to: b.to, text, callbackData: b.dispatch_id });
		return { ok: r.sent, messageId: r.messageId, providerStatus: r.providerStatus, error: r.reason, permanent: r.permanent };
	}
	const mail = buildPrecheckinMail({
		facilityName: b.facility_name,
		guestName: b.guest_name,
		checkIn: String(b.check_in).slice(0, 10),
		checkOut: String(b.check_out).slice(0, 10),
		nights: Number(b.nights) || 1,
		bookingCode: b.booking_code,
		url,
		editableUntil: b.editable_until
	});
	const sender = mailDb ? await partnerMailSender(mailDb, b.facility_id).catch(() => null) : null;
	const r = await sendHtmlEmail({
		to: [b.to],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
		fromName: `${b.facility_name} 事前チェックイン`,
		replyTo: sender?.replyTo ?? undefined
	});
	return { ok: r.sent, error: r.reason };
}

// ---------------------------------------------------------------- 管理画面（手動）

export type ManualSmsResult =
	| { sent: true; toMasked: string }
	| { sent: false; code: string; message: string; lastAt?: string };

/**
 * 「SMSで送る／再送」。SMS 未設定なら受付もしない（トークンを回さない）。
 * force=false で直近 1 時間に送っていれば code='recent'（画面で確認してから force=true で送り直す）。
 */
export async function sendPrecheckinSms(
	c: BookClient,
	facility: string,
	stayId: string,
	force: boolean,
	origin: string
): Promise<ManualSmsResult> {
	const cfg = nttConfig();
	if (!cfg) return { sent: false, code: 'sms_not_configured', message: 'SMS未設定（NTT CPaaS の接続情報が登録されていません）。' };
	const { data, error } = await c.rpc('admin_precheckin_dispatch_begin', {
		p_facility: facility,
		p_stay_id: stayId,
		p_channel: 'sms',
		p_force: force
	});
	if (error) throw error;
	const b = data as BeginResult;
	if (!b.ok) return { sent: false, code: b.error, message: dispatchErrorText(b.error), lastAt: b.last_at };
	const r = await deliver(b, origin, cfg, null);
	dbg('manual', { dispatch: b.dispatch_id, ok: r.ok, status: r.providerStatus, error: r.error });
	const fin = await c.rpc('admin_precheckin_dispatch_finish', {
		p_facility: facility,
		p_dispatch: b.dispatch_id,
		p_ok: r.ok,
		p_message_id: r.messageId ?? null,
		p_provider_status: r.providerStatus ?? null,
		p_error: r.ok ? null : (r.error ?? 'unknown'),
		p_permanent: Boolean(r.permanent)
	});
	if (fin.error) dbg('finish error', fin.error.message);
	if (!r.ok) return { sent: false, code: 'send_failed', message: `SMS を送れませんでした（${r.error ?? '不明'}）。一覧に失敗を残しました。` };
	return { sent: true, toMasked: b.to_masked };
}

export async function adminSmsStatus(c: BookClient, facility: string, from: string, to: string): Promise<SmsStatusRow[]> {
	const { data, error } = await c.rpc('admin_precheckin_sms_status', { p_facility: facility, p_from: from, p_to: to });
	if (error) throw error;
	return (data ?? []) as SmsStatusRow[];
}

export type SmsDispatchRow = {
	id: string;
	channel: 'sms' | 'email';
	mode: 'manual' | 'auto';
	to_masked: string | null;
	status: SmsStatusRow['sms_status'];
	provider_status: string | null;
	last_error: string | null;
	attempts: number;
	sent_at: string | null;
	delivered_at: string | null;
	created_at: string;
};
export type SmsInboundRow = { id: string; from_masked: string; message: string; received_at: string | null; created_at: string };
export type SmsDetail = { dispatches: SmsDispatchRow[]; inbound: SmsInboundRow[] };

export async function adminSmsDetail(c: BookClient, facility: string, stayId: string): Promise<SmsDetail> {
	const { data, error } = await c.rpc('admin_precheckin_sms_detail', { p_facility: facility, p_stay_id: stayId });
	if (error) throw error;
	const d = (data ?? {}) as Partial<SmsDetail>;
	return { dispatches: d.dispatches ?? [], inbound: d.inbound ?? [] };
}

// ---------------------------------------------------------------- 自動送信（cron）

export type AutosendResult = {
	dryRun: boolean;
	date: string | null;
	counts: ReturnType<typeof planAutosend>['counts'];
	sent?: number;
	failed?: number;
	skipped?: Record<string, number>;
	smsConfigured: boolean;
};

/**
 * 当日チェックインの代表 1 通へ送る。enabled=false（PRECHECKIN_AUTOSEND≠'1'）は対象を数えるだけ。
 * SMS が失敗してもメールには切り替えない（管理画面の一覧に失敗が出るので手動で対応）。
 */
export async function runPrecheckinAutosend(
	svc: SupabaseClient,
	opts: { enabled: boolean; origin: string; date?: string | null }
): Promise<AutosendResult> {
	const db = svc.schema('book');
	const { data, error } = await db.rpc('precheckin_autosend_targets', { p_date: opts.date ?? null });
	if (error) throw error;
	const rows = (data ?? []) as AutosendTarget[];
	const plan = planAutosend(rows);
	const cfg = nttConfig();
	const base: AutosendResult = { dryRun: !opts.enabled, date: opts.date ?? rows[0]?.check_in_date ?? null, counts: plan.counts, smsConfigured: cfg !== null };
	if (!opts.enabled) return base;

	let sent = 0;
	let failed = 0;
	const skipped: Record<string, number> = {};
	const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);
	for (const t of plan.send) {
		// SMS 未設定なら SMS の対象は受付もしない（トークンを回さない・メールにも切り替えない）
		if (t.channel === 'sms' && !cfg) {
			skip('sms_not_configured');
			continue;
		}
		try {
			const begin = await db.rpc('precheckin_autosend_begin', { p_stay_id: t.stay_id, p_channel: t.channel });
			if (begin.error) throw begin.error;
			const b = begin.data as BeginResult;
			if (!b.ok) {
				skip(b.error);
				continue;
			}
			const r = await deliver(b, opts.origin, cfg, svc);
			const fin = await db.rpc('precheckin_dispatch_finish', {
				p_dispatch: b.dispatch_id,
				p_ok: r.ok,
				p_message_id: r.messageId ?? null,
				p_provider_status: r.providerStatus ?? null,
				p_error: r.ok ? null : (r.error ?? 'unknown'),
				p_permanent: Boolean(r.permanent)
			});
			if (fin.error) dbg('finish error', fin.error.message);
			if (r.ok) sent++;
			else failed++;
		} catch (e) {
			dbg('autosend error', e instanceof Error ? e.message : String(e));
			failed++;
		}
	}
	return { ...base, sent, failed, skipped };
}

// ---------------------------------------------------------------- Webhook

/**
 * NTT CPaaS の Webhook の入口（認証 → 本文 → 処理）。未設定は 503、認証違いは 401、本文が JSON でなければ 400。
 * 処理の失敗は 500（NTT CPaaS が後で送り直す）。
 */
export async function handleNttWebhook(
	request: Request,
	kind: 'dlr' | 'inbound',
	deps: { svc: SupabaseClient | null; secret?: string | null } = { svc: null }
): Promise<Response> {
	const auth = checkWebhookAuth(request.headers.get('authorization'), deps.secret ?? null);
	if (auth === 'unconfigured') return new Response('webhook not configured', { status: 503 });
	if (auth === 'denied') return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="ntt-cpaas"' } });
	if (!deps.svc) return new Response('SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。', { status: 503 });
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return new Response('invalid json', { status: 400 });
	}
	try {
		const r = kind === 'dlr' ? await applyDlr(deps.svc, payload) : await saveInbound(deps.svc, payload);
		dbg(kind, r);
		return Response.json(r);
	} catch (e) {
		console.error(`[ntt-cpaas ${kind}] 失敗:`, e instanceof Error ? e.message : e);
		return new Response('error', { status: 500 });
	}
}

export async function applyDlr(svc: SupabaseClient, payload: unknown) {
	const reports = normalizeDlr(payload);
	if (!reports.length) return { ok: true, updated: 0, skipped: 0 };
	const { data, error } = await svc.schema('book').rpc('precheckin_dlr_apply', { p_reports: reports });
	if (error) throw error;
	return data as { ok: boolean; updated: number; skipped: number };
}

export async function saveInbound(svc: SupabaseClient, payload: unknown) {
	const rows = normalizeInbound(payload);
	if (!rows.length) return { ok: true, saved: 0, linked: 0 };
	const { data, error } = await svc.schema('book').rpc('precheckin_sms_inbound_save', { p_rows: rows });
	if (error) throw error;
	return data as { ok: boolean; saved: number; linked: number };
}
