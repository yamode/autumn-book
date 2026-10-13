import { fail, redirect } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { listRoomTypes, toFacilityUuidStrict } from '$lib/server/supabase-data';
import { upgradeError, type UpgradeCampaign, type UpgradeRecipient, type UpgradeReport } from '$lib/room-upgrades';
import { todayStr } from '$lib/format';
import type { Actions, PageServerLoad } from './$types';

function staff(event: { locals: App.Locals }) {
	if (event.locals.user?.role !== 'admin' && event.locals.user?.role !== 'staff') redirect(303, '/admin/login');
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async (event) => {
	staff(event);
	const { currentFacility } = await event.parent();
	const facilityId = toFacilityUuidStrict(currentFacility.id);
	const base = { enabled: ADMIN_SUPABASE, facilityId, today: todayStr() };
	if (!ADMIN_SUPABASE) return { ...base, rooms: [] as { id: string; name: string }[], campaigns: [] as UpgradeCampaign[], selected: null as UpgradeCampaign | null, preview: [] as UpgradeRecipient[], offers: [] as UpgradeReport[] };
	const db = createSupabaseServerClient(event).schema('book');
	const [rooms, campaignsResult] = await Promise.all([
		listRoomTypes(facilityId), db.from('upgrade_campaigns').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(100)
	]);
	if (campaignsResult.error) throw campaignsResult.error;
	const campaigns = (campaignsResult.data ?? []) as UpgradeCampaign[];
	const selected = campaigns.find((c) => c.id === event.url.searchParams.get('id')) ?? null;
	let preview: UpgradeRecipient[] = [];
	let offers: UpgradeReport[] = [];
	if (selected?.status === 'draft') {
		const result = await db.rpc('admin_preview_upgrade_campaign', { p_id: selected.id });
		if (result.error) throw result.error;
		preview = (result.data ?? []) as UpgradeRecipient[];
	} else if (selected) {
		const result = await db.rpc('admin_upgrade_campaign_report', { p_id: selected.id });
		if (result.error) throw result.error;
		offers = (result.data ?? []) as UpgradeReport[];
	}
	return { ...base, rooms: rooms.map((r) => ({ id: String(r.room_type_id), name: String(r.name) })), campaigns, selected, preview, offers };
};

function jstDateTime(s: string) {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
	const date = new Date(`${s}+09:00`);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export const actions: Actions = {
	save: async (event) => {
		staff(event);
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では保存できません。' });
		const fd = await event.request.formData();
		const values = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
		const expiry = jstDateTime(values.expires ?? '');
		const amount = Number(values.amount);
		if (!expiry || !/^\d+$/.test(values.amount ?? '') || !Number.isInteger(amount) || !uuid.test(values.facility ?? '') || !uuid.test(values.source ?? '') || !uuid.test(values.target ?? '') || (values.id && !uuid.test(values.id))) return fail(400, { message: upgradeError('invalid_params'), values });
		const result = await createSupabaseServerClient(event).schema('book').rpc('admin_save_upgrade_campaign', {
			p_id: values.id || null, p_facility: values.facility, p_checkin: values.checkin, p_source: values.source, p_target: values.target,
			p_title: values.title, p_description: values.description ?? '', p_basis: 'night', p_amount: amount, p_channel: values.channel, p_expires: expiry
		});
		if (result.error) return fail(400, { message: upgradeError(result.error), values });
		redirect(303, `/admin/upgrades?id=${result.data}`);
	},
	publish: async (event) => {
		staff(event);
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では送信できません。' });
		const fd = await event.request.formData();
		const id = String(fd.get('id') ?? '');
		const count = Number(fd.get('count'));
		const stays = fd.getAll('stay').map(String);
		const schedule = String(fd.get('dispatch') ?? '');
		const dispatch = schedule ? jstDateTime(schedule) : new Date().toISOString();
		if (!uuid.test(id) || !Number.isInteger(count) || count <= 0 || fd.get('confirm') !== 'yes' || !dispatch || stays.length !== count || stays.some((x) => !uuid.test(x))) return fail(400, { message: '対象者と送信方法を確認し、送信に同意してください。' });
		const result = await createSupabaseServerClient(event).schema('book').rpc('admin_publish_upgrade_campaign', { p_id: id, p_expected_count: count, p_expected_stays: stays, p_dispatch: dispatch });
		if (result.error) return fail(400, { message: upgradeError(result.error) });
		return { success: true, message: `${result.data}室分の提案通知を${schedule ? '予約しました' : '送信キューへ登録しました'}。` };
	},
	withdraw: async (event) => {
		staff(event);
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では操作できません。' });
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!uuid.test(id)) return fail(400, { message: '提案が見つかりません。' });
		const result = await createSupabaseServerClient(event).schema('book').rpc('admin_withdraw_upgrade_campaign', { p_id: id });
		if (result.error) return fail(400, { message: upgradeError(result.error) });
		return { success: true, message: '提案の受付を終了しました。確定済みのアップグレードはそのままです。' };
	}
};
