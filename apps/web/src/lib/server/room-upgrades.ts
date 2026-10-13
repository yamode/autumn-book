import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from './auth';
import type { RequestEvent } from '@sveltejs/kit';
import type { UpgradeOffer } from '$lib/room-upgrades';

export async function myUpgradeOffers(event: RequestEvent, id: string | null = null): Promise<UpgradeOffer[]> {
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	if (!MEMBER_SUPABASE) return [];
	const { data, error } = await createSupabaseServerClient(event).schema('book').rpc('my_upgrade_offers', { p_id: id });
	if (error) throw error;
	return (data ?? []) as UpgradeOffer[];
}
