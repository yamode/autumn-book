// 会員詳細。本番（ADMIN_SUPABASE）では book の実データ、それ以外は store.ts のデモ。
//
// 実データ側で出せないもの（意図的に空にし、UI で理由を出す）:
//   - 予約履歴 … 会員軸で他人の予約を引く管理 RPC が未整備（/admin/reservations で会員名検索する）
//   - おたより台帳 … book.otayori_ledger に staff select policy が無い（残高のみ表示）
//   - ランク手動変更 … 更新 RPC が未整備（book.members は members_own_update のみ）
import { error, fail } from '@sveltejs/kit';

import { ADMIN_SUPABASE } from '$lib/server/auth';
import {
	adjustPointsOf,
	adminListMemberCoupons,
	adminListMembers,
	adminMemberDevices,
	bookAdmin,
	grantOtayoriOf,
	listMemberNotifications,
	listMemberPreferences,
	listPointLedger,
	mapRpcError,
	otayoriBalanceOf,
	normalizeRank,
	pointBalanceOf,
	type DeviceRow,
	type MemberCouponRow,
	type MemberNotificationRow,
	type MemberPreferenceRow
} from '$lib/server/admin-app-data';
import {
	adjustPoints,
	auditLogs,
	facilityById,
	grantOtayori,
	memberById,
	myReservations,
	otayoriBalance,
	otayoriLedger,
	pointBalance,
	pointLedger
} from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

type LedgerEntry = { id: string; delta: number; reason: string; createdAt: string };
type Reservation = { code: string; checkin: string; status: string; facilityName: string };
type Audit = { at: string; actor: string; action: string; detail: string };

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';

	if (ADMIN_SUPABASE) {
		const client = bookAdmin(event);
		const id = event.params.id;

		// admin_list_members に user_id 絞り込みが無いため取得して突き合わせる。
		// 会員数が 1000 を超えたら RPC に p_user_id を足すこと（HANDOFF 参照）。
		let member;
		try {
			const rows = await adminListMembers(client, { limit: 1000, includeWithdrawn: true });
			member = rows.find((m) => m.user_id === id) ?? null;
		} catch (e) {
			error(500, mapRpcError(e));
		}
		if (!member) error(404, '会員が見つかりません');

		// policy 未整備のテーブルがあるため、1つ落ちても画面が開くようにする
		const [balance, otayori, ledger, coupons, devices, notifications, preferences] =
			await Promise.all([
				pointBalanceOf(client, id).catch(() => 0),
				otayoriBalanceOf(client, id).catch(() => 0),
				listPointLedger(client, id).catch(() => []),
				adminListMemberCoupons(client, { memberUserId: id }).catch(() => [] as MemberCouponRow[]),
				adminMemberDevices(client, id).catch(() => [] as DeviceRow[]),
				listMemberNotifications(client, id).catch(() => [] as MemberNotificationRow[]),
				listMemberPreferences(client, id).catch(() => [] as MemberPreferenceRow[])
			]);

		return {
			live: true as const,
			isAdmin,
			m: {
				id,
				memberCode: member.member_code ?? '—',
				name: member.name ?? '（氏名未登録）',
				kana: '',
				email: member.email ?? '（権限がありません）',
				phone: '—',
				rank: normalizeRank(member.rank_code),
				mailOptIn: false,
				joinedAt: member.joined_at?.slice(0, 10) ?? '',
				withdrawnAt: member.withdrawn_at?.slice(0, 10) ?? null,
				pushOptIn: member.push_opt_in as boolean | null,
				lastStay: member.last_stay as string | null
			},
			balance,
			otayoriBalance: otayori,
			ledger: ledger.map<LedgerEntry>((e) => ({
				id: e.id,
				delta: e.delta,
				reason: e.reason ?? '',
				createdAt: e.created_at.slice(0, 16).replace('T', ' ')
			})),
			otayoriLedger: [] as LedgerEntry[],
			reservations: [] as Reservation[],
			audits: [] as Audit[],
			coupons,
			devices,
			notifications,
			preferences
		};
	}

	const member = memberById(event.params.id);
	if (!member) error(404, '会員が見つかりません');
	return {
		live: false as const,
		isAdmin,
		m: {
			id: member.id,
			memberCode: member.memberCode,
			name: member.name,
			kana: member.kana,
			email: isAdmin ? member.email : '（権限がありません）',
			phone: isAdmin ? member.phone : '***',
			rank: member.rank,
			mailOptIn: member.mailOptIn,
			joinedAt: member.joinedAt,
			withdrawnAt: null as string | null,
			pushOptIn: null as boolean | null,
			lastStay: null as string | null
		},
		balance: pointBalance(member.id),
		otayoriBalance: otayoriBalance(member.id),
		ledger: pointLedger
			.filter((p) => p.memberId === member.id)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map<LedgerEntry>((e) => ({
				id: e.id,
				delta: e.delta,
				reason: e.reason,
				createdAt: e.createdAt
			})),
		otayoriLedger: otayoriLedger
			.filter((e) => e.memberId === member.id)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map<LedgerEntry>((e) => ({
				id: e.id,
				delta: e.delta,
				reason: e.reason,
				createdAt: e.createdAt
			})),
		reservations: myReservations(member.id).map<Reservation>((b) => ({
			code: b.code,
			checkin: b.checkin,
			status: b.status,
			facilityName: facilityById(b.facilityId)!.name
		})),
		audits: auditLogs.filter((a) => a.detail.includes(member.id)).slice(0, 10) as Audit[],
		coupons: [] as MemberCouponRow[],
		devices: [] as DeviceRow[],
		notifications: [] as MemberNotificationRow[],
		preferences: [] as MemberPreferenceRow[]
	};
};

