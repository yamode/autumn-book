// 会員サポートの一覧（docs/member-support.md「管理画面」）。状態のタブ（対応中・返事待ち・完了・すべて）と件数。
// DB 関数（book スキーマ・スタッフなら誰でも＝book._require_staff）: admin_support_list(p_status) / admin_support_counts()
// 本番（ADMIN_SUPABASE）以外ではデモデータが無いため、空の一覧と理由を出す（admin/members/legacy と同じ）。
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin } from '$lib/server/admin-app-data';
import { supportAdminError } from '$lib/server/member-support';
import { isSupportStatus, type SupportStatus } from '$lib/support';
import type { PageServerLoad } from './$types';

type SupportListItem = {
	id: string;
	code: string;
	status: SupportStatus;
	category: string;
	name: string;
	email: string;
	subject: string;
	source: 'form' | 'email';
	needs_reply: boolean;
	is_member: boolean;
	last_message_at: string;
	created_at: string;
	preview: string | null;
};

type SupportCounts = { open: number; waiting: number; closed: number; needs_reply: number };
const EMPTY_COUNTS: SupportCounts = { open: 0, waiting: 0, closed: 0, needs_reply: 0 };

export const load: PageServerLoad = async (event) => {
	const raw = event.url.searchParams.get('status') ?? 'open';
	const status: SupportStatus | 'all' = raw === 'all' ? 'all' : isSupportStatus(raw) ? raw : 'open';
	if (!ADMIN_SUPABASE) {
		return { live: false as const, status, items: [] as SupportListItem[], counts: EMPTY_COUNTS, error: null as string | null };
	}
	const db = bookAdmin(event);
	const [list, counts] = await Promise.all([
		db.rpc('admin_support_list', { p_status: status === 'all' ? null : status }),
		db.rpc('admin_support_counts')
	]);
	const error = list.error ?? counts.error;
	if (error) {
		return { live: true as const, status, items: [] as SupportListItem[], counts: EMPTY_COUNTS, error: supportAdminError(error) };
	}
	const c = (counts.data ?? {}) as Partial<SupportCounts>;
	return {
		live: true as const,
		status,
		items: (Array.isArray(list.data) ? list.data : []) as SupportListItem[],
		counts: {
			open: Number(c.open ?? 0) || 0,
			waiting: Number(c.waiting ?? 0) || 0,
			closed: Number(c.closed ?? 0) || 0,
			needs_reply: Number(c.needs_reply ?? 0) || 0
		},
		error: null as string | null
	};
};
