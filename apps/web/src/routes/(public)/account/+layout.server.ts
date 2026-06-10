import { redirect } from '@sveltejs/kit';
import { memberById, pointBalance } from '$lib/server/store';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (locals.user?.role !== 'member') {
		redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
	}
	const member = memberById(locals.user.id);
	if (!member) redirect(303, '/auth/login');
	return {
		member: { id: member.id, memberCode: member.memberCode, name: member.name, rank: member.rank, mailOptIn: member.mailOptIn, email: member.email, kana: member.kana, phone: member.phone, joinedAt: member.joinedAt },
		balance: pointBalance(member.id)
	};
};
