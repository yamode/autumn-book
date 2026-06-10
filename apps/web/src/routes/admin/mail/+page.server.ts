import { mailCampaigns } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { campaigns: [...mailCampaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
};
