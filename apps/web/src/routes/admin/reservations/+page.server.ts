import { bookings, roomTypeById } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { currentFacility } = await parent();
	const status = url.searchParams.get('status') ?? '';
	const channel = url.searchParams.get('channel') ?? 'autumn_booking';
	const q = url.searchParams.get('q') ?? '';

	let list = [...bookings.values()].filter((b) => b.facilityId === currentFacility.id);
	if (status) list = list.filter((b) => b.status === status);
	if (channel) list = list.filter((b) => b.channel === channel);
	if (q) list = list.filter((b) => b.code.includes(q) || b.guest.name.includes(q) || b.guest.kana.includes(q));

	return {
		list: list
			.sort((a, b) => a.checkin.localeCompare(b.checkin))
			.map((b) => ({ ...b, roomName: roomTypeById(b.roomTypeId)!.name })),
		filters: { status, channel, q }
	};
};
