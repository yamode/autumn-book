// 管理画面の二段階認証（認証アプリ・TOTP）の登録と管理（本人用・docs/auth-hardening.md §7.2）。
// enroll → QR と手入力用の秘密 → challengeAndVerify で有効化。有効化と同時にこのセッションは aal2 になる。
// Supabase 側で TOTP が無効なら、登録時のエラーで設定場所を案内するだけ（既存のログインには影響しない）。
import { fail } from '@sveltejs/kit';
import { AUTH_MODE, adminMfaRequired, createSupabaseServerClient, forgetStaffUser } from '$lib/server/auth';
import { adminMfaErrorText, normalizeTotpCode } from '$lib/admin-mfa';
import type { Actions, PageServerLoad } from './$types';
import type { RequestEvent } from '@sveltejs/kit';
import { AdminPasskeyError, adminPasskeyAvailable, listAdminPasskeys, removeAdminPasskey, type AdminPasskeyView } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

/** 画面に出す登録の形（秘密は含めない）。 */
type FactorRow = { id: string; friendlyName: string | null; createdAt: string; lastUsedAt: string | null };

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { locals, url } = event;
	const base = {
		required: adminMfaRequired(),
		enrollRequested: url.searchParams.get('enroll') === '1',
		isAdmin: locals.user?.role === 'admin'
	};
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) {
		return { ...base, available: false as const, factors: [] as FactorRow[], loadError: null, aal: null, passkey: { usable: false, list: [] as AdminPasskeyView[], loadError: null as string | null } };
	}
	// パスキー（本番ドメインとローカルだけ。読めなくても認証アプリの画面は出す）
	const passkey = { usable: adminPasskeyAvailable(event), list: [] as AdminPasskeyView[], loadError: null as string | null };
	// パスキーの一覧と認証アプリの一覧は互いに依存しないので同時に投げる（2026-10-18 高速化）
	const passkeyLoad =
		passkey.usable && locals.user
			? listAdminPasskeys(locals.user.id).then(
					(list) => {
						passkey.list = list;
					},
					(e) => {
						passkey.loadError = e instanceof AdminPasskeyError ? e.message : 'パスキーを読み込めませんでした。';
					}
				)
			: Promise.resolve();
	try {
		const client = createSupabaseServerClient(event);
		const [{ data, error }] = await Promise.all([client.auth.mfa.listFactors(), passkeyLoad]);
		if (error) throw error;
		const factors: FactorRow[] = data.totp.map((f) => ({
			id: f.id,
			friendlyName: f.friendly_name ?? null,
			createdAt: f.created_at,
			lastUsedAt: f.last_challenged_at ?? null
		}));
		return { ...base, available: true as const, factors, loadError: null, aal: locals.adminAal.current, passkey };
	} catch (e) {
		// 認証アプリ側が失敗してもパスキーの欄は読み終わってから返す（passkeyLoad は失敗しない）
		await passkeyLoad;
		return {
			...base,
			available: true as const,
			factors: [] as FactorRow[],
			loadError: adminMfaErrorText(e as { code?: string; message?: string }),
			aal: locals.adminAal.current,
			passkey
		};
	}
};

function guard(event: RequestEvent) {
	if (AUTH_MODE !== 'supabase' || !event.locals.adminAal) {
		return fail(400, { message: 'この環境（AUTH_MODE=demo）では二段階認証は使えません。' });
	}
	if (event.locals.user?.role !== 'admin' && event.locals.user?.role !== 'staff') {
		return fail(403, { message: '権限がありません。' });
	}
	return null;
}

function defaultFriendlyName(): string {
	// Supabase は同じユーザーで名前の重複を許さないため、時刻まで入れる
	const d = new Date(Date.now() + 9 * 3600_000).toISOString(); // JST
	return `認証アプリ ${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

export const actions: Actions = {
	// 登録を始める（QR と秘密を返す。まだ有効ではない）
	enroll: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const name = String(form.get('friendlyName') ?? '').trim().slice(0, 40) || defaultFriendlyName();
		const client = createSupabaseServerClient(event);

		// 途中でやめた登録（unverified）が残っていると名前の重複や上限に当たるので先に片付ける
		const listed = await client.auth.mfa.listFactors();
		for (const f of listed.data?.all ?? []) {
			if (f.factor_type === 'totp' && f.status === 'unverified') {
				await client.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
			}
		}

		const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: name, issuer: '山人 管理画面' });
		if (error || !data) return fail(400, { message: adminMfaErrorText(error) });
		return {
			enroll: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, friendlyName: name }
		};
	},

	// 認証アプリのコードで登録を有効にする（このセッションは aal2 になる）
	verify: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const factorId = String(form.get('factorId') ?? '');
		const code = normalizeTotpCode(String(form.get('code') ?? ''));
		const keep = {
			factorId,
			qrCode: String(form.get('qrCode') ?? ''),
			secret: String(form.get('secret') ?? ''),
			friendlyName: String(form.get('friendlyName') ?? '')
		};
		if (!factorId) return fail(400, { message: '登録をやり直してください。' });
		if (!code) return fail(400, { message: '認証アプリに表示されている 6 桁の数字を入力してください。', enroll: keep });
		const client = createSupabaseServerClient(event);
		const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
		if (error) return fail(400, { message: adminMfaErrorText(error), enroll: keep });
		forgetStaffUser(event.locals.user?.id);
		return { verified: true };
	},

	// 途中でやめる（未確認の登録を消す）
	cancel: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const factorId = String(form.get('factorId') ?? '');
		if (factorId) {
			await createSupabaseServerClient(event)
				.auth.mfa.unenroll({ factorId })
				.catch(() => {});
		}
		return { cancelled: true };
	},

	// 自分のパスキーを削除する（関所により、確認済みのセッションでしか来られない）
	removePasskey: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const passkeyId = String(form.get('passkeyId') ?? '');
		try {
			const name = await removeAdminPasskey({ userId: event.locals.user!.id, passkeyId, ip: clientIp(event.request) });
			return { passkeyRemoved: name };
		} catch (e) {
			if (e instanceof AdminPasskeyError) return fail(e.status, { message: e.message });
			return fail(500, { message: 'パスキーを削除できませんでした。' });
		}
	},

	// 自分の登録を削除する（Supabase が aal2 を要求する。確認済みのセッションでしか消せない）
	remove: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const factorId = String(form.get('factorId') ?? '');
		if (!factorId) return fail(400, { message: '削除する登録を選んでください。' });
		const { error } = await createSupabaseServerClient(event).auth.mfa.unenroll({ factorId });
		if (error) return fail(400, { message: adminMfaErrorText(error) });
		forgetStaffUser(event.locals.user?.id);
		return { removed: true };
	}
};
