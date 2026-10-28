// 事前チェックイン P4 のサーバー処理（cron の dry-run・Webhook の入口）。DB は偽物、NTT CPaaS・メールは呼ばない。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
const sendHtmlEmail = vi.fn(async () => ({ sent: true }));
vi.mock('$lib/server/mailer', () => ({ sendHtmlEmail }));
vi.mock('$lib/server/partners/mail', () => ({ partnerMailSender: vi.fn(async () => ({ fromName: 'x', replyTo: null })) }));

const { runPrecheckinAutosend, handleNttWebhook } = await import('./precheckin-sms');

type Call = { fn: string; args: Record<string, unknown> };
function fakeSvc(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
	const calls: Call[] = [];
	const db = {
		rpc: async (fn: string, args: Record<string, unknown>) => {
			calls.push({ fn, args });
			const h = handlers[fn];
			return h ? { data: h(args), error: null } : { data: null, error: { message: `unexpected ${fn}` } };
		}
	};
	const svc = { schema: () => db } as unknown as import('@supabase/supabase-js').SupabaseClient;
	return { svc, calls };
}

const targets = [
	{ facility_id: 'f1', stay_id: 's-sms', check_in_date: '2026-10-29', channel: 'sms', skip_reason: null },
	{ facility_id: 'f1', stay_id: 's-mail', check_in_date: '2026-10-29', channel: 'email', skip_reason: null },
	{ facility_id: 'f1', stay_id: 's-none', check_in_date: '2026-10-29', channel: 'none', skip_reason: null },
	{ facility_id: 'f1', stay_id: 's-done', check_in_date: '2026-10-29', channel: 'sms', skip_reason: 'answered' }
];

beforeEach(() => {
	for (const k of Object.keys(env)) delete env[k];
	sendHtmlEmail.mockClear();
});

