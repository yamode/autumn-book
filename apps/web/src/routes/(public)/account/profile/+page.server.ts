import { fail } from '@sveltejs/kit';
import { memberById } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbUpdateMyProfile } from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import type { Actions } from './$types';

export const actions: Actions = {
	update: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kana = String(form.get('kana') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const mailOptIn = form.get('mailOptIn') === 'on';
		if (!name || !kana) return fail(400, { saved: false, message: m.error_name_kana_required() });

		if (MEMBER_SUPABASE) {
			try {
				// 氏名/カナ/電話は core.guests、メルマガ同意は book.members を RPC 経由で更新。
				// locale はプロフィール画面では変更しない（null で現状維持）。
				await sbUpdateMyProfile(createSupabaseServerClient(event), { name, kana, phone, mailOptIn });
			} catch {
				return fail(400, { saved: false, message: m.error_name_kana_required() });
			}
			return { saved: true, message: '' };
		}

		const member = memberById(locals.user!.id);
		if (!member) return fail(404, { saved: false, message: '' });
		member.name = name;
		member.kana = kana;
		member.phone = phone;
		member.mailOptIn = mailOptIn;
		return { saved: true, message: '' };
	}
};
