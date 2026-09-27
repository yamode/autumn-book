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
import { fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { DEFAULT_WELCOME_BONUS, sbAdminMemberProgram, sbSaveMemberProgram, type MemberProgram } from '$lib/server/member-program';
import type { Actions, PageServerLoad } from './$types';

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

const loadList = async (event: Parameters<PageServerLoad>[0]) => {
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

// 入会ボーナスの設定（book.member_program_settings・autumn-shared 20260927001351）。
// 閲覧はスタッフも可、保存は管理者のみ（金額に関わるため。DB もテナント管理者に限る）。
export const load: PageServerLoad = async (event) => {
	const list = await loadList(event);
	const canEditProgram = event.locals.user?.role === 'admin';
	if (!ADMIN_SUPABASE) {
		const demo: MemberProgram = { welcomeBonusPoints: DEFAULT_WELCOME_BONUS, welcomeBonusValidDays: 365, updatedAt: null, grantedTotal: 0, granted30d: 0 };
		return { ...list, program: demo, programError: null as string | null, canEditProgram };
	}
	try {
		return { ...list, program: await sbAdminMemberProgram(createSupabaseServerClient(event)), programError: null as string | null, canEditProgram };
	} catch (e) {
		return { ...list, program: null, programError: e instanceof Error ? e.message : String(e), canEditProgram };
	}
};

export const actions: Actions = {
	saveProgram: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { programError: '入会ボーナスの設定は管理者だけが変更できます。' });
		if (!ADMIN_SUPABASE) return fail(400, { programError: 'この環境では保存できません（管理画面が実データに繋がっていません）。' });
		const fd = await event.request.formData();
		const points = Math.round(Number(fd.get('points')));
		const days = Math.round(Number(fd.get('days')));
		if (!Number.isFinite(points) || points < 0 || points > 100000) return fail(400, { programError: 'ポイントは 0〜100,000 で入れてください（0 で入会ボーナスなし）。' });
		if (!Number.isFinite(days) || days < 1 || days > 3650) return fail(400, { programError: '有効期限は 1〜3,650 日で入れてください。' });
		try {
			await sbSaveMemberProgram(createSupabaseServerClient(event), points, days);
			return { programSaved: true };
		} catch (e) {
			return fail(400, { programError: e instanceof Error ? e.message : String(e) });
		}
	}
};
