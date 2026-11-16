import { json } from '@sveltejs/kit';
import { bookingResource, OAUTH_PATH } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const resource = bookingResource(new URL(url.pathname.replace('/.well-known/oauth-protected-resource', ''), url.origin));
	if (!resource) return new Response(null, { status: 404 });
	return json({
		resource: url.origin + resource.path,
		resource_name: 'YAMADO',
		authorization_servers: [url.origin + OAUTH_PATH],
		bearer_methods_supported: ['header'],
		scopes_supported: [resource.scope]
	});
};
