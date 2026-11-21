// 会員サポート（support@yamado.app）のサーバ側。設計: docs/member-support.md・DB: autumn-shared 20261121224620_book_member_support.sql。
//
//   - ヘルプページ（/help）の問い合わせフォーム → submitSupportTicket（service_role で book.support_submit）→ 受付の控え・宿への通知
//   - 受信（受信用 Worker → /api/support/inbound）→ verifySupportSignature → acceptInboundMail（book.support_inbound）→ 新しければ宿へ通知
//   - 管理画面の返信 → admin_support_reply（スタッフのセッション）→ sendSupportReply → support_mark_sent
//
// 公開側（フォーム・受信）の関数は service_role だけに grant している（lib/server/partners/admin-client.ts の例外その15）。
// フォームは Turnstile・回数制限・入力の検証を、受信は署名と時刻の検証を、それぞれ呼ぶ前に済ませること。
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { sendHtmlEmail, type SendEmailResult } from '$lib/server/mailer';
import { PRIMARY_ORIGIN } from '$lib/server/public-origin';
import {
	SUPPORT_EMAIL,
	SUPPORT_FROM_NAME,
	SUPPORT_HELP_URL,
	supportAckSubject,
	supportCategoryLabel,
	supportReplySubject,
	oneLine
} from '$lib/support';
import { supportMailEnabled } from '$lib/server/support-mail-flag';

/** 宿への通知の既定の送り先（SUPPORT_NOTIFY_TO が無いとき） */
export const DEFAULT_SUPPORT_NOTIFY_TO = 'info@yamado.co.jp';
/** 受信の署名の有効時間（秒） */
export const INBOUND_MAX_SKEW_SEC = 300;
/** 本文の上限（DB も 20000 文字で切る） */
export const SUPPORT_BODY_MAX = 10000;

export class SupportError extends Error {
	constructor(public code: 'unavailable' | 'failed', message: string = code) {
		super(message);
	}
}

function service(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new SupportError('unavailable');
	return svc;
}

/** 公開側で使えるか（service_role の鍵がある） */
export const supportServiceAvailable = () => partnerServiceClient() !== null;

// ---------------------------------------------------------------- 署名（受信）

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (s) => parseInt(s, 16));

/**
 * 受信用 Worker の署名を確かめる。x-support-signature = hex(HMAC-SHA256(secret, `${timestamp}.${body}`))、
 * x-support-timestamp は UNIX 秒（10 桁）で、今から ±5 分以内。
 */
export async function verifySupportSignature(
	secret: string,
	timestamp: string,
	rawBody: string,
	signature: string,
	nowSec: number = Math.floor(Date.now() / 1000)
): Promise<boolean> {
	if (!secret) return false;
	if (!/^\d{10}$/.test(timestamp) || Math.abs(nowSec - Number(timestamp)) > INBOUND_MAX_SKEW_SEC) return false;
	if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
	// verify は時間一定で比べる
	return crypto.subtle.verify('HMAC', key, hexToBytes(signature.toLowerCase()), new TextEncoder().encode(`${timestamp}.${rawBody}`));
}

