// 事前チェックイン P2（docs/pre-checkin.md）のサーバー側。
//
// DB: autumn-shared 20261028220125_book_precheckin_p2.sql（RPC のシグネチャはここと一致させる）
//   フォーム（anon・トークン）: precheckin_context(p_token) / precheckin_save_answers(p_token, p_answers) /
//                              precheckin_save_meals(p_token, p_meals)
//   P3（20261028223603）: precheckin_stay_token(p_token) … 滞在トークン（ab_stay）を受け取る。context に is_official 等
//   管理画面（authenticated）: admin_precheckin_list(p_facility, p_from, p_to) / admin_precheckin_detail(p_facility, p_stay_id) /
//                              admin_precheckin_issue(p_facility, p_stay_id) / admin_precheckin_mark_sent(p_facility, p_id, p_ok, p_to, p_error) /
//                              admin_precheckin_caps(p_facility) / admin_precheckin_save_caps(p_facility, p_caps)
//
// トークンはリンク（/ci/<token>）で受け取ったら httpOnly Cookie（ab_ci）に移し、URL から消す（/r/c/[token] と同じ）。
// トークン違いの連続は claim-rate-limit と同じ方式（KV）で数え、5 回でしばらく閉じる。
import { splashHint } from '$lib/precheckin-splash';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { DATA_SOURCE, supa } from '$lib/server/supabase';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { loadDemoMealSlots } from '$lib/server/precheckin-demo-meals';
import { rateLimitClientKey } from '$lib/server/client-key';
import { claimRateCheck, claimRecordFailure, claimRecordSuccess } from '$lib/server/claim-rate-limit';
import { sendHtmlEmail } from '$lib/server/mailer';
import type { BookClient } from '$lib/server/admin-app-data';
import {
	DEMO_PRECHECKIN_GUEST_TOKEN,
	isDemoPrecheckinToken,
	buildPrecheckinMail,
	precheckinMailFrom,
	demoPrecheckinContext,
	normalizePrecheckinContext,
	precheckinCookieMaxAge,
	type PcAnswers,
	type PcContext,
	type PcProfile,
	type PcQuestion,
	type PcError,
	type PcMealChoice
} from '$lib/precheckin';
import {
	DEFAULT_MEAL_MINUTES,
	normalizeMealMinutes,
	normalizeStayTokenResult,
	type MealMinutes,
	type StayTokenResult
} from '$lib/precheckin-p3';
import { normalizeAutosendSettings, type AutosendSettings } from '$lib/precheckin-sms';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { stayOffersPrecheckinBath } from '$lib/server/precheckin-sms';
import { customerLinkOrigin } from '$lib/server/public-origin';
import { waitUntilOf } from '$lib/server/access-log-core';
import {
	buildPrecheckinNotifyMail,
	normalizeNotifyBegin,
	normalizeNotifySettings,
	precheckinAdminUrl,
	type PrecheckinNotifySettings
} from '$lib/precheckin-notify';

// 開発中はログを出す（リリース前に false）
const DEBUG = true;
function dbg(...args: unknown[]) {
	if (DEBUG) console.log('[DBG precheckin]', ...args);
}

export const PRECHECKIN_COOKIE = 'ab_ci';
export const precheckinBathAccess = (token: string) => 'precheckin-bath:' + token;
const RATE_PREFIX = 'ci:';

// ---------------------------------------------------------------- 見本（DATA_SOURCE=demo）

// 見本の回答はこのブラウザの /ci だけで持ち、実予約には保存しない。
export const DEMO_ANSWERS_COOKIE = 'ab_ci_demo';
const DEMO_ANSWERS_PATH = '/ci';
const DEMO_ROOM_PATH = '/r';

function readDemoAnswers(cookies: Cookies): PcAnswers {
  try {
    const value = JSON.parse(cookies.get(DEMO_ANSWERS_COOKIE) ?? '{}') as PcAnswers;
    if (!value || typeof value !== 'object') return {};
    return {
      arrival_time: typeof value.arrival_time === 'string' ? value.arrival_time : null,
      basic_saved_at: typeof value.basic_saved_at === 'string' ? value.basic_saved_at : undefined,
      meals_saved_at: typeof value.meals_saved_at === 'string' ? value.meals_saved_at : undefined,
      questions: Array.isArray(value.questions) ? value.questions.filter((q) => q && typeof q.id === 'string' && typeof q.answer === 'string') : [],
      meals: Array.isArray(value.meals) ? value.meals.filter((meal) => meal && typeof meal.time === 'string') : []
    };
  } catch {
    return {};
  }
}

