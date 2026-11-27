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
//   NTT_CPAAS_BASE_URL / NTT_CPAAS_API_KEY … 共通の接続情報
//   NTT_CPAAS_SENDER_NISHIWAGA / NTT_CPAAS_SENDER_OGA … 事前チェックインの施設別送信元
//   NTT_CPAAS_SENDER … 施設にひもづかない会員向け SMS の送信元
//   NTT_CPAAS_WEBHOOK_SECRET … Webhook の Basic 認証（「ユーザー名:パスワード」）。未設定なら Webhook は 503
//   PRECHECKIN_AUTOSEND … '1' のときだけ自動送信が実際に送る（未設定・'0' は dry-run）
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { splashHint } from '$lib/precheckin-splash';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import type { BookClient } from '$lib/server/admin-app-data';
import { sendHtmlEmail } from '$lib/server/mailer';
import { nttFetch } from '$lib/server/ntt-fetch';
import { facilities } from '$lib/server/store';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { PRIMARY_ORIGIN } from '$lib/server/public-origin';
import { buildPrecheckinMail, precheckinMailFrom } from '$lib/precheckin';
import {
	autosendChannel,
	buildPrecheckinSmsPair,
	checkWebhookAuth,
	dispatchErrorText,
	normalizeDlr,
	normalizeInbound,
	nttConfigFrom,
	nttSmsBillingUnits,
	planAutosend,
	sendSmsWith,
	smsAutosendEnabled,
	type AutosendTarget,
	type MonthlySmsEstimate,
	type NttConfig,
	type SmsStatusRow
} from '$lib/precheckin-sms';

// 開発中はログを出す（リリース前に false）。宛先・本文・トークンは出さない
const DEBUG = false;
function dbg(...args: unknown[]) {
	if (DEBUG) console.log('[DBG precheckin-sms]', ...args);
}

const PRECHECKIN_SENDER_KEYS = new Map([
	[FACILITY_UUID['f-nishiwaga'], 'NTT_CPAAS_SENDER_NISHIWAGA'],
	[FACILITY_UUID['f-oga'], 'NTT_CPAAS_SENDER_OGA']
]);

export function nttConfig(): NttConfig | null {
	return nttConfigFrom(privateEnv);
}

function precheckinNttConfig(facility: string): NttConfig | null {
	const senderKey = PRECHECKIN_SENDER_KEYS.get(facility);
	return senderKey ? nttConfigFrom(privateEnv, senderKey) : null;
}

/** SMS を送れる設定があるか（管理画面のボタンの出し分け） */
export const smsReady = (facility: string) => precheckinNttConfig(facility) !== null;

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

/** 事前チェックインで貸切風呂を案内できるか、画面と同じ規則で確認する。 */
export async function stayOffersPrecheckinBath(stayId: string, db = partnerServiceClient()): Promise<boolean> {
	if (!db) return false;
	try {
		const { data, error } = await db.schema('book').rpc('_pc_bath_eligible', { p_stay_id: stayId });
		return !error && data === true;
	} catch {
		return false;
	}
}

