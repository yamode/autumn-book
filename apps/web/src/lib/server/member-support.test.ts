import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/partners/admin-client', () => ({ partnerServiceClient: () => null }));
vi.mock('$lib/server/mailer', () => ({ sendHtmlEmail: async () => ({ sent: false, reason: 'test' }) }));

const ms = await import('./member-support');
const lib = await import('../../../../../workers/support-inbound/src/lib');

describe('会員サポート: 受信の署名', () => {
	const secret = 'test-secret';
	const body = JSON.stringify({ from_email: 'guest@example.com', subject: 'x', body: 'こんにちは' });
	const now = 1_790_000_000;
	const ts = String(now);

	it('Worker と同じ作り方の署名は通る（hex(HMAC-SHA256(secret, ts.body))）', async () => {
		const sig = await lib.signPayload(secret, ts, body);
		expect(sig).toMatch(/^[a-f0-9]{64}$/);
		expect(sig).toBe(await ms.signSupportPayload(secret, ts, body));
		expect(await ms.verifySupportSignature(secret, ts, body, sig, now)).toBe(true);
		expect(await ms.verifySupportSignature(secret, ts, body, sig.toUpperCase(), now)).toBe(true);
	});
	it('本文・鍵・時刻が違えば通らない', async () => {
		const sig = await lib.signPayload(secret, ts, body);
		expect(await ms.verifySupportSignature(secret, ts, body + ' ', sig, now)).toBe(false);
		expect(await ms.verifySupportSignature('other', ts, body, sig, now)).toBe(false);
		expect(await ms.verifySupportSignature('', ts, body, sig, now)).toBe(false);
		expect(await ms.verifySupportSignature(secret, String(now + 1), body, sig, now)).toBe(false);
	});
	it('時刻は ±5 分以内・10 桁の数字だけ', async () => {
		const old = String(now - 301);
		expect(await ms.verifySupportSignature(secret, old, body, await lib.signPayload(secret, old, body), now)).toBe(false);
		const ok = String(now - 299);
		expect(await ms.verifySupportSignature(secret, ok, body, await lib.signPayload(secret, ok, body), now)).toBe(true);
		const future = String(now + 301);
		expect(await ms.verifySupportSignature(secret, future, body, await lib.signPayload(secret, future, body), now)).toBe(false);
		expect(await ms.verifySupportSignature(secret, '12345', body, 'a'.repeat(64), now)).toBe(false);
		expect(await ms.verifySupportSignature(secret, ts, body, 'zz', now)).toBe(false);
	});
});

describe('会員サポート: 受信の中身', () => {
	it('差出人は小文字・件名と名前は切り詰め・添付は件数だけ本文に残す', () => {
		const r = ms.parseInboundPayload(
			JSON.stringify({ from_email: ' Guest@Example.COM ', from_name: '山田', subject: 'Re: x [YS-AB12CD]', body: 'a\r\nb', message_id: '<m1@x>', attachments: 2 })
		);
		expect(r).not.toBeNull();
		expect(r!.fromEmail).toBe('guest@example.com');
		expect(r!.messageId).toBe('<m1@x>');
		expect(r!.body).toBe('a\nb\n\n［添付ファイル 2 件がありましたが、受け取っていません］');
		expect(r!.auto).toBe(false);
	});
	it('件名・名前の改行などは空白に・auto=true を受け取る', () => {
		const r = ms.parseInboundPayload(JSON.stringify({ from_email: 'a@b.jp', from_name: '山田\n太郎', subject: 'x\r\n\u0007y', body: 'b', auto: true }));
		expect(r!.fromName).toBe('山田 太郎');
		expect(r!.subject).toBe('x y');
		expect(r!.auto).toBe(true);
		expect(ms.parseInboundPayload(JSON.stringify({ from_email: 'a@b.jp', body: 'b', auto: 'yes' }))!.auto).toBe(false);
	});
	it('差出人が無い・JSON でないものは null・本文が空なら（本文なし）', () => {
		expect(ms.parseInboundPayload('not json')).toBeNull();
		expect(ms.parseInboundPayload('[]')).toBeNull();
		expect(ms.parseInboundPayload(JSON.stringify({ from_email: 'nope', body: 'x' }))).toBeNull();
		const r = ms.parseInboundPayload(JSON.stringify({ from_email: 'a@b.jp', body: '  ', message_id: '' }));
		expect(r!.body).toBe('（本文なし）');
		expect(r!.messageId).toBeNull();
	});
});

