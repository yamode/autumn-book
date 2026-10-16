// 客室案内（/r）の全客室へのお知らせ（施設ごと・book.inroom_notices）。2026-10-17 指示。
// 既読は端末ごと（ブラウザの localStorage）で持つので、ここでは「いま出ているお知らせ」を返すだけ。
// 公開側は anon で読む（RLS で掲載期間内・取り下げていないものだけ見える）。
// 管理画面はログイン中スタッフの権限で RPC（book.admin_save_inroom_notice / admin_end_inroom_notice / admin_list_inroom_notices）。
// DATA_SOURCE=demo（または管理画面が AUTH_MODE=demo）はプロセス内の配列。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';

export type InroomNotice = { id: string; title: string; body: string; startsAt: string; endsAt: string | null };
export type AdminInroomNotice = InroomNotice & { endedAt: string | null; live: boolean };

type Row = { id: string; title: string; body: string; starts_at: string; ends_at: string | null; ended_at?: string | null };
const toNotice = (r: Row): InroomNotice => ({ id: r.id, title: r.title ?? '', body: r.body, startsAt: r.starts_at, endsAt: r.ends_at });

const demoNotices: (AdminInroomNotice & { facilityId: string })[] = [];

function isLive(n: { startsAt: string; endsAt: string | null; endedAt: string | null }, now = Date.now()): boolean {
	return !n.endedAt && Date.parse(n.startsAt) <= now && (!n.endsAt || Date.parse(n.endsAt) > now);
}

// 客室案内に出すお知らせ（掲載中・新しい順）。読めなければ出さない
export async function loadLiveNotices(facilityId: string): Promise<InroomNotice[]> {
	if (DATA_SOURCE !== 'supabase') {
		return demoNotices
			.filter((n) => n.facilityId === facilityId && isLive(n))
			.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
			.map(({ id, title, body, startsAt, endsAt }) => ({ id, title, body, startsAt, endsAt }));
	}
	try {
		const { data, error } = await supa()
			.from('inroom_notices')
			.select('id, title, body, starts_at, ends_at')
			.eq('facility_id', FACILITY_UUID[facilityId] ?? facilityId)
			.order('starts_at', { ascending: false })
			.limit(10);
		if (error || !data) return [];
		return (data as Row[]).map(toNotice);
	} catch {
		return [];
	}
}

// ---- 管理画面 ----

export function listNoticesDemo(facilityId: string): AdminInroomNotice[] {
	return demoNotices
		.filter((n) => n.facilityId === facilityId)
		.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
		.map(({ facilityId: _f, ...n }) => ({ ...n, live: isLive(n) }));
}

export function saveNoticeDemo(facilityId: string, input: { title: string; body: string; endsAt: string | null }): void {
	demoNotices.push({
		facilityId,
		id: crypto.randomUUID(),
		title: input.title,
		body: input.body,
		startsAt: new Date().toISOString(),
		endsAt: input.endsAt,
		endedAt: null,
		live: true
	});
}

export function endNoticeDemo(id: string): void {
	const n = demoNotices.find((x) => x.id === id);
	if (n && !n.endedAt) n.endedAt = new Date().toISOString();
}

export async function sbListNotices(client: SupabaseClient, facilityId: string): Promise<AdminInroomNotice[]> {
	const { data, error } = await client.schema('book').rpc('admin_list_inroom_notices', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_limit: 20
	});
	if (error) throw new Error('お知らせの一覧を読めませんでした（' + error.message + '）');
	return ((data ?? []) as Row[]).map((r) => {
		const n = { ...toNotice(r), endedAt: r.ended_at ?? null };
		return { ...n, live: isLive(n) };
	});
}

export async function sbSaveNotice(
	client: SupabaseClient,
	facilityId: string,
	input: { title: string; body: string; endsAt: string | null }
): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_inroom_notice', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_id: null,
		p_title: input.title,
		p_body: input.body,
		p_ends_at: input.endsAt
	});
	if (error) throw new Error('お知らせを出せませんでした（' + error.message + '）');
}

export async function sbEndNotice(client: SupabaseClient, id: string): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_end_inroom_notice', { p_id: id });
	if (error) throw new Error('お知らせを取り下げられませんでした（' + error.message + '）');
}
