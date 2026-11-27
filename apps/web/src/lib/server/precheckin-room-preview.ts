import type { RequestEvent } from '@sveltejs/kit';
import { isDemoPrecheckinToken } from '$lib/precheckin';
import { PRECHECKIN_COOKIE, resolvePrecheckin } from '$lib/server/precheckin';

export const PRECHECKIN_ROOM_PREVIEW = '/r?preview=precheckin';

/** 見本の回答がある端末だけ。通常の滞在Cookieや、実際の滞在情報は使わない。 */
export async function precheckinRoomPreview(event: RequestEvent) {
	if (!isDemoPrecheckinToken(event.cookies.get(PRECHECKIN_COOKIE) ?? '')) return null;
	const result = await resolvePrecheckin(event);
	return 'ctx' in result && result.ctx.answeredAt ? result.ctx : null;
}
