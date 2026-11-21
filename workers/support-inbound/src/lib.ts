// 受信用 Worker の純関数（Cloudflare の型・postal-mime に頼らない。apps/web の vitest からも読む）。
// 設計: autumn-book docs/member-support.md「受信」。

/** Book に渡す形（apps/web lib/server/member-support.ts parseInboundPayload と同じ項目） */
export type InboundPayload = {
	from_email: string;
	from_name: string;
	subject: string;
	body: string;
	message_id: string | null;
	attachments: number;
	/** 自動送信のメール（Book は取り込むが、新しい問い合わせでも宿へ通知しない） */
	auto: boolean;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 数値文字参照を文字に。範囲外・不正な値（サロゲートなど）は元の文字列のまま */
function codePointOrRaw(raw: string, n: number): string {
	if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return raw;
	try {
		return String.fromCodePoint(n);
	} catch {
		return raw;
	}
}

/** HTML のメールを文字にする（タグを外し、改行を保つ）。本文がテキストで無いときだけ使う */
export function htmlToText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, '\n')
		.replace(/<li[^>]*>/gi, '・')
		.replace(/<[^>]+>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
			const c = code.toLowerCase();
			if (c.startsWith('#x')) return codePointOrRaw(all, parseInt(c.slice(2), 16));
			if (c.startsWith('#')) return codePointOrRaw(all, parseInt(c.slice(1), 10));
			return ENTITIES[c] ?? all;
		})
		.replace(/[ \t ]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** 件名・名前の 1 行化（改行などの制御文字を空白に） */
const oneLine = (s: string | null | undefined) =>
	String(s ?? '')
		.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/**
 * 自動送信のメールか（不達通知・自動返信・メーリングリスト・一斉配信）。
 * Auto-Submitted が no 以外・Precedence が bulk / junk / list・差出人が mailer-daemon / postmaster
 */
export function isAutoMail(headers: { autoSubmitted?: string | null; precedence?: string | null }, fromEmail: string): boolean {
	const auto = (headers.autoSubmitted ?? '').trim().toLowerCase();
	if (auto && auto !== 'no') return true;
	const prec = (headers.precedence ?? '').trim().toLowerCase();
	if (['bulk', 'junk', 'list'].includes(prec)) return true;
	const local = fromEmail.split('@')[0]?.toLowerCase() ?? '';
	return local === 'mailer-daemon' || local === 'postmaster';
}

/** 取り出した値から Book に渡す JSON の中身を作る（text 優先・無ければ html を文字に） */
export function buildPayload(mail: {
	fromAddress: string | null | undefined;
	fromName: string | null | undefined;
	envelopeFrom: string;
	subject: string | null | undefined;
	text: string | null | undefined;
	html: string | null | undefined;
	messageId: string | null | undefined;
	attachments: number;
	autoSubmitted?: string | null;
	precedence?: string | null;
}): InboundPayload {
	const text = (mail.text ?? '').trim() ? (mail.text as string) : mail.html ? htmlToText(mail.html) : '';
	// ヘッダの From を優先（返信先＝お客様のアドレス）。取れなければエンベロープの差出人
	const fromEmail = (mail.fromAddress || mail.envelopeFrom || '').trim().toLowerCase();
	return {
		from_email: fromEmail,
		from_name: oneLine(mail.fromName).slice(0, 100),
		subject: oneLine(mail.subject).slice(0, 200),
		body: text.replace(/\r\n?/g, '\n').slice(0, 20000),
		message_id: oneLine(mail.messageId).slice(0, 500) || null,
		attachments: mail.attachments,
		auto: isAutoMail({ autoSubmitted: mail.autoSubmitted, precedence: mail.precedence }, fromEmail)
	};
}

/**
 * Message-ID が無いメールの代わりの ID（差出人＋件名＋本文の SHA-256）。
 * Email Routing が同じメールを送り直したとき、Book で二重に取り込まないため
 */
export async function fallbackMessageId(p: Pick<InboundPayload, 'from_email' | 'subject' | 'body'>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${p.from_email}\n${p.subject}\n${p.body}`));
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `<${hex}@support-inbound>`;
}

/** 署名: hex(HMAC-SHA256(secret, `${timestamp}.${body}`)) */
export async function signPayload(secret: string, timestamp: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 取り込まずに捨てるメール（自分たちのアドレスから出たもの＝送信のループを作らない） */
export const OWN_ADDRESSES = ['support@yamado.app', 'noreply@yamado.app'];
export function shouldDrop(fromEmail: string, own: readonly string[] = OWN_ADDRESSES): boolean {
	const f = fromEmail.trim().toLowerCase();
	return !f || own.some((a) => a.toLowerCase() === f);
}

/**
 * Book の応答をどう扱うか:
 *   ok    … 受け取った
 *   retry … throw して Email Routing に送り直させる（5xx・429・通信の失敗、401/403/404 = 鍵や URL の設定の誤り。直れば届く）
 *   drop  … 送り直しても同じ（400 形の誤り・413 大きすぎ）。転送先があれば逃がしてから終える
 */
export function classifyResponse(status: number): 'ok' | 'retry' | 'drop' {
	if (status >= 200 && status < 300) return 'ok';
	if (status === 400 || status === 413) return 'drop';
	return 'retry';
}
