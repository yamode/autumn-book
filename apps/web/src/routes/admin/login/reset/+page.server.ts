// パスワードの再設定（ユーザー管理の「再設定のメールを送る」のリンク先・未ログインで開く）。
// メールのリンクは ?token_hash=…（Supabase の recovery。lib/server/admin-users.ts sendPasswordResetMail）。
// 開いただけではトークンを使わない（メールの安全確認ツールがリンクを先に開いても無効にならないように）。
// 新しいパスワードを送ったときに verifyOtp → updateUser → ログアウトし、ログイン画面へ戻す。
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { passwordProblem, MIN_PASSWORD } from '$lib/server/admin-users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
	return { tokenHash: url.searchParams.get('token_hash') ?? '', minPassword: MIN_PASSWORD, authMode: AUTH_MODE };
};

export const actions: Actions = {
	default: async (event) => {
		if (AUTH_MODE !== 'supabase') return fail(400, { message: 'この環境では使えません。' });
		const form = await event.request.formData();
		const tokenHash = String(form.get('tokenHash') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (!tokenHash) return fail(400, { message: 'リンクが正しくありません。管理者に再設定のメールをもう一度送ってもらってください。' });
		const problem = passwordProblem(password);
		if (problem) return fail(400, { message: problem });
		if (password !== confirm) return fail(400, { message: '確認のパスワードが一致しません。' });

		const client = createSupabaseServerClient(event);
		const { data, error } = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
		if (error || !data.session) {
			return fail(400, { message: 'リンクの有効期限が切れたか、すでに使われています。管理者に再設定のメールをもう一度送ってもらってください。' });
		}
		const { error: upErr } = await client.auth.updateUser({ password });
		await client.auth.signOut().catch(() => undefined);
		if (upErr) return fail(400, { message: `パスワードを変えられませんでした（${upErr.message}）。管理者にお知らせください。` });
		redirect(303, '/admin/login?reset=1');
	}
};
