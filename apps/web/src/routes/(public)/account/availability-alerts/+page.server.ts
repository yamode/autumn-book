import { fail, redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { listFacilities, listPlans, listRoomTypes } from '$lib/server/supabase-data';
import type { AvailabilityAlert } from '$lib/availability-alerts';
import { todayStr } from '$lib/format';
import { alertErrorMessage } from '$lib/server/availability-alert-errors';
import { dbg } from '$lib/debug';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

function requireMember(event: { locals: App.Locals; url: URL }) {
	// Layout loads do not guard actions or child loads: always enforce here too.
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
}

export const load: PageServerLoad = async (event) => {
	requireMember(event);
	const base = { today: todayStr() };
	if (!MEMBER_SUPABASE) return { ...base, enabled: false, loadError: false, facilities: [], alerts: [] as AvailabilityAlert[] };
	try {
		const client = createSupabaseServerClient(event);
		const [facilities, result] = await Promise.all([
			listFacilities(),
			client.schema('book').from('availability_alerts').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
		]);
		if (result.error) throw result.error;
		const choices = await Promise.all(facilities.map(async (f) => {
			const [rooms, plans] = await Promise.all([listRoomTypes(f.facility_id), listPlans(f.facility_id)]);
			return { id: f.facility_id, name: f.name, rooms: rooms.map((r) => ({ id: String(r.room_type_id), name: String(r.name) })), plans: plans.map((p) => ({ id: String(p.rate_plan_id), name: String(p.name) })) };
		}));
		return { ...base, enabled: true, loadError: false, facilities: choices, alerts: (result.data ?? []) as AvailabilityAlert[] };
	} catch (e) {
		dbg('availability alerts load failed', e instanceof Error ? e.message : 'database error');
		return { ...base, enabled: true, loadError: true, facilities: [], alerts: [] as AvailabilityAlert[] };
	}
};

export const actions: Actions = {
	remove: async (event) => {
		requireMember(event);
		if (!MEMBER_SUPABASE) return fail(400, { message: m.account_env_unavailable() });
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { message: m.account_alerts_not_found() });
		const { error } = await createSupabaseServerClient(event).schema('book').rpc('delete_availability_alert', { p_id: id });
		if (error) return fail(400, { message: alertErrorMessage(error.message) });
		return { message: m.account_alerts_deleted(), success: true };
	}
};
