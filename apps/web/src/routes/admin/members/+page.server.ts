import { members, pointBalance } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	let list = members;
	if (q) list = list.filter((m) => m.name.includes(q) || m.kana.includes(q) || m.email.includes(q) || m.memberCode.includes(q));
	return {
		members: list.map((m) => ({
			id: m.id,
			memberCode: m.memberCode,
			name: m.name,
			email: m.email,
			rank: m.rank,
			mailOptIn: m.mailOptIn,
			joinedAt: m.joinedAt,
			balance: pointBalance(m.id)
		})),
		q
	};
};
