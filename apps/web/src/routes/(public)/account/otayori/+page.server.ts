import { listMyOtayori } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// account レイアウトで member ガード済み（locals.user は member）
	const memberId = locals.user!.id;
	const { balance, ledger, posts } = listMyOtayori(memberId);
	return { balance, ledger, posts };
};
