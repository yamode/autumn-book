import { json } from '@sveltejs/kit';
import { bookingMcpEnabled, MCP_PATH, OAUTH_PATH, SCOPE } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	if (!bookingMcpEnabled(url)) return new Response(null, { status: 404 });
	return json({
		resource: url.origin + MCP_PATH,
		resource_name: 'YAMADO',
		authorization_servers: [url.origin + OAUTH_PATH],
		bearer_methods_supported: ['header'],
		scopes_supported: [SCOPE]
	});
};
