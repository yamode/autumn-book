import { ratePlans } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	return {
		plans: ratePlans.filter((p) => p.facilityId === currentFacility.id).sort((a, b) => a.sortOrder - b.sortOrder)
	};
};
