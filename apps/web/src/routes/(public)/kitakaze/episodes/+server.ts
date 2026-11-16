import { json } from '@sveltejs/kit';
import { kitakazeEpisodePage } from '$lib/server/kitakaze';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const before = url.searchParams.get('before') ?? '';
	const result = before ? await kitakazeEpisodePage(before) : null;
	if (!result) return json({ error: 'invalid_cursor' }, { status: 400 });
	return json(result);
};
