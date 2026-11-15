import { error, redirect } from '@sveltejs/kit';
import { bookingMcpEnabled, hasBookingAccess, privateHeaders, revokeBookingAccess } from '$lib/server/booking-mcp/oauth';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

function memberId({ locals, url, setHeaders }: RequestEvent) {
	setHeaders(privateHeaders);
	if (!bookingMcpEnabled(url)) error(404);
	if (locals.user?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fai-connections');
	return locals.user.id;
}

export const load: PageServerLoad = async (event) => ({
	connected: await hasBookingAccess(memberId(event))
});

export const actions: Actions = {
	disconnect: async (event) => {
		const userId = memberId(event);
		await revokeBookingAccess(userId);
		redirect(303, '/account/ai-connections');
	}
};
