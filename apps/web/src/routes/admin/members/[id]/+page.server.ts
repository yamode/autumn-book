import { error, fail } from '@sveltejs/kit';
import {
	memberById, pointBalance, pointLedger, myReservations, facilityById, adjustPoints, auditLogs,
	otayoriBalance, otayoriLedger, grantOtayori
} from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const member = memberById(params.id);
	if (!member) error(404, '会員が見つかりません');
	const isAdmin = locals.user?.role === 'admin';
	return {
		m: {
			id: member.id,
			memberCode: member.memberCode,
			name: member.name,
			kana: member.kana,
			email: isAdmin ? member.email : '（権限がありません）',
			phone: isAdmin ? member.phone : '***',
			rank: member.rank,
			mailOptIn: member.mailOptIn,
			joinedAt: member.joinedAt
		},
		isAdmin,
		balance: pointBalance(member.id),
		ledger: pointLedger.filter((p) => p.memberId === member.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		otayoriBalance: otayoriBalance(member.id),
		otayoriLedger: otayoriLedger.filter((e) => e.memberId === member.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		reservations: myReservations(member.id).map((b) => ({ code: b.code, checkin: b.checkin, status: b.status, facilityName: facilityById(b.facilityId)!.name })),
		audits: auditLogs.filter((a) => a.detail.includes(member.id)).slice(0, 10)
	};
};

export const actions: Actions = {
	adjust: async ({ params, request, locals }) => {
		// 本実装：superadmin のみ（設計書 §4.8）。デモは admin
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const delta = Number(form.get('delta'));
		const reason = String(form.get('reason') ?? '').trim();
		if (!delta || !reason) return fail(400, { message: 'ポイント数と理由（必須）を入力してください' });
		adjustPoints(params.id, delta, reason, locals.user.name);
		return { adjusted: true };
	},
	rank: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const member = memberById(params.id);
		if (!member) return fail(404, {});
		const form = await request.formData();
		const rank = String(form.get('rank')) as typeof member.rank;
		const reason = String(form.get('rankReason') ?? '').trim();
		if (!reason) return fail(400, { message: 'ランク変更の理由を入力してください（監査ログに記録）' });
		member.rank = rank;
		auditLogs.unshift({ id: `al-${Date.now()}`, at: new Date().toISOString(), actor: locals.user.name, action: 'change_rank', detail: `${member.id} → ${rank}: ${reason}` });
		return { rankChanged: true };
	},
	// おたよりポイント手動付与（admin 限定・設計書 §9）。1pt=1,000円相当。正負可。
	grantOtayori: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const member = memberById(params.id);
		if (!member) return fail(404, {});
		const form = await request.formData();
		const delta = Number(form.get('otayoriDelta'));
		const reason = String(form.get('otayoriReason') ?? '').trim();
		if (!delta || !reason) return fail(400, { message: 'おたよりポイント数（0以外）と理由（必須）を入力してください' });
		grantOtayori(params.id, delta, reason, locals.user.name);
		return { otayoriGranted: true };
	}
};
