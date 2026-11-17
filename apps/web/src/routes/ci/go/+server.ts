import { redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import { ensureStayCookie, resolvePrecheckin } from '$lib/server/precheckin';
import { ciGoPath, ciGoTarget } from '$lib/precheckin-p3';
import type { RequestHandler } from './$types';

// 客室案内に移るときだけ、滞在トークンを Cookie（ab_stay）に入れる。
export const GET: RequestHandler = async (event) => {
	const to = ciGoTarget(event.url.searchParams.get('to'));
	if (to === 'inroom') {
		const r = await resolvePrecheckin(event);
		if ('ctx' in r) await ensureStayCookie(event.cookies, r.token);
	}
	redirect(303, localizeHref(ciGoPath(to)));
};
