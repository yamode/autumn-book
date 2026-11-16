import { error, redirect } from '@sveltejs/kit';
import { activeBookMember, authorizationRequest, bookingMcpEnabled, CONNECTOR_ICON_PATH, isMuseClient, issueAuthorizationCode, PILOT_CLIENT_ID, pilotMemberAllowed, privatePageHeaders } from '$lib/server/booking-mcp/oauth';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

async function consent(event: RequestEvent) {
	const { url, locals } = event;
	event.setHeaders({ ...privatePageHeaders, 'content-security-policy': "frame-ancestors 'none'" });
	if (!bookingMcpEnabled(url)) error(404);
	const authorization = authorizationRequest(url);
	if (!authorization) error(400, 'YAMADOの接続要求を確認できません。コネクターの設定からやり直してください。');
	const next = encodeURIComponent(url.pathname + url.search);
	if (locals.pendingAuthUser) redirect(303, `/auth/register?next=${next}`);
	if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${next}`);
	if (!await activeBookMember(locals.user.id)) {
		error(403, '山人Bookの会員アカウントでログインしてください。');
	}
	const pilot = authorization.clientId === PILOT_CLIENT_ID;
	if (pilot && !await pilotMemberAllowed(locals.user.id)) error(403, 'この会員アカウントは試験連携の対象外です。');
	return { userId: locals.user.id, pilot, muse: isMuseClient(authorization.clientId), ...authorization };
}

export const load: PageServerLoad = async (event) => {
	const { pilot, onsite, muse } = await consent(event);
	return { icon: CONNECTOR_ICON_PATH, pilot, onsite, muse, appName: muse ? 'Muse' : 'Claude' };
};

export const actions: Actions = {
	default: async (event) => {
		// This page is a browser-only state change. The token endpoint is the only CSRF exception.
		if (event.request.headers.get('origin') !== event.url.origin) error(403);
		const { userId, challenge, state, callback, clientId, onsite, muse } = await consent(event);
		const decision = (await event.request.formData()).get('decision');
		if (decision !== 'allow' && decision !== 'deny' && !(muse && onsite && decision === 'read')) error(400);
		const code = decision === 'deny' ? null : await issueAuthorizationCode(userId, challenge, clientId, callback, onsite && decision === 'allow');
		if (state !== null) callback.searchParams.set('state', state);
		if (code) callback.searchParams.set('code', code);
		else callback.searchParams.set('error', 'access_denied');
		redirect(303, callback.href);
	}
};
