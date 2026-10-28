// 事前チェックイン P2（docs/pre-checkin.md）のサーバー側。
//
// DB: autumn-shared 20261028220125_book_precheckin_p2.sql（RPC のシグネチャはここと一致させる）
//   フォーム（anon・トークン）: precheckin_context(p_token) / precheckin_save_answers(p_token, p_answers) /
//                              precheckin_save_meals(p_token, p_meals)
//   管理画面（authenticated）: admin_precheckin_list(p_facility, p_from, p_to) / admin_precheckin_detail(p_facility, p_stay_id) /
//                              admin_precheckin_issue(p_facility, p_stay_id) / admin_precheckin_mark_sent(p_facility, p_id, p_ok, p_to, p_error) /
//                              admin_precheckin_caps(p_facility) / admin_precheckin_save_caps(p_facility, p_caps)
//
// トークンはリンク（/ci/<token>）で受け取ったら httpOnly Cookie（ab_ci）に移し、URL から消す（/r/c/[token] と同じ）。
// トークン違いの連続は claim-rate-limit と同じ方式（KV）で数え、5 回でしばらく閉じる。
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { DATA_SOURCE, supa } from '$lib/server/supabase';
import { claimRateCheck, claimRecordFailure, claimRecordSuccess } from '$lib/server/claim-rate-limit';
import { sendHtmlEmail } from '$lib/server/mailer';
import { partnerMailSender } from '$lib/server/partners/mail';
import { createSupabaseServerClient } from '$lib/server/auth';
import type { BookClient } from '$lib/server/admin-app-data';
import {
	DEMO_PRECHECKIN_TOKEN,
	buildPrecheckinMail,
	demoPrecheckinContext,
	normalizePrecheckinContext,
	precheckinCookieMaxAge,
	type PcAnswers,
	type PcContext,
	type PcError,
	type PcMealChoice
} from '$lib/precheckin';

// 開発中はログを出す（リリース前に false）
const DEBUG = true;
function dbg(...args: unknown[]) {
	if (DEBUG) console.log('[DBG precheckin]', ...args);
}

export const PRECHECKIN_COOKIE = 'ab_ci';
const RATE_PREFIX = 'ci:';

// ---------------------------------------------------------------- 見本（DATA_SOURCE=demo）

// 見本の回答はプロセス内だけに持つ（ローカル確認用）
let demoAnswers: PcAnswers = {};

// ---------------------------------------------------------------- フォーム（anon）

/** トークンからフォームの中身を引く。開いた時刻も DB に残る */
export async function pcContext(token: string): Promise<PcContext | { error: PcError }> {
	if (DATA_SOURCE !== 'supabase') {
		return token === DEMO_PRECHECKIN_TOKEN ? demoPrecheckinContext(demoAnswers) : { error: 'invalid_token' };
	}
	const { data, error } = await supa().rpc('precheckin_context', { p_token: token });
	if (error) {
		dbg('context error', error.message);
		return { error: 'invalid_token' };
	}
	return normalizePrecheckinContext(data);
}

export type PcSaveResult = { ok: true } | { ok: false; error: string; field?: string; type?: string; date?: string; time?: string };

function rpcResult(data: unknown, error: { message: string } | null): PcSaveResult {
	if (error) return { ok: false, error: 'server' };
	const r = (data ?? {}) as Record<string, unknown>;
	if (r.ok === true) return { ok: true };
	return {
		ok: false,
		error: String(r.error ?? 'server'),
		...(r.field ? { field: String(r.field) } : {}),
		...(r.type ? { type: String(r.type), date: String(r.date ?? ''), time: String(r.time ?? '') } : {})
	};
}

export async function pcSaveAnswers(token: string, answers: PcAnswers): Promise<PcSaveResult> {
	if (DATA_SOURCE !== 'supabase') {
		if (token !== DEMO_PRECHECKIN_TOKEN) return { ok: false, error: 'invalid_token' };
		demoAnswers = { ...demoAnswers, ...answers, basic_saved_at: new Date().toISOString() };
		return { ok: true };
	}
	const { data, error } = await supa().rpc('precheckin_save_answers', { p_token: token, p_answers: answers });
	if (error) dbg('save_answers error', error.message);
	return rpcResult(data, error);
}

export async function pcSaveMeals(token: string, meals: PcMealChoice[]): Promise<PcSaveResult> {
	if (DATA_SOURCE !== 'supabase') {
		if (token !== DEMO_PRECHECKIN_TOKEN) return { ok: false, error: 'invalid_token' };
		demoAnswers = { ...demoAnswers, meals: meals.filter((m) => m.time), meals_saved_at: new Date().toISOString() };
		return { ok: true };
	}
	const { data, error } = await supa().rpc('precheckin_save_meals', { p_token: token, p_meals: meals });
	if (error) dbg('save_meals error', error.message);
	return rpcResult(data, error);
}

// ---------------------------------------------------------------- Cookie とレート制限

export function setPrecheckinCookie(cookies: Cookies, token: string, expiresAt: string) {
	cookies.set(PRECHECKIN_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: precheckinCookieMaxAge(expiresAt)
	});
}

/**
 * いまの Cookie（またはリンクのトークン）でフォームの中身を引く。
 * トークン違いは失敗として数え（5 回で 10 分閉じる）、Cookie は消す。
 */
