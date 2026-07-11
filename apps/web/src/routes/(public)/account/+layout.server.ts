import { redirect } from '@sveltejs/kit';
import { memberById, pointBalance, avatarByMember } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyProfile, sbPointBalance } from '$lib/server/supabase-data';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { locals, url } = event;
	if (locals.user?.role !== 'member') {
		redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
	}

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		let p: Awaited<ReturnType<typeof sbMyProfile>>;
		try {
			p = await sbMyProfile(client);
		} catch {
			// 会員フラグ（user_metadata.member）はあるが book.members 行が無い異常系。
			// フラグを解除してから会員登録へ戻す（/account⇄/auth/register の無限ループ防止）。
			await client.auth.updateUser({ data: { member: false } }).catch(() => {});
			redirect(303, '/auth/register');
		}
		const balance = await sbPointBalance(client).catch(() => 0);
		return {
			member: {
				id: p.userId,
				memberCode: p.memberCode,
				name: p.name,
				rank: p.rankCode,
				mailOptIn: p.isMailOptIn,
				email: p.email,
				kana: p.kana,
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
		member: { id: member.id, memberCode: member.memberCode, name: member.name, rank: member.rank, mailOptIn: member.mailOptIn, email: member.email, kana: member.kana, phone: member.phone, joinedAt: member.joinedAt, avatarUrl: avatarByMember.get(member.id) ?? null },
		balance: pointBalance(member.id)
	};
};
