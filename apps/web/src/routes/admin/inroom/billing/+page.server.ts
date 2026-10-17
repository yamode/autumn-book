import { fail } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import {
	inroomPaymentReady,
	listStayBillsDemo,
	loadBillSettings,
	retryInroomMismatchRefund,
	saveBillSettingsDemo,
	sbListStayBills,
	sbSaveBillSettings,
	sbSetStayOverride,
	setStayOverrideDemo,
	type AdminStayBills,
	type BillOverride
} from '$lib/server/inroom-bill';
import type { Actions, PageServerLoad } from './$types';

// 客室案内の精算案内（2026-10-17 指示）。
//   ・施設の既定: 明細／フロント案内／オンライン決済の3つを出すか、フロント案内文（ja / en / zh）。管理者だけ
//   ・滞在ごとの上書き: ご滞在中・これからの滞在コードごとに「既定どおり／出す／出さない」。スタッフも変えられる
//   ・最近のオンライン決済（入金・返金・金額の食い違い）
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const settings = await loadBillSettings(currentFacility.id);
	let list: AdminStayBills = { stays: [], payments: [] };
	let loadError: string | null = null;
	if (useSupabaseAdmin) {
		try {
			list = await sbListStayBills(createSupabaseServerClient(event), currentFacility.id);
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	} else {
		list = listStayBillsDemo(currentFacility.id);
	}
	return {
		settings,
		stays: list.stays,
		payments: list.payments,
		loadError,
		live: useSupabaseAdmin,
		paymentReady: inroomPaymentReady(),
		isAdmin: event.locals.user?.role === 'admin'
	};
};

const flag = (v: FormDataEntryValue | null): boolean | null => (v === 'on' ? true : v === 'off' ? false : null);

export const actions: Actions = {
	// ---- 施設の既定（管理者だけ）----
	saveSettings: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		// 施設の権限は DB の RPC（has_facility_access）で確かめる
		const facilityId = String(form.get('facilityId') ?? '');
		if (!facilityId) return fail(400, { message: '施設が見つかりません' });
		const note = {
			ja: String(form.get('note') ?? '').trim(),
			en: String(form.get('noteEn') ?? '').trim(),
			zh: String(form.get('noteZh') ?? '').trim()
		};
		if (note.ja.length > 4000 || note.en.length > 4000 || note.zh.length > 4000) {
			return fail(400, { message: '案内文は4000文字以内で入力してください' });
		}
		const flags = { items: form.get('items') === 'on', front: form.get('front') === 'on', online: form.get('online') === 'on' };
		if (flags.front && !note.ja) return fail(400, { message: 'フロントでのご案内を出すときは、日本語の案内文を入れてください' });
		if (useSupabaseAdmin) {
			try {
				await sbSaveBillSettings(createSupabaseServerClient(event), facilityId, { flags, note });
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		} else {
			saveBillSettingsDemo(facilityId, { flags, note });
		}
		return { settingsSaved: true };
	},

	// ---- 滞在ごとの上書き（スタッフも）----
	setOverride: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const tokenId = String(form.get('tokenId') ?? '');
		if (!tokenId) return fail(400, { message: '滞在が見つかりません' });
		const o: BillOverride = { items: flag(form.get('items')), front: flag(form.get('front')), online: flag(form.get('online')) };
		if (useSupabaseAdmin) {
			try {
				await sbSetStayOverride(createSupabaseServerClient(event), tokenId, o);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		} else {
			setStayOverrideDemo(tokenId, o);
		}
		return { overrideSaved: tokenId };
	},

	// ---- 金額の食い違いで返金に失敗した決済の返金をやり直す（管理者だけ）----
	retryRefund: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		if (!useSupabaseAdmin) return fail(400, { message: 'デモでは使えません' });
		const id = String((await event.request.formData()).get('id') ?? '');
		try {
			await retryInroomMismatchRefund(id);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? `返金できませんでした（${e.message}）` : '返金できませんでした' });
		}
		return { refundRetried: true };
	}
};
