import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbBathContent, sbBathContext } from '$lib/server/private-bath';
import { EMPTY_BATH_CONTENT } from '$lib/private-bath-content';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const token = cookies.get('ab_stay');
	if (!token || DATA_SOURCE !== 'supabase') redirect(303, '/r');

	const ctx = await sbBathContext(token);
	if (!ctx?.ok) redirect(303, '/r');

	const date = url.searchParams.get('date');
	const from = url.searchParams.get('from');
	const bathId = url.searchParams.get('bath') || null;
	const reservation = ctx.mine?.find(
		(r) => r.date === date && r.from === from && r.bath_id === bathId
	);
	// A completion URL is never enough to claim a booking: it must belong to this stay.
	if (!reservation) redirect(303, '/r/bath');

	const content = ctx.facility?.id
		? await sbBathContent(ctx.facility.id, getLocale()).catch(() => EMPTY_BATH_CONTENT)
		: EMPTY_BATH_CONTENT;
	const bathName = ctx.baths?.find((b) => b.bath_id === reservation.bath_id)?.bath_name ?? null;

	return { ctx, reservation, bathName, content, headerTitle: m.bath_step3(), headerBack: '/r/bath' };
};
