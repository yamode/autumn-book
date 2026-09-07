// 会員一覧。本番（ADMIN_SUPABASE）では book.admin_list_members の実データ、
// それ以外は従来どおり store.ts のデモ会員を表示する。
import { ADMIN_SUPABASE } from '$lib/server/auth';
import {
	adminListMembers,
	bookAdmin,
	mapRpcError,
	normalizeRank,
	type MemberRank
} from '$lib/server/admin-app-data';
import { members, pointBalance } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export type MemberListRow = {
	id: string;
	memberCode: string;
	name: string;
	email: string;
	rank: MemberRank;
	joinedAt: string;
	/** デモのみ。実データは N+1 になるため一覧では出さない（詳細で表示） */
	balance: number | null;
	/** 実データのみ */
	deviceCount: number | null;
	pushOptIn: boolean | null;
	lastStay: string | null;
	mailOptIn: boolean | null;
};

export const load: PageServerLoad = async (event) => {
	const q = event.url.searchParams.get('q') ?? '';

	if (ADMIN_SUPABASE) {
		try {
			const rows = await adminListMembers(bookAdmin(event), { q: q || null, limit: 200 });
			return {
				live: true as const,
				q,
				error: null as string | null,
				members: rows.map<MemberListRow>((m) => ({
					id: m.user_id,
					memberCode: m.member_code ?? '—',
					name: m.name ?? '（氏名未登録）',
					// staff にはメールを返さない（RPC が null を返す）
					email: m.email ?? '—',
					rank: normalizeRank(m.rank_code),
					joinedAt: m.joined_at?.slice(0, 10) ?? '',
					balance: null,
					deviceCount: m.device_count,
					pushOptIn: m.push_opt_in,
					lastStay: m.last_stay,
					mailOptIn: null
				}))
			};
		} catch (e) {
			return { live: true as const, q, members: [] as MemberListRow[], error: mapRpcError(e) };
		}
	}

	let list = members;
	if (q) {
		list = list.filter(
			(m) =>
				m.name.includes(q) || m.kana.includes(q) || m.email.includes(q) || m.memberCode.includes(q)
		);
	}
	return {
		live: false as const,
		q,
		error: null as string | null,
		members: list.map<MemberListRow>((m) => ({
			id: m.id,
			memberCode: m.memberCode,
			name: m.name,
			email: m.email,
			rank: m.rank,
			joinedAt: m.joinedAt,
			balance: pointBalance(m.id),
			deviceCount: null,
			pushOptIn: null,
			lastStay: null,
			mailOptIn: m.mailOptIn
		}))
	};
};
