import { redirect } from '@sveltejs/kit';
import { memberById, pointBalance, avatarByMember } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyProfile, sbPointBalance } from '$lib/server/supabase-data';
import { bookingMcpEnabled } from '$lib/server/booking-mcp/oauth';
import { myAmbassador } from '$lib/server/ambassador';
import { MEMBER_LOGIN_METHODS, memberMfaPath } from '$lib/server/member-login';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { locals, url, untrack } = event;
	if (locals.memberMfaPending) redirect(303, memberMfaPath(url.pathname + url.search));
	if (locals.user?.role !== 'member') {
		redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const loadBalance = sbPointBalance(client).catch(() => 0);
		// アンバサダーのバッジとメニュー（docs/ambassador.md §8）。落ちても出さないだけ
		const loadAmbassador = myAmbassador(client)
			.then((a) => a.isAmbassador)
			.catch(() => false);
		let p: Awaited<ReturnType<typeof sbMyProfile>>;
		try {
			p = await sbMyProfile(client);
		} catch {
			// 会員フラグ（user_metadata.member）はあるが book.members 行が無い異常系。
			// フラグを解除してから会員登録へ戻す（/account⇄/auth/register の無限ループ防止）。
			await client.auth.updateUser({ data: { member: false } }).catch(() => {});
			redirect(303, '/auth/register');
		}
		const [balance, isAmbassador] = await Promise.all([loadBalance, loadAmbassador]);
		return {
			isAmbassador,
			memberLoginMethods: MEMBER_LOGIN_METHODS,
			bookingMcpEnabled: untrack(() => bookingMcpEnabled(url)),
			member: {
				id: p.userId,
				memberCode: p.memberCode,
				name: p.name,
				rank: p.rankCode,
				mailOptIn: p.isMailOptIn,
				email: p.email,
				kana: p.kana,
				familyName: p.familyName,
				givenName: p.givenName,
				middleName: p.middleName,
				familyNameKana: p.familyNameKana,
				givenNameKana: p.givenNameKana,
				phone: p.phone,
				joinedAt: p.joinedAt,
				avatarUrl: p.avatarUrl ?? null
			},
			balance
		};
	}

	const member = memberById(locals.user.id);
	if (!member) redirect(303, '/auth/login');
	return {
		isAmbassador: false,
		memberLoginMethods: false,
		bookingMcpEnabled: false,
		member: { id: member.id, memberCode: member.memberCode, name: member.name, rank: member.rank, mailOptIn: member.mailOptIn, email: member.email, kana: member.kana, familyName: member.familyName, givenName: member.givenName, middleName: member.middleName ?? '', familyNameKana: member.familyNameKana ?? '', givenNameKana: member.givenNameKana ?? '', phone: member.phone, joinedAt: member.joinedAt, avatarUrl: avatarByMember.get(member.id) ?? null },
		balance: pointBalance(member.id)
	};
};
