import { searchAvailability } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	const results = searchAvailability({ checkin, nights, adults, children: 0 });
	return { results, params: { checkin: checkin ?? '', nights, adults } };
};
