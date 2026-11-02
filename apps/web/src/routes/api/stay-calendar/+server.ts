// GET /api/stay-calendar?facility=<施設ID or slug | all>&nights=2&adults=2[&plan=<プランID>][&room=<部屋タイプID>][&months=6]
// facility=all は全施設まとめ（トップなど施設を決めていない検索バー・最安と空室数の合計）。
// 日付ピッカーで泊数を変えたとき、その泊数で予約できる日と最安「1名1泊」を返す（公開情報のみ）。
// 施設 HP の検索バー（static/embed/search-bar.js）からも呼ばれるので、両 HP のオリジンだけ CORS を許可する（$lib/server/hp-cors）。
import { json } from '@sveltejs/kit';
import { hpCorsHeaders } from '$lib/server/hp-cors';
import { allFacilitiesStayCalendar, stayCalendar } from '$lib/server/stay-calendar';
import { isStaffViewer } from '$lib/server/plan-preview';
import type { RequestHandler } from './$types';

const clamp = (value: string | null, min: number, max: number, fallback: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const GET: RequestHandler = async ({ url, request, setHeaders, locals }) => {
	const cors = hpCorsHeaders(request.headers.get('origin'));
	const facility = url.searchParams.get('facility') ?? '';
	if (!facility) return json({ error: 'facility_required' }, { status: 400, headers: cors });
	const plan = url.searchParams.get('plan') || undefined;
	// &preview=1: スタッフの販売ページプレビュー（販売中でないプランも本物の空室で返す・$lib/server/plan-preview）
	const previewPlanId = plan && url.searchParams.get('preview') === '1' && isStaffViewer(locals) ? plan : undefined;
	try {
		if (facility === 'all') {
			const result = await allFacilitiesStayCalendar(clamp(url.searchParams.get('nights'), 1, 7, 1), clamp(url.searchParams.get('adults'), 1, 6, 2), clamp(url.searchParams.get('months'), 1, 6, 2));
			setHeaders({ 'cache-control': 'private, max-age=60', ...cors });
			return json(result);
		}
		const result = await stayCalendar(
			facility,
			clamp(url.searchParams.get('nights'), 1, 7, 1),
			clamp(url.searchParams.get('adults'), 1, 6, 2),
			{ planId: plan, roomTypeId: url.searchParams.get('room') || undefined, months: clamp(url.searchParams.get('months'), 1, 6, 2), previewPlanId }
		);
		setHeaders({ 'cache-control': previewPlanId ? 'private, no-store' : 'private, max-age=60', ...cors });
		return json(result);
	} catch (e) {
		console.error('[api/stay-calendar]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503, headers: cors });
	}
};

export const OPTIONS: RequestHandler = async ({ request }) =>
	new Response(null, { status: 204, headers: hpCorsHeaders(request.headers.get('origin'), { 'Cache-Control': 'max-age=86400' }) });
