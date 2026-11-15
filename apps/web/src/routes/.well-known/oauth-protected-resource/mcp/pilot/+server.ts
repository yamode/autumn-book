import { json } from '@sveltejs/kit';
import { bookingPilotEnabled, OAUTH_PATH, PILOT_MCP_PATH, PILOT_SCOPE } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	if (!bookingPilotEnabled(url)) return new Response(null, { status: 404 });
	return json({
		resource: url.origin + PILOT_MCP_PATH,
		resource_name: 'YAMADO',
		authorization_servers: [url.origin + OAUTH_PATH],
		bearer_methods_supported: ['header'],
		scopes_supported: [PILOT_SCOPE]
	});
};