describe('会員サポート: メールの文面', () => {
	it('控え: 件名に番号・内容は引用で控える', () => {
		const m = ms.supportAckMail({ code: 'YS-AB12CD', name: '山田 太郎', category: 'login', subject: '', body: '届きません\n2 行目' }, true);
		expect(m.subject).toBe('【YAMADO】お問い合わせを受け付けました [YS-AB12CD]');
		expect(m.text).toContain('山田 太郎 様');
		expect(m.text).toContain('お問い合わせの種類: ログイン・会員登録');
		expect(m.text).toContain('> 届きません\n> 2 行目');
		expect(m.text).toContain('support@yamado.app');
		expect(m.text).toContain('このメールにご返信いただくと');
	});
	it('控え: SUPPORT_MAIL_ENABLED でないときは support@ を載せず、返信できない旨とヘルプページを案内する', () => {
		const m = ms.supportAckMail({ code: 'YS-AB12CD', name: '山田', category: 'other', subject: 's', body: 'x' }, false);
		expect(m.text).not.toContain('support@yamado.app');
		expect(m.text).toContain(ms.noReplyNotice('YS-AB12CD'));
		expect(m.text).toContain('https://book.yamado.app/help');
		expect(ms.supportReplyMail({ code: 'YS-AB12CD', name: '', subject: 'x', body: 'b' }, false).text).toContain(ms.noReplyNotice('YS-AB12CD'));
	});
	it('控え: 内容は先頭 500 字まで（…付き）・件名と名前の改行は空白に', () => {
		const m = ms.supportAckMail({ code: 'YS-AB12CD', name: '山田\r\n太郎', category: 'other', subject: 'a\nb', body: 'あ'.repeat(600) }, true);
		expect(m.text).toContain(`> ${'あ'.repeat(500)}…`);
		expect(m.text).not.toContain('あ'.repeat(501));
		expect(m.text.startsWith('山田 太郎 様')).toBe(true);
		expect(m.text).toContain('件名: a b');
	});
	it('通知の件名に改行を入れない', () => {
		const m = ms.supportNotifyMail({ id: 'x', code: 'YS-AB12CD', name: 'n', email: 'a@b.jp', category: 'other', subject: '件名\r\nBcc: x@y', body: 'b', source: 'email' });
		expect(m.subject).toBe('【会員サポート】新しいお問い合わせ [YS-AB12CD] 件名 Bcc: x@y');
	});
	it('返信: 件名は Re: <件名> [番号]・宛名と署名が付く', () => {
		const m = ms.supportReplyMail({ code: 'YS-AB12CD', name: '', subject: 'ポイント', body: 'ご連絡ありがとうございます。\r\n' }, true);
		expect(m.subject).toBe('Re: ポイント [YS-AB12CD]');
		expect(m.text.startsWith('お客様 様\n\nご連絡ありがとうございます。\n')).toBe(true);
		expect(m.text).toContain('https://book.yamado.app/help');
	});
	it('通知: 管理画面のリンクと会員の印', () => {
		const m = ms.supportNotifyMail({ id: 'abc', code: 'YS-AB12CD', name: '山田', email: 'a@b.jp', category: 'points', subject: '', body: 'x', source: 'form', isMember: true });
		expect(m.subject).toBe('【会員サポート】新しいお問い合わせ [YS-AB12CD] ポイント・会員ランク');
		expect(m.text).toContain('https://book.yamado.app/admin/support/abc');
		expect(m.text).toContain('山田（会員）');
	});
	it('本文の HTML は文字をエスケープして段落にする', () => {
		expect(ms.textToHtml('<b>&\n\nx')).toBe(
			'<p style="margin:0 0 6px;white-space:pre-wrap">&lt;b&gt;&amp;</p><p style="margin:0 0 6px">&nbsp;</p><p style="margin:0 0 6px;white-space:pre-wrap">x</p>'
		);
	});
	it('通知先は SUPPORT_NOTIFY_TO（カンマ区切り）・無ければ info@yamado.co.jp', () => {
		expect(ms.supportNotifyRecipients('')).toEqual(['info@yamado.co.jp']);
		expect(ms.supportNotifyRecipients('a@b.jp, c@d.jp')).toEqual(['a@b.jp', 'c@d.jp']);
		expect(ms.supportNotifyRecipients('bad')).toEqual(['info@yamado.co.jp']);
	});
});

