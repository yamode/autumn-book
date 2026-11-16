import { json } from '@sveltejs/kit';
import { bookingMcpEnabled, bookingPilotEnabled, bookingReservationsEnabled, OAUTH_PATH, ONSITE_SCOPE, SCOPE, TOKEN_PATH } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	if (!bookingMcpEnabled(url)) return new Response(null, { status: 404 });
	return json({
		issuer: url.origin + OAUTH_PATH,
		authorization_endpoint: `${url.origin}${OAUTH_PATH}/authorize`,
		token_endpoint: url.origin + TOKEN_PATH,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: bookingPilotEnabled(url) || bookingReservationsEnabled(url) ? [SCOPE, ONSITE_SCOPE] : [SCOPE]
	});
};
