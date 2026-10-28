// 事前チェックイン P4（SMS）の純関数のテスト。NTT CPaaS の実 API は呼ばない（fetch はモック）。
import { describe, expect, it, vi } from 'vitest';
import {
	SMS_MAX_CHARS,
	autosendEnabled,
	buildNttSmsRequest,
	buildPrecheckinSms,
	checkWebhookAuth,
	contactRoute,
	dlrStatusOf,
	normalizeBaseUrl,
	normalizeDlr,
	normalizeInbound,
	nttConfigFrom,
	nttTime,
	parseNttSendResponse,
	planAutosend,
	sendSmsWith,
	smsSegments,
	smsTarget,
	type AutosendTarget,
	type NttConfig
} from './precheckin-sms';

// テスト用のダミー値（実在の鍵ではない）
const CFG: NttConfig = { baseUrl: 'https://example1.ibapi.nttcpaas.com', apiKey: 'test-key', sender: 'ServiceSMS' };
const TOKEN = 'A'.repeat(43);
const URL_ = `https://book.yamado.app/ci/${TOKEN}`;

describe('smsTarget（携帯番号 → 国際形式）', () => {
	it.each([
		['09012345678', '819012345678'],
		['090-1234-5678', '819012345678'],
		['090 1234 5678', '819012345678'],
		['０９０－１２３４－５６７８', '819012345678'],
		['０８０ １２３４ ５６７８', '818012345678'],
		['070-1234-5678', '817012345678'],
		['+81 90-1234-5678', '819012345678'],
		['+819012345678', '819012345678'],
		['＋８１９０１２３４５６７８', '819012345678'],
		['819012345678', '819012345678']
	])('%s → %s', (input, out) => {
		expect(smsTarget(input)).toBe(out);
	});
	it.each([
		['0197-82-2222'], // 固定電話
		['0185-47-7776'],
		['050-1234-5678'], // IP 電話
		['0120-123-456'],
		['+1 415 555 0100'], // 海外
		['+82 10-1234-5678'],
		['09012345'], // 桁不足
		['090123456789'], // 桁超過
		[''],
		[null],
		[undefined]
	])('%s は送らない（null）', (input) => {
		expect(smsTarget(input as string | null | undefined)).toBeNull();
	});
	it('携帯なら SMS、それ以外でメールがあればメール、どちらも無ければ連絡先なし', () => {
		expect(contactRoute('090-1234-5678', 'a@example.com')).toBe('sms');
		expect(contactRoute('0197-82-2222', 'a@example.com')).toBe('email');
		expect(contactRoute('', ' ')).toBe('none');
		expect(contactRoute(null, null)).toBe('none');
	});
});

describe('SMS 本文', () => {
	it.each([
		['山人-yamado-', '0197-82-2222'],
		['山人-oga-', '0185-47-7776']
	])('%s: 施設名・案内・リンク・問い合わせ先が入り、2 通（134 字）以内', (name, tel) => {
		const t = buildPrecheckinSms({ facilityName: name, url: URL_, phone: tel });
		expect(t).toContain(`【${name}】`);
		expect(t).toContain('事前チェックインはこちら');
		expect(t).toContain('夕食・朝食の時間');
		expect(t).toContain(URL_);
		expect(t).toContain(tel);
		expect([...t].length).toBeLessThanOrEqual(SMS_MAX_CHARS);
		expect(smsSegments(t)).toBeLessThanOrEqual(2);
	});
	it('施設名が長いときは案内を短くして 2 通に収める（リンクと電話は残す）', () => {
		const t = buildPrecheckinSms({ facilityName: 'とても長い施設名の旅館さま本館東館', url: URL_, phone: '0197-82-2222' });
		expect([...t].length).toBeLessThanOrEqual(SMS_MAX_CHARS);
		expect(t).toContain(URL_);
		expect(t).toContain('0197-82-2222');
	});
	it('通数の目安', () => {
		expect(smsSegments('a'.repeat(160))).toBe(1);
		expect(smsSegments('a'.repeat(161))).toBe(2);
		expect(smsSegments('あ'.repeat(70))).toBe(1);
		expect(smsSegments('あ'.repeat(71))).toBe(2);
		expect(smsSegments('あ'.repeat(134))).toBe(2);
		expect(smsSegments('あ'.repeat(135))).toBe(3);
	});
});

