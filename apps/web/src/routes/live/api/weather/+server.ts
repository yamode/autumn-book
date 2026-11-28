// Autumn Live: いまの天気（西和賀・男鹿）。気象庁の観測と予報から決める（docs/autumn-live.md §11）。入場券は hooks.server.ts（handleLive）で確かめ済み。
// 画面が 10 分ごとに読む。読めないときは { places: [] } を返し、画面は「おまかせ」の天気にする。
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadLiveWeather } from '$lib/server/live-weather';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.live) return json({ error: 'forbidden' }, { status: 403 });
	const w = await loadLiveWeather();
	return json(w ?? { at: null, places: [] }, { headers: { 'cache-control': 'no-store' } });
};
