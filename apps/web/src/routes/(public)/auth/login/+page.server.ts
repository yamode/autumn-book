import { fail, redirect } from '@sveltejs/kit';
import { members } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user?.role === 'member') redirect(303, url.searchParams.get('next') ?? '/account');
	return {};
};

export const actions: Actions = {
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const member = members.find((m) => m.email === email && m.password === password);
		if (!member) {
			return fail(401, { message: 'メールアドレスまたはパスワードが違います。', email });
		}
		setSession(cookies, { id: member.id, role: 'member', name: member.name });
		redirect(303, url.searchParams.get('next') ?? '/account');
	}
};
