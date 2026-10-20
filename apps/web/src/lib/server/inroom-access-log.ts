// 客室案内（/r）のアクセスログ（book.inroom_access_logs）。2026-10-17 指示。
// ページを表示したときにブラウザが /r/api/view へ送り、ここで1行残す（画面の自動再読込は数えない）。
// 滞在コードが紐づいていれば（Cookie の滞在トークンが有効なら）どの部屋かも残す。トークンの解決は DB 側（book.log_inroom_access）。
// 記録は service_role（partnerServiceClient）。一覧は施設スタッフの RPC（book.admin_list_inroom_access）。
// IP は残さない。同じ端末かどうかは visitor_id（端末の Cookie のランダム値）で見る。
// DATA_SOURCE=demo（または service_role が無い・管理画面が AUTH_MODE=demo）はプロセス内の配列。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE } from './supabase';
import { FACILITY_UUID } from './supabase-data';
import { partnerServiceClient } from './partners/admin-client';
import { resolveStay } from './store';
import { facilityIdFromSlug } from './inroom-banners';

export type AccessLogInput = {
	token: string | null;
	facilitySlug: string | null;
	path: string;
	guideId: string | null;
	locale: string;
	device: string;
	visitorId: string;
};

export type AccessLogRow = {
	id: string;
	createdAt: string;
	roomCode: string | null;
	guestName: string | null;
	tokenId: string | null;
	isDemo: boolean;
	path: string;
	guideId: string | null;
	locale: string | null;
	device: string | null;
	visitorId: string | null;
};

const demoLogs: (AccessLogRow & { facilityId: string })[] = [];

/** User-Agent から端末の種類だけ取り出す（細かい UA は残さない） */
export function deviceKind(ua: string | null): string {
	const s = ua ?? '';
	if (/iPad/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))) return 'iPad';
	if (/iPhone|iPod/i.test(s)) return 'iPhone';
	if (/Android/i.test(s)) return /Mobile/i.test(s) ? 'Android' : 'Androidタブレット';
	if (/Windows|Macintosh|Linux|CrOS/i.test(s)) return 'PC';
	return 'その他';
}

/** 記録する客室案内のページだけ通す（/r・/r/g/<id>・/r/bath 以下）。それ以外は null */
export function normalizeInroomPath(path: unknown): { path: string; guideId: string | null } | null {
	if (typeof path !== 'string' || path.length > 200) return null;
	const p = path.replace(/\/+$/, '') || '/';
	if (p === '/r') return { path: p, guideId: null };
	const g = /^\/r\/g\/([A-Za-z0-9_-]{1,80})$/.exec(p);
	if (g) return { path: p, guideId: g[1] };
	if (/^\/r\/bath(\/[a-z-]+)?$/.test(p)) return { path: p, guideId: null };
	return null;
}

export async function logInroomAccess(input: AccessLogInput): Promise<void> {
	const sb = DATA_SOURCE === 'supabase' ? partnerServiceClient() : null;
	if (!sb) {
		logDemo(input);
		return;
	}
	const { error } = await sb.schema('book').rpc('log_inroom_access', {
		p_token: input.token ?? '',
		p_facility_slug: input.facilitySlug ?? '',
		p_path: input.path,
		p_guide_id: input.guideId ?? '',
		p_locale: input.locale,
		p_device: input.device,
		p_visitor_id: input.visitorId
	});
	if (error) console.warn('[inroom-access-log]', error.message);
}

function logDemo(input: AccessLogInput): void {
	const stay = input.token ? resolveStay(input.token, 'ja') : null;
	const facilityId = stay?.facility.id ?? facilityIdFromSlug(input.facilitySlug);
	if (!facilityId) return;
	demoLogs.push({
		facilityId,
		id: String(demoLogs.length + 1),
		createdAt: new Date().toISOString(),
		roomCode: stay?.roomCode ?? null,
		guestName: stay?.guestName ?? null,
		tokenId: stay?.tokenId ?? null,
		isDemo: stay?.isDemo === true,
		path: input.path,
		guideId: input.guideId,
		locale: input.locale,
		device: input.device,
		visitorId: input.visitorId
	});
	if (demoLogs.length > 5000) demoLogs.splice(0, demoLogs.length - 5000);
}

// ---- 管理画面 ----

/** JST の日付（YYYY-MM-DD）の範囲 */
function jstDayRange(date: string): [number, number] {
	const from = Date.parse(`${date}T00:00:00+09:00`);
	return [from, from + 24 * 60 * 60 * 1000];
}

export function listAccessDemo(facilityId: string, date: string): AccessLogRow[] {
	const [from, to] = jstDayRange(date);
	return demoLogs
		.filter((l) => l.facilityId === facilityId && Date.parse(l.createdAt) >= from && Date.parse(l.createdAt) < to)
		.reverse()
		.map(({ facilityId: _f, ...r }) => r);
}

type DbRow = {
	id: number;
	created_at: string;
	room_code: string | null;
	guest_name: string | null;
	token_id: string | null;
	is_demo: boolean;
	path: string;
	guide_id: string | null;
	locale: string | null;
	device: string | null;
	visitor_id: string | null;
};