describe('cron 自動送信', () => {
	it('dry-run（無効）は対象を数えるだけで、受付も送信もしない', async () => {
		const { svc, calls } = fakeSvc({ precheckin_autosend_targets: () => targets });
		const r = await runPrecheckinAutosend(svc, { enabled: false, origin: 'https://book.example' });
		expect(r.dryRun).toBe(true);
		expect(r.counts).toEqual({ total: 4, sms: 1, email: 1, no_contact: 1, answered: 1, already_sent: 0 });
		expect(calls.map((c) => c.fn)).toEqual(['precheckin_autosend_targets']);
		expect(sendHtmlEmail).not.toHaveBeenCalled();
	});

	it('有効でも SMS 未設定なら SMS は受付しない（メールへは切り替えない）。メールの対象は送る', async () => {
		const { svc, calls } = fakeSvc({
			precheckin_autosend_targets: () => targets,
			precheckin_autosend_begin: (a) => ({
				ok: true,
				dispatch_id: 'd1',
				precheckin_id: 'p1',
				stay_id: a.p_stay_id,
				channel: a.p_channel,
				token: 'T'.repeat(43),
				to: 'guest@example.com',
				to_masked: 'gu***@example.com',
				guest_name: '山田',
				booking_code: 'B1',
				check_in: '2026-10-29',
				check_out: '2026-10-30',
				nights: 1,
				locale: 'ja',
				facility_id: '10000000-0000-0000-0000-000000000001',
				facility_name: '山人-yamado-',
				facility_slug: 'yamado',
				facility_phone: null,
				expires_at: '2026-10-30T02:00:00Z',
				editable_until: '2026-10-29T03:00:00Z'
			}),
			precheckin_dispatch_finish: () => null
		});
		const r = await runPrecheckinAutosend(svc, { enabled: true, origin: 'https://book.example' });
		expect(r.dryRun).toBe(false);
		expect(r.smsConfigured).toBe(false);
		expect(r.sent).toBe(1);
		expect(r.failed).toBe(0);
		expect(r.skipped).toEqual({ sms_not_configured: 1 });
		const begins = calls.filter((c) => c.fn === 'precheckin_autosend_begin');
		expect(begins).toEqual([{ fn: 'precheckin_autosend_begin', args: { p_stay_id: 's-mail', p_channel: 'email' } }]);
		expect(sendHtmlEmail).toHaveBeenCalledTimes(1);
		const finish = calls.find((c) => c.fn === 'precheckin_dispatch_finish');
		expect(finish?.args).toMatchObject({ p_dispatch: 'd1', p_ok: true });
	});

	it('受付で重複（cron の 2 回目）なら送らない', async () => {
		const { svc } = fakeSvc({
			precheckin_autosend_targets: () => [targets[1]],
			precheckin_autosend_begin: () => ({ ok: false, error: 'duplicate' })
		});
		const r = await runPrecheckinAutosend(svc, { enabled: true, origin: 'https://book.example' });
		expect(r.sent).toBe(0);
		expect(r.skipped).toEqual({ duplicate: 1 });
		expect(sendHtmlEmail).not.toHaveBeenCalled();
	});

	it('有効で SMS 設定ありなら NTT CPaaS へ送る（fetch はモック）', async () => {
		env.NTT_CPAAS_BASE_URL = 'example1';
		env.NTT_CPAAS_API_KEY = 'test-key';
		env.NTT_CPAAS_SENDER = 'ServiceSMS';
		const fetchMock = vi.fn(async () => Response.json({ messages: [{ messageId: 'm-77', status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' } }] }));
		vi.stubGlobal('fetch', fetchMock);
		try {
			const { svc, calls } = fakeSvc({
				precheckin_autosend_targets: () => [targets[0]],
				precheckin_autosend_begin: () => ({
					ok: true,
					dispatch_id: 'd2',
					channel: 'sms',
					token: 'T'.repeat(43),
					to: '819012345678',
					to_masked: '*******5678',
					facility_id: '10000000-0000-0000-0000-000000000001',
					facility_name: '山人-yamado-',
					facility_phone: null
				}),
				precheckin_dispatch_finish: () => null
			});
			const r = await runPrecheckinAutosend(svc, { enabled: true, origin: 'https://book.example' });
			expect(r.sent).toBe(1);
			const [u, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(u).toBe('https://example1.ibapi.nttcpaas.com/sms/3/messages');
			const text = JSON.parse(String(init.body)).messages[0].content.text as string;
			expect(text).toContain(`https://book.example/ci/${'T'.repeat(43)}`);
			expect(text).toContain('0197-82-2222'); // DB に電話が無いときはサイトの施設情報の電話
			expect(calls.find((c) => c.fn === 'precheckin_dispatch_finish')?.args).toMatchObject({ p_dispatch: 'd2', p_ok: true, p_message_id: 'm-77' });
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('Webhook の入口', () => {
	const req = (auth: string | null, body = '{"results":[]}') =>
		new Request('https://book.example/api/webhooks/ntt-cpaas/dlr', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
			body
		});
	const { svc } = fakeSvc({ precheckin_dlr_apply: () => ({ ok: true, updated: 1, skipped: 0 }) });

	it('secret 未設定は 503', async () => {
		expect((await handleNttWebhook(req(`Basic ${btoa('u:p')}`), 'dlr', { svc, secret: null })).status).toBe(503);
	});
	it('認証違いは 401', async () => {
		expect((await handleNttWebhook(req(`Basic ${btoa('u:x')}`), 'dlr', { svc, secret: 'u:p' })).status).toBe(401);
		expect((await handleNttWebhook(req(null), 'dlr', { svc, secret: 'u:p' })).status).toBe(401);
	});
	it('JSON でなければ 400', async () => {
		expect((await handleNttWebhook(req(`Basic ${btoa('u:p')}`, 'not json'), 'dlr', { svc, secret: 'u:p' })).status).toBe(400);
	});
	it('正しい認証なら 200 で DB に渡す', async () => {
		const { svc: s2, calls } = fakeSvc({ precheckin_dlr_apply: () => ({ ok: true, updated: 1, skipped: 0 }) });
		const body = JSON.stringify({ results: [{ messageId: 'm1', status: { groupName: 'DELIVERED', name: 'DELIVERED_TO_HANDSET' } }] });
		const res = await handleNttWebhook(req(`Basic ${btoa('u:p')}`, body), 'dlr', { svc: s2, secret: 'u:p' });
		expect(res.status).toBe(200);
		expect(calls[0].fn).toBe('precheckin_dlr_apply');
		expect((calls[0].args.p_reports as unknown[]).length).toBe(1);
	});
});
