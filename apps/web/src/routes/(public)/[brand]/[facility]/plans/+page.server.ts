import { error } from '@sveltejs/kit';
import { facilityBySlug, ratePlans, roomTypes, remainingRooms, quoteFor } from '$lib/server/store';
import { eachNight } from '@autumn-book/core';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const facility = facilityBySlug(params.brand, params.facility);
	if (!facility) error(404, '施設が見つかりません');

	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	const tag = url.searchParams.get('tag') || undefined;

	let plans = ratePlans
		.filter((p) => p.facilityId === facility.id && p.isPublished)
		.sort((a, b) => a.sortOrder - b.sortOrder);
	const allTags = [...new Set(plans.flatMap((p) => p.highlightTags))];
	if (tag) plans = plans.filter((p) => p.highlightTags.includes(tag));

	const items = plans.map((plan) => {
		if (!checkin) return { plan, total: null, perPerson: null, remaining: null };
		let best: { total: number; perPerson: number } | null = null;
		let remaining = 0;
		for (const rtId of plan.roomTypeIds) {
			const rt = roomTypes.find((r) => r.id === rtId)!;
			if (rt.capacity < adults) continue;
			const rem = Math.min(...eachNight(checkin, nights).map((d) => remainingRooms(rtId, d)));
			if (rem <= 0) continue;
			remaining = Math.max(remaining, rem);
			const q = quoteFor(plan.id, rtId, checkin, nights, adults, 0);
			if (!best || q.total < best.total) best = { total: q.total, perPerson: q.perPerson };
		}
		return { plan, total: best?.total ?? null, perPerson: best?.perPerson ?? null, remaining: best ? remaining : 0 };
	});

	return { facility, items, allTags, params: { checkin: checkin ?? '', nights, adults, tag: tag ?? '' } };
};
