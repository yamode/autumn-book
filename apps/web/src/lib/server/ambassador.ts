// アンバサダー会員の DB 呼び出し（book.* の RPC）。設計: docs/ambassador.md
// 書き込み・権限判定・監査ログは RPC（SECURITY DEFINER）の中。ここでは形を揃えるだけ。
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookClient } from './admin-app-data';
import type { InviteApplyStatus, ReferralStatus } from '$lib/ambassador';

/** 会員本人は cookie 束縛の SupabaseClient（.schema('book') して呼ぶ）、管理画面は bookAdmin の BookClient */
async function rpc<T>(client: BookClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
	const { data, error } = await client.rpc(fn, args);
	if (error) throw error;
	return data as T;
}

// ---------------------------------------------------------------------------
// 会員本人
// ---------------------------------------------------------------------------

export type InviteApplyResult = {
	status: InviteApplyStatus;
	coupon: { name: string; discountType: 'fixed' | 'percent'; discountValue: number; minTotal: number; validUntil: string } | null;
};

/** 会員登録の直後に招待コードを結ぶ（失敗しても登録は止めない） */
export async function applyInviteCode(client: SupabaseClient, code: string): Promise<InviteApplyResult> {
	try {
		const r = await rpc<{ status: InviteApplyStatus; coupon?: Record<string, unknown> | null }>(client.schema('book'), 'apply_invite_code', { p_code: code });
		const c = r.coupon;
		return {
			status: r.status,
			coupon: c
				? {
						name: String(c.name ?? ''),
						discountType: c.discount_type === 'percent' ? 'percent' : 'fixed',
						discountValue: Number(c.discount_value ?? 0),
						minTotal: Number(c.min_total ?? 0),
						validUntil: String(c.valid_until ?? '')
					}
				: null
		};
	} catch (e) {
		console.error('[ambassador] apply_invite_code', e);
		return { status: 'error', coupon: null };
	}
}

export type MyReferral = {
	label: string;
	registeredOn: string;
	status: ReferralStatus;
	visits: number;
	nights: number;
	firstStayOn: string | null;
};

export type MyAmbassador =
	| { isAmbassador: false }
	| {
			isAmbassador: true;
			code: string;
			registered: number;
			stayed: number;
			visits: number;
			nights: number;
			pointsTotal: number;
			firstPoints: number;
			shareRates: number[];
			referrals: MyReferral[];
	  };

export async function myAmbassador(client: SupabaseClient): Promise<MyAmbassador> {
	const r = await rpc<Record<string, unknown>>(client.schema('book'), 'my_ambassador');
	if (!r?.is_ambassador) return { isAmbassador: false };
	return {
		isAmbassador: true,
		code: String(r.code),
		registered: Number(r.registered ?? 0),
		stayed: Number(r.stayed ?? 0),
		visits: Number(r.visits ?? 0),
		nights: Number(r.nights ?? 0),
		pointsTotal: Number(r.points_total ?? 0),
		firstPoints: Number(r.first_points ?? 0),
		shareRates: ((r.share_rates as unknown[]) ?? []).map(Number),
		referrals: ((r.referrals as Record<string, unknown>[]) ?? []).map((x) => ({
			label: String(x.label ?? ''),
			registeredOn: String(x.registered_on ?? ''),
			status: (x.status as ReferralStatus) ?? 'active',
			visits: Number(x.visits ?? 0),
			nights: Number(x.nights ?? 0),
			firstStayOn: (x.first_stay_on as string | null) ?? null
		}))
	};
}

// ---------------------------------------------------------------------------
// 管理画面
// ---------------------------------------------------------------------------

export type AdminReferral = {
	memberUserId: string;
	memberCode: string;
	name: string;
	registeredAt: string;
	status: ReferralStatus;
	statusReason: string | null;
	visits: number;
	nights: number;
	firstStayOn: string | null;
	points: number;
};

export type AdminMemberAmbassador = {
	ambassador: {
		code: string;
		isActive: boolean;
		grantedAt: string;
		revokedAt: string | null;
		codeIssuedAt: string;
		note: string | null;
		pointsTotal: number;
	} | null;
	referrals: AdminReferral[];
	invitedBy: {
		memberUserId: string;
		memberCode: string;
		name: string;
		status: ReferralStatus;
		statusReason: string | null;
		registeredAt: string;
		codeUsed: string;
	} | null;
};

