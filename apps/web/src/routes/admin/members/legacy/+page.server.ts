// 旧会員（tripla）の会員移行の確認。確認待ちの移行を、PMS の顧客に紐づける・紐づけない（却下）・紐づけを解除する。
//
// DB 関数（book スキーマ・中で book._require_admin により管理者だけに絞っている）:
//   - admin_legacy_review_list()                          … 確認待ち（pending_review）と、紐づけ済み（linked・自動もスタッフも）の一覧
//   - admin_legacy_link(p_legacy_id, p_guest_id, p_note)  … 会員を選んだ PMS の顧客に紐づける
//   - admin_legacy_unlink(p_legacy_id, p_note)            … 紐づけを解除して元の顧客に戻す（理由必須）
//   - admin_legacy_reject(p_legacy_id, p_note)            … 紐づけない（却下・理由必須）
// 本番（ADMIN_SUPABASE）以外ではデモデータが無いため、空の一覧と理由を出す。
import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import type { Actions, PageServerLoad } from './$types';

type LegacyCandidate = {
	guest_id: string;
	name: string | null;
	kana: string | null;
	phone: string | null;
	email: string | null;
	direct_visits: number;
	has_member: boolean;
};

type LegacyReviewItem = {
	id: string;
	email: string | null;
	claim: 'pending_review' | 'linked';
	match: 'auto' | 'candidate' | 'none';
	name: string | null;
	kana: string | null;
	phone: string | null;
	migrated_at: string | null;
	member_user_id: string | null;
	member_code: string | null;
	member_guest_id: string | null;
	member_guest_stays: number;
	previous_guest_id: string | null;
	reviewed_at: string | null;
	// 本人が手続きで入力した氏名・電話（以前の登録と食い違えば電話で本人に確かめる）
	entered_name: string | null;
	entered_kana: string | null;
	entered_phone: string | null;
	candidates: LegacyCandidate[];
};

// DB 関数の例外コード → スタッフ向けの文言（mapRpcError の 'not_found' より先に見るため、ここで先に照合する）
const LEGACY_MESSAGES: [string, string][] = [
	['member_has_stays', '会員の今の顧客に宿泊・予約があるため、紐づけ直せません。PMS の重複チェックで顧客を統合してください。'],
	['guest_not_candidate', '照合の候補ではない顧客には紐づけられません（画面を読み直してください）。'],
	['guest_has_member', 'この顧客には別の会員が紐づいています。'],
	['not_pending', 'この移行はすでに確認済みです（画面を読み直してください）。'],
	['not_relinked', 'この移行は解除できません（元の顧客の記録がありません）。'],
	['member_not_found', '移行先の会員が見つかりません。'],
	['guest_not_found', '選んだ顧客が見つかりません（統合・削除された可能性があります）。'],
	['reason_required', '理由を入力してください（記録に残ります）。']
];

function legacyError(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : String(e ?? '');
	for (const [code, text] of LEGACY_MESSAGES) {
		if (msg.includes(code)) return text;
	}
	return mapRpcError(e);
}

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';
	if (!ADMIN_SUPABASE) {
		return { live: false as const, isAdmin, items: [] as LegacyReviewItem[], error: null as string | null };
	}
	if (!isAdmin) {
		return { live: true as const, isAdmin, items: [] as LegacyReviewItem[], error: 'この画面は管理者だけが使えます。' };
	}
	const { data, error } = await bookAdmin(event).rpc('admin_legacy_review_list');
	if (error) {
		return { live: true as const, isAdmin, items: [] as LegacyReviewItem[], error: legacyError(error) };
	}
	const items = (Array.isArray(data) ? data : []) as LegacyReviewItem[];
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
	// この顧客に紐づける（メモは任意）
	link: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		const guestId = String(r.form.get('guestId') ?? '').trim();
		if (!guestId) return fail(400, { message: '紐づける顧客が指定されていません。', legacyId: r.legacyId });
		const { error } = await bookAdmin(event).rpc('admin_legacy_link', {
			p_legacy_id: r.legacyId,
			p_guest_id: guestId,
			p_note: r.note || null
		});
		if (error) return fail(400, { message: legacyError(error), legacyId: r.legacyId });
		return { done: 'link' as const, legacyId: r.legacyId };
	},

	// 紐づけを解除して元の顧客に戻す（理由必須）
	unlink: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		if (!r.note) return fail(400, { message: '解除する理由を入力してください。', legacyId: r.legacyId });
		const { error } = await bookAdmin(event).rpc('admin_legacy_unlink', { p_legacy_id: r.legacyId, p_note: r.note });
		if (error) return fail(400, { message: legacyError(error), legacyId: r.legacyId });
		return { done: 'unlink' as const, legacyId: r.legacyId };
	},

	// 紐づけない（却下・理由必須）
	reject: async (event) => {
		const r = await readForm(event);
		if ('failure' in r) return r.failure;
		if (!r.note) return fail(400, { message: '紐づけない理由を入力してください。', legacyId: r.legacyId });
		const { error } = await bookAdmin(event).rpc('admin_legacy_reject', { p_legacy_id: r.legacyId, p_note: r.note });
		if (error) return fail(400, { message: legacyError(error), legacyId: r.legacyId });
		return { done: 'reject' as const, legacyId: r.legacyId };
	}
};
