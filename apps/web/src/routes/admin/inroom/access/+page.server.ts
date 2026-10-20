import { listHouseGuidesAdmin } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID, sbListHouseGuides } from '$lib/server/supabase-data';
import {
	listAccessDemo,
	MAX_SUMMARY_SPAN_DAYS,
	sbListAccess,
	sbSummarizeAccess,
	summarizeAccessDemo,
	type AccessLogRow,
	type AccessSummary
} from '$lib/server/inroom-access-log';
import type { PageServerLoad } from './$types';

// 客室案内のアクセスログ（2026-10-17 指示）。日付（JST）ごとに、いつ・どの部屋の方が・どのページを開いたか。
// 滞在コードが紐づいていない（入口QRから館内案内だけ見ている）アクセスは部屋が空。
// ?view=period で任意の期間の集計（2026-10-21 指示）。既定は今月1日〜今日。
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const spanDays = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const q = event.url.searchParams;
	const today = todayJst();
	const view: 'day' | 'period' = q.get('view') === 'period' ? 'period' : 'day';
	const dateParam = q.get('date') ?? '';
	const date = isDate(dateParam) ? dateParam : today;

	// 期間（両端を含む）。逆順なら入れ替え、長すぎれば終わりから数えて上限まで
	let from = q.get('from') ?? '';
	let to = q.get('to') ?? '';
	if (!isDate(to) || to > today) to = today;
	if (!isDate(from)) from = `${to.slice(0, 7)}-01`;
	if (from > to) [from, to] = [to, from];
	let rangeNote: string | null = null;
	if (spanDays(from, to) > MAX_SUMMARY_SPAN_DAYS) {
		from = new Date(Date.parse(`${to}T00:00:00Z`) - MAX_SUMMARY_SPAN_DAYS * 86400000).toISOString().slice(0, 10);
		rangeNote = `集計できるのは最長 ${MAX_SUMMARY_SPAN_DAYS + 1} 日です。開始日を ${from} にしました。`;
	}

	let rows: AccessLogRow[] = [];
	let summary: AccessSummary | null = null;
	let loadError: string | null = null;
	let guideTitles: Record<string, string> = {};
	if (useSupabaseAdmin) {
		try {
			const client = createSupabaseServerClient(event);
			const [r, guides] = await Promise.all([
				view === 'period' ? sbSummarizeAccess(client, currentFacility.id, from, to) : sbListAccess(client, currentFacility.id, date),
				sbListHouseGuides(FACILITY_UUID[currentFacility.id] ?? currentFacility.id, 'ja').catch(() => [])
			]);
			if (Array.isArray(r)) rows = r;
			else summary = r;
			guideTitles = Object.fromEntries(guides.map((g) => [g.id, g.title]));
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	} else {
		if (view === 'period') summary = summarizeAccessDemo(currentFacility.id, from, to);
		else rows = listAccessDemo(currentFacility.id, date);
		guideTitles = Object.fromEntries(listHouseGuidesAdmin(currentFacility.id).map((g) => [g.id, g.title]));
	}
	return { view, date, from, to, rangeNote, today, rows, summary, guideTitles, loadError, live: useSupabaseAdmin };
};
