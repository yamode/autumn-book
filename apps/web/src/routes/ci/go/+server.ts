import { redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { clearStayCookie, ensureStayCookie, resolvePrecheckin } from '$lib/server/precheckin';
import { BROWSE_FACILITY_COOKIE, rememberBrowseFacility } from '$lib/server/inroom-browse';
import { ROOM_COOKIE } from '$lib/server/intercom';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { ciGoPath, ciGoTarget } from '$lib/precheckin-p3';
import { isDemoPrecheckinToken } from '$lib/precheckin';
import { PRECHECKIN_ROOM_PREVIEW } from '$lib/server/precheckin-room-preview';
import type { RequestHandler } from './$types';

// 客室案内に移るときだけ、滞在トークンを Cookie（ab_stay）に入れる。
export const GET: RequestHandler = async (event) => {
	const to = ciGoTarget(event.url.searchParams.get('to'));
	if (to === 'inroom') {
		const r = await resolvePrecheckin(event);
		if (!('ctx' in r)) redirect(303, localizeHref('/ci'));
		if (isDemoPrecheckinToken(r.token)) {
			redirect(303, localizeHref(r.ctx.answeredAt ? PRECHECKIN_ROOM_PREVIEW : '/ci'));
		}
		const { cookies } = event;
		const { facility } = r.ctx;
		const storeId = Object.keys(FACILITY_UUID).find((id) => FACILITY_UUID[id] === facility.id);
		const slug = facility.portalSlug ?? storeId?.slice(2) ?? facility.slug;
		const knownFacility = rememberBrowseFacility(cookies, slug, getLocale());
		const stay = await ensureStayCookie(cookies, r.token);
		// 別の滞在の Cookie で先に開かないよう、引き継げない場合はこの施設の案内を開く。
		if (!stay.ok) {
			clearStayCookie(cookies);
			cookies.delete(ROOM_COOKIE, { path: '/' });
			if (knownFacility) redirect(303, localizeHref(`/r?f=${encodeURIComponent(slug)}`));
			cookies.delete(BROWSE_FACILITY_COOKIE, { path: '/' });
		}
	}
	redirect(303, localizeHref(ciGoPath(to)));
};
