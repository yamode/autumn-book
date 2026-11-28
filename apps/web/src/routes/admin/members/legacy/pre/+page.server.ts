// 旧会員（tripla）の手続き前の確認。照合が「候補あり」の旧会員について、お客様が移行の手続きをする前に、
// 紐づける PMS の顧客を職員が先に決めておく（紐づける／紐づけない／取り消す）。
//
// DB 関数（book スキーマ・中で book._require_admin により管理者だけに絞っている・autumn-shared 20261128073224）:
//   - admin_legacy_prereview_list()                          … 手続き前の候補あり・決めたものの一覧
//   - admin_legacy_prelink(p_legacy_id, p_guest_id, p_note)  … 「この顧客に紐づける」と決める（手続きを済ませたらその場で紐づく）
//   - admin_legacy_prereject(p_legacy_id, p_note)            … 「紐づけない」と決める（手続きでは新しい顧客になる・理由必須）
//   - admin_legacy_preundo(p_legacy_id)                      … 決めた内容を取り消して照合し直す
// 本番（ADMIN_SUPABASE）以外ではデモデータが無いため、空の一覧と理由を出す。
import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import type { Actions, PageServerLoad } from './$types';

type PreCandidate = {
	guest_id: string;
	name: string | null;
	kana: string | null;
	phone: string | null;
	email: string | null;
	direct_visits: number;
	last_stay: string | null;
	has_member: boolean;
	other_legacy: boolean;
};

type PreReviewItem = {
	id: string;
	email: string;
	match: 'auto' | 'candidate' | 'none';
	name: string | null;
	kana: string | null;
	phone: string | null;
	registered_on: string | null;
	decision: 'link' | 'reject' | null;
	decided_guest_id: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	candidates: PreCandidate[];
};

// DB 関数の例外コード → スタッフ向けの文言
const PRE_MESSAGES: [string, string][] = [
	['already_migrated', 'この旧会員はもう手続きを済ませています。「旧会員の確認」の画面で確かめてください。'],
	['not_candidate', 'この旧会員はすでに決めてあります（画面を読み直してください）。'],
	['not_decided', 'まだ決めていません（画面を読み直してください）。'],
	['guest_not_candidate', '照合の候補ではない顧客には紐づけられません（画面を読み直してください）。'],
	['guest_has_member', 'この顧客には別の会員が紐づいています。'],
	['guest_has_legacy', 'この顧客には別の旧会員が紐づく予定です。'],
	['guest_not_found', '選んだ顧客が見つかりません（統合・削除された可能性があります）。'],
	['reason_required', '理由を入力してください（記録に残ります）。']
];

function preError(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : String(e ?? '');
	for (const [code, text] of PRE_MESSAGES) {
		if (msg.includes(code)) return text;
	}
	return mapRpcError(e);
}

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';
	if (!ADMIN_SUPABASE) {
		return { live: false as const, isAdmin, items: [] as PreReviewItem[], error: null as string | null };
	}
	if (!isAdmin) {
		return { live: true as const, isAdmin, items: [] as PreReviewItem[], error: 'この画面は管理者だけが使えます。' };
	}
	const { data, error } = await bookAdmin(event).rpc('admin_legacy_prereview_list');
	if (error) {
		return { live: true as const, isAdmin, items: [] as PreReviewItem[], error: preError(error) };
	}
	const items = (Array.isArray(data) ? data : []) as PreReviewItem[];
	return {
		live: true as const,
		isAdmin,
		items: items.map((it) => ({ ...it, candidates: Array.isArray(it.candidates) ? it.candidates : [] })),
		error: null as string | null
	};
};

// 共通の前処理: 管理者・本番接続・legacyId を確かめる
async function readForm(event: Parameters<Actions[string]>[0]) {
	if (event.locals.user?.role !== 'admin') return { failure: fail(403, { message: '権限がありません' }) } as const;
	if (!ADMIN_SUPABASE) {
		return { failure: fail(400, { message: 'この環境では操作できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。' }) } as const;
	}
	const form = await event.request.formData();
	const legacyId = String(form.get('legacyId') ?? '').trim();
	const note = String(form.get('note') ?? '').trim();
	if (!legacyId) return { failure: fail(400, { message: '対象が指定されていません。', legacyId }) } as const;
	return { form, legacyId, note } as const;
}

export const actions: Actions = {
	// この顧客に紐づけると決める（メモは任意）
	prelink: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		const guestId = String(r.form.get('guestId') ?? '').trim();
		if (!guestId) return fail(400, { message: '紐づける顧客が指定されていません。', legacyId: r.legacyId });
		const { error } = await bookAdmin(event).rpc('admin_legacy_prelink', {
			p_legacy_id: r.legacyId,
			p_guest_id: guestId,
			p_note: r.note || null
		});
		if (error) return fail(400, { message: preError(error), legacyId: r.legacyId });
		return { done: 'prelink' as const, legacyId: r.legacyId };
	},

	// 紐づけないと決める（理由必須）
	prereject: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		if (!r.note) return fail(400, { message: '紐づけない理由を入力してください。', legacyId: r.legacyId });
		const { error } = await bookAdmin(event).rpc('admin_legacy_prereject', { p_legacy_id: r.legacyId, p_note: r.note });
		if (error) return fail(400, { message: preError(error), legacyId: r.legacyId });
		return { done: 'prereject' as const, legacyId: r.legacyId };
	},

	// 決めた内容を取り消す（照合し直す）
	preundo: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		const { error } = await bookAdmin(event).rpc('admin_legacy_preundo', { p_legacy_id: r.legacyId });
		if (error) return fail(400, { message: preError(error), legacyId: r.legacyId });
		return { done: 'preundo' as const, legacyId: r.legacyId };
	}
};