export const actions: Actions = {
	adjust: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const delta = Number(form.get('delta'));
		const reason = String(form.get('reason') ?? '').trim();
		if (!delta || !reason) {
			return fail(400, { message: 'ポイント数と理由（必須）を入力してください' });
		}
		if (ADMIN_SUPABASE) {
			try {
				await adjustPointsOf(bookAdmin(event), event.params.id, delta, reason);
			} catch (e) {
				return fail(400, { message: mapRpcError(e) });
			}
		} else {
			adjustPoints(event.params.id, delta, reason, event.locals.user.name);
		}
		return { adjusted: true };
	},

	rank: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		if (ADMIN_SUPABASE) {
			return fail(400, { message: 'ランクの手動変更は未対応です（更新 RPC が未整備のため）。' });
		}
		const member = memberById(event.params.id);
		if (!member) return fail(404, {});
		const form = await event.request.formData();
		const rank = String(form.get('rank')) as typeof member.rank;
		const reason = String(form.get('rankReason') ?? '').trim();
		if (!reason) {
			return fail(400, { message: 'ランク変更の理由を入力してください（監査ログに記録）' });
		}
		member.rank = rank;
		auditLogs.unshift({
			id: `al-${Date.now()}`,
			at: new Date().toISOString(),
			actor: event.locals.user.name,
			action: 'change_rank',
			detail: `${member.id} → ${rank}: ${reason}`
		});
		return { rankChanged: true };
	},

	// おたよりポイント手動付与（admin 限定・設計書 §9）。1pt=1,000円相当。正負可。
	grantOtayori: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const delta = Number(form.get('otayoriDelta'));
		const reason = String(form.get('otayoriReason') ?? '').trim();
		if (!delta || !reason) {
			return fail(400, { message: 'おたよりポイント数（0以外）と理由（必須）を入力してください' });
		}
		if (ADMIN_SUPABASE) {
			try {
				await grantOtayoriOf(bookAdmin(event), event.params.id, delta, reason);
			} catch (e) {
				return fail(400, { message: mapRpcError(e) });
			}
		} else {
			grantOtayori(event.params.id, delta, reason, event.locals.user.name);
		}
		return { otayoriGranted: true };
	}
};
