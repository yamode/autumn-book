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
import type { BathContext } from '$lib/server/private-bath';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';

// 開発中はログを出す（リリース前に false）
const DEBUG = true;
function dbg(...args: unknown[]) {
	if (DEBUG) console.log('[DBG precheckin]', ...args);
}

export const PRECHECKIN_COOKIE = 'ab_ci';
const RATE_PREFIX = 'ci:';

// ---------------------------------------------------------------- 見本（DATA_SOURCE=demo）

// 見本（DEMO_PRECHECKIN_TOKEN）はどのデータ源でも開ける。DB には一切触れず、回答はプロセス内だけに持つ（再起動・別の isolate では消える）。
// 本番でも、お客様に届く画面（/ci・食事の時間）をスタッフが確かめられるようにするため（管理画面の「お客様フォームの見本」から）。
let demoAnswers: PcAnswers = {};

// ---------------------------------------------------------------- フォーム（anon）

/** トークンからフォームの中身を引く。開いた時刻も DB に残る */
export async function pcContext(token: string): Promise<PcContext | { error: PcError }> {
	if (token === DEMO_PRECHECKIN_TOKEN) return demoPrecheckinContext(demoAnswers);
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

export async function pcSaveAnswers(token: string, answers: PcAnswers): Promise<PcSaveResult> {
	if (token === DEMO_PRECHECKIN_TOKEN) {
		const questions = (answers.questions ?? []).map((a) => ({ ...a, question: DEMO_QUESTIONS.find((q) => q.id === a.id)?.question ?? '' }));
		demoAnswers = { ...demoAnswers, ...answers, questions, basic_saved_at: new Date().toISOString() };
		return { ok: true };
	}
	if (DATA_SOURCE !== 'supabase') return { ok: false, error: 'invalid_token' };
	const { data, error } = await supa().rpc('precheckin_save_answers', { p_token: token, p_answers: answers });
	if (error) dbg('save_answers error', error.message);
	return rpcResult(data, error);
}

export async function pcSaveMeals(token: string, meals: PcMealChoice[]): Promise<PcSaveResult> {
	if (token === DEMO_PRECHECKIN_TOKEN) {
		demoAnswers = { ...demoAnswers, meals: meals.filter((m) => m.time), meals_saved_at: new Date().toISOString() };
		return { ok: true };
	}
	if (DATA_SOURCE !== 'supabase') return { ok: false, error: 'invalid_token' };
	const { data, error } = await supa().rpc('precheckin_save_meals', { p_token: token, p_meals: meals });
	if (error) dbg('save_meals error', error.message);
	return rpcResult(data, error);
}

// ---------------------------------------------------------------- 滞在トークン（P3: 客室案内・貸切風呂へ）

const STAY_COOKIE = 'ab_stay';

/**
 * 事前チェックインのトークンから、その予約（代表の部屋）の滞在トークンを受け取る（book.precheckin_stay_token・P3）。
 * 回答済み・チェックイン日 12:00 より前だけ。見本（DATA_SOURCE=demo）は客室案内の見本が別にあるので出さない。
 */
export async function pcStayToken(token: string): Promise<StayTokenResult> {
	if (DATA_SOURCE !== 'supabase') return { ok: false, error: 'not_eligible' };
	const { data, error } = await supa().rpc('precheckin_stay_token', { p_token: token });
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
	if (token === DEMO_PRECHECKIN_TOKEN)
		return { zip: '029-5514', address: '岩手県和賀郡西和賀町湯川52-71-10', birthdate: '1980-05-10', receipt_name: null, arrival_time: '15:00' };
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
		receipt_name: str(r.receipt_name),
		arrival_time: str(r.arrival_time)
	};
}

// ---------------------------------------------------------------- 宿からの質問（book.precheckin_questions）

/** 見本の質問（見本の画面で回答欄を確かめられるように） */
export const DEMO_QUESTIONS: PcQuestion[] = [{ id: 'demo-q1', question: 'ご到着の交通手段（お車・電車など）を教えてください。' }];