describe('normalizeBaseUrl（SSRF 対策）', () => {
	it.each([
		['abc123', 'https://abc123.ibapi.nttcpaas.com'],
		['  ABC123  ', 'https://abc123.ibapi.nttcpaas.com'],
		['abc123.ibapi.nttcpaas.com', 'https://abc123.ibapi.nttcpaas.com'],
		['abc123.IBAPI.nttcpaas.com/', 'https://abc123.ibapi.nttcpaas.com'],
		['https://abc123.ibapi.nttcpaas.com', 'https://abc123.ibapi.nttcpaas.com'],
		['HTTPS://Abc123.ibapi.nttcpaas.com//', 'https://abc123.ibapi.nttcpaas.com'],
		['x-y-1', 'https://x-y-1.ibapi.nttcpaas.com']
	])('%s → %s', (input, out) => {
		expect(normalizeBaseUrl(input)).toBe(out);
	});
	it.each([
		[''],
		['   '],
		[null],
		['http://abc123.ibapi.nttcpaas.com'], // https 以外
		['https://evil.example.com'], // 別ホスト
		['abc123.ibapi.nttcpaas.com.evil.com'],
		['evil.com/abc123.ibapi.nttcpaas.com'],
		['https://abc123.ibapi.nttcpaas.com/sms/3/messages'], // パスつき
		['https://abc123.ibapi.nttcpaas.com:8443'], // ポートつき
		['https://user:pass@abc123.ibapi.nttcpaas.com'], // 認証情報つき
		['a.b.ibapi.nttcpaas.com'], // サブドメインが複数段
		['nttcpaas.com'],
		['-abc.ibapi.nttcpaas.com'],
		['abc_123']
	])('%s は拒否（null）', (input) => {
		expect(normalizeBaseUrl(input as string | null)).toBeNull();
	});
	it('nttConfigFrom: どれか欠けたら null（= SMS 未設定）、ベース URL が不正でも null', () => {
		expect(nttConfigFrom({})).toBeNull();
		expect(nttConfigFrom({ NTT_CPAAS_BASE_URL: 'abc', NTT_CPAAS_API_KEY: 'k' })).toBeNull();
		expect(nttConfigFrom({ NTT_CPAAS_BASE_URL: 'https://evil.example.com', NTT_CPAAS_API_KEY: 'k', NTT_CPAAS_SENDER: 's' })).toBeNull();
		expect(nttConfigFrom({ NTT_CPAAS_BASE_URL: 'abc', NTT_CPAAS_API_KEY: ' k ', NTT_CPAAS_SENDER: 'ServiceSMS' })).toEqual({
			baseUrl: 'https://abc.ibapi.nttcpaas.com',
			apiKey: 'k',
			sender: 'ServiceSMS'
		});
	});
});

