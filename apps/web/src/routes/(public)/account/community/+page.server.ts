import { fail, redirect } from '@sveltejs/kit';
import { getForumProfile, setForumNickname } from '$lib/server/store';
import { setForumNickname as sbSetForumNickname, getForumNickname as sbGetForumNickname } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals, url } = event;
	// account レイアウトで member ガード済み（locals.user は member）
	if (!FORUM_WRITE_ENABLED) {
		return { nickname: '', next: '', writeEnabled: false };
	}
	// 現ニックネームをプリフィル（supabase は forum_my_nickname RPC・demo は store から）
	let nickname = '';
	if (MEMBER_SUPABASE) {
		nickname = await sbGetForumNickname(createSupabaseServerClient(event)).catch(() => '');
	} else {
		nickname = getForumProfile(locals.user!.id)?.nickname ?? '';
	}
	return {
		nickname,
		next: url.searchParams.get('next') ?? '',
		writeEnabled: true
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { request, locals, url } = event;
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only() });
		if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
		const form = await request.formData();
		const nickname = String(form.get('nickname') ?? '');
		const next = String(form.get('next') ?? '');

		let savedNickname: string;
		if (MEMBER_SUPABASE) {
			try {
				const res = await sbSetForumNickname(createSupabaseServerClient(event), nickname);
				savedNickname = res.nickname;
			} catch (e) {
				const msg = e instanceof Error ? e.message : '';
				const message = msg.includes('nickname_taken')
					? m.forum_error_nickname_taken()
					: m.forum_error_nickname_invalid();
				return fail(400, { message, nickname });
			}
		} else {
			const res = setForumNickname(locals.user.id, nickname, locals.user.role);
			if ('error' in res) {
				const message = res.error === 'taken' ? m.forum_error_nickname_taken() : m.forum_error_nickname_invalid();
				return fail(400, { message, nickname });
			}
			savedNickname = res.nickname;
		}

		// 戻り先指定があればそこへ、なければ設定画面に留まり成功表示
		if (next && next.startsWith('/')) redirect(303, next);
		return { saved: true, nickname: savedNickname };
	}
};
