// 会員詳細。本番（ADMIN_SUPABASE）では book の実データ、それ以外は store.ts のデモ。
//
// 実データ側で出せないもの（意図的に空にし、UI で理由を出す）:
//   - おたより台帳 … book.otayori_ledger に staff select policy が無い（残高のみ表示）
// ランク手動変更（V0・2026-10-11）: 実データは book.admin_set_member_rank（管理者のみ・理由必須・監査ログ change_rank）。
// 特別会員の専用ページ（docs/vip-member-page.md §13.4.5）: この会員が対象の専用ページ（本人・家族）の一覧（memberPages）と
// 「専用ページを作る」（?/createMemberPage・admin のみ・公開停止・予約受付オフで作り、対象の会員に入れて取引先詳細へ）。
import { error, fail, redirect } from '@sveltejs/kit';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import { addPartnerMember, createPartner, deletePartner, memberForMemberPage, memberPagesForAdmin, PartnerStoreError } from '$lib/server/partners/store';
import { actionFailure, staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';

import { ADMIN_SUPABASE } from '$lib/server/auth';
import { toFacilityUuidStrict } from '$lib/server/supabase-data';
import {
	adjustPointsOf,
	adminListMemberCoupons,
	adminListBookings,
	adminListMembers,
	adminMemberDevices,
	adminSetMemberRank,
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

	// 予約履歴の施設名を引くための対応表（admin_list_bookings は facility_id しか返さない）
	const { facilities } = await event.parent();
	// admin_list_bookings は実 UUID を返すので、対応表も UUID キーで作る
	const facilityName = new Map(facilities.map((f) => [toFacilityUuidStrict(f.id), f.name]));

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
		const [balance, otayori, ledger, coupons, devices, notifications, preferences, stays] =
			await Promise.all([
				pointBalanceOf(client, id).catch(() => 0),
				otayoriBalanceOf(client, id).catch(() => 0),
				listPointLedger(client, id).catch(() => []),
				adminListMemberCoupons(client, { memberUserId: id }).catch(() => [] as MemberCouponRow[]),
				adminMemberDevices(client, id).catch(() => [] as DeviceRow[]),
				listMemberNotifications(client, id).catch(() => [] as MemberNotificationRow[]),
				listMemberPreferences(client, id).catch(() => [] as MemberPreferenceRow[]),
				// 会員軸の予約履歴。施設は跨いで見たいので p_facility_id は null、期間も無指定
				adminListBookings(client, {
					facilityId: null,
					source: null,
					memberUserId: id,
					limit: 50
				}).catch(() => [])
			]);

		// 専用ページ（本人・家族）。取引先モジュールが使えない環境・権限なしは空
		const memberPages = await staffPartnerScope(event, 'view')
			.then((scope) => memberPagesForAdmin(scope.db, scope.tenantId, id))
			.catch(() => []);

		return {
			live: true as const,
			isAdmin,
			// この会員が対象の専用ページ（via=self）と家族のつながりで使えるページ（via=family）
			memberPages,
			// 「専用ページを作る」（管理者のみ・退会者には作らない）
			canCreateMemberPage: isAdmin && !member.withdrawn_at,
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
			reservations: stays.map<Reservation>((s2) => ({
				code: s2.booking_code,
				checkin: s2.check_in_date,
				status: s2.stay_status,
				facilityName: facilityName.get(s2.facility_id) ?? ""
			})),
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
		memberPages: [] as Awaited<ReturnType<typeof memberPagesForAdmin>>,
		canCreateMemberPage: false,
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
			const form = await event.request.formData();
			const rank = String(form.get('rank') ?? '');
			const reason = String(form.get('rankReason') ?? '').trim();
			if (!reason) return fail(400, { message: 'ランク変更の理由を入力してください（監査ログに記録）' });
			try {
				await adminSetMemberRank(bookAdmin(event), event.params.id, rank, reason);
			} catch (e) {
				return fail(400, { message: mapRpcError(e) });
			}
			return { rankChanged: true };
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

	// 特別会員の専用ページを作る（admin のみ・Q5）: kind='member'・公開停止・予約受付オフで、ab_fac の施設に作る（他の施設は
	// 取引先詳細の施設タブでオン）。この会員を対象の会員に入れて、取引先詳細へ移る
	createMemberPage: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では専用ページを作れません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。' });
		let partnerId: string;
		try {
			const scope = await staffPartnerScope(event, 'edit');
			const memberUserId = event.params.id;
			// 会員は 1 件だけ引く（同じテナント・service_role・一覧から探さない）
			const member = await memberForMemberPage(scope.db, scope.tenantId, memberUserId);
			if (!member) return fail(404, { message: '会員が見つかりません' });
			if (member.withdrawnAt) return fail(400, { message: '退会した会員には専用ページを作れません。' });
			const name = `${(member.name ?? '').trim() || member.memberCode || '会員'}様 専用ページ`.slice(0, 120);
			const partner = await createPartner(
				scope.db,
				{ tenantId: scope.tenantId, facilityId: scope.facilityId, userId: scope.userId },
				{
					name,
					kind: 'member',
					contact_name: null,
					contact_email: null,
					is_active: false,
					valid_from: null,
					valid_until: null,
					max_days_ahead: 365,
					show_inventory: true,
					include_advance: true,
					pricing: DEFAULT_PARTNER_PRICING,
					note: null,
					booking_enabled: false,
					// 室数は公式と同じ 4 室まで・支払方法は使わない（公式予約の支払方法）
					booking_settings: { ...DEFAULT_PARTNER_BOOKING_SETTINGS, paymentOptions: [], maxRooms: 4 }
				}
			);
			try {
				await addPartnerMember(scope.db, partner, memberUserId, scope.userId);
			} catch (e) {
				// 対象の会員を入れられなければ作ったページも残さない
				await deletePartner(scope.db, partner).catch(() => undefined);
				throw e;
			}
			partnerId = partner.id;
		} catch (e) {
			if (e instanceof StaffScopeError || e instanceof PartnerStoreError) return actionFailure(e);
			return fail(400, { message: mapRpcError(e) });
		}
		redirect(303, `/admin/partners/${partnerId}`);
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
