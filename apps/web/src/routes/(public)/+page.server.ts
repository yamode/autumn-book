import { brands, searchAvailability } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const results = searchAvailability({ nights: 1, adults: 2, children: 0 });
	return { brands, results };
};
