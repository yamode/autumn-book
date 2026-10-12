import { fail, redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { listFacilities, listPlans, listRoomTypes } from '$lib/server/supabase-data';
import { alertConditions, validateAlertConditions, type AvailabilityAlert } from '$lib/availability-alerts';
import { addDays, todayStr } from '$lib/format';
import { dbg } from '$lib/debug';
import type { Actions, PageServerLoad } from './$types';

function requireMember(event: { locals: App.Locals; url: URL }) {
	// Layout loads do not guard actions or child loads: always enforce here too.
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
}

export const load: PageServerLoad = async (event) => {
	requireMember(event);
	const defaults = alertConditions(event.url.searchParams);
	const base = { defaults, today: todayStr(), maxDate: addDays(todayStr(), 365) };
	if (!MEMBER_SUPABASE) return { ...base, enabled: false, loadError: false, facilities: [], alerts: [] as AvailabilityAlert[] };
	try {
		const client = createSupabaseServerClient(event);
		const [facilities, result] = await Promise.all([
			listFacilities(),
			client.schema('book').from('availability_alerts').select('*').order('created_at', { ascending: false }).limit(100)
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

function messageFor(code: string) {
	if (code.includes('alert_limit')) return '空室通知は同時に10件まで登録できます。不要な通知を停止してください。';
	if (code.includes('duplicate_alert')) return '同じ条件の空室通知をすでに登録しています。';
	if (code.includes('verified_email_required')) return '確認済みのメールアドレスが必要です。プロフィールでメールアドレスをご確認ください。';
	if (code.includes('invalid_conditions')) return '宿泊日・人数・お部屋・プランの条件を確認してください。';
	if (code.includes('not_found')) return '通知が見つかりません。画面を更新してください。';
	return '処理できませんでした。時間をおいてもう一度お試しください。';
}

export const actions: Actions = {
	create: async (event) => {
		requireMember(event);
		if (!MEMBER_SUPABASE) return fail(400, { message: 'この環境では空室通知を登録できません。' });
		const fd = await event.request.formData();
		const values = alertConditions(fd);
		const invalid = validateAlertConditions(values);
		if (invalid) return fail(400, { message: invalid, values });
		if (fd.get('consent') !== 'yes') return fail(400, { message: '空室通知メールの受信に同意してください。', values });
		const { error } = await createSupabaseServerClient(event).schema('book').rpc('register_availability_alert', {
			p_facility_id: values.facility, p_checkin: values.checkin, p_nights: values.nights,
			p_adults: values.adults, p_room_count: values.rooms, p_room_type_id: values.room || null,
			p_rate_plan_id: values.plan || null, p_max_total: values.budget ? Number(values.budget) : null,
			p_consent: true
		});
		if (error) { dbg('availability alert register failed', error.code); return fail(400, { message: messageFor(error.message), values }); }
		return { message: '空室通知を登録しました。条件に合う空室を確認したらメールでお知らせします。', success: true };
	},
	stop: async (event) => {
		requireMember(event);
		if (!MEMBER_SUPABASE) return fail(400, { message: 'この環境では操作できません。' });
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(400, { message: '通知が見つかりません。' });
		const { error } = await createSupabaseServerClient(event).schema('book').rpc('stop_availability_alert', { p_id: id });
		if (error) return fail(400, { message: messageFor(error.message) });
		return { message: '空室通知を停止しました。', success: true };
	}
};
