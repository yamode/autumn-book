// 会員サポートの受信（docs/member-support.md「受信」）。
// support@yamado.app に届いたメールを、受信用 Worker（workers/support-inbound）が取り出して署名つきで POST してくる。
//   x-support-timestamp: UNIX 秒（±5 分以内）
//   x-support-signature: hex(HMAC-SHA256(SUPPORT_INBOUND_SECRET, `${timestamp}.${body}`))
// 署名を確かめてから book.support_inbound（service_role）。新しい問い合わせなら宿へ通知する。
// 応答: 200 = 受け取った（二重も含む）、4xx = 送り直しても無駄（署名・形の誤り）、5xx = 一時的な失敗（Worker が送り直す）。
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { waitUntilOf } from '$lib/server/access-log-core';
import {
	acceptInboundMail,
	parseInboundPayload,
	sendSupportNotify,
	supportNotifyMail,
	supportServiceAvailable,
	verifySupportSignature
} from '$lib/server/member-support';
import type { RequestHandler } from './$types';

/** 本文の上限（バイト）。本文 20000 文字＋余裕 */
const MAX_BYTES = 256_000;

async function readLimited(request: Request): Promise<string> {
	const reader = request.body?.getReader();
	if (!reader) error(400, 'Empty body');
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BYTES) {
			await reader.cancel();
			error(413, 'Too large');
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		bytes.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const secret = env.SUPPORT_INBOUND_SECRET?.trim();
	if (!secret) error(503, 'Not configured');
	const timestamp = request.headers.get('x-support-timestamp') ?? '';
	const signature = request.headers.get('x-support-signature') ?? '';
	const raw = await readLimited(request);
	if (!(await verifySupportSignature(secret, timestamp, raw, signature))) error(401, 'Unauthorized');

	const mail = parseInboundPayload(raw);
	if (!mail) error(400, 'Invalid input');
	if (!supportServiceAvailable()) error(503, 'Not configured');

	let result: Awaited<ReturnType<typeof acceptInboundMail>>;
	try {
		result = await acceptInboundMail(mail);
	} catch (e) {
		console.error('[support/inbound] 取り込めませんでした', e instanceof Error ? e.message : e);
		error(503, 'Temporary failure');
	}
	if (result.duplicate) return json({ ok: true, duplicate: true }, { headers: { 'cache-control': 'no-store' } });

	const accepted = result;
	// 自動送信のメール（不達通知・自動返信・一斉配信）は取り込むが、新しい問い合わせでも宿へ通知しない
	if (accepted.isNew && !mail.auto) {
		const job = sendSupportNotify(
			supportNotifyMail({
				id: accepted.id,
				code: accepted.code,
				name: mail.fromName,
				email: mail.fromEmail,
				category: 'other',
				subject: mail.subject,
				body: mail.body,
				source: 'email'
			})
		).then((r) => {
			if (!r.sent) console.error('[support/inbound] 宿への通知を送れませんでした', accepted.code, r.reason);
		});
		const wait = waitUntilOf(platform);
		if (wait) wait(job);
		else await job;
	}
	return json({ ok: true, code: accepted.code, new: accepted.isNew }, { headers: { 'cache-control': 'no-store' } });
};
