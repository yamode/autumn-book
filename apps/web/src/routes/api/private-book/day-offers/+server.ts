// GET /api/private-book/day-offers?facility=<施設ID>&checkin=YYYY-MM-DD&nights=1&adults=2[&room=<部屋タイプID>][&meal=<お食事>]
// プライベートブックの状態の空室カレンダーで日を押したとき（docs/private-book.md）。/api/day-offers と同じ形で返す。
// その施設が特別料金なら、出せる組を特別料金に差し替える（出せない組はふつうの料金のまま）。会員ごとの料金なので no-store。
import { json } from '@sveltejs/kit';
import { dayOffers } from '$lib/server/day-offers';
import { privateBookFacility, privateBookOffers } from '$lib/server/private-book';
import { getLocale } from '$lib/paraglide/runtime';
import type { RequestHandler } from './$types';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const NO_STORE = { 'cache-control': 'private, no-store' };

export const GET: RequestHandler = async ({ url, locals }) => {
	const facility = url.searchParams.get('facility') ?? '';
	const checkin = url.searchParams.get('checkin') ?? '';
	if (!facility || !/^\d{4}-\d{2}-\d{2}$/.test(checkin)) return json({ error: 'bad_request' }, { status: 400, headers: NO_STORE });
	const nights = clamp(url.searchParams.get('nights'), 1, 7, 1);
	const adults = clamp(url.searchParams.get('adults'), 1, 6, 2);
	const roomTypeId = url.searchParams.get('room') || undefined;
	try {
		const fac = await privateBookFacility(locals.privateBook, facility);
		const special = await privateBookOffers(fac, facility, checkin, nights, adults, { roomTypeId });
		const offers = await dayOffers(facility, checkin, nights, adults, {
			roomTypeId,
			meal: url.searchParams.get('meal') || undefined,
			locale: getLocale(),
			special
		});
		return json({ offers }, { headers: NO_STORE });
	} catch (e) {
		console.error('[api/private-book/day-offers]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
	}
};
