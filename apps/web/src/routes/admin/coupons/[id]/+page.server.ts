// クーポン詳細: 条件編集・配布（対象抽出→二段確認）・配布先一覧・配布取消・無効化。
import { error, fail } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	adminListCoupons,
	adminListMemberCoupons,
	adminListMembers,
	adminRevokeMemberCoupons,
	adminSetCouponActive,
	adminUpsertCoupon,
	bookAdmin,
	issueCoupon,
	mapRpcError,
	type CouponRow,
	type MemberCouponRow
} from '$lib/server/admin-app-data';
import { readCouponForm } from '../coupon-form';
import type { Actions, PageServerLoad } from './$types';

const UNAVAILABLE = 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）';

function requireAdmin(role: string | undefined, what: string) {
	if (role !== 'admin') return `${what}は管理者のみ行えます（スタッフは閲覧のみ）。`;
	return null;
}

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			coupon: null as CouponRow | null,
			issuedList: [] as MemberCouponRow[]
		};
	}
	const client = bookAdmin(event);
	try {
		const coupons = await adminListCoupons(client, true);
		const coupon = coupons.find((c) => c.id === event.params.id) ?? null;
		if (!coupon) error(404, 'クーポンが見つかりません');

		const issuedList = await adminListMemberCoupons(client, { couponId: coupon.id });
		return { unavailable: false as const, coupon, issuedList };
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return {
			unavailable: false as const,
			coupon: null as CouponRow | null,
			issuedList: [] as MemberCouponRow[],
			error: mapRpcError(e)
		};
	}
};

export const actions: Actions = {
	save: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, 'クーポンの編集');
		if (denied) return fail(403, { message: denied });

		const form = await event.request.formData();
		try {
			await adminUpsertCoupon(bookAdmin(event), { id: event.params.id, ...readCouponForm(form) });
			return { saved: true };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	setActive: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, 'クーポンの有効・無効の切り替え');
		if (denied) return fail(403, { message: denied });

		const form = await event.request.formData();
		try {
			await adminSetCouponActive(bookAdmin(event), event.params.id, form.get('active') === 'true');
			return { saved: true };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	/** 配布対象を数える（この結果を持ち回らないと配布ボタンを押せない） */
	countTargets: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const form = await event.request.formData();
		const mode = String(form.get('mode') ?? 'all');

		try {
			const client = bookAdmin(event);
			const ranks = form.getAll('ranks').map(String);
			const members = await adminListMembers(client, {
				ranks: mode === 'rank' && ranks.length > 0 ? ranks : null,
				stayedFacility: mode === 'stayed' ? (String(form.get('stayedFacility') ?? '') || null) : null,
				stayedFrom: mode === 'stayed' ? (String(form.get('stayedFrom') ?? '') || null) : null,
				stayedUntil: mode === 'stayed' ? (String(form.get('stayedUntil') ?? '') || null) : null,
				q: mode === 'search' ? String(form.get('q') ?? '') : null,
				limit: 1000
			});

			// 既に配布済みの会員は除く（issue_coupon は重複を作らないが、件数表示を実態に合わせる）
			const already = new Set(
				(await adminListMemberCoupons(client, { couponId: event.params.id })).map(
					(r) => r.member_user_id
				)
			);
			const targets = members.filter((m) => !already.has(m.user_id));

			return {
				counted: {
					mode,
					total: members.length,
					already: members.length - targets.length,
					ids: targets.map((m) => m.user_id),
					preview: targets.slice(0, 20).map((m) => ({
						name: m.name,
						memberCode: m.member_code,
						rank: m.rank_code
					}))
				}
			};
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	issue: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, 'クーポンの配布');
		if (denied) return fail(403, { message: denied });

		const form = await event.request.formData();
		let ids: string[];
		try {
			ids = JSON.parse(String(form.get('targetIds') ?? '[]')) as string[];
		} catch {
			return fail(400, { message: '配布対象の読み取りに失敗しました。もう一度数え直してください。' });
		}
		if (ids.length === 0) return fail(400, { message: '配布対象が 0 名です。' });

		try {
			const n = await issueCoupon(bookAdmin(event), event.params.id, ids);
			return { issued: n ?? ids.length };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	revoke: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, 'クーポンの配布取消');
		if (denied) return fail(403, { message: denied });

		const form = await event.request.formData();
		const memberUserId = String(form.get('memberUserId') ?? '');
		const reason = String(form.get('reason') ?? '') || null;
		try {
			const n = await adminRevokeMemberCoupons(
				bookAdmin(event),
				event.params.id,
				memberUserId ? [memberUserId] : null,
				reason
			);
			return { revoked: n };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	}
};