export async function sbListAccess(client: SupabaseClient, facilityId: string, date: string): Promise<AccessLogRow[]> {
	const { data, error } = await client.schema('book').rpc('admin_list_inroom_access', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_date: date
	});
	if (error) throw new Error('アクセスログを読めませんでした（' + error.message + '）');
	return ((data ?? []) as DbRow[]).map((r) => ({
		id: String(r.id),
		createdAt: r.created_at,
		roomCode: r.room_code,
		guestName: r.guest_name,
		tokenId: r.token_id,
		isDemo: r.is_demo === true,
		path: r.path,
		guideId: r.guide_id,
		locale: r.locale,
		device: r.device,
		visitorId: r.visitor_id
	}));
}

// ---- 期間集計（2026-10-21 指示）。月間など任意の期間で、どのページが何回見られたか ----

export type AccessCount = { views: number; visitors: number };
export type AccessSummary = {
	totals: AccessCount & { rooms: number };
	byPage: (AccessCount & { path: string; guideId: string | null })[];
	byDay: (AccessCount & { day: string })[];
	byRoom: (AccessCount & { roomCode: string | null })[];
	byLocale: { key: string | null; views: number }[];
	byDevice: { key: string | null; views: number }[];
};

/** 集計できる最長の期間（日数・両端を含めない差）。DB 側の上限と揃える */
export const MAX_SUMMARY_SPAN_DAYS = 366;

const jstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** 行の一覧から期間集計を作る（見本環境用。DB の book.admin_inroom_access_summary と同じ形・見本の滞在は除く） */
export function summarizeAccess(rows: AccessLogRow[]): AccessSummary {
	const real = rows.filter((r) => !r.isDemo);
	const group = <K>(key: (r: AccessLogRow) => K) => {
		const m = new Map<K, { views: number; visitors: Set<string> }>();
		for (const r of real) {
			const k = key(r);
			const cur = m.get(k) ?? { views: 0, visitors: new Set<string>() };
			cur.views += 1;
			if (r.visitorId) cur.visitors.add(r.visitorId);
			m.set(k, cur);
		}
		return [...m.entries()].map(([k, v]) => ({ k, views: v.views, visitors: v.visitors.size }));
	};
	return {
		totals: {
			views: real.length,
			visitors: new Set(real.map((r) => r.visitorId).filter(Boolean)).size,
			rooms: new Set(real.map((r) => r.roomCode).filter(Boolean)).size
		},
		byPage: group((r) => `${r.path}\u0000${r.guideId ?? ''}`)
			.map(({ k, views, visitors }) => {
				const [path, guideId] = k.split('\u0000');
				return { path, guideId: guideId || null, views, visitors };
			})
			.sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)),
		byDay: group((r) => jstDay(r.createdAt))
			.map(({ k, views, visitors }) => ({ day: k, views, visitors }))
			.sort((a, b) => a.day.localeCompare(b.day)),
		byRoom: group((r) => r.roomCode)
			.map(({ k, views, visitors }) => ({ roomCode: k, views, visitors }))
			.sort((a, b) => (a.roomCode === null ? 1 : b.roomCode === null ? -1 : a.roomCode.localeCompare(b.roomCode))),
		byLocale: group((r) => r.locale)
			.map(({ k, views }) => ({ key: k, views }))
			.sort((a, b) => b.views - a.views),
		byDevice: group((r) => r.device)
			.map(({ k, views }) => ({ key: k, views }))
			.sort((a, b) => b.views - a.views)
	};
}

/** 見本環境：プロセス内の記録から期間（JST の日付・両端を含む）で集計 */
export function summarizeAccessDemo(facilityId: string, from: string, to: string): AccessSummary {
	const start = Date.parse(`${from}T00:00:00+09:00`);
	const end = jstDayRange(to)[1];
	return summarizeAccess(
		demoLogs
			.filter((l) => l.facilityId === facilityId && Date.parse(l.createdAt) >= start && Date.parse(l.createdAt) < end)
			.map(({ facilityId: _f, ...r }) => r)
	);
}

type DbCount = { views: number; visitors: number };
type DbSummary = {
	totals: DbCount & { rooms: number };
	by_page: (DbCount & { path: string; guide_id: string | null })[];
	by_day: (DbCount & { day: string })[];
	by_room: (DbCount & { room_code: string | null })[];
	by_locale: { key: string | null; views: number }[];
	by_device: { key: string | null; views: number }[];
};

export async function sbSummarizeAccess(client: SupabaseClient, facilityId: string, from: string, to: string): Promise<AccessSummary> {
	const { data, error } = await client.schema('book').rpc('admin_inroom_access_summary', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_from: from,
		p_to: to
	});
	if (error) throw new Error('アクセスログを集計できませんでした（' + error.message + '）');
	const d = data as DbSummary;
	return {
		totals: d.totals,
		byPage: d.by_page.map((r) => ({ path: r.path, guideId: r.guide_id, views: r.views, visitors: r.visitors })),
		byDay: d.by_day.map((r) => ({ day: r.day, views: r.views, visitors: r.visitors })),
		byRoom: d.by_room.map((r) => ({ roomCode: r.room_code, views: r.views, visitors: r.visitors })),
		byLocale: d.by_locale,
		byDevice: d.by_device
	};
}
