import { listHouseGuidesAdmin } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID, sbListHouseGuides } from '$lib/server/supabase-data';
import { listAccessDemo, sbListAccess, type AccessLogRow } from '$lib/server/inroom-access-log';
import type { PageServerLoad } from './$types';

// 客室案内のアクセスログ（2026-10-17 指示）。日付（JST）ごとに、いつ・どの部屋の方が・どのページを開いたか。
// 滞在コードが紐づいていない（入口QRから館内案内だけ見ている）アクセスは部屋が空。
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const dateParam = event.url.searchParams.get('date') ?? '';
	const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayJst();

	let rows: AccessLogRow[] = [];
	let loadError: string | null = null;
	let guideTitles: Record<string, string> = {};
	if (useSupabaseAdmin) {
		try {
			const [r, guides] = await Promise.all([
				sbListAccess(createSupabaseServerClient(event), currentFacility.id, date),
				sbListHouseGuides(FACILITY_UUID[currentFacility.id] ?? currentFacility.id, 'ja').catch(() => [])
			]);
			rows = r;
			guideTitles = Object.fromEntries(guides.map((g) => [g.id, g.title]));
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	} else {
		rows = listAccessDemo(currentFacility.id, date);
		guideTitles = Object.fromEntries(listHouseGuidesAdmin(currentFacility.id).map((g) => [g.id, g.title]));
	}
	return { date, today: todayJst(), rows, guideTitles, loadError, live: useSupabaseAdmin };
};
