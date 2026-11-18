import { json } from '@sveltejs/kit';
import { AUTHORIZE_PATH, bookingChatGPTEnabled, CHATGPT_ISSUER_PATH, SCOPE, TOKEN_PATH } from '$lib/server/booking-mcp/oauth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	if (!bookingChatGPTEnabled(url)) return new Response(null, { status: 404 });
	return json({
		issuer: url.origin + CHATGPT_ISSUER_PATH,
		authorization_endpoint: url.origin + AUTHORIZE_PATH,
		token_endpoint: url.origin + TOKEN_PATH,
		authorization_response_iss_parameter_supported: true,
		client_id_metadata_document_supported: true,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [SCOPE]
	});
};
