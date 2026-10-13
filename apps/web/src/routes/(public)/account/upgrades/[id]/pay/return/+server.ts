import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { confirmUpgradeIntent } from '$lib/server/upgrade-payments';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	const back = `/account/upgrades/${event.params.id}`;
	if (event.locals.user?.role !== 'member' || !MEMBER_SUPABASE) redirect(303, `/auth/login?next=${encodeURIComponent(back)}`);
	let outcome = 'pending';
	try { const r = await confirmUpgradeIntent(event.url.searchParams.get('payment_intent') ?? '', event.params.id, event.locals.user.id); outcome = r.confirmed ? 'confirmed' : r.refunded ? 'refunded' : 'pending'; } catch { outcome = 'pending'; }
	redirect(303, `${back}?payment=${outcome}`);
};
