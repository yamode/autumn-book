// 管理画面「Autumn Live の端末」（docs/autumn-live.md §4.3・§4.6）。管理者だけ。
// 表示専用の端末の登録コードを出す・登録済みの端末を見る・止める。中身は lib/server/live-devices.ts
import { error, fail } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { LiveDeviceError, issueLiveCode, listLiveDevices, revokeLiveDevice, type LiveDeviceView } from '$lib/server/live-devices';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	if (event.locals.user?.role !== 'admin') error(403, 'この画面は管理者だけが開けます。');
	if (AUTH_MODE !== 'supabase') return { available: false as const, devices: [] as LiveDeviceView[], loadError: null as string | null };
	try {
		return { available: true as const, devices: await listLiveDevices(), loadError: null as string | null };
	} catch (e) {
		return { available: true as const, devices: [] as LiveDeviceView[], loadError: e instanceof LiveDeviceError ? e.message : '端末の一覧を読めませんでした。' };
	}
};

export const actions: Actions = {
	issue: async ({ request, locals }) => {
		if (AUTH_MODE !== 'supabase') return fail(400, { message: 'この環境（AUTH_MODE=demo）では使えません。' });
		if (locals.user?.role !== 'admin') return fail(403, { message: '登録コードは管理者だけが出せます。' });
		const form = await request.formData();
		const label = String(form.get('label') ?? '').trim();
		if (!label) return fail(400, { message: '端末の名前（置き場所など）を入れてください。', label });
		try {
			const r = await issueLiveCode({ actorId: locals.user.id, label });
			return { issued: r };
		} catch (e) {
			return fail(e instanceof LiveDeviceError ? e.status : 500, { message: e instanceof LiveDeviceError ? e.message : '登録コードを出せませんでした。', label });
		}
	},
	revoke: async ({ request, locals }) => {
		if (AUTH_MODE !== 'supabase') return fail(400, { message: 'この環境（AUTH_MODE=demo）では使えません。' });
		if (locals.user?.role !== 'admin') return fail(403, { message: '端末を止めるのは管理者だけができます。' });
		const form = await request.formData();
		try {
			const r = await revokeLiveDevice({ actorId: locals.user.id, deviceId: String(form.get('deviceId') ?? '') });
			return { done: r ? `「${r.label}」を止めました。最長 1 時間以内に Autumn Live を開けなくなります。` : 'この端末はすでに止まっています。' };
		} catch (e) {
			return fail(e instanceof LiveDeviceError ? e.status : 500, { message: e instanceof LiveDeviceError ? e.message : '端末を止められませんでした。' });
		}
	}
};
