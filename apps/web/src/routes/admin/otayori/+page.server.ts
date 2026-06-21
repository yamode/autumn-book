import { fail } from '@sveltejs/kit';
import {
	listOtayoriAdmin,
	approveOtayori,
	rejectOtayori,
	grantOtayori,
	otayoriBalance,
	members,
	memberById
} from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

type Tab = 'pending' | 'approved' | 'rejected';
const TABS: Tab[] = ['pending', 'approved', 'rejected'];

export const load: PageServerLoad = async ({ url, locals }) => {
	const isAdmin = locals.user?.role === 'admin';
	const statusParam = url.searchParams.get('status');
	const status: Tab = TABS.includes(statusParam as Tab) ? (statusParam as Tab) : 'pending';

	const items = listOtayoriAdmin(status);

	// 会員検索（手動付与フォーム用）。q が無ければ空表示。
	const q = url.searchParams.get('q') ?? '';
	const found = q
		? members
				.filter((m) => m.name.includes(q) || m.kana.includes(q) || m.email.includes(q) || m.memberCode.includes(q))
				.map((m) => ({ id: m.id, memberCode: m.memberCode, name: m.name, balance: otayoriBalance(m.id) }))
		: [];

	return {
		isAdmin,
		status,
		items,
		q,
		found,
		counts: {
			pending: listOtayoriAdmin('pending').length,
			approved: listOtayoriAdmin('approved').length,
			rejected: listOtayoriAdmin('rejected').length
		}
	};
};

export const actions: Actions = {
	// 承認（＝1pt付与）。admin 限定（設計書 §2・§9）
	approve: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: 'おたよりの承認（ポイント付与）は管理者のみ可能です' });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		const res = approveOtayori(postId, locals.user.name);
		if ('error' in res) return fail(404, { message: '対象のおたよりが見つかりません' });
		return { ok: 'approve' };
	},

	// 却下。staff 可
	reject: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		const note = String(form.get('note') ?? '');
		const res = rejectOtayori(postId, note, locals.user.name);
		if ('error' in res) return fail(404, { message: '対象のおたよりが見つかりません' });
		return { ok: 'reject' };
	},

	// 会員検索 → 手動付与。admin 限定（設計書 §9）
	grant: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '手動付与は管理者のみ可能です' });
		const form = await request.formData();
		const memberId = String(form.get('memberId') ?? '');
		const delta = Number(form.get('delta'));
		const reason = String(form.get('reason') ?? '').trim();
		if (!memberById(memberId)) return fail(404, { message: '会員が見つかりません' });
		if (!delta || !reason) return fail(400, { message: 'ポイント数（0以外）と理由（必須）を入力してください' });
		grantOtayori(memberId, delta, reason, locals.user.name);
		return { ok: 'grant' };
	}
};