describe('会員サポート: 返信の送信と記録', () => {
	it('送れたら ok=true・送れなければ ok=false と理由を support_mark_sent に残す', async () => {
		const calls: [string, Record<string, unknown> | undefined][] = [];
		const db = { rpc: async (fn: string, args?: Record<string, unknown>) => (calls.push([fn, args]), { data: null, error: null }) };
		const t = { messageId: 'm1', code: 'YS-AB12CD', email: 'a@b.jp', name: '山田', subject: 's', body: 'b' };
		const ok = await ms.deliverSupportReply(db, t, async () => ({ sent: true }));
		expect(ok.sent).toBe(true);
		expect(calls[0]).toEqual(['support_mark_sent', { p_message_id: 'm1', p_ok: true, p_error: null }]);
		const ng = await ms.deliverSupportReply(db, t, async () => ({ sent: false, reason: 'cf-email 500' }));
		expect(ng).toMatchObject({ sent: false, reason: 'cf-email 500' });
		expect(calls[1]).toEqual(['support_mark_sent', { p_message_id: 'm1', p_ok: false, p_error: 'cf-email 500' }]);
	});
	it('返信は admin_support_reply の戻りの宛先へ送る', async () => {
		const db = {
			rpc: async (fn: string) =>
				fn === 'admin_support_reply'
					? { data: { message_id: 'm9', code: 'YS-AB12CD', email: 'g@x.jp', name: '山田', subject: '件名' }, error: null }
					: { data: null, error: null }
		};
		// replySupportTicket は既定の送信（モックの sendHtmlEmail は送れない）を使う
		const r = await ms.replySupportTicket(db, 't1', '本文');
		expect(r).toMatchObject({ messageId: 'm9', code: 'YS-AB12CD', sent: false });
	});
	it('管理画面の例外は日本語の文言に', () => {
		expect(ms.supportAdminError({ message: 'body_required' })).toBe('本文を入力してください。');
		expect(ms.supportAdminError({ message: 'forbidden' })).toBe('この操作の権限がありません。');
	});
});

