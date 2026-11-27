// 館内のご案内の詳細。トップのカードから1件ずつ開く。
//
// 現行の VERY travel と同じで、長い案内（ルームサービスのメニュー等）はトップに積まず
// 個別のページに置く。滞在の確認は /r と同じく httpOnly Cookie のトークンだけを見る。
import { error, redirect } from '@sveltejs/kit';
import { listHouseGuidesFor, resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbListHouseGuides, sbResolveStay } from '$lib/server/supabase-data';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { PRECHECKIN_ROOM_PREVIEW, precheckinRoomPreview } from '$lib/server/precheckin-room-preview';
import { browseFacility, browseVisibleGuide } from '$lib/server/inroom-browse';
import type { PageServerLoad } from './$types';

const STAY_COOKIE = 'ab_stay';

export const load: PageServerLoad = async (event) => {
	const { cookies, params, url } = event;
	const locale = getLocale();
	if (url.searchParams.get('preview') === 'precheckin') {
		const ctx = await precheckinRoomPreview(event);
		if (!ctx) redirect(303, localizeHref('/ci'));
		event.setHeaders({ 'cache-control': 'private, no-store' });
		const guides = DATA_SOURCE === 'supabase' ? await sbListHouseGuides(ctx.facility.id, locale) : listHouseGuidesFor(ctx.facility.id, locale);
		const guide = guides.find((item) => item.id === params.id && browseVisibleGuide(item));
		const headerBack = localizeHref(PRECHECKIN_ROOM_PREVIEW);
		if (!guide) redirect(303, headerBack);
		return { stay: null, facilitySlug: ctx.facility.slug, guide, headerTitle: guide.title, headerBack };
	}
	const token = cookies.get(STAY_COOKIE);
	const stay = token ? (DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, locale)) : null;
	// 滞在が無くても、入口QRで覚えた施設（Cookie ab_facility）の案内は見られる（2026-10-10・inroom-browse.ts）。
	// どちらも無ければ /r（コード入力・終了案内）へ寄せる
	const browse = stay ? null : browseFacility(cookies, null, locale);
	const facilityId = stay?.facility.id ?? browse?.id;
	if (!facilityId) redirect(303, '/r');

	const guides =
		DATA_SOURCE === 'supabase' ? await sbListHouseGuides(facilityId, locale) : listHouseGuidesFor(facilityId, locale);

	const guide = guides.find((g) => g.id === params.id);
	if (!guide) redirect(303, '/r');
	// コードなし（館内案内だけ）では Wi-Fi などは見せない（browseVisibleGuide）。
	// ページ1件だけの QR から来た方のために、コードを入れたらこのページへ戻す（?g・2026-10-15）
	if (!stay && !browseVisibleGuide(guide)) {
		const q = new URLSearchParams({ ...(browse?.slug ? { f: browse.slug } : {}), g: guide.id });
		redirect(303, `/r?${q.toString()}`);
	}

	return { stay, facilitySlug: stay?.facility.slug ?? browse?.slug ?? '', guide, headerTitle: guide.title, headerBack: '/r' };
};
