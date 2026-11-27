import { searchAvailability } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityAvailability } from '$lib/server/supabase-data';
import { clampSearch } from '$lib/stay-search/params';
import { privateBookFacility, privateBookOffers, privateBookReferencePrices } from '$lib/server/private-book';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals, setHeaders }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const { nights, adults, rooms } = clampSearch({ nights: url.searchParams.get('nights'), adults: url.searchParams.get('adults'), rooms: url.searchParams.get('rooms') });

	const results =
		DATA_SOURCE === 'supabase'
			? await sbFacilityAvailability(checkin, nights, adults)
			: searchAvailability({ checkin, nights, adults, children: 0 });

	// プライベートブックの状態（docs/private-book.md）: 特別料金の施設は、その施設の最安を特別料金で出す
	// （特別料金を出せる組が無ければふつうの料金のまま）。施設ごとに「特別料金／ふつうの料金」の一言を添える。料金の表示は保存させない
	const pbState = locals.privateBook ?? null;
	const privateBook: Record<string, { special: boolean }> = {};
	if (pbState && DATA_SOURCE === 'supabase') {
		setHeaders({ 'cache-control': 'private, no-store' });
		await Promise.all(
			results.map(async (r, i) => {
				const fac = await privateBookFacility(pbState, r.facility.id);
				privateBook[r.facility.id] = { special: !!fac?.special };
				if (!fac?.special) return;
				if (checkin) {
					const offers = await privateBookOffers(fac, r.facility.id, checkin, nights, adults);
					if (!offers.length) return;
					const best = offers.reduce((a, b) => (b.total < a.total ? b : a));
					results[i] = { ...r, minTotal: best.total, minPerPerson: best.perPerson, remaining: Math.max(r.remaining, ...offers.map((o) => o.remaining)) };
				} else {
					const refs = await privateBookReferencePrices(fac, r.facility.id, adults);
					if (!refs.length) return;
					const per = Math.min(...refs.map((x) => x.minPerPerson));
					results[i] = { ...r, minTotal: per * adults * nights, minPerPerson: per, remaining: r.remaining || 9 };
				}
			})
		);
	}

	return { results, privateBook: pbState ? privateBook : null, params: { checkin: checkin ?? '', nights, adults, rooms } };
};
