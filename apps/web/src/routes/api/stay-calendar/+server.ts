// GET /api/stay-calendar?facility=<施設ID>&nights=2&adults=2[&plan=<プランID>][&room=<部屋タイプID>][&months=6]
// 日付ピッカーで泊数を変えたとき、その泊数で予約できる日と最安「1名1泊」を返す（公開情報のみ）。
import { json } from '@sveltejs/kit';
import { stayCalendar } from '$lib/server/stay-calendar';
import type { RequestHandler } from './$types';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const facility = url.searchParams.get('facility') ?? '';
	if (!facility) return json({ error: 'facility_required' }, { status: 400 });
	const plan = url.searchParams.get('plan') || undefined;
	try {
		const result = await stayCalendar(
			facility,
			clamp(url.searchParams.get('nights'), 1, 7, 1),
			clamp(url.searchParams.get('adults'), 1, 6, 2),
			{ planId: plan, roomTypeId: url.searchParams.get('room') || undefined, months: clamp(url.searchParams.get('months'), 1, 6, 2) }
		);
		setHeaders({ 'cache-control': 'private, max-age=60' });
		return json(result);
	} catch (e) {
		console.error('[api/stay-calendar]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503 });
	}
};
