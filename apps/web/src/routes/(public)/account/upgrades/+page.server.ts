import { myUpgradeOffers } from '$lib/server/room-upgrades';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => ({ enabled: MEMBER_SUPABASE || Boolean(event.locals.memberPreview), offers: await myUpgradeOffers(event) });
