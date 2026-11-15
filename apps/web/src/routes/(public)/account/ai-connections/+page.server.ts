import { error, redirect } from '@sveltejs/kit';
import { bookingMcpEnabled, hasBookingAccess, PILOT_CLIENT_ID, privatePageHeaders, revokeBookingAccess } from '$lib/server/booking-mcp/oauth';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

function memberId({ locals, url, setHeaders }: RequestEvent) {
	setHeaders(privatePageHeaders);
	if (!bookingMcpEnabled(url)) error(404);
	if (locals.user?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fai-connections');
	return locals.user.id;
}

export const load: PageServerLoad = async (event) => {
	const userId = memberId(event);
	const [connected, pilotConnected] = await Promise.all([hasBookingAccess(userId), hasBookingAccess(userId, PILOT_CLIENT_ID)]);
	return { connected, pilotConnected };
};

export const actions: Actions = {
	disconnect: async (event) => {
		const userId = memberId(event);
		await revokeBookingAccess(userId);
		redirect(303, '/account/ai-connections');
	},
	disconnectPilot: async (event) => {
		await revokeBookingAccess(memberId(event), PILOT_CLIENT_ID);
		redirect(303, '/account/ai-connections');
	}
};
