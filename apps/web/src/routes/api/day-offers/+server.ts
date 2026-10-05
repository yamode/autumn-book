// GET /api/day-offers?facility=<施設ID>&checkin=YYYY-MM-DD&nights=1&adults=2[&room=<部屋タイプID>][&tag=<タグ>]
// 空室カレンダーで日を押したとき、その日に予約できる部屋×プランを安い順に返す（公開情報のみ）。
import { json } from '@sveltejs/kit';
import { dayOffers } from '$lib/server/day-offers';
import { getLocale } from '$lib/paraglide/runtime';
import type { RequestHandler } from './$types';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const facility = url.searchParams.get('facility') ?? '';
	const checkin = url.searchParams.get('checkin') ?? '';
	if (!facility || !/^\d{4}-\d{2}-\d{2}$/.test(checkin)) return json({ error: 'bad_request' }, { status: 400 });
	try {
		const offers = await dayOffers(facility, checkin, clamp(url.searchParams.get('nights'), 1, 7, 1), clamp(url.searchParams.get('adults'), 1, 6, 2), {
			roomTypeId: url.searchParams.get('room') || undefined,
			tag: url.searchParams.get('tag') || undefined,
			locale: getLocale()
		});
		setHeaders({ 'cache-control': 'private, max-age=30' });
		return json({ offers });
	} catch (e) {
		console.error('[api/day-offers]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503 });
	}
};