describe('受信用 Worker の取り出し', () => {
	it('テキストを優先し、無ければ HTML を文字にする', () => {
		const base = { fromAddress: 'Guest@Example.com', fromName: ' 山田 ', envelopeFrom: 'bounce@x', subject: ' 件名 ', messageId: '<id@x>', attachments: 0 };
		expect(lib.buildPayload({ ...base, text: '本文', html: '<p>html</p>' }).body).toBe('本文');
		const p = lib.buildPayload({ ...base, text: '', html: '<p>こんにちは&amp;<br>2 行目</p><div>次</div>' });
		expect(p.body).toBe('こんにちは&\n2 行目\n次');
		expect(p.from_email).toBe('guest@example.com');
		expect(p.from_name).toBe('山田');
		expect(p.subject).toBe('件名');
		expect(p.message_id).toBe('<id@x>');
	});
	it('ヘッダの From が無ければエンベロープの差出人', () => {
		expect(lib.buildPayload({ fromAddress: null, fromName: null, envelopeFrom: 'A@B.jp', subject: null, text: null, html: null, messageId: null, attachments: 0 })).toEqual({
			from_email: 'a@b.jp',
			from_name: '',
			subject: '',
			body: '',
			message_id: null,
			attachments: 0,
			auto: false
		});
	});
	it('HTML: style・script・コメントを落とし、実体参照を戻す', () => {
		expect(lib.htmlToText('<style>p{}</style><!-- c --><p>a&nbsp;b &#12354; &#x3044;</p><script>x()</script>')).toBe('a b あ い');
		expect(lib.htmlToText('<ul><li>一</li><li>二</li></ul>')).toBe('・一\n・二');
	});
	it('数値文字参照: 範囲外・サロゲートは元の文字列のまま', () => {
		expect(lib.htmlToText('a &#99999999; b &#xD800; c &#0; d &#x1F600;')).toBe('a &#99999999; b &#xD800; c &#0; d 😀');
	});
	it('自動送信のメールは auto=true（Auto-Submitted・Precedence・mailer-daemon / postmaster）', () => {
		const base = { fromAddress: 'guest@example.com', fromName: '', envelopeFrom: '', subject: 's', text: 't', html: null, messageId: null, attachments: 0 };
		expect(lib.buildPayload(base).auto).toBe(false);
		expect(lib.buildPayload({ ...base, autoSubmitted: 'no' }).auto).toBe(false);
		expect(lib.buildPayload({ ...base, autoSubmitted: 'auto-replied' }).auto).toBe(true);
		expect(lib.buildPayload({ ...base, precedence: 'Bulk' }).auto).toBe(true);
		expect(lib.buildPayload({ ...base, precedence: 'first-class' }).auto).toBe(false);
		expect(lib.buildPayload({ ...base, fromAddress: 'MAILER-DAEMON@mx.example.com' }).auto).toBe(true);
		expect(lib.buildPayload({ ...base, fromAddress: 'postmaster@example.com' }).auto).toBe(true);
	});
	it('件名・名前の改行は空白に', () => {
		const p = lib.buildPayload({ fromAddress: 'a@b.jp', fromName: 'A\r\nB', envelopeFrom: '', subject: 'x\ny', text: 't', html: null, messageId: null, attachments: 0 });
		expect(p.from_name).toBe('A B');
		expect(p.subject).toBe('x y');
	});
	it('Message-ID が無いときの代わりの ID は中身の SHA-256（同じ中身なら同じ）', async () => {
		const a = await lib.fallbackMessageId({ from_email: 'a@b.jp', subject: 's', body: 'b' });
		expect(a).toMatch(/^<[a-f0-9]{64}@support-inbound>$/);
		expect(await lib.fallbackMessageId({ from_email: 'a@b.jp', subject: 's', body: 'b' })).toBe(a);
		expect(await lib.fallbackMessageId({ from_email: 'a@b.jp', subject: 's', body: 'c' })).not.toBe(a);
	});
	it('Book の応答: 2xx は受け取り・400/413 は捨てる・それ以外（401/403/404/429/5xx）は送り直す', () => {
		expect(lib.classifyResponse(200)).toBe('ok');
		expect(lib.classifyResponse(400)).toBe('drop');
		expect(lib.classifyResponse(413)).toBe('drop');
		for (const s of [401, 403, 404, 429, 500, 503]) expect(lib.classifyResponse(s)).toBe('retry');
	});
	it('自分たちのアドレスからのメールは取り込まない', () => {
		expect(lib.shouldDrop('noreply@yamado.app')).toBe(true);
		expect(lib.shouldDrop('SUPPORT@yamado.app')).toBe(true);
		expect(lib.shouldDrop('guest@example.com')).toBe(false);
		expect(lib.shouldDrop('')).toBe(true);
	});
});