export async function resolvePrecheckin(
	event: Pick<RequestEvent, 'cookies' | 'platform' | 'getClientAddress'>,
	fromLink?: string
): Promise<{ token: string; ctx: PcContext } | { error: PcError }> {
	const token = fromLink ?? event.cookies.get(PRECHECKIN_COOKIE) ?? '';
	if (!token) return { error: 'none' };
	const key = RATE_PREFIX + event.getClientAddress();
	const rl = await claimRateCheck(event.platform, key);
	if (rl.locked) return { error: 'locked' };
	const ctx = await pcContext(token);
	if ('error' in ctx) {
		if (ctx.error === 'invalid_token') await claimRecordFailure(event.platform, key);
		// 使えなくなった Cookie は消す（古いリンクを開いただけのときは、手元の有効な Cookie を残す）
		if (fromLink === undefined) event.cookies.delete(PRECHECKIN_COOKIE, { path: '/' });
		return ctx;
	}
	await claimRecordSuccess(event.platform, key);
	return { token, ctx };
}

// ---------------------------------------------------------------- 管理画面（authenticated）

export type PrecheckinListRow = {
	stay_id: string;
	booking_code: string | null;
	guest_name: string | null;
	guest_kana: string | null;
	check_in_date: string;
	check_out_date: string;
	nights: number;
	room_count: number;
	adults: number;
	source: string | null;
	channel_code: string | null;
	channel_name: string | null;
	channel_category: string | null;
	email: string | null;
	phone: string | null;
	precheckin_id: string | null;
	status: string | null;
	sent_at: string | null;
	sent_to: string | null;
	send_error: string | null;
	send_count: number;
	first_opened_at: string | null;
	answered_at: string | null;
	expires_at: string | null;
};

export type PrecheckinDetail = {
	stay_id: string;
	summary: {
		booking_code: string;
		source: string | null;
		channel_code: string | null;
		check_in: string;
		check_out: string;
		nights: number;
		room_count: number;
		adults: number;
		children: number;
		locale: string;
		guest: { name: string; name_kana: string; phone: string; email: string };
	};
	rooms: unknown;
	precheckin: null | {
		id: string;
		status: string;
		answers: PcAnswers;
		sent_to: string | null;
		sent_at: string | null;
		send_error: string | null;
		send_count: number;
		first_opened_at: string | null;
		last_opened_at: string | null;
		answered_at: string | null;
		expires_at: string | null;
		created_at: string;
	};
};

export type PrecheckinCaps = {
	times: { dinner: string[]; breakfast: string[] };
	caps: { type: 'dinner' | 'breakfast'; time: string; max_rooms: number }[];
};

async function rpc<T>(c: BookClient, fn: string, args: Record<string, unknown>): Promise<T> {
	const { data, error } = await c.rpc(fn, args);
	if (error) throw error;
	return data as T;
}

export const adminPrecheckinList = (c: BookClient, facility: string, from: string, to: string) =>
	rpc<PrecheckinListRow[]>(c, 'admin_precheckin_list', { p_facility: facility, p_from: from, p_to: to });

export const adminPrecheckinDetail = (c: BookClient, facility: string, stayId: string) =>
	rpc<PrecheckinDetail>(c, 'admin_precheckin_detail', { p_facility: facility, p_stay_id: stayId });

export const adminPrecheckinCaps = (c: BookClient, facility: string) =>
	rpc<PrecheckinCaps>(c, 'admin_precheckin_caps', { p_facility: facility });

export const adminPrecheckinSaveCaps = (c: BookClient, facility: string, caps: { type: string; time: string; max_rooms: string | null }[]) =>
	rpc<null>(c, 'admin_precheckin_save_caps', { p_facility: facility, p_caps: caps });

type IssueResult = {
	id: string;
	token: string;
	stay_id: string;
	to_email: string;
	guest_name: string;
	booking_code: string;
	check_in: string;
	check_out: string;
	nights: number;
	locale: string;
	facility_name: string;
	facility_slug: string;
	expires_at: string;
	editable_until: string;
};

/**
 * 事前チェックインのご案内を 1 通送る（送る／再送）。
 * 新しいトークンを発行してリンクに入れる（前のリンクは無効になる）。送信の失敗は例外にせず、理由を send_error に残す。
 */
export async function sendPrecheckin(
	event: RequestEvent,
	c: BookClient,
	facility: string,
	stayId: string
): Promise<{ sent: boolean; to: string; reason?: string }> {
	const issued = await rpc<IssueResult>(c, 'admin_precheckin_issue', { p_facility: facility, p_stay_id: stayId });
	const url = `${event.url.origin}/ci/${issued.token}`;
	const mail = buildPrecheckinMail({
		facilityName: issued.facility_name,
		guestName: issued.guest_name,
		checkIn: String(issued.check_in).slice(0, 10),
		checkOut: String(issued.check_out).slice(0, 10),
		nights: Number(issued.nights) || 1,
		bookingCode: issued.booking_code,
		url,
		editableUntil: issued.editable_until
	});
	// 返信先は施設の予約用アドレス（取引先メールと同じ。読めなければ付けない）
	const sender = await partnerMailSender(createSupabaseServerClient(event), facility).catch(() => null);
	const res = await sendHtmlEmail({
		to: [issued.to_email],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
		fromName: `${issued.facility_name} 事前チェックイン`,
		replyTo: sender?.replyTo ?? undefined
	});
	dbg('send', { id: issued.id, sent: res.sent, reason: res.reason });
	await rpc<null>(c, 'admin_precheckin_mark_sent', {
		p_facility: facility,
		p_id: issued.id,
		p_ok: res.sent,
		p_to: issued.to_email,
		p_error: res.sent ? null : (res.reason ?? 'unknown')
	});
	return { sent: res.sent, to: issued.to_email, reason: res.reason };
}