function writeDemoAnswers(cookies: Cookies, answers: PcAnswers, path = DEMO_ANSWERS_PATH): void {
  const value = JSON.stringify(answers);
  const compact = encodeURIComponent(value).length <= 3500 ? value : JSON.stringify({ ...answers, questions: [] });
  cookies.set(DEMO_ANSWERS_COOKIE, compact, { path, httpOnly: true, sameSite: 'lax', maxAge: 4 * 3600 });
}

export function copyDemoAnswersToRoom(cookies: Cookies): void {
  writeDemoAnswers(cookies, readDemoAnswers(cookies), DEMO_ROOM_PATH);
}

export function clearDemoAnswers(cookies: Cookies): void {
  cookies.delete(DEMO_ANSWERS_COOKIE, { path: DEMO_ANSWERS_PATH });
  cookies.delete(DEMO_ANSWERS_COOKIE, { path: DEMO_ROOM_PATH });
}

// ---------------------------------------------------------------- フォーム（anon）

/** トークンからフォームの中身を引く。開いた時刻も DB に残る */
export async function pcContext(token: string, demoAnswers: PcAnswers = {}): Promise<PcContext | { error: PcError }> {
	if (isDemoPrecheckinToken(token)) {
		const ctx = demoPrecheckinContext(demoAnswers, new Date(), token === DEMO_PRECHECKIN_GUEST_TOKEN);
		if (DATA_SOURCE !== 'supabase') return ctx;
		const facilityId = FACILITY_UUID[ctx.facility.id];
		const slots = await loadDemoMealSlots(facilityId, ctx.checkIn, ctx.checkOut).catch((error) => {
			dbg('demo meal settings error', error instanceof Error ? error.message : 'unavailable');
			return { dinner: {}, breakfast: {} };
		});
		return { ...ctx, facility: { ...ctx.facility, id: facilityId }, slots };
	}
	if (DATA_SOURCE !== 'supabase') return { error: 'invalid_token' };
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

export async function pcSaveAnswers(token: string, answers: PcAnswers, cookies: Cookies): Promise<PcSaveResult> {
	if (isDemoPrecheckinToken(token)) {
		writeDemoAnswers(cookies, {
			...readDemoAnswers(cookies),
			arrival_time: answers.arrival_time,
			questions: (answers.questions ?? []).map(({ id, answer }) => ({ id, answer })),
			basic_saved_at: new Date().toISOString()
		});
		return { ok: true };
	}
	if (DATA_SOURCE !== 'supabase') return { ok: false, error: 'invalid_token' };
	const { data, error } = await supa().rpc('precheckin_save_answers', { p_token: token, p_answers: answers });
	if (error) dbg('save_answers error', error.message);
	return rpcResult(data, error);
}

export async function pcSaveMeals(token: string, meals: PcMealChoice[], cookies: Cookies): Promise<PcSaveResult> {
	if (isDemoPrecheckinToken(token)) {
		writeDemoAnswers(cookies, { ...readDemoAnswers(cookies), meals: meals.filter((m) => m.time), meals_saved_at: new Date().toISOString() });
		return { ok: true };
	}
	if (DATA_SOURCE !== 'supabase') return { ok: false, error: 'invalid_token' };
	const { data, error } = await supa().rpc('precheckin_save_meals', { p_token: token, p_meals: meals });
	if (error) dbg('save_meals error', error.message);
	return rpcResult(data, error);
}

// ---------------------------------------------------------------- 宿への通知（回答の完了・修正）

/**
 * 回答の完了（② お食事の時間の送信）・あとからの修正を宿に知らせる（book.precheckin_notify_begin・20261115012421）。
 * DB が「確認待ち」にして（PMS のトップ画面に出る）、メールを送るとき（mail: true・10 分に 1 通まで）だけ宛先へ 1 通送る。
 * 未回答のうち（① だけ保存）は DB が notified:false を返すので何もしない。見本・DATA_SOURCE が supabase でないときも何もしない。
 * 失敗してもお客様の保存は失敗させない（ログだけ）。Cloudflare の waitUntil があれば応答の後ろへ回し、画面遷移を待たせない。
 */
export function pcNotifyFacility(event: Pick<RequestEvent, 'platform' | 'url'>, token: string): Promise<void> {
	if (isDemoPrecheckinToken(token) || DATA_SOURCE !== 'supabase') return Promise.resolve();
	const task = notifyFacilityTask(token, customerLinkOrigin(event.url)).catch((e) =>
		dbg('notify error', e instanceof Error ? e.message : String(e))
	);
	const wait = waitUntilOf(event.platform);
	if (wait) {
		wait(task);
		return Promise.resolve();
	}
	return task;
}

async function notifyFacilityTask(token: string, origin: string): Promise<void> {
	const { data, error } = await supa().rpc('precheckin_notify_begin', { p_token: token });
	if (error) {
		dbg('notify_begin error', error.message);
		return;
	}
	const r = normalizeNotifyBegin(data);
	dbg('notify_begin', { ok: r.ok, notified: r.notified, kind: r.kind, mail: r.mail });
	if (!r.ok || !r.notified || !r.mail || !r.to || !r.stayId) return;
	const mail = buildPrecheckinNotifyMail({
		kind: r.kind,
		facilityName: r.facilityName,
		guestName: r.guestName,
		bookingCode: r.bookingCode,
		checkIn: r.checkIn,
		nights: r.nights,
		answers: r.answers,
		adminUrl: precheckinAdminUrl(origin, r.stayId, r.facilityId)
	});
	// 差出人名はお客様向けの案内メール（sendPrecheckin）と揃える。宿のスタッフ宛てなので返信先は付けない
	const res = await sendHtmlEmail({
		to: [r.to],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
	});
	dbg('notify mail', { stay: r.stayId, sent: res.sent, reason: res.reason });
}

// ---------------------------------------------------------------- 滞在トークン（P3: 客室案内・貸切風呂へ）

const STAY_COOKIE = 'ab_stay';

export function clearStayCookie(cookies: Cookies): void {
	cookies.delete(STAY_COOKIE, { path: '/' });
}

/**
 * 事前チェックインのトークンから、その予約（代表の部屋）の滞在トークンを受け取る（book.precheckin_stay_cookie・P3）。
 * 回答済みの直販予約で、チェックイン日 20:00 より前に客室案内を開いたときに引き継ぐ。見本（DATA_SOURCE=demo）は客室案内の見本が別にあるので出さない。
 */
export async function pcStayToken(token: string): Promise<StayTokenResult> {
	if (isDemoPrecheckinToken(token) || DATA_SOURCE !== 'supabase') return { ok: false, error: 'not_eligible' };
	const { data, error } = await supa().rpc('precheckin_stay_cookie', { p_token: token });
	if (error) {
		dbg('stay_token error', error.message);
		return { ok: false, error: 'server' };
	}
	return normalizeStayTokenResult(data);
}

/**
 * 滞在トークンを受け取り、客室案内と同じ httpOnly Cookie（ab_stay）に入れる（/r/c/[token] と同じ。URL には出さない）。
 * 戻り値は受け取れた結果（呼び出し側が貸切風呂の予約状況を引くのに使う）。
 */
export async function ensureStayCookie(cookies: Cookies, pcToken: string): Promise<StayTokenResult> {
	const r = await pcStayToken(pcToken);
	if (r.ok) {
		cookies.set(STAY_COOKIE, r.token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: stayCookieMaxAge(r.validTo) });
	}
	dbg('stay cookie', r.ok ? 'set' : r.error);
	return r;
}

