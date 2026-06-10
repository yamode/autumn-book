import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const f = url.searchParams.get('f');
	if (f) cookies.set('ab_fac', f, { path: '/admin', httpOnly: true, sameSite: 'lax' });
	redirect(303, url.searchParams.get('back') ?? '/admin');
};