/** 署名を作る（テストと、受信用 Worker と同じ作り方の確認用） */
export async function signSupportPayload(secret: string, timestamp: string, rawBody: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type InboundMail = {
	fromEmail: string;
	fromName: string;
	subject: string;
	body: string;
	messageId: string | null;
	attachments: number;
	/** 自動送信のメール（不達通知・自動返信・一斉配信）。取り込むが、新しい問い合わせでも宿へ通知しない */
	auto: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 受信用 Worker から届いた JSON を確かめて整える（形が違えば null） */
export function parseInboundPayload(raw: string): InboundMail | null {
	let input: Record<string, unknown>;
	try {
		const v = JSON.parse(raw);
		if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
		input = v as Record<string, unknown>;
	} catch {
		return null;
	}
	const str = (k: string, max: number) => (typeof input[k] === 'string' ? (input[k] as string).trim().slice(0, max) : '');
	const fromEmail = str('from_email', 254).toLowerCase();
	if (!EMAIL_RE.test(fromEmail)) return null;
	const messageId = str('message_id', 500) || null;
	const attachments = Math.max(0, Math.min(1000, Math.floor(Number(input.attachments ?? 0)) || 0));
	let body = typeof input.body === 'string' ? input.body.replace(/\r\n?/g, '\n').slice(0, 20000) : '';
	// 添付は受け取らない（あったことだけ本文の末尾に残す・docs/member-support.md「未定・あとで」）
	if (attachments > 0) body = `${body.trimEnd()}\n\n［添付ファイル ${attachments} 件がありましたが、受け取っていません］`;
	return {
		fromEmail,
		// 改行などの制御文字は空白に（通知メールの件名・管理画面の表示に改行を持ち込ませない）
		fromName: oneLine(str('from_name', 300)).slice(0, 100),
		subject: oneLine(str('subject', 600)).slice(0, 200),
		body: body.trim() ? body : '（本文なし）',
		messageId: messageId ? oneLine(messageId) : null,
		attachments,
		auto: input.auto === true
	};
}

// ---------------------------------------------------------------- メールの文面

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** プレーンテキストを HTML に（段落ごとに p、段落の中の改行は br。URL はリンクにしない＝そのまま） */
export function textToHtml(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => (l ? `<p style="margin:0 0 6px;white-space:pre-wrap">${esc(l)}</p>` : '<p style="margin:0 0 6px">&nbsp;</p>'))
		.join('');
}

export type MailContent = { subject: string; text: string };

/** お客様向けの署名。mailEnabled のときだけ support@ のアドレスを載せる */
function supportFooter(mailEnabled: boolean): string[] {
	return [
		'',
		'――――――――――――',
		'山人（YAMADO）会員サポート',
		...(mailEnabled ? [`メール: ${SUPPORT_EMAIL}`] : []),
		`ヘルプ・よくあるご質問: ${SUPPORT_HELP_URL}`,
		'山人（YAMADO）は、メールでパスワードや確認コードをお尋ねすることはありません。'
	];
}

/** 返信できないメールの案内（SUPPORT_MAIL_ENABLED が 'true' でないとき・控えと返信の両方に付ける） */
export const noReplyNotice = (code: string) =>
	`このメールには返信できません。ご返信は、ヘルプページのフォーム（${SUPPORT_HELP_URL}）から、受付番号 ${code} を添えてお送りください。`;

/** 本文を「> 」付きで引用する（控え・通知に載せる） */
const quote = (body: string) =>
	body
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((l) => `> ${l}`)
		.join('\n');

/** 控えに載せる内容の上限（文字）。長い本文をそのまま送り返さない */
export const ACK_BODY_MAX = 500;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** 受付の控え（お客様へ） */
export function supportAckMail(
	t: { code: string; name: string; category: string; subject: string; body: string },
	mailEnabled: boolean = supportMailEnabled()
): MailContent {
	return {
		subject: supportAckSubject(t.code),
		text: [
			`${oneLine(t.name) || 'お客様'} 様`,
			'',
			'山人（YAMADO）へのお問い合わせ、ありがとうございます。以下の内容で受け付けました。',
			'担当者から、このメールアドレス宛てにご返信します。数日かかる場合があります。',
			mailEnabled
				? 'このメールにご返信いただくと、同じお問い合わせの続きとして届きます（件名の番号は消さずにお送りください）。'
				: noReplyNotice(t.code),
			'',
			`受付番号: ${t.code}`,
			`お問い合わせの種類: ${supportCategoryLabel(t.category)}`,
			`件名: ${oneLine(t.subject) || '（なし）'}`,
			'内容:',
			quote(clip(t.body.replace(/\r\n?/g, '\n'), ACK_BODY_MAX)),
			...supportFooter(mailEnabled)
		].join('\n')
	};
}

/** 宿への通知（新しい問い合わせ） */
export function supportNotifyMail(t: {
	id: string;
	code: string;
	name: string;
	email: string;
	category: string;
	subject: string;
	body: string;
	source: 'form' | 'email';
	isMember?: boolean;
}): MailContent {
	const subject = oneLine(t.subject);
	return {
		subject: oneLine(`【会員サポート】新しいお問い合わせ [${t.code}] ${subject || supportCategoryLabel(t.category)}`).slice(0, 200),
		text: [
			`会員サポートに新しいお問い合わせが届きました（${t.source === 'form' ? 'ヘルプページのフォーム' : `${SUPPORT_EMAIL} へのメール`}）。`,
			'返信は管理画面から行ってください（このメールに返信してもお客様には届きません）。',
			`${PRIMARY_ORIGIN}/admin/support/${t.id}`,
			'',
			`受付番号: ${t.code}`,
			`お名前: ${oneLine(t.name) || '（なし）'}${t.isMember ? '（会員）' : ''}`,
			`メール: ${t.email}`,
			`種類: ${supportCategoryLabel(t.category)}`,
			`件名: ${subject || '（なし）'}`,
			'内容:',
			quote(t.body.slice(0, 4000))
		].join('\n')
	};
}

/** 宿の返信（お客様へ）。件名は Re: <件名> [YS-…] */
export function supportReplyMail(
	t: { code: string; name: string; subject: string; body: string },
	mailEnabled: boolean = supportMailEnabled()
): MailContent {
	return {
		subject: supportReplySubject(t.subject, t.code),
		text: [
			`${oneLine(t.name) || 'お客様'} 様`,
			'',
			t.body.replace(/\r\n?/g, '\n').trim(),
			'',
			mailEnabled ? `（受付番号: ${t.code}。このメールにご返信いただくと、同じお問い合わせの続きとして届きます）` : noReplyNotice(t.code),
			...supportFooter(mailEnabled)
		].join('\n')
	};
}

/**
 * お客様へ送る（控え・返信）。SUPPORT_MAIL_ENABLED='true' なら From・Reply-To とも support@yamado.app、
 * そうでなければ既定の差出人（REPORT_EMAIL_FROM）から返信先なしで送る（support@ の受信がまだ動いていないため）
 */
export function sendSupportMail(to: string, mail: MailContent, mailEnabled: boolean = supportMailEnabled()): Promise<SendEmailResult> {
	return sendHtmlEmail({
		to: [to],
		subject: mail.subject,
		text: mail.text,
		html: textToHtml(mail.text),
		...(mailEnabled ? { from: { address: SUPPORT_EMAIL, name: SUPPORT_FROM_NAME }, replyTo: SUPPORT_EMAIL } : {})
	}).catch((e) => ({ sent: false, reason: e instanceof Error ? e.message : String(e) }));
}

/** 宿への通知の送り先（SUPPORT_NOTIFY_TO・カンマ区切り可。無ければ info@yamado.co.jp） */
export function supportNotifyRecipients(value: string | null | undefined = privateEnv.SUPPORT_NOTIFY_TO): string[] {
	const list = String(value ?? '')
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter((s) => EMAIL_RE.test(s));
	return list.length ? list : [DEFAULT_SUPPORT_NOTIFY_TO];
}

/**
 * 宿への通知を送る。差出人は既定（REPORT_EMAIL_FROM）のまま・返信先なし。
 * support@ から送ると、宿の人がうっかり返信したとき support@ に戻って新しい問い合わせになってしまうため。
 */
export async function sendSupportNotify(mail: MailContent): Promise<SendEmailResult> {
	return sendHtmlEmail({ to: supportNotifyRecipients(), subject: mail.subject, text: mail.text, html: textToHtml(mail.text) }).catch((e) => ({
		sent: false,
		reason: e instanceof Error ? e.message : String(e)
	}));
}

// ---------------------------------------------------------------- フォーム（service_role）

export type SupportSubmitInput = {
	name: string;
	email: string;
	category: string;
	subject: string;
	body: string;
	memberUserId: string | null;
};

/** 問い合わせを作る（book.support_submit）。→ { id, code } */
export async function submitSupportTicket(input: SupportSubmitInput): Promise<{ id: string; code: string }> {
	const { data, error } = await service()
		.schema('book')
		.rpc('support_submit', {
			p_name: input.name,
			p_email: input.email,
			p_category: input.category,
			p_subject: input.subject,
			p_body: input.body,
			p_member_user_id: input.memberUserId
		});
	if (error) throw new SupportError('failed', error.message);
	const r = (data ?? {}) as { id?: string; code?: string };
	if (!r.id || !r.code) throw new SupportError('failed', 'empty result');
	return { id: r.id, code: r.code };
}

/** フォームの問い合わせの控えと通知を送る（失敗しても受付は取り消さない。ログだけ） */
export async function sendSubmitMails(t: SupportSubmitInput & { id: string; code: string }): Promise<void> {
	const [ack, notify] = await Promise.all([
		sendSupportMail(t.email, supportAckMail(t)),
		sendSupportNotify(supportNotifyMail({ ...t, source: 'form', isMember: !!t.memberUserId }))
	]);
	if (!ack.sent) console.error('[member-support] 控えのメールを送れませんでした', t.code, ack.reason);
	if (!notify.sent) console.error('[member-support] 宿への通知を送れませんでした', t.code, notify.reason);
}

// ---------------------------------------------------------------- 受信（service_role）

export type InboundResult = { duplicate: true } | { duplicate: false; id: string; code: string; isNew: boolean };

/** 受信したメールを取り込む（book.support_inbound） */
export async function acceptInboundMail(mail: InboundMail): Promise<InboundResult> {
	const { data, error } = await service()
		.schema('book')
		.rpc('support_inbound', {
			p_from_email: mail.fromEmail,
			p_from_name: mail.fromName,
			p_subject: mail.subject,
			p_body: mail.body,
			p_message_id: mail.messageId
		});
	if (error) throw new SupportError('failed', error.message);
	const r = (data ?? {}) as { duplicate?: boolean; id?: string; code?: string; new?: boolean };
	if (r.duplicate) return { duplicate: true };
	if (!r.id || !r.code) throw new SupportError('failed', 'empty result');
	return { duplicate: false, id: r.id, code: r.code, isNew: r.new === true };
}

// ---------------------------------------------------------------- 管理画面（スタッフのセッション・bookAdmin）

/** 管理画面の RPC の例外 → スタッフ向けの文言 */
const ADMIN_SUPPORT_MESSAGES: [string, string][] = [
	['body_required', '本文を入力してください。'],
	['invalid_status', '状態を選び直してください。'],
	['invalid_input', '入力内容を確かめてください（質問と回答は必須です）。'],
	['not_found', '対象が見つかりませんでした（画面を読み直してください）。'],
	['not_authenticated', 'セッションが切れています。ログインし直してください。'],
	['forbidden', 'この操作の権限がありません。'],
];

export function supportAdminError(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : String(e ?? '');
	for (const [code, text] of ADMIN_SUPPORT_MESSAGES) if (msg.includes(code)) return text;
	return `処理に失敗しました: ${msg || '不明なエラー'}`;
}

/** rpc だけ使う最小の型（bookAdmin(event) を受ける。テストで差し替えやすくする） */
type RpcClient = {
	rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type ReplyOutcome = { messageId: string; code: string; sent: boolean; reason?: string };

/**
 * 返信の送信と結果の記録（admin_support_reply の後・再送のとき）。
 * 送れなかったら support_mark_sent(ok=false) で残し、画面から再送できるようにする。
 */
export async function deliverSupportReply(
	db: RpcClient,
	t: { messageId: string; code: string; email: string; name: string; subject: string; body: string },
	send: (to: string, mail: MailContent) => Promise<SendEmailResult> = sendSupportMail
): Promise<ReplyOutcome> {
	const r = await send(t.email, supportReplyMail(t));
	const { error } = await db.rpc('support_mark_sent', { p_message_id: t.messageId, p_ok: r.sent, p_error: r.sent ? null : (r.reason ?? 'unknown') });
	if (error) console.error('[member-support] 送信結果を記録できませんでした', t.code, error.message);
	return { messageId: t.messageId, code: t.code, sent: r.sent, reason: r.reason };
}

/** 返信を記録して送る（admin_support_reply → 送信 → support_mark_sent） */
export async function replySupportTicket(db: RpcClient, ticketId: string, body: string): Promise<ReplyOutcome> {
	const { data, error } = await db.rpc('admin_support_reply', { p_id: ticketId, p_body: body });
	if (error) throw new Error(error.message);
	const r = (data ?? {}) as { message_id?: string; code?: string; email?: string; name?: string; subject?: string };
	if (!r.message_id || !r.code || !r.email) throw new Error('empty result');
	return deliverSupportReply(db, { messageId: r.message_id, code: r.code, email: r.email, name: r.name ?? '', subject: r.subject ?? '', body });
}