export async function adminMemberAmbassador(client: BookClient, memberUserId: string): Promise<AdminMemberAmbassador> {
	const r = await rpc<Record<string, unknown>>(client, 'admin_member_ambassador', { p_member: memberUserId });
	const a = r.ambassador as Record<string, unknown> | null;
	const by = r.invited_by as Record<string, unknown> | null;
	return {
		ambassador: a
			? {
					code: String(a.code),
					isActive: Boolean(a.is_active),
					grantedAt: String(a.granted_at ?? ''),
					revokedAt: (a.revoked_at as string | null) ?? null,
					codeIssuedAt: String(a.code_issued_at ?? ''),
					note: (a.note as string | null) ?? null,
					pointsTotal: Number(a.points_total ?? 0)
				}
			: null,
		referrals: ((r.referrals as Record<string, unknown>[]) ?? []).map((x) => ({
			memberUserId: String(x.member_user_id),
			memberCode: String(x.member_code ?? ''),
			name: String(x.name ?? ''),
			registeredAt: String(x.registered_at ?? ''),
			status: (x.status as ReferralStatus) ?? 'active',
			statusReason: (x.status_reason as string | null) ?? null,
			visits: Number(x.visits ?? 0),
			nights: Number(x.nights ?? 0),
			firstStayOn: (x.first_stay_on as string | null) ?? null,
			points: Number(x.points ?? 0)
		})),
		invitedBy: by
			? {
					memberUserId: String(by.member_user_id),
					memberCode: String(by.member_code ?? ''),
					name: String(by.name ?? ''),
					status: (by.status as ReferralStatus) ?? 'active',
					statusReason: (by.status_reason as string | null) ?? null,
					registeredAt: String(by.registered_at ?? ''),
					codeUsed: String(by.code_used ?? '')
				}
			: null
	};
}

export async function adminSetAmbassador(client: BookClient, memberUserId: string, on: boolean, note?: string | null) {
	return rpc<{ is_active: boolean; code: string | null }>(client, 'admin_set_ambassador', {
		p_member: memberUserId,
		p_on: on,
		p_note: note ?? null
	});
}

export async function adminReissueAmbassadorCode(client: BookClient, memberUserId: string) {
	return rpc<{ code: string }>(client, 'admin_reissue_ambassador_code', { p_member: memberUserId });
}

export async function adminVoidReferral(client: BookClient, referredUserId: string, voidIt: boolean, reason?: string | null) {
	return rpc<{ status: ReferralStatus }>(client, 'admin_void_referral', {
		p_referred: referredUserId,
		p_void: voidIt,
		p_reason: reason ?? null
	});
}

export type AdminAmbassadorRow = {
	memberUserId: string;
	memberCode: string;
	name: string;
	code: string;
	isActive: boolean;
	grantedAt: string;
	registered: number;
	stayed: number;
	visits: number;
	pointsTotal: number;
};

export async function adminAmbassadors(client: BookClient): Promise<AdminAmbassadorRow[]> {
	const rows = await rpc<Record<string, unknown>[]>(client, 'admin_ambassadors');
	return (rows ?? []).map((x) => ({
		memberUserId: String(x.member_user_id),
		memberCode: String(x.member_code ?? ''),
		name: String(x.name ?? ''),
		code: String(x.code ?? ''),
		isActive: Boolean(x.is_active),
		grantedAt: String(x.granted_at ?? ''),
		registered: Number(x.registered ?? 0),
		stayed: Number(x.stayed ?? 0),
		visits: Number(x.visits ?? 0),
		pointsTotal: Number(x.points_total ?? 0)
	}));
}

export type ReferralProgram = { firstPoints: number; shareRates: number[]; inviteCouponId: string | null; updatedAt: string | null };

export async function adminReferralProgram(client: BookClient): Promise<ReferralProgram> {
	const r = await rpc<Record<string, unknown>>(client, 'admin_referral_program');
	return {
		firstPoints: Number(r.first_points ?? 0),
		shareRates: ((r.share_rates as unknown[]) ?? []).map(Number),
		inviteCouponId: (r.invite_coupon_id as string | null) ?? null,
		updatedAt: (r.updated_at as string | null) ?? null
	};
}

export async function adminSaveReferralProgram(client: BookClient, p: { firstPoints: number; shareRates: number[]; inviteCouponId: string | null }) {
	return rpc(client, 'admin_save_referral_program', {
		p_first_points: p.firstPoints,
		p_share_rates: p.shareRates,
		p_invite_coupon_id: p.inviteCouponId
	});
}

/** RPC のエラーを画面の文言に */
export function ambassadorErrorMessage(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : String(e ?? '');
	if (msg.includes('member_withdrawn')) return '退会した会員はアンバサダーにできません。';
	if (msg.includes('member_not_found')) return '会員が見つかりません。';
	if (msg.includes('not_ambassador')) return 'この会員はアンバサダーではありません。';
	if (msg.includes('referral_not_found')) return '招待の記録が見つかりません。';
	if (msg.includes('coupon_not_found')) return '選んだクーポンが見つかりません。';
	if (msg.includes('invalid_params')) return '入力の値が正しくありません（ポイントは 0〜100,000・割合は 0〜20% を最大10年分）。';
	if (msg.includes('forbidden') || msg.includes('admin')) return 'この操作は管理者だけができます。';
	return msg || 'うまくいきませんでした。';
}
