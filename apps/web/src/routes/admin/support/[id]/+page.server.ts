// 会員サポートの詳細（docs/member-support.md「管理画面」）: やりとり・返信・メモ・状態の切替・会員番号。
// DB 関数（スタッフなら誰でも）: admin_support_get / admin_support_reply / admin_support_note / admin_support_set_status / support_mark_sent
// 返信は admin_support_reply（記録・send_status=sending）→ メール送信（support@yamado.app から）→ support_mark_sent。
// 送れなかったら画面に出し、「再送」で同じ本文を送り直す（送り直しも support_mark_sent で結果を残す）。
import { error, fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin } from '$lib/server/admin-app-data';
import { deliverSupportReply, replySupportTicket, supportAdminError, SUPPORT_BODY_MAX } from '$lib/server/member-support';
import { canResendReply, isSupportStatus, type SupportStatus } from '$lib/support';
import { clearSupportBadge } from '$lib/server/admin-badges';
import { supportMailEnabled } from '$lib/server/support-mail-flag';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

type SupportTicket = {
	id: string;
	code: string;
	status: SupportStatus;
	category: string;
	name: string;
	email: string;
	member_user_id: string | null;
	member_code: string | null;
	subject: string;
	source: 'form' | 'email';
	needs_reply: boolean;
	last_message_at: string;
	created_at: string;
};

type SupportMessage = {
	id: string;
	direction: 'in' | 'out' | 'note';
	body: string;
	from_email: string | null;
	author: string | null;
	send_status: 'sending' | 'sent' | 'failed' | null;
	send_error: string | null;
	created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getTicket(event: RequestEvent, id: string) {
	const { data, error: e } = await bookAdmin(event).rpc('admin_support_get', { p_id: id });
	if (e) return { error: supportAdminError(e), ticket: null, messages: [] as SupportMessage[] };
	const d = (data ?? {}) as { ticket?: SupportTicket; messages?: SupportMessage[] };
	return { error: null, ticket: d.ticket ?? null, messages: Array.isArray(d.messages) ? d.messages : [] };
}

export const load: PageServerLoad = async (event) => {
	if (!UUID_RE.test(event.params.id)) error(404, '見つかりません');
	if (!ADMIN_SUPABASE) {
		return { live: false as const, mailEnabled: supportMailEnabled(), ticket: null as SupportTicket | null, messages: [] as SupportMessage[], error: null as string | null };
	}
	const r = await getTicket(event, event.params.id);
	if (r.error?.includes('見つかりませんでした')) error(404, '見つかりません');
	return { live: true as const, mailEnabled: supportMailEnabled(), ticket: r.ticket, messages: r.messages, error: r.error };
};

function guard(event: RequestEvent) {
	if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では操作できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。' });
	if (!UUID_RE.test(event.params.id)) return fail(404, { message: '対象が見つかりませんでした。' });
	return null;
}

const readBody = (form: FormData) => String(form.get('body') ?? '').replace(/\r\n?/g, '\n').trim();

export const actions: Actions = {
	// 返信する（SUPPORT_MAIL_ENABLED なら support@ から・そうでなければ既定の差出人から返信先なし）
	reply: async (event) => {
		const g = guard(event);
		if (g) return g;
		const form = await event.request.formData();
		const body = readBody(form);
		if (!body) return fail(400, { message: '返信の本文を入力してください。', replyBody: body });
		if (body.length > SUPPORT_BODY_MAX) return fail(400, { message: '本文が長すぎます。', replyBody: body });
		try {
			const r = await replySupportTicket(bookAdmin(event), event.params.id, body);
			clearSupportBadge(event.locals.user?.id);
			// 送れなかったときも成功として返す（返信欄を空にして、同じ返信を二重に記録させない）。やりとりの「再送」から送り直す
			if (!r.sent) {
				return { done: 'reply' as const, warning: `返信は記録しましたが、メールを送れませんでした（${r.reason ?? '不明'}）。やりとりの「再送」から送り直してください。` };
			}
			return { done: 'reply' as const, warning: null };
		} catch (e) {
			return fail(400, { message: supportAdminError(e), replyBody: body });
		}
	},

	// 送れなかった返信を、同じ本文で送り直す
	resend: async (event) => {
		const g = guard(event);
		if (g) return g;
		const form = await event.request.formData();
		const messageId = String(form.get('messageId') ?? '');
		const r = await getTicket(event, event.params.id);
		if (r.error || !r.ticket) return fail(400, { message: r.error ?? '対象が見つかりませんでした。' });
		const msg = r.messages.find((x) => x.id === messageId && x.direction === 'out');
		if (!msg) return fail(400, { message: '送り直す返信が見つかりませんでした（画面を読み直してください）。' });
		if (msg.send_status === 'sent') return fail(400, { message: 'この返信は送信済みです。' });
		// 送信中（結果の記録が無い）のものは、作成から 5 分たってから・届いている可能性を確かめたうえでだけ送り直す
		if (!canResendReply(msg)) return fail(400, { message: 'この返信はまだ送信中の可能性があります。5 分ほどたってから、もう一度お試しください。' });
		if (msg.send_status === 'sending' && form.get('confirmSending') !== '1') return fail(400, { message: '届いている可能性があることを確かめてから送り直してください。' });
		const out = await deliverSupportReply(bookAdmin(event), {
			messageId: msg.id,
			code: r.ticket.code,
			email: r.ticket.email,
			name: r.ticket.name,
			subject: r.ticket.subject,
			body: msg.body
		});
		if (!out.sent) return fail(502, { message: `メールを送れませんでした（${out.reason ?? '不明'}）。時間をおいてもう一度お試しください。` });
		return { done: 'resend' as const };
	},

	// 宿の中だけのメモ（お客様には送らない）
	note: async (event) => {
		const g = guard(event);
		if (g) return g;
		const form = await event.request.formData();
		const body = readBody(form);
		if (!body) return fail(400, { message: 'メモを入力してください。', noteBody: body });
		const { error: e } = await bookAdmin(event).rpc('admin_support_note', { p_id: event.params.id, p_body: body.slice(0, SUPPORT_BODY_MAX) });
		if (e) return fail(400, { message: supportAdminError(e), noteBody: body });
		clearSupportBadge(event.locals.user?.id);
		return { done: 'note' as const };
	},

	// 状態の切替（対応中・返事待ち・完了）
	status: async (event) => {
		const g = guard(event);
		if (g) return g;
		const form = await event.request.formData();
		const status = String(form.get('status') ?? '');
		if (!isSupportStatus(status)) return fail(400, { message: '状態を選び直してください。' });
		const { error: e } = await bookAdmin(event).rpc('admin_support_set_status', { p_id: event.params.id, p_status: status });
		if (e) return fail(400, { message: supportAdminError(e) });
		clearSupportBadge(event.locals.user?.id);
		return { done: 'status' as const };
	}
};
