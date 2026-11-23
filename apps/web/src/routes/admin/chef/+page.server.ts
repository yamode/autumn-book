// 出張シェフ・受付枠（月カレンダー）。シェフごとに日を開ける・閉じる（設計: hp-pchef docs/design.md 5章 1）。
// 開ける前に taskul 系のシフトを読み、休みの日は開けられない。シフト未作成の日は警告つきで開けられる。
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { CHEF_FACILITY_ID, chefDb, chefErrorMessage, type ChefSlot } from '$lib/server/chef';
import { listChefs, shiftDay, shiftDays, taskulShiftClient, type TaskulChef } from '$lib/server/taskul-shift';
import type { ShiftDay } from '$lib/server/taskul-shift-day';
import { CHEF_LIVE_STATUSES, addDays, isValidIsoDate, jstToday } from '$lib/chef';

const TASKUL_DOWN = 'taskul に接続できないため受付枠を開けられません（閉じる・メモの保存はできます）。';

function monthRange(param: string | null) {
	const today = jstToday();
	const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(param ?? '') ? param! : today.slice(0, 7);
	const from = `${m}-01`;
	const [y, mo] = m.split('-').map(Number);
	const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
	const to = addDays(`${next}-01`, -1);
	const prev = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
	return { month: m, from, to, prev, next, today };
}

export const load: PageServerLoad = async (event) => {
	const r = monthRange(event.url.searchParams.get('month'));
	const days: string[] = [];
	for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d);
	const base = {
		...r,
		days,
		chefs: [] as TaskulChef[],
		slots: [] as ChefSlot[],
		booked: {} as Record<string, { id: string; status: string; name: string }>,
		shifts: {} as Record<string, ShiftDay>,
		taskulError: null as string | null,
		unavailable: null as string | null
	};
	if (!ADMIN_SUPABASE) return { ...base, unavailable: '出張シェフは Supabase 接続時のみ使えます。' };

	const db = chefDb(createSupabaseServerClient(event));
	const taskul = taskulShiftClient();
	const chefsP: Promise<TaskulChef[] | string> = taskul ? listChefs(taskul).catch((e) => (e instanceof Error ? e.message : TASKUL_DOWN)) : Promise.resolve(TASKUL_DOWN);
	const [slots, reservations, chefsOrError] = await Promise.all([
		db.from('slots').select('id,date,chef_staff_id,chef_name,status,note,updated_at').eq('facility_id', CHEF_FACILITY_ID).gte('date', r.from).lte('date', r.to),
		db.from('reservations').select('id,slot_id,status,name').eq('facility_id', CHEF_FACILITY_ID).gte('date', r.from).lte('date', r.to).in('status', CHEF_LIVE_STATUSES),
		chefsP
	]);
	if (slots.error || reservations.error) return { ...base, unavailable: chefErrorMessage((slots.error ?? reservations.error)?.message) };

	let chefs: TaskulChef[] = typeof chefsOrError === 'string' ? [] : chefsOrError;
	let taskulError = typeof chefsOrError === 'string' ? chefsOrError : null;
	if (!taskulError && !chefs.length) taskulError = 'taskul で勤務パターン「出張シェフ」を担当できる人がいません（taskul-shift で指名してください）。';
	const slotRows = (slots.data ?? []) as ChefSlot[];
	// taskul で外れたシェフでも、枠が残っていれば列に出す（閉じたり予約を見たりできるように）
	for (const s of slotRows) if (!chefs.some((c) => c.id === s.chef_staff_id)) chefs = [...chefs, { id: s.chef_staff_id, name: s.chef_name || '（taskul で外れたシェフ）' }];

	let shifts: Record<string, ShiftDay> = {};
	if (taskul && chefs.length) {
		try {
			shifts = Object.fromEntries(await shiftDays(taskul, chefs.map((c) => c.id), r.from, r.to));
		} catch (e) {
			taskulError = e instanceof Error ? e.message : TASKUL_DOWN;
		}
	}
	const booked = Object.fromEntries((reservations.data ?? []).map((x) => [x.slot_id as string, { id: x.id as string, status: x.status as string, name: x.name as string }]));
	return { ...base, chefs, slots: slotRows, booked, shifts, taskulError };
};

export const actions: Actions = {
	slot: async (event) => {
		if (!ADMIN_SUPABASE) return fail(503, { message: '出張シェフは Supabase 接続時のみ使えます。' });
		if (!['admin', 'staff'].includes(event.locals.user?.role ?? '')) return fail(403, { message: 'スタッフとしてログインしてください。' });
		const form = await event.request.formData();
		const date = String(form.get('date') ?? '');
		const chefId = String(form.get('chefId') ?? '');
		const status = String(form.get('status') ?? '');
		const note = String(form.get('note') ?? '').slice(0, 1000);
		const key = `${chefId}|${date}`;
		// 存在しない日付（2026-02-31 など）は DB に投げずに止める
		if (!isValidIsoDate(date)) return fail(400, { key, message: `日付「${date.slice(0, 20)}」は存在しません。カレンダーから選び直してください。` });
		if (!/^[0-9a-f-]{36}$/i.test(chefId) || !['open', 'closed'].includes(status)) return fail(400, { key, message: '入力を確かめてください。' });

		const db = chefDb(createSupabaseServerClient(event));
		const { data: existing } = await db.from('slots').select('chef_name,status').eq('facility_id', CHEF_FACILITY_ID).eq('date', date).eq('chef_staff_id', chefId).maybeSingle();
		let chefName = (existing?.chef_name as string | undefined) ?? '';
		let warning: string | null = null;

		// 開ける（すでに開いている枠のメモ保存は除く）ときは、taskul で指名されているか・休みでないかを確かめる
		if (status === 'open' && existing?.status !== 'open') {
			if (date < jstToday()) return fail(400, { key, message: '過去の日は開けられません。' });
			const taskul = taskulShiftClient();
			if (!taskul) return fail(503, { key, message: TASKUL_DOWN });
			try {
				const chef = (await listChefs(taskul)).find((c) => c.id === chefId);
				if (!chef) return fail(400, { key, message: 'このシェフは taskul で勤務パターン「出張シェフ」を担当できる人になっていません。' });
				chefName = chef.name;
				const day = await shiftDay(taskul, chefId, date);
				if (day.kind === 'off') return fail(400, { key, message: `${chef.name}さんはこの日 ${day.label} のため開けられません。` });
				if (day.kind === 'none') warning = `${chef.name}さんのこの日のシフトはまだ作られていません。シフトを作るときに休みにしないよう気をつけてください。`;
			} catch (e) {
				return fail(503, { key, message: e instanceof Error ? `${e.message}（${TASKUL_DOWN}）` : TASKUL_DOWN });
			}
		}

		const { error } = await db.rpc('admin_slot_set', {
			p_facility: CHEF_FACILITY_ID,
			p_date: date,
			p_chef_staff_id: chefId,
			p_chef_name: chefName,
			p_status: status,
			p_note: note
		});
		if (error) return fail(400, { key, message: chefErrorMessage(error.message) });
		const done = status === existing?.status ? 'メモを保存しました。' : status === 'open' ? '受付枠を開けました。' : '受付枠を閉じました。';
		return { key, ok: true, message: done, warning };
	}
};
