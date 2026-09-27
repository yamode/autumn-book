import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRatePlans, roomTypes, remainingRooms, quoteFor } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbListPlansMapped, sbPlanOffers, sbPlanReferenceMinPrices } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { eachNight } from '@autumn-book/core';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	const tag = url.searchParams.get('tag') || undefined;

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');

		// 早期決済割の対象プランは「予約時決済で最大 N%お得」を出す
		let plans = withEarlyPrepayMax(
			(await sbListPlansMapped(facility.id)).map((p) => planForViewer(p, isMember)),
			await loadEarlyPrepaySettings(facility.id)
		);
		if (!checkin) {
			const referencePrices = await sbPlanReferenceMinPrices(facility.id, adults);
			plans = plans.map((plan) => ({ ...plan, basePrice: referencePrices.get(plan.id) ?? 0 }));
		}
		const allTags = [...new Set(plans.flatMap((p) => p.highlightTags))];
		if (tag) plans = plans.filter((p) => p.highlightTags.includes(tag));

		// 施設全プランの「泊まれる客室×料金×残室」を1クエリで取得（日付なしは 0 行）。
		// プラン単位に最安総額（min）と残室（max）へ集約する。
		const offers = await sbPlanOffers(facility.id, checkin, nights, adults);
		const byPlan = new Map<string, { total: number; perPerson: number; remaining: number }>();
		for (const o of offers) {
			const cur = byPlan.get(o.ratePlanId);
			if (!cur) {
				byPlan.set(o.ratePlanId, { total: o.total, perPerson: o.perPerson, remaining: o.remaining });
			} else {
				byPlan.set(o.ratePlanId, {
					total: Math.min(cur.total, o.total),
					perPerson: o.total < cur.total ? o.perPerson : cur.perPerson,
					remaining: Math.max(cur.remaining, o.remaining)
				});
			}
		}

		const items = plans.map((plan) => {
			const best = byPlan.get(plan.id);
			if (!checkin || !best) return { plan, total: null, perPerson: null, remaining: checkin ? 0 : null };
			return { plan, total: best.total, perPerson: best.perPerson, remaining: best.remaining };
		});

		return { facility, items, allTags, referenceMode: !checkin, params: { checkin: checkin ?? '', nights, adults, tag: tag ?? '' } };
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	let plans = withEarlyPrepayMax(
		getRatePlans(facility.id, locale).map((p) => planForViewer(p, isMember)),
		await loadEarlyPrepaySettings(facility.id)
	);
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

	return { facility, items, allTags, referenceMode: false, params: { checkin: checkin ?? '', nights, adults, tag: tag ?? '' } };
};