/** 受付済みの 1 件を実際に送る（SMS / メール）。結果は呼び出し側が finish で残す。official は貸切風呂の事前予約を案内するか */
async function deliver(b: BeginOk, origin: string, cfg: NttConfig | null, mailDb: SupabaseClient | null, official: boolean): Promise<FinishArgs> {
	// ?f=<施設の slug> は、リンクを開いた瞬間の読み込み中の画面に出すロゴの目印（$lib/precheckin-splash）
	const url = `${origin}/ci/${b.token}${splashHint(b.facility_slug)}`;
	if (b.channel === 'sms') {
		// 送信は nttFetch（Workers の fetch だと NTT に届かず 401 になるため、生の接続で送る。理由は ntt-fetch.ts）。
		// 2 通に分けて送る（1 通目＝案内文、2 通目＝URL と電話）。届く順を守るため 1 通目を受け付けてから 2 通目を送る。
		// 送信記録（到達管理）は 2 通目（URL）の messageId で持つ。1 通目の到達通知は照合されず読み飛ばされる。
		const pair = buildPrecheckinSmsPair({
			facilityName: b.facility_name,
			checkIn: String(b.check_in).slice(0, 10),
			url,
			phone: facilityPhone(b.facility_id, b.facility_phone),
			bath: official
		});
		const first = await sendSmsWith(cfg, { to: b.to, text: pair.message, callbackData: b.dispatch_id }, nttFetch);
		if (!first.sent) return { ok: false, messageId: first.messageId, providerStatus: first.providerStatus, error: first.reason, permanent: first.permanent };
		const r = await sendSmsWith(cfg, { to: b.to, text: pair.link, callbackData: b.dispatch_id }, nttFetch);
		return {
			ok: r.sent,
			messageId: r.messageId,
			providerStatus: r.providerStatus,
			error: r.sent ? undefined : `1 通目（案内文）は送信済み・2 通目（URL）が失敗: ${r.reason ?? ''}`.slice(0, 300),
			permanent: r.permanent
		};
	}
	const mail = buildPrecheckinMail({
		facilityName: b.facility_name,
		guestName: b.guest_name,
		checkIn: String(b.check_in).slice(0, 10),
		checkOut: String(b.check_out).slice(0, 10),
		nights: Number(b.nights) || 1,
		bookingCode: b.booking_code,
		url,
		editableUntil: b.editable_until,
		bath: official,
		facilitySlug: b.facility_slug,
		assetOrigin: origin
	});
	// 送信専用（noreply@yamado.app・返信先なし・2026-11-26）
	const r = await sendHtmlEmail({
		to: [b.to],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
		from: precheckinMailFrom(b.facility_name)
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
	origin: string,
	/** 貸切風呂の事前予約を文面に入れるか */
	official: boolean
): Promise<ManualSmsResult> {
	const cfg = precheckinNttConfig(facility);
	if (!cfg) return { sent: false, code: 'sms_not_configured', message: 'SMS未設定（NTT CPaaSの接続情報またはこの施設の送信元が未登録です）。' };
	const { data, error } = await c.rpc('admin_precheckin_dispatch_begin', {
		p_facility: facility,
		p_stay_id: stayId,
		p_channel: 'sms',
		p_force: force
	});
	if (error) throw error;
	const b = data as BeginResult;
	if (!b.ok) return { sent: false, code: b.error, message: dispatchErrorText(b.error), lastAt: b.last_at };
	const r = await deliver(b, origin, cfg, null, official);
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

type MonthlySmsRow = {
	facility_id: string;
	facility_name: string;
	facility_slug: string;
	facility_phone: string | null;
	sent_pairs: number;
	sent_first_only: number;
	scheduled: number;
};

export async function adminMonthlySmsEstimate(
	c: BookClient,
	brandName: string,
	brandFacilities: { id: string; name: string }[]
): Promise<MonthlySmsEstimate> {
	const { data, error } = await c.rpc('admin_precheckin_sms_month', {
		p_facilities: brandFacilities.map((facility) => facility.id)
	});
	if (error) throw error;
	const byFacility = new Map((data as MonthlySmsRow[]).map((row) => [row.facility_id, row]));
	const rows = brandFacilities.flatMap(({ id, name }) => {
		const row = byFacility.get(id);
		if (!row) return [];
		// 現行の16文字のトークンと、長い方の案内文で概算する。
		const pair = buildPrecheckinSmsPair({
			facilityName: row.facility_name,
			checkIn: '',
			url: `${PRIMARY_ORIGIN}/ci/${'A'.repeat(16)}${splashHint(row.facility_slug)}`,
			phone: facilityPhone(id, row.facility_phone)
		});
		const firstUnits = nttSmsBillingUnits(pair.message);
		const pairUnits = firstUnits + nttSmsBillingUnits(pair.link);
		return [{
			id,
			name,
			sentUnits: row.sent_pairs * pairUnits + row.sent_first_only * firstUnits,
			remainingUnits: row.scheduled * pairUnits
		}];
	});
	return { brandName, completeBrand: rows.length === brandFacilities.length, facilities: rows };
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
	const base: AutosendResult = {
		dryRun: !opts.enabled,
		date: opts.date ?? rows[0]?.check_in_date ?? null,
		counts: plan.counts,
		smsConfigured: [...PRECHECKIN_SENDER_KEYS.keys()].some(smsReady)
	};
	if (!opts.enabled) return base;

	let sent = 0;
	let failed = 0;
	const skipped: Record<string, number> = {};
	const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);
	for (const t of plan.send) {
		// SMS の自動送信が無効、または施設の送信元が未設定ならメールで送る。
		// メールアドレスが無い予約は受付で no_email になり、送らずに数える
		const cfg = precheckinNttConfig(t.facility_id);
		const channel = autosendChannel(t.channel, cfg !== null && smsAutosendEnabled(privateEnv.PRECHECKIN_SMS));
		try {
			const begin = await db.rpc('precheckin_autosend_begin', { p_stay_id: t.stay_id, p_channel: channel });
			if (begin.error) throw begin.error;
			const b = begin.data as BeginResult;
			if (!b.ok) {
				skip(b.error);
				continue;
			}
			const r = await deliver(b, opts.origin, cfg, svc, await stayOffersPrecheckinBath(b.stay_id, svc));
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
