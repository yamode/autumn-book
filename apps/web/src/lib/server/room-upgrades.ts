import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from './auth';
import type { RequestEvent } from '@sveltejs/kit';
import type { UpgradeOffer } from '$lib/room-upgrades';
import { addDays } from '$lib/format';
import { rankMeets } from '$lib/plan-access';
import { facilityById, myReservations, roomTypeById } from './store';
import { TtlCache } from './ttl-cache';

const sampleOfferId = '00000000-0000-4000-8000-000000000001';
const sampleDecisions = new TtlCache<'accepted' | 'declined'>(3600_000, 512);

function sampleOffer(event: RequestEvent): UpgradeOffer | null {
	const { user, memberPreview: rank } = event.locals;
	if (!rank || !user || !rankMeets({ isMember: true, rank }, 'silver')) return null;
	const booking = myReservations(user.id).find((row) => row.code.startsWith('PREVIEW-') && row.status === 'reserved');
	const target = roomTypeById('r-oga-suite');
	if (!booking || !target) return null;
	const decision = sampleDecisions.get(user.id);
	return {
		id: sampleOfferId, booking_id: booking.code, stay_id: booking.code, booking_code: booking.code, room_index: 1,
		facility_name: facilityById(booking.facilityId)?.name ?? '', source_name: roomTypeById(booking.roomTypeId)?.name ?? '',
		target_name: target.name, target_description: target.description, target_photos: target.photos,
		target_area: target.sizeM2, target_amenities: target.amenities,
		checkin: booking.checkin, checkout: addDays(booking.checkin, booking.nights), adults: booking.adults,
		title: 'お部屋のアップグレードのご提案（見本）', description: '施設から届く客室アップグレード提案の見本です。',
		price_basis: 'stay', unit_amount: 5000, total: 5000, base_total: booking.total,
		status: decision ?? 'offered', dispatch_at: new Date().toISOString(), expires_at: `${addDays(booking.checkin, -1)}T12:00:00+09:00`,
		campaign_status: 'published', eligible: !decision, remaining: 1, option_status: null,
		payment_mode: 'onsite', upgrade_paid_amount: 0, has_payment_hold: false, payment_expires_at: null
	};
}

export function decidePreviewUpgrade(event: RequestEvent, id: string, decision: 'accepted' | 'declined', total?: number) {
	const offer = sampleOffer(event);
	if (!offer?.eligible || offer.id !== id || (decision === 'accepted' && offer.total !== total)) return false;
	sampleDecisions.set(event.locals.user!.id, decision);
	return true;
}

export async function myUpgradeOffers(event: RequestEvent, id: string | null = null): Promise<UpgradeOffer[]> {
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	if (event.locals.memberPreview) {
		const offer = sampleOffer(event);
		return offer && (!id || id === offer.id) ? [offer] : [];
	}
	if (!MEMBER_SUPABASE) return [];
	const { data, error } = await createSupabaseServerClient(event).schema('book').rpc('my_upgrade_offers', { p_id: id });
	if (error) throw error;
	return (data ?? []) as UpgradeOffer[];
}
