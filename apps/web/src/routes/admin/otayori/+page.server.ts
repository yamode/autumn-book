import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { radioAttachmentLinks, type RadioAttachment } from '$lib/server/radio-letters';
import { kitakazeApiStatus } from '$lib/server/kitakaze';
import { clearOtayoriBadge } from '$lib/server/admin-badges';
import { listOtayoriAdmin, approveOtayori, rejectOtayori } from '$lib/server/store';
import type { OtayoriAdminItem } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

type Tab = 'pending' | 'approved' | 'rejected';
const TABS: Tab[] = ['pending', 'approved', 'rejected'];
const perPage = 25;
type RadioRow = {
	post_id: string; member_user_id: string | null; member_code: string | null; member_name: string | null;
	radio_name: string | null; body: string; status: Tab; created_at: string; awarded_at: string | null; attachments: RadioAttachment[];
};
type DisplayLetter = OtayoriAdminItem & { guest: boolean; awardedAt: string | null; files: Awaited<ReturnType<typeof radioAttachmentLinks>> };

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const youtube = kitakazeApiStatus(event.url.searchParams.get('youtube') === 'check');
	const statusParam = event.url.searchParams.get('status');
	const status: Tab = TABS.includes(statusParam as Tab) ? (statusParam as Tab) : 'pending';
	const page = Math.max(1, Math.min(10000, Math.trunc(Number(event.url.searchParams.get('page')) || 1)));
	if (ADMIN_SUPABASE) {
		const db = createSupabaseServerClient(event).schema('book');
		const queue = await Promise.all(TABS.map(async (tab) => {
			const result = await db.rpc('otayori_list_admin', { p_status: tab, p_page: tab === status ? page : 1, p_per: tab === status ? perPage : 1 });
			if (result.error) throw result.error;
			return [tab, result.data as { total: number; items: RadioRow[] }] as const;
		}));
		const pages = Object.fromEntries(queue) as Record<Tab, { total: number; items: RadioRow[] }>;
		const items = await Promise.all(pages[status].items.map(async (row): Promise<DisplayLetter> => ({
			id: row.post_id, memberId: row.member_user_id ?? '', memberCode: row.member_code ?? '',
			memberName: row.member_name ?? '', radioName: row.radio_name ?? undefined, body: row.body,
			status: row.status, createdAt: row.created_at, guest: !row.member_user_id,
			awardedAt: row.awarded_at, files: await radioAttachmentLinks(row.attachments ?? [])
		})));
		return { status, items, page, perPage, youtube,
			counts: { pending: pages.pending.total, approved: pages.approved.total, rejected: pages.rejected.total } };
	}

	const items: DisplayLetter[] = listOtayoriAdmin(status).slice((page - 1) * perPage, page * perPage)
		.map((row) => ({ ...row, guest: false, awardedAt: null, files: [] }));
	return { status, items, page, perPage, youtube, counts: {
		pending: listOtayoriAdmin('pending').length, approved: listOtayoriAdmin('approved').length,
		rejected: listOtayoriAdmin('rejected').length
	} };
};

export const actions: Actions = {
	approve: async (event) => {
		const { request, locals } = event;
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		if (form.get('readOnAir') !== 'yes') return fail(400, { message: '番組で紹介されたことを確認してください。' });
		if (ADMIN_SUPABASE) {
			const { data, error } = await createSupabaseServerClient(event).schema('book').rpc('otayori_approve', { p_post_id: postId });
			if (error) return fail(400, { message: 'おたよりの紹介を記録できませんでした。' });
			clearOtayoriBadge(locals.user.id);
			return { ok: 'approve', points: Number((data as { points?: number } | null)?.points ?? 0) };
		}
		const res = approveOtayori(postId, locals.user.name);
		if ('error' in res) return fail(404, { message: '対象のおたよりが見つかりません' });
		return { ok: 'approve', points: null };
	},
	reject: async (event) => {
		const { request, locals } = event;
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		const note = String(form.get('note') ?? '');
		if (ADMIN_SUPABASE) {
			const { error } = await createSupabaseServerClient(event).schema('book').rpc('otayori_reject', { p_post_id: postId, p_note: note });
			if (error) return fail(400, { message: 'おたよりを却下できませんでした。' });
			clearOtayoriBadge(locals.user.id);
			return { ok: 'reject' };
		}
		const res = rejectOtayori(postId, note, locals.user.name);
		if ('error' in res) return fail(404, { message: '対象のおたよりが見つかりません' });
		return { ok: 'reject' };
	}
};
