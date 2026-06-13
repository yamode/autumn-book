import { fail, redirect } from '@sveltejs/kit';
import { setSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { authMode: AUTH_MODE };
};

export const actions: Actions = {
	// Supabase Auth（email+パスワード）でのログイン。管理権限（app_metadata.role）が無いアカウントは拒否。
	login: async (event) => {
		if (AUTH_MODE !== 'supabase') return fail(400, { message: 'この環境ではメールログインは無効です' });
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!email || !password) return fail(400, { message: 'メールアドレスとパスワードを入力してください', email });

		let supabase;
		try {
			supabase = createSupabaseServerClient(event);
		} catch {
			return fail(503, { message: '認証システムが未設定です。管理者にお問い合わせください（Supabase 環境変数）', email });
		}
		const { data, error } = await supabase.auth.signInWithPassword({ email, password });
		if (error || !data.user) return fail(401, { message: 'メールアドレスまたはパスワードが違います', email });

		const role = (data.user.app_metadata as { role?: string } | null)?.role;
		if (role !== 'admin' && role !== 'staff') {
			// 管理権限のないアカウント（会員等）でのログインは拒否し、発行されたセッションを破棄
			await supabase.auth.signOut();
			return fail(403, { message: 'この画面にアクセスする権限がありません', email });
		}
		redirect(303, '/admin');
	},

	// デモのワンクリックログイン（AUTH_MODE=demo のときのみ。本番 supabase モードでは無効）
	admin: async ({ cookies }) => {
		if (AUTH_MODE !== 'demo') return fail(400, { message: 'デモログインは無効です' });
		setSession(cookies, { id: 'admin-demo', role: 'admin', name: '管理者' });
		redirect(303, '/admin');
	},
	staff: async ({ cookies }) => {
		if (AUTH_MODE !== 'demo') return fail(400, { message: 'デモログインは無効です' });
		setSession(cookies, { id: 'staff-demo', role: 'staff', name: 'スタッフ' });
		redirect(303, '/admin');
	}
};
