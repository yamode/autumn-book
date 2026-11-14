// 事前チェックイン P3（docs/pre-checkin.md §6 貸切風呂・§8 OTA 誘導バナー）の純関数。DB に触らない
// （単体テスト: precheckin-p3.test.ts）。
//
// DB: autumn-shared 20261028223603_book_precheckin_p3_bath_banner.sql
//   - precheckin_context の is_official / is_partner / facility.portal_slug → showOtaBanner / portalSlugOf
//   - precheckin_stay_token(p_token) の戻り → normalizeStayTokenResult
import type { PcContext } from '$lib/precheckin';

// ---------------------------------------------------------------- OTA 誘導バナー

/**
 * 誘導バナーを出すか。公式サイト予約（source=autumn_booking）と取引先経由（rms_partner）には出さない。
 * tripla は公式サイト予約ではないので出す（§7・Q8）。is_official が分からない（DB 適用前）ときは出さない。
 */
export function showOtaBanner(ctx: Pick<PcContext, 'isOfficial' | 'isPartner'>): boolean {
	return ctx.isOfficial === false && !ctx.isPartner;
}

/** core.facilities.slug → 予約トップの slug（ディープリンク契約 v1 §2: nishiwaga / oga）。DB 適用前の代わり */
const CORE_TO_PORTAL: Record<string, string> = { yamado: 'nishiwaga', nishiwaga: 'nishiwaga', oga: 'oga' };

/** 予約トップの slug。DB の portal_slug を優先し、無ければ既知の 2 施設を対応表で引く。分からなければ null */
export function portalSlugOf(f: Pick<PcContext['facility'], 'slug' | 'portalSlug'>): string | null {
	const p = (f.portalSlug ?? '').trim();
	if (/^[a-z0-9-]+$/.test(p)) return p;
	return CORE_TO_PORTAL[(f.slug ?? '').trim()] ?? null;
}

/** 施設の予約トップのパス（E1: /yamado/<slug>）。言語の接頭辞は呼び出し側（localizeHref）で付ける */
export function officialTopPath(portalSlug: string): string {
	return `/yamado/${portalSlug}`;
}

/**
 * UTM を付ける（utm_source=precheckin&utm_medium=ota&utm_campaign=<施設slug>）。
 * 既にあるクエリは残し、同じ名前の UTM だけ置き換える。#以降も残す。
 */
export function withPrecheckinUtm(href: string, campaign: string): string {
	const hashAt = href.indexOf('#');
	const hash = hashAt >= 0 ? href.slice(hashAt) : '';
	const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const qAt = noHash.indexOf('?');
	const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
	const params = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '');
	params.set('utm_source', 'precheckin');
	params.set('utm_medium', 'ota');
	params.set('utm_campaign', campaign);
	return `${path}?${params.toString()}${hash}`;
}

/**
 * バナーのリンク先。localize は言語の接頭辞を付ける関数（localizeHref）。
 * 施設が分からないときは null（バナーを出さない）。
 */
export function otaBannerHref(
	f: Pick<PcContext['facility'], 'slug' | 'portalSlug'>,
	localize: (path: string) => string = (p) => p
): string | null {
	const slug = portalSlugOf(f);
	if (!slug) return null;
	return withPrecheckinUtm(localize(officialTopPath(slug)), slug);
}

// ---------------------------------------------------------------- 滞在トークン（客室案内・貸切風呂へ）

export type StayTokenError = 'invalid_token' | 'expired' | 'cancelled' | 'not_answered' | 'closed' | 'not_eligible' | 'server';
export type StayTokenResult = { ok: true; token: string; validFrom: string; validTo: string } | { ok: false; error: StayTokenError };

const STAY_TOKEN_ERRORS: StayTokenError[] = ['invalid_token', 'expired', 'cancelled', 'not_answered', 'closed', 'not_eligible'];

/** book.precheckin_stay_token の戻りを整える */
export function normalizeStayTokenResult(raw: unknown): StayTokenResult {
	const r = (raw ?? {}) as Record<string, unknown>;
	if (r.ok === true && typeof r.token === 'string' && /^[0-9a-f]{32,128}$/i.test(r.token)) {
		return { ok: true, token: r.token, validFrom: String(r.valid_from ?? ''), validTo: String(r.valid_to ?? '') };
	}
	const e = String(r.error ?? '') as StayTokenError;
	return { ok: false, error: STAY_TOKEN_ERRORS.includes(e) ? e : 'server' };
}

/** /ci/go?to= の行き先。知らない値は客室案内 */
export type CiGoTarget = 'bath' | 'inroom';
export const ciGoTarget = (v: string | null | undefined): CiGoTarget => (v === 'bath' ? 'bath' : 'inroom');
export const ciGoPath = (t: CiGoTarget) => (t === 'bath' ? '/r/bath' : '/r');

// ---------------------------------------------------------------- 貸切風呂のステップ

/**
 * /ci/bath の状態。
 *   not_answered … ② お食事の時間をまだ送っていない（滞在トークンを出さない）
 *   closed       … 回答を受け付けていない（2026-11-14 に締め切りを廃止したので、今の DB では起きない）
 *   not_yet      … 滞在トークンの有効開始（チェックイン日 9:00）より前（前日以前に手動で送ったとき）
 *   unavailable  … この施設は貸切風呂の受付をしていない／一時的に読めない
 *   ready        … 予約画面へ案内できる（予約済みの枠も出す）
 */
