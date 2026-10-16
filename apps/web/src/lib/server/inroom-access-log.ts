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