describe('NTT CPaaS 送信リクエスト', () => {
	it('URL・ヘッダー・ボディの形（v3）', () => {
		const { url, init } = buildNttSmsRequest(CFG, { to: '819012345678', text: '本文', callbackData: 'd-1', notifyUrl: 'https://book.example/api/webhooks/ntt-cpaas/dlr' });
		expect(url).toBe('https://example1.ibapi.nttcpaas.com/sms/3/messages');
		expect(init.method).toBe('POST');
		const h = init.headers as Record<string, string>;
		expect(h.Authorization).toBe('App test-key');
		expect(h['Content-Type']).toBe('application/json');
		const body = JSON.parse(String(init.body));
		expect(body).toEqual({
			messages: [
				{
					sender: 'ServiceSMS',
					destinations: [{ to: '819012345678' }],
					content: { text: '本文' },
					options: { validityPeriod: { amount: 360, timeUnit: 'MINUTES' } },
					webhooks: { delivery: { url: 'https://book.example/api/webhooks/ntt-cpaas/dlr' }, contentType: 'application/json', callbackData: 'd-1' }
				}
			]
		});
		expect(body.messages[0]).not.toHaveProperty('flash'); // flash は NTT CPaaS では不可
	});
	it('notifyUrl を渡さなければ delivery を付けない（サブスクリプション管理の設定が使われる）', () => {
		const body = JSON.parse(String(buildNttSmsRequest(CFG, { to: '819012345678', text: 'x' }).init.body));
		expect(body.messages[0].webhooks).toEqual({ contentType: 'application/json' });
	});

	it('sendSmsWith: fetch に正しい形で渡し、PENDING を送信済みにする', async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				bulkId: 'b1',
				messages: [{ messageId: 'm-1', status: { groupId: 1, groupName: 'PENDING', id: 26, name: 'PENDING_ACCEPTED' }, destination: '819012345678' }]
			})
		);
		const r = await sendSmsWith(CFG, { to: '819012345678', text: 'こんにちは', callbackData: 'd-9' }, fetchMock as unknown as typeof fetch);
		expect(r).toEqual({ sent: true, messageId: 'm-1', providerStatus: 'PENDING_ACCEPTED' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [u, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(u).toBe('https://example1.ibapi.nttcpaas.com/sms/3/messages');
		expect((init.headers as Record<string, string>).Authorization).toBe('App test-key');
		expect(JSON.parse(String(init.body)).messages[0].content.text).toBe('こんにちは');
	});
	it('sendSmsWith: 未設定なら fetch せず「SMS未設定」', async () => {
		const fetchMock = vi.fn();
		const r = await sendSmsWith(null, { to: '819012345678', text: 'x' }, fetchMock as unknown as typeof fetch);
		expect(r).toEqual({ sent: false, reason: 'SMS未設定' });
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it('sendSmsWith: 携帯番号の国際形式でなければ fetch しない', async () => {
		const fetchMock = vi.fn();
		const r = await sendSmsWith(CFG, { to: '81197822222', text: 'x' }, fetchMock as unknown as typeof fetch);
		expect(r.sent).toBe(false);
		expect(r.permanent).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it('sendSmsWith: 通信エラーは例外にせず sent:false', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('network down');
		});
		const r = await sendSmsWith(CFG, { to: '819012345678', text: 'x' }, fetchMock as unknown as typeof fetch);
		expect(r.sent).toBe(false);
		expect(r.reason).toContain('network down');
	});

	it('応答の読み取り: ステータス別', () => {
		const ok = (groupName: string, name: string) => ({ messages: [{ messageId: 'm', status: { groupName, name, description: 'd' } }] });
		expect(parseNttSendResponse(200, ok('PENDING', 'PENDING_ACCEPTED')).sent).toBe(true);
		expect(parseNttSendResponse(200, ok('DELIVERED', 'DELIVERED_TO_HANDSET')).sent).toBe(true);
		const rej = parseNttSendResponse(200, ok('REJECTED', 'REJECTED_DESTINATION'));
		expect(rej).toMatchObject({ sent: false, messageId: 'm', providerStatus: 'REJECTED_DESTINATION', permanent: false });
		expect(parseNttSendResponse(200, ok('UNDELIVERABLE', 'UNDELIVERABLE_NOT_DELIVERED'))).toMatchObject({ sent: false, permanent: true });
		expect(parseNttSendResponse(200, ok('EXPIRED', 'EXPIRED_EXPIRED')).sent).toBe(false);
		expect(parseNttSendResponse(200, { messages: [] })).toMatchObject({ sent: false });
		const e401 = parseNttSendResponse(401, { requestError: { serviceException: { messageId: 'UNAUTHORIZED', text: 'Invalid login details' } } });
		expect(e401.sent).toBe(false);
		expect(e401.reason).toBe('ntt 401: UNAUTHORIZED Invalid login details');
		expect(parseNttSendResponse(500, null).reason).toBe('ntt 500');
	});
});