export type CiBathState = 'not_answered' | 'closed' | 'not_yet' | 'unavailable' | 'ready';

export function ciBathState(i: {
	answered: boolean;
	editable: boolean;
	token: StayTokenResult | null;
	now?: Date;
	bathOpen: boolean | null;
}): CiBathState {
	if (!i.editable) return 'closed';
	if (!i.answered) return 'not_answered';
	if (!i.token || !i.token.ok) {
		if (i.token && !i.token.ok && i.token.error === 'closed') return 'closed';
		if (i.token && !i.token.ok && i.token.error === 'not_answered') return 'not_answered';
		return 'unavailable';
	}
	const from = Date.parse(i.token.validFrom);
	if (Number.isFinite(from) && (i.now ?? new Date()).getTime() < from) return 'not_yet';
	return i.bathOpen ? 'ready' : 'unavailable';
}

export type CiBathRow = { key: string; date: string; from: string; to: string | null; bathName: string };

/** 予約済みの枠を画面の行にする（日付・開始の順。浴室名は context の baths から引く） */
export function ciBathRows(
	mine: { id: string; date: string; from: string; to: string | null; bath_id: string | null }[] | undefined,
	baths: { bath_id: string | null; bath_name: string }[] | undefined
): CiBathRow[] {
	const names = new Map((baths ?? []).map((b) => [b.bath_id ?? '', b.bath_name]));
	return [...(mine ?? [])]
		.sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from))
		.map((r) => ({ key: r.id, date: r.date, from: r.from, to: r.to, bathName: names.get(r.bath_id ?? '') ?? '' }));
}

// ---------------------------------------------------------------- 食事の所要時間の目安（貸切風呂の時間選び）

/** 食事の所要時間の目安（分）。施設設定 book.precheckin_settings。無ければこの既定 */
export type MealMinutes = { dinner: number; breakfast: number };
// 夕食 2 時間半（客室案内の貸切風呂の案内「ご夕食で約2時間〜2時間30分」に合わせる）・朝食 1 時間
export const DEFAULT_MEAL_MINUTES: MealMinutes = { dinner: 150, breakfast: 60 };

/** DB の行（dinner_minutes / breakfast_minutes）を整える。壊れた値は既定 */
export function normalizeMealMinutes(raw: unknown): MealMinutes {
	const r = (raw ?? {}) as Record<string, unknown>;
	const ok = (v: unknown, d: number) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 600 && v !== null && v !== '' ? Number(v) : d);
	return { dinner: ok(r.dinner_minutes, DEFAULT_MEAL_MINUTES.dinner), breakfast: ok(r.breakfast_minutes, DEFAULT_MEAL_MINUTES.breakfast) };
}

/** 'HH:MM' に分を足す（24:00 を超えても日はまたがない表記: 23:30 + 60 → 24:30） */
export function addMinutes(hhmm: string, min: number): string {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	if (!m) return hhmm;
	const t = Number(m[1]) * 60 + Number(m[2]) + min;
	return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const toMin = (hhmm: string) => {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
	return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** 食事の時間帯（開始〜目安の終わり）。room は複数室のときの何室目 */
export type MealWindow = { key: string; date: string; type: 'dinner' | 'breakfast'; from: string; to: string; minutes: number; room: number };

/**
 * 選んだ食事の時間を、所要時間の目安つきの時間帯にする（日付・開始の順）。
 * 時間が未定の食事は出さない。同じ日・同じ食事・同じ時間（複数室で同じ時間）は 1 つにまとめる。
 */
export function mealWindows(
	rooms: { index: number; nights: { stayId: string; dinner: { date: string; offered: boolean; time: string | null }; breakfast: { date: string; offered: boolean; time: string | null } }[] }[],
	minutes: MealMinutes
): MealWindow[] {
	const out = new Map<string, MealWindow>();
	for (const r of rooms)
		for (const n of r.nights)
			for (const type of ['dinner', 'breakfast'] as const) {
				const c = n[type];
				if (!c.offered || !c.time) continue;
				const key = `${c.date}|${type}|${c.time}`;
				if (out.has(key)) continue;
				out.set(key, { key, date: c.date, type, from: c.time, to: addMinutes(c.time, minutes[type]), minutes: minutes[type], room: r.index });
			}
	return [...out.values()].sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
}

/** 貸切風呂の枠（date・from〜to）が食事の時間帯と重なるか（端が接するだけは重ならない） */
export function overlapsMeal(date: string, from: string, to: string | null, windows: MealWindow[]): boolean {
	const s = toMin(from);
	const e = to ? toMin(to) : s + 30;
	if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
	return windows.some((w) => w.date === date && w.minutes > 0 && s < toMin(w.to) && toMin(w.from) < e);
}

/** 所要時間の表示（120 → '2時間'、90 → '1時間30分'、45 → '45分'）。日本語以外は呼び出し側で */
export function minutesJa(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return h && m ? `${h}時間${m}分` : h ? `${h}時間` : `${m}分`;
}
