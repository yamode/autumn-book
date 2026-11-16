import { DATA_SOURCE } from '$lib/server/supabase';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return { user: locals.user, demoData: DATA_SOURCE !== 'supabase' };
};
