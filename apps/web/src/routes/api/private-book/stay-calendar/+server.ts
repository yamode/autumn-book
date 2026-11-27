// GET /api/private-book/stay-calendar?facility=<施設ID or slug>&nights=2&adults=2[&plan=<プランID>][&room=<部屋タイプID>][&months=6]
// プライベートブックの状態の日付ピッカー・空室カレンダー（docs/private-book.md）。/api/stay-calendar と同じ形で返す。
// 状態（hooks が確かめた locals.privateBook）で、その施設が特別料金なら特別料金を重ね、そうでなければふつうの料金のまま。
// 会員ごとに違う料金なので、CORS は付けず（施設 HP からは呼ばない）、ブラウザにも保存させない（no-store）。
import { json } from '@sveltejs/kit';
import { resolveStayFacility, stayCalendar } from '$lib/server/stay-calendar';
import { privateBookFacility, privateBookStayCalendar } from '$lib/server/private-book';
import type { RequestHandler } from './$types';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const NO_STORE = { 'cache-control': 'private, no-store' };

export const GET: RequestHandler = async ({ url, locals }) => {
	const raw = url.searchParams.get('facility') ?? '';
	if (!raw || raw === 'all') return json({ error: 'facility_required' }, { status: 400, headers: NO_STORE });
	const facilityId = resolveStayFacility(raw);
	const nights = clamp(url.searchParams.get('nights'), 1, 7, 1);
	const adults = clamp(url.searchParams.get('adults'), 1, 6, 2);
	const planId = url.searchParams.get('plan') || undefined;
	const roomTypeId = url.searchParams.get('room') || undefined;
	try {
		const [normal, fac] = await Promise.all([
			stayCalendar(facilityId, nights, adults, { planId, roomTypeId, months: clamp(url.searchParams.get('months'), 1, 6, 2) }),
			privateBookFacility(locals.privateBook, facilityId)
		]);
		const result = await privateBookStayCalendar(fac, facilityId, nights, adults, normal, { planId, roomTypeId });
		return json(result, { headers: NO_STORE });
	} catch (e) {
		console.error('[api/private-book/stay-calendar]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
	}
};
