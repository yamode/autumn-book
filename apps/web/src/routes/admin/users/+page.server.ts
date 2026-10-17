// ユーザー管理（管理者だけ・2026-10-17 指示）。アカウントの一覧・追加（初期パスワード）・Book の権限・施設の割り当て・
// パスワードの変更と再設定メール。中身は lib/server/admin-users.ts（service_role の管理 API・監査ログ）。
// 一覧は管理者なら見られる。変更は、操作する本人が二段階認証かパスキーで確認済み（aal2）のときだけ。
import { error, fail } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { facilities } from '$lib/server/store';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import {
	AdminUserError,
	createAdminUser,
	listAdminUsers,
	MIN_PASSWORD,
	normalizeBookRole,
	sendPasswordResetMail,
	setBookRole,
	setSharedFacilities,
	setUserPassword,
	type AdminUserView
} from '$lib/server/admin-users';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// 施設（表示名と UUID）
const FACILITY_OPTIONS = facilities.map((f) => ({ id: FACILITY_UUID[f.id] ?? f.id, name: f.name }));
const VALID_FACILITY = new Set(FACILITY_OPTIONS.map((f) => f.id));

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { locals } = event;
	if (locals.user?.role !== 'admin') error(403, 'この画面は管理者だけが開けます。');
	const base = {
		selfId: locals.user.id,
		selfAal2: locals.adminAal?.current === 'aal2',
		facilities: FACILITY_OPTIONS,
		minPassword: MIN_PASSWORD
	};
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) {
		return { ...base, available: false as const, users: [] as AdminUserView[], loadError: null as string | null };
	}
	try {
		return { ...base, available: true as const, users: await listAdminUsers(), loadError: null as string | null };
	} catch (e) {
		return { ...base, available: true as const, users: [] as AdminUserView[], loadError: e instanceof AdminUserError ? e.message : 'アカウントの一覧を読めませんでした。' };
	}
};

/** 変更の前の確認（管理者・確認済み）。だめなら fail を返す */
function guard(event: RequestEvent) {
	const { locals } = event;
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) return fail(400, { message: 'この環境（AUTH_MODE=demo）では使えません。' });
	if (locals.user?.role !== 'admin') return fail(403, { message: 'ユーザー管理は管理者だけができます。' });
	if (locals.adminAal.current !== 'aal2') {
		return fail(403, { message: 'アカウントを変えるには、先にご自身の二段階認証かパスキーを登録し、確認してください。' });
	}
	return null;
}

const facilityIdsFrom = (form: FormData) => form.getAll('facilityId').map(String).filter((f) => VALID_FACILITY.has(f));

async function run(fn: () => Promise<string>) {
	try {
		return { done: await fn() };
	} catch (e) {
		if (e instanceof AdminUserError) return fail(e.status, { message: e.message });
		console.error('[admin-users]', e);
		return fail(500, { message: '処理に失敗しました。' });
	}
}

export const actions: Actions = {
	create: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '');
		const r = await run(async () => {
			const u = await createAdminUser({
				actorId: event.locals.user!.id,
				email,
				name: String(form.get('name') ?? ''),
				password: String(form.get('password') ?? ''),
				role: normalizeBookRole(form.get('role')),
				facilityIds: facilityIdsFrom(form)
			});
			return `${u.email} を作りました。初期パスワードを本人（共有IDなら使う人たち）に伝えてください。`;
		});
		// 失敗したときは入力を残す（パスワードは残さない）
		return 'done' in r ? { ...r, created: true } : fail(r.status, { ...r.data, email, name: String(form.get('name') ?? '') });
	},

	role: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		return run(async () => {
			await setBookRole({ actorId: event.locals.user!.id, targetId: String(form.get('userId') ?? ''), role: normalizeBookRole(form.get('role')) });
			return '権限を変えました。';
		});
	},

	facilities: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		return run(async () => {
			await setSharedFacilities({ actorId: event.locals.user!.id, targetId: String(form.get('userId') ?? ''), facilityIds: facilityIdsFrom(form) });
			return '施設の割り当てを変えました。';
		});
	},

	password: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		return run(async () => {
			await setUserPassword({ actorId: event.locals.user!.id, targetId: String(form.get('userId') ?? ''), password: String(form.get('password') ?? '') });
			return 'パスワードを変えました。新しいパスワードを使う人に伝えてください。';
		});
	},

	resetMail: async (event) => {
		const blocked = guard(event);
		if (blocked) return blocked;
		const form = await event.request.formData();
		return run(async () => {
			const to = await sendPasswordResetMail({ actorId: event.locals.user!.id, targetId: String(form.get('userId') ?? ''), origin: event.url.origin });
			return `${to} にパスワードの再設定のメールを送りました（リンクの有効期限は 1 時間）。`;
		});
	}
};