// ---------------------------------------------------------------- 顧客マスタの伺い書の項目（book.precheckin_guest_profile）

/**
 * PMS の顧客マスタ（core.guests）の 郵便番号・住所（address1+address2）・生年月日・領収書宛名。① の欄に最初から入れる。
 * 見本は見本の値。読めない（DB 適用前など）ときは空＝入力欄にする。
 */
export async function pcGuestProfile(token: string): Promise<PcProfile> {
	if (isDemoPrecheckinToken(token))
		return { zip_masked: '029-****', address_masked: '岩手県和賀郡 ***', birthdate_masked: '1980-**-**', has_address: true, has_birthdate: true, receipt_name: null, arrival_time: '15:00' };
	if (DATA_SOURCE !== 'supabase') return {};
	const { data, error } = await supa().rpc('precheckin_guest_profile', { p_token: token });
	if (error) {
		dbg('guest_profile error', error.message);
		return {};
	}
	const r = (data ?? {}) as Record<string, unknown>;
	if (r.ok !== true) return {};
	const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	return {
		zip: str(r.zip),
		address: str(r.address),
		birthdate: str(r.birthdate)?.slice(0, 10) ?? null,
		// 顧客マスタの値は伏せて受け取る（電話・メールと同じ・2026-11-23 レビュー M-5）
		zip_masked: str(r.zip_masked),
		address_masked: str(r.address_masked),
		birthdate_masked: str(r.birthdate_masked),
		has_address: r.has_address === true || Boolean(str(r.address)),
		has_birthdate: r.has_birthdate === true || Boolean(str(r.birthdate)),
		receipt_name: str(r.receipt_name),
		arrival_time: str(r.arrival_time),
		family_name: str(r.family_name),
		given_name: str(r.given_name),
		family_name_kana: str(r.family_name_kana),
		given_name_kana: str(r.given_name_kana)
	};
}

