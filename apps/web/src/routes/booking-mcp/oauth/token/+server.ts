import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { bookingMcpEnabled, exchangeToken, privateHeaders } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

const DEBUG = dev;

export const POST: RequestHandler = async ({ request, url }) => {
	if (!bookingMcpEnabled(url)) return new Response(null, { status: 404, headers: privateHeaders });
	try {
		return await exchangeToken(request, url);
	} catch {
		if (DEBUG) console.warn('[DBG booking-mcp] token exchange failed');
		return json({ error: 'server_error' }, { status: 503, headers: privateHeaders });
	}
};