describe('DLR・受信 Webhook', () => {
	it('DLR の状態の対応', () => {
		expect(dlrStatusOf('DELIVERED')).toBe('delivered');
		expect(dlrStatusOf('REJECTED')).toBe('failed');
		expect(dlrStatusOf('EXPIRED')).toBe('failed');
		expect(dlrStatusOf('UNDELIVERABLE')).toBe('undeliverable');
		expect(dlrStatusOf('PENDING')).toBeNull();
		expect(dlrStatusOf('')).toBeNull();
	});
	it('DLR の本文を正規化（PENDING と messageId なしは捨てる）', () => {
		const out = normalizeDlr({
			results: [
				{ messageId: 'm1', status: { groupName: 'DELIVERED', name: 'DELIVERED_TO_HANDSET' }, error: { name: 'NO_ERROR' }, doneAt: '2026-10-29T09:00:05.000+0900' },
				{ messageId: 'm2', status: { groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_NOT_DELIVERED', description: '届きません' }, error: { name: 'EC_ABSENT_SUBSCRIBER', description: '圏外' } },
				{ messageId: 'm3', status: { groupName: 'PENDING', name: 'PENDING_ENROUTE' } },
				{ status: { groupName: 'DELIVERED' } }
			]
		});
		expect(out).toEqual([
			{ message_id: 'm1', status: 'delivered', provider_status: 'DELIVERED_TO_HANDSET', error: null, done_at: '2026-10-29T00:00:05.000Z' },
			{ message_id: 'm2', status: 'undeliverable', provider_status: 'UNDELIVERABLE_NOT_DELIVERED', error: 'EC_ABSENT_SUBSCRIBER 圏外', done_at: null }
		]);
		expect(normalizeDlr(null)).toEqual([]);
		expect(normalizeDlr({ results: 'x' })).toEqual([]);
	});
	it('受信の本文を正規化（message / text のどちらでも）', () => {
		const out = normalizeInbound({
			results: [
				{ messageId: 'in1', from: '819012345678', to: '00051234', message: '到着は18時です', receivedAt: '2026-10-29T00:10:00.000+0000', pairedMessageId: 'm1' },
				{ messageId: 'in2', from: '818012345678', to: '00051234', text: 'hello', receivedAt: 'bad' },
				{ from: '819000000000', message: 'no id' }
			],
			messageCount: 3,
			pendingMessageCount: 0
		});
		expect(out).toEqual([
			{ message_id: 'in1', paired_message_id: 'm1', from: '819012345678', to: '00051234', message: '到着は18時です', received_at: '2026-10-29T00:10:00.000Z' },
			{ message_id: 'in2', paired_message_id: null, from: '818012345678', to: '00051234', message: 'hello', received_at: null }
		]);
	});
	it('時刻の読み取り', () => {
		expect(nttTime('2019-11-09T16:00:00.000+0100')).toBe('2019-11-09T15:00:00.000Z');
		expect(nttTime('2019-11-09T16:00:00Z')).toBe('2019-11-09T16:00:00.000Z');
		expect(nttTime('')).toBeNull();
		expect(nttTime('x')).toBeNull();
	});

	const basic = (v: string) => `Basic ${btoa(v)}`;
	it('Webhook 認証: 未設定は unconfigured', () => {
		expect(checkWebhookAuth(basic('u:p'), '')).toBe('unconfigured');
		expect(checkWebhookAuth(basic('u:p'), undefined)).toBe('unconfigured');
	});
	it('Webhook 認証: ユーザー名:パスワードが一致すれば ok', () => {
		expect(checkWebhookAuth(basic('ntt:s3cret'), 'ntt:s3cret')).toBe('ok');
		expect(checkWebhookAuth(`basic   ${btoa('ntt:s3cret')}`, 'ntt:s3cret')).toBe('ok');
	});
	it('Webhook 認証: 違えば denied', () => {
		expect(checkWebhookAuth(basic('ntt:wrong'), 'ntt:s3cret')).toBe('denied');
		expect(checkWebhookAuth(basic('other:s3cret'), 'ntt:s3cret')).toBe('denied');
		expect(checkWebhookAuth(null, 'ntt:s3cret')).toBe('denied');
		expect(checkWebhookAuth('Bearer ntt:s3cret', 'ntt:s3cret')).toBe('denied');
		expect(checkWebhookAuth('Basic !!!', 'ntt:s3cret')).toBe('denied');
	});
	it('Webhook 認証: secret にコロンが無ければパスワードだけ比べる', () => {
		expect(checkWebhookAuth(basic('anyone:onlypass'), 'onlypass')).toBe('ok');
		expect(checkWebhookAuth(basic('anyone:nope'), 'onlypass')).toBe('denied');
	});
});

describe('自動送信（cron）', () => {
	it("PRECHECKIN_AUTOSEND は '1' のときだけ有効", () => {
		expect(autosendEnabled('1')).toBe(true);
		expect(autosendEnabled(' 1 ')).toBe(true);
		expect(autosendEnabled('0')).toBe(false);
		expect(autosendEnabled('true')).toBe(false);
		expect(autosendEnabled(undefined)).toBe(false);
	});
	it('対象を送る／連絡先なし／回答済み／送信済みに分ける', () => {
		const t = (id: string, channel: AutosendTarget['channel'], skip: AutosendTarget['skip_reason'] = null): AutosendTarget => ({
			facility_id: 'f',
			stay_id: id,
			check_in_date: '2026-10-29',
			channel,
			skip_reason: skip
		});
		const plan = planAutosend([t('a', 'sms'), t('b', 'email'), t('c', 'none'), t('d', 'sms', 'answered'), t('e', 'sms', 'already_sent'), t('f', 'sms')]);
		expect(plan.send.map((x) => x.stay_id)).toEqual(['a', 'b', 'f']);
		expect(plan.counts).toEqual({ total: 6, sms: 2, email: 1, no_contact: 1, answered: 1, already_sent: 1 });
	});
});
