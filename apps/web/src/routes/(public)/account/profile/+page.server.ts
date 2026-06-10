import { fail } from '@sveltejs/kit';
import { memberById } from '$lib/server/store';
import type { Actions } from './$types';

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const member = memberById(locals.user!.id);
		if (!member) return fail(404, {});
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kana = String(form.get('kana') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		if (!name || !kana) return fail(400, { message: '氏名・フリガナは必須です' });
		// 本実装: core.guests へも反映（設計書 C-16）
		member.name = name;
		member.kana = kana;
		member.phone = phone;
		member.mailOptIn = form.get('mailOptIn') === 'on';
		return { saved: true };
	}
};
