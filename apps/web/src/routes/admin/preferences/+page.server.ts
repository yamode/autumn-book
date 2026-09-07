// アプリの「ご滞在の好み」で会員に聞く設問の管理。
// key は PK かつ member_preferences.pref_key の参照先なので変更・削除は提供しない（非表示のみ）。
import { fail } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	adminPreferenceUsage,
	adminUpsertPreferenceItem,
	bookAdmin,
	listPreferenceCatalog,
	mapRpcError,
	type PreferenceItem,
	type PreferenceOption,
	type PreferenceUsageRow
} from '$lib/server/admin-app-data';
import type { Actions, PageServerLoad } from './$types';

const UNAVAILABLE = 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			items: [] as PreferenceItem[],
			usageMap: {} as Record<string, PreferenceUsageRow>
		};
	}
	const client = bookAdmin(event);
	try {
		const [items, usage] = await Promise.all([
			listPreferenceCatalog(client),
			adminPreferenceUsage(client)
		]);
		const usageMap: Record<string, PreferenceUsageRow> = Object.fromEntries(
			usage.map((u) => [u.key, u])
		);
		return { unavailable: false as const, items, usageMap };
	} catch (e) {
		return {
			unavailable: false as const,
			items: [] as PreferenceItem[],
			usageMap: {} as Record<string, PreferenceUsageRow>,
			error: mapRpcError(e)
		};
	}
};

/** value/label の対を options[] に組み立てる（同じ index 同士が1組） */
function parseOptions(form: FormData): PreferenceOption[] {
	const values = form.getAll('optValue').map(String);
	const labels = form.getAll('optLabel').map(String);
	const out: PreferenceOption[] = [];
	for (let i = 0; i < values.length; i++) {
		const value = values[i]?.trim();
		const label = (labels[i] ?? '').trim();
		if (!value) continue; // 空行は無視（削除の意思表示として扱う）
		out.push({ value, label: label || value });
	}
	return out;
}

export const actions: Actions = {
	save: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: '好み登録項目の編集は管理者のみ行えます。' });
		}
		const form = await event.request.formData();
		const key = String(form.get('key') ?? '');
		try {
			await adminUpsertPreferenceItem(bookAdmin(event), {
				key,
				label: String(form.get('label') ?? '').trim(),
				groupName: String(form.get('groupName') ?? 'personal') as 'meal' | 'room' | 'personal',
				valueType: String(form.get('valueType') ?? 'text') as
					| 'single'
					| 'multi'
					| 'text'
					| 'boolean'
					| 'date',
				options: parseOptions(form),
				sortOrder: Number(form.get('sortOrder') ?? 0) || 0,
				isActive: form.get('isActive') === 'on'
			});
			return { saved: key };
		} catch (e) {
			return fail(400, { message: mapRpcError(e), key });
		}
	}
};
