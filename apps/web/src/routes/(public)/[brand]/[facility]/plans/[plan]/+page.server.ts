import { error, fail, redirect } from '@sveltejs/kit';
import {
	facilityBySlug,
	ratePlans,
	roomTypes,
	remainingRooms,
	quoteFor,
	getPlanCalendar,
	createHold
} from '$lib/server/store';
import { eachNight } from '@autumn-book/core';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const facility = facilityBySlug(params.brand, params.facility);
	if (!facility) error(404, '施設が見つかりません');
	const plan = ratePlans.find((p) => p.facilityId === facility.id && p.slug === params.plan && p.isPublished);
	if (!plan) error(404, 'プランが見つかりません');

	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	const calMonth = url.searchParams.get('cal') ?? (checkin ?? new Date().toISOString().slice(0, 10)).slice(0, 7);

	const rooms = plan.roomTypeIds
		.map((id) => roomTypes.find((r) => r.id === id)!)
		.map((room) => {
			if (!checkin || room.capacity < adults) {
				return { room, quote: null, remaining: checkin ? 0 : null, fits: room.capacity >= adults };
			}
			const remaining = Math.min(...eachNight(checkin, nights).map((d) => remainingRooms(room.id, d)));
			return {
				room,
				quote: remaining > 0 ? quoteFor(plan.id, room.id, checkin, nights, adults, 0) : null,
				remaining,
				fits: true
			};
		});

	return {
		facility,
		plan,
		rooms,
		calendar: getPlanCalendar(plan.id, calMonth),
		calMonth,
		params: { checkin: checkin ?? '', nights, adults }
	};
};

export const actions: Actions = {
	hold: async ({ request, locals, params }) => {
		const form = await request.formData();
		const planId = String(form.get('planId'));
		const roomTypeId = String(form.get('roomTypeId'));
		const checkin = String(form.get('checkin'));
		const nights = Number(form.get('nights'));
		const adults = Number(form.get('adults'));
		if (!checkin || !planId || !roomTypeId) return fail(400, { message: '日付を選択してください' });

		const result = createHold(planId, roomTypeId, checkin, nights, adults, 0, locals.user?.role === 'member' ? locals.user.id : undefined);
		if ('error' in result) {
			return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
		}
		redirect(303, `/booking/hold?id=${result.id}`);
	}
};
