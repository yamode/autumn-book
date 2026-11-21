// 会員サポートの受信用 Worker（autumn-book docs/member-support.md「受信」）。
// Cloudflare Email Routing（yamado.app）で support@yamado.app をこの Worker に送り、email() で受ける。
// postal-mime で差出人・名前・件名・本文（テキスト優先・無ければ HTML を文字に）・Message-ID を取り出し、
// Book の /api/support/inbound に HMAC 署名つきで POST する。
//
// 失敗したとき（lib.ts classifyResponse）:
//   - message.setReject はしない（お客様に「届かなかった」を返さない）
//   - 5xx・429・通信の失敗・401/403/404（鍵や URL の設定の誤り）は throw する → Email Routing が送り直す
//     ※ throw で本当に送り直されるかは、本番の前にわざと 503 を返して確かめる（README）
//   - 400・413（送り直しても同じ）は、FALLBACK_FORWARD（任意・Email Routing で検証済みの転送先）があれば転送してから終える
import PostalMime from 'postal-mime';
import { buildPayload, classifyResponse, fallbackMessageId, shouldDrop, signPayload } from './lib';

export interface Env {
	/** Book と同じ値（wrangler secret put SUPPORT_INBOUND_SECRET） */
	SUPPORT_INBOUND_SECRET: string;
	/** 例: https://book.yamado.app/api/support/inbound（wrangler.jsonc の vars） */
	BOOK_INBOUND_URL: string;
	/** 取り込めないメールの逃がし先（任意）。Email Routing の「宛先アドレス」で検証済みのアドレスでないと転送できない */
	FALLBACK_FORWARD?: string;
}

async function giveUp(message: ForwardableEmailMessage, env: Env, why: string): Promise<void> {
	const to = env.FALLBACK_FORWARD?.trim();
	if (to) {
		// 転送に失敗したら throw（送り直してもらう）
		await message.forward(to);
		console.error(`[support-inbound] ${why}。転送先へ逃がしました`);
		return;
	}
	console.error(`[support-inbound] ${why}。転送先（FALLBACK_FORWARD）が無いため取り込めませんでした`);
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
		const secret = env.SUPPORT_INBOUND_SECRET?.trim();
		const url = env.BOOK_INBOUND_URL?.trim();
		if (!secret || !url) {
			// 設定が無いまま受けたら送り直してもらう（設定してから届くように）
			throw new Error('SUPPORT_INBOUND_SECRET / BOOK_INBOUND_URL が未設定です');
		}
		const raw = await new Response(message.raw).arrayBuffer();
		const parsed = await PostalMime.parse(raw);
		const payload = buildPayload({
			fromAddress: parsed.from?.address,
			fromName: parsed.from?.name,
			envelopeFrom: message.from,
			subject: parsed.subject,
			text: parsed.text,
			html: parsed.html,
			messageId: parsed.messageId ?? message.headers.get('message-id'),
			attachments: parsed.attachments?.length ?? 0,
			autoSubmitted: message.headers.get('auto-submitted'),
			precedence: message.headers.get('precedence')
		});
		if (shouldDrop(payload.from_email)) {
			console.log('[support-inbound] 自分たちのアドレスからのメールは取り込みません');
			return;
		}
		// Message-ID が無いメールは、中身から作った ID で二重の取り込みを防ぐ
		if (!payload.message_id) payload.message_id = await fallbackMessageId(payload);

		const body = JSON.stringify(payload);
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = await signPayload(secret, timestamp, body);
		let res: Response;
		try {
			res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-support-timestamp': timestamp, 'x-support-signature': signature },
				body
			});
		} catch (e) {
			throw new Error(`Book に届きませんでした: ${e instanceof Error ? e.message : String(e)}`);
		}
		const kind = classifyResponse(res.status);
		if (kind === 'ok') return;
		const text = await res.text().catch(() => '');
		if (kind === 'retry') {
			throw new Error(`Book が受け取れませんでした（${res.status}・送り直します）: ${text.slice(0, 200)}`);
		}
		// 400 / 413 は送り直しても同じ（中身はログに出さない）
		await giveUp(message, env, `Book が受け取りを断りました（${res.status}）: ${text.slice(0, 200)}`);
	}
} satisfies ExportedHandler<Env>;
