import { fail, redirect } from '@sveltejs/kit';
import { getForumProfile, setForumNickname } from '$lib/server/store';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const profile = getForumProfile(locals.user.id);
	return {
		nickname: profile?.nickname ?? '',
		next: url.searchParams.get('next') ?? ''
	};
};

export const actions: Actions = {
	save: async ({ request, locals, url }) => {
		if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
		const form = await request.formData();
		const nickname = String(form.get('nickname') ?? '');
		const next = String(form.get('next') ?? '');

		// role は session.role を渡す（lazy 作成時の役割）
		const res = setForumNickname(locals.user.id, nickname, locals.user.role);
		if ('error' in res) {
			const message = res.error === 'taken' ? m.forum_error_nickname_taken() : m.forum_error_nickname_invalid();
			return fail(400, { message, nickname });
		}
		// 戻り先指定があればそこへ、なければ設定画面に留まり成功表示
		if (next && next.startsWith('/')) redirect(303, next);
		return { saved: true, nickname: res.nickname };
	}
};