/** 施設の宿からの質問（有効なもの・表示順）。見本は DEMO_QUESTIONS。読めないときは空（質問なし） */
export async function pcQuestions(facilityId: string, demo = false): Promise<PcQuestion[]> {
	if (demo) return DEMO_QUESTIONS;
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

// ---------------------------------------------------------------- 見本の貸切風呂（DB に触れない）

// 見本（DEMO_PRECHECKIN_TOKEN）の ③ 貸切風呂で、予約・取消まで試せるようにする。プロセス内だけに持つ（再起動で消える）。
let demoBathMine: { id: string; date: string; from: string; to: string }[] = [];

const hm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
const isMorning = (from: string) => Number(from.slice(0, 2)) < 12;

/** 見本の枠: チェックイン日は 15:00〜22:20、翌朝は 6:00〜9:20（40 分枠・10 分入れ替え）。午前・午後で 1 部屋 1 枠ずつ */
function demoBathSlots(morning: boolean): { from: string; to: string }[] {
	const out: { from: string; to: string }[] = [];
	const [start, end] = morning ? [6 * 60, 10 * 60] : [15 * 60, 23 * 60];
	for (let t = start; t + 40 <= end; t += 50) out.push({ from: hm(t), to: hm(t + 40) });
	return out;
}

/** 見本の貸切風呂（private_bath_context と同じ形） */
export function demoBathContext(checkIn: string): BathContext {
	const next = new Date(Date.parse(`${checkIn}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
	const taken = new Set([`${checkIn} 16:40`, `${checkIn} 19:10`, `${next} 07:40`]); // 他のお客様が取った見本の枠
	const day = (date: string, morning: boolean) => ({
		date,
		slots: demoBathSlots(morning).map((s) => {
			const mine = demoBathMine.find((r) => r.date === date && r.from === s.from);
			const limit = demoBathMine.some((r) => r.date === date && isMorning(r.from) === morning);
			return { ...s, taken: taken.has(`${date} ${s.from}`) || !!mine, mine: !!mine, slot_id: mine?.id ?? null, closed: false, limit_reached: limit };
		})
	});
	return {
		ok: true,
		enabled: true,
		price_yen: 0,
		per_room_per_range: 1,
		cutoff_min: 30,
		cancel_min: 60,
		check_in_date: checkIn,
		check_out_date: next,
		baths: [{ bath_id: 'demo-bath', bath_name: '貸切風呂（見本）', days: [day(checkIn, false), day(next, true)] }],
		mine: demoBathMine.map((r) => ({ id: r.id, date: r.date, from: r.from, to: r.to, bath_id: 'demo-bath', price_yen: 0, booked_via: 'guest', cancelable: true })),
		group: { shared: false }
	};
}

export function demoBathReserve(date: string, from: string): 'ok' | 'slot_taken' | 'per_room_limit' {
	// どの日の枠かは日付で引く（見本はチェックイン日と翌朝の 2 日）
	const ctx = demoBathContext(isMorning(from) ? new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10) : date);
	const slot = ctx.baths?.[0].days.find((d) => d.date === date)?.slots.find((s) => s.from === from);
	if (!slot || slot.taken) return 'slot_taken';
	if (slot.limit_reached) return 'per_room_limit';
	demoBathMine = [...demoBathMine, { id: `demo-${date}-${from}`, date, from, to: slot.to }];
	return 'ok';
}

export function demoBathCancel(slotId: string): boolean {
	const before = demoBathMine.length;
	demoBathMine = demoBathMine.filter((r) => r.id !== slotId);
	return demoBathMine.length < before;
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

export const adminPrecheckinSaveMinutes = (c: BookClient, facility: string, m: MealMinutes) =>
	rpc<null>(c, 'admin_precheckin_save_minutes', { p_facility: facility, p_dinner: m.dinner, p_breakfast: m.breakfast });

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
