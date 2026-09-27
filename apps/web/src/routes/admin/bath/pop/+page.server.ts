import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { sbGetOrIssueStayToken, sbListBookableStays } from '$lib/server/private-bath';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'Cache-Control': 'private, no-store' });
	const { currentFacility } = await event.parent();
	const date = /^\d{4}-\d{2}-\d{2}$/.test(event.url.searchParams.get('date') ?? '')
		? event.url.searchParams.get('date')! : null;
	const stayId = event.url.searchParams.get('stay') ?? '';
	const size = event.url.searchParams.get('size') === 'A7' ? 'A7' as const : 'A6' as const;
	if (DATA_SOURCE !== 'supabase' || AUTH_MODE !== 'supabase') {
		return { facilityName: currentFacility.name, date, size, stay: null, qrUrl: '', error: '実データへの接続が必要です。' };
	}
	try {
		const client = createSupabaseServerClient(event);
		const facilityId = FACILITY_UUID[currentFacility.id] ?? currentFacility.id;
		const stays = await sbListBookableStays(client, facilityId, date);
		const stay = stays.find((s) => s.stay_id === stayId) ?? null;
		if (!stay) return { facilityName: currentFacility.name, date, size, stay: null, qrUrl: '', error: '対象の滞在が見つかりません。' };
		const qr = await sbGetOrIssueStayToken(client, facilityId, stay);
		return {
			facilityName: currentFacility.name,
			date,
			size,
			stay,
			qrUrl: `${event.url.origin}/r/c/${qr.token}?next=bath`,
			validFrom: qr.valid_from,
			validTo: qr.valid_to,
			error: null
		};
	} catch (e) {
		return { facilityName: currentFacility.name, date, size, stay: null, qrUrl: '', error: e instanceof Error ? e.message : 'QRを発行できませんでした。' };
	}
};