// ---------------------------------------------------------------- 宿からの質問（book.precheckin_questions）

/** 見本の質問（見本の画面で回答欄を確かめられるように） */
export const DEMO_QUESTIONS: PcQuestion[] = [{ id: 'demo-q1', question: 'ご到着の交通手段（お車・電車など）を教えてください。' }];

/** 施設の宿からの質問（有効なもの・表示順）。見本は DEMO_QUESTIONS。読めないときは空（質問なし） */
export async function pcQuestions(facilityId: string, demo = false): Promise<PcQuestion[]> {
	if (demo && DATA_SOURCE !== 'supabase') return DEMO_QUESTIONS;
	if (DATA_SOURCE !== 'supabase' || !/^[0-9a-f-]{36}$/i.test(facilityId)) return [];
	const { data, error } = await supa()
		.from('precheckin_questions')
		.select('id, question')
		.eq('facility_id', facilityId)
		.eq('is_active', true)
		.order('sort_order');
	if (error) dbg('questions error', error.message);
	return ((data ?? []) as { id: string; question: string }[]).map((q) => ({ id: q.id, question: q.question }));
}

// ---------------------------------------------------------------- 食事の所要時間の目安（book.precheckin_settings）

/** 施設の食事の所要時間の目安（分）。見本・未設定・読めないときは既定（夕食 120・朝食 60） */
export async function pcMealMinutes(facilityId: string): Promise<MealMinutes> {
	if (DATA_SOURCE !== 'supabase' || !/^[0-9a-f-]{36}$/i.test(facilityId)) return DEFAULT_MEAL_MINUTES;
	const { data, error } = await supa()
		.from('precheckin_settings')
		.select('dinner_minutes, breakfast_minutes')
		.eq('facility_id', facilityId)
		.maybeSingle();
	if (error) dbg('meal minutes error', error.message);
	return normalizeMealMinutes(data);
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
	const key = RATE_PREFIX + rateLimitClientKey(event.getClientAddress());
	const rl = await claimRateCheck(event.platform, key);
	if (rl.locked) return { error: 'locked' };
	const ctx = await pcContext(token, isDemoPrecheckinToken(token) && !fromLink ? readDemoAnswers(event.cookies) : {});
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

/** 食事の所要時間の目安（分）。未設定・読めないときは既定 */
export async function adminPrecheckinMinutes(c: BookClient, facility: string): Promise<MealMinutes> {
	const { data, error } = await c.from('precheckin_settings').select('dinner_minutes, breakfast_minutes').eq('facility_id', facility).maybeSingle();
	if (error) throw error;
	return normalizeMealMinutes(data);
}

/** 宿からの質問（管理画面・表示順） */
export async function adminPrecheckinQuestions(c: BookClient, facility: string): Promise<PcQuestion[]> {
	const { data, error } = await c.from('precheckin_questions').select('id, question').eq('facility_id', facility).order('sort_order');
	if (error) throw error;
	return ((data ?? []) as PcQuestion[]).map((q) => ({ id: q.id, question: q.question }));
}

/** 宿からの質問を丸ごと置き換える（並び順＝表示順・空欄は捨てる・一覧から消した質問は削除） */
export const adminPrecheckinSaveQuestions = (c: BookClient, facility: string, questions: { id: string | null; question: string }[]) =>
	rpc<null>(c, 'admin_precheckin_save_questions', { p_facility: facility, p_questions: questions });

/** 自動送信の対象の設定（経路・有効か・選べる経路） */
export const adminPrecheckinAutosend = async (c: BookClient, facility: string): Promise<AutosendSettings> =>
	normalizeAutosendSettings(await rpc<unknown>(c, 'admin_precheckin_autosend', { p_facility: facility }));

export const adminPrecheckinSaveAutosend = (c: BookClient, facility: string, enabled: boolean, routes: string[]) =>
	rpc<null>(c, 'admin_precheckin_save_autosend', { p_facility: facility, p_enabled: enabled, p_routes: routes });

/** 予約ごとの上書き。include = true 送る／false 送らない／null 経路の設定どおり */
export const adminPrecheckinSetAutosend = (c: BookClient, facility: string, stayId: string, include: boolean | null) =>
	rpc<null>(c, 'admin_precheckin_set_autosend', { p_facility: facility, p_stay_id: stayId, p_include: include });

/** 一覧の予約の上書き（stay_id → include） */
export async function adminPrecheckinAutosendOverrides(c: BookClient, facility: string, stayIds: string[]): Promise<Record<string, boolean>> {
	if (!stayIds.length) return {};
	const rows = await rpc<{ stay_id: string; include: boolean }[]>(c, 'admin_precheckin_autosend_overrides', { p_facility: facility, p_stay_ids: stayIds });
	return Object.fromEntries((rows ?? []).map((r) => [r.stay_id, r.include === true]));
}

export const adminPrecheckinSaveMinutes = (c: BookClient, facility: string, m: MealMinutes) =>
	rpc<null>(c, 'admin_precheckin_save_minutes', { p_facility: facility, p_dinner: m.dinner, p_breakfast: m.breakfast });

/** 回答が届いたときの通知メールの設定（宛先・送るか・施設の代表アドレス） */
export const adminPrecheckinNotify = async (c: BookClient, facility: string): Promise<PrecheckinNotifySettings> =>
	normalizeNotifySettings(await rpc<unknown>(c, 'admin_precheckin_notify', { p_facility: facility }));

/** 通知メールの設定を保存（宛先は空欄なら代表アドレスへ。形が違えば例外 invalid_email） */
export const adminPrecheckinSaveNotify = (c: BookClient, facility: string, email: string, enabled: boolean) =>
	rpc<null>(c, 'admin_precheckin_save_notify', { p_facility: facility, p_email: email, p_enabled: enabled });

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
	// ?f=<施設の slug> は、リンクを開いた瞬間の読み込み中の画面に出すロゴの目印（$lib/precheckin-splash）
	const url = `${event.url.origin}/ci/${issued.token}${splashHint(issued.facility_slug)}`;
	const bath = await stayOffersPrecheckinBath(stayId);
	const mail = buildPrecheckinMail({
		facilityName: issued.facility_name,
		guestName: issued.guest_name,
		checkIn: String(issued.check_in).slice(0, 10),
		checkOut: String(issued.check_out).slice(0, 10),
		nights: Number(issued.nights) || 1,
		bookingCode: issued.booking_code,
		url,
		editableUntil: issued.editable_until,
		bath,
		facilitySlug: issued.facility_slug,
		assetOrigin: event.url.origin
	});
	// 送信専用（noreply@yamado.app・返信先なし・2026-11-26）。差出人名は「<施設名> 事前チェックイン」
	const res = await sendHtmlEmail({
		to: [issued.to_email],
		subject: mail.subject,
		html: mail.html,
		text: mail.text,
		from: precheckinMailFrom(issued.facility_name)
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
