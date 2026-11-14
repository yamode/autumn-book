// 事前チェックインの当日 9:00 の自動送信（docs/pre-checkin.md §3・P4）。
// pg_cron 'precheckin_send'（UTC 0:00 = JST 9:00・autumn-shared 20261028223741）が呼ぶ。呼び先 URL と認証は Vault。
//
// 対象: チェックイン日 = 今日（施設 TZ）・取消なし・取引先除外・未送信・未回答の予約の代表 1 通。
//   携帯番号なら SMS（NTT CPaaS）、それ以外でメールがあればメール、どちらも無ければ「連絡先なし」として件数だけ返す。
//   SMS の失敗はメールに切り替えない（管理画面 /admin/precheckin に失敗が出るので手動で対応）。
// 既定は OFF: PRECHECKIN_AUTOSEND が '1' のときだけ送る。それ以外は dry-run（対象件数だけ）。
// 送信が続くので waitUntil に逃がして即 202（pg_net 5 秒タイムアウト回避）。?wait=1 なら結果を待って返す（手動確認用）。
// ?date=YYYY-MM-DD は対象の確認用（指定したときは PRECHECKIN_AUTOSEND に関係なく必ず dry-run）。
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { timingSafeEqualText } from '$lib/partner-mfa';
import { autosendEnabled, buildNttSmsRequest } from '$lib/precheckin-sms';
import { partnerAdminClient } from '$lib/server/partners/store';
import { nttConfig, runPrecheckinAutosend } from '$lib/server/precheckin-sms';
import { customerLinkOrigin } from '$lib/server/public-origin';

async function nttCheck() {
	const cfg = nttConfig();
	const rawKey = String(privateEnv.NTT_CPAAS_API_KEY ?? '');
	const info = { configured: !!cfg, host: cfg?.baseUrl ?? null, keyLen: rawKey.length, keyTail: rawKey.trim().slice(-4), keyTrimmed: rawKey !== rawKey.trim() };
	if (!cfg) return { ...info, status: null };
	const { url, init } = buildNttSmsRequest(cfg, { to: '819000000000', text: 'x', callbackData: 'check' });
	const out: Record<string, unknown> = { ...info };
	const hdrs = (r: Response) => Object.fromEntries([...r.headers].filter(([k]) => !/cookie/i.test(k)));
	const safe = async (name: string, fn: () => Promise<unknown>) => {
		try {
			out[name] = await fn();
		} catch (e) {
			out[name] = { error: e instanceof Error ? e.message : String(e) };
		}
	};
	// 1) 空の依頼（400 なら認証は通っている）。転送は追わない
	await safe('post', async () => {
		const r = await fetch(url, { ...init, body: '{"messages":[]}', redirect: 'manual' });
		return { status: r.status, headers: hdrs(r), body: (await r.text()).slice(0, 160) };
	});
	// 2) 残高の照会（GET）
	await safe('balance', async () => {
		const r = await fetch(`${cfg.baseUrl}/account/1/balance`, { headers: { Authorization: `App ${cfg.apiKey}`, Accept: 'application/json' }, redirect: 'manual' });
		return { status: r.status, body: (await r.text()).slice(0, 120) };
	});
	// 3) 見出しがそのまま届くか（にせのキーで、見出しを返すだけのサービスへ）
	await safe('echo', async () => {
		const r = await fetch('https://postman-echo.com/post', { method: 'POST', headers: { Authorization: 'App DUMMY-0000-not-a-key', 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{"messages":[]}' });
		const j = (await r.json()) as { headers?: Record<string, string> };
		return { status: r.status, headers: j.headers };
	});
	// 4) fetch を使わず、TLS の生の接続で同じ依頼を送る（Workers が見出しを足さない経路）
	await safe('socket', async () => {
		const spec = 'cloudflare:' + 'sockets';
		const { connect } = (await import(/* @vite-ignore */ spec)) as { connect: (a: { hostname: string; port: number }, o: { secureTransport: string }) => { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array>; close: () => Promise<void> } };
		const host = new URL(cfg.baseUrl).hostname;
		const sock = connect({ hostname: host, port: 443 }, { secureTransport: 'on' });
		const body = '{"messages":[]}';
		const req = ['POST /sms/3/messages HTTP/1.1', `Host: ${host}`, `Authorization: App ${cfg.apiKey}`, 'Content-Type: application/json', 'Accept: application/json', `Content-Length: ${body.length}`, 'Connection: close', '', body].join('\r\n');
		const w = sock.writable.getWriter();
		await w.write(new TextEncoder().encode(req));
		const rd = sock.readable.getReader();
		let text = '';
		const dec = new TextDecoder();
		for (let i = 0; i < 20 && text.length < 600; i++) {
			const { value, done } = await rd.read();
			if (done) break;
			text += dec.decode(value);
		}
		await sock.close().catch(() => {});
		return { head: text.split('\r\n')[0], tail: text.slice(-140) };
	});
	// 5) 出口の IP と場所
	await safe('egress', async () => (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text().then((t) => t.split('\n').filter((l) => /^(ip|colo|loc)=/.test(l)).join(' ')));
	await safe('egress2', async () => (await fetch('https://api.ipify.org')).text());
	return out;
}

function isAuthorized(request: Request, secret: string): boolean {
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
	return presented.length > 0 && timingSafeEqualText(presented, secret);
}

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const cronSecret = privateEnv.CRON_SECRET;
	if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
	if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
	// ?check=ntt … NTT CPaaS の認証だけ確かめる（空の依頼を送る。SMS は送られない）。キーは末尾 4 桁と長さだけ返す
	if (url.searchParams.get('check') === 'ntt') return json(await nttCheck());
	const db = partnerAdminClient();
	if (!db) throw error(503, 'SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。');

	const dateQ = url.searchParams.get('date');
	const date = dateQ && /^\d{4}-\d{2}-\d{2}$/.test(dateQ) ? dateQ : null;
	// 日付を指定したときは数えるだけ（過去・未来の日に送らない）
	const enabled = autosendEnabled(privateEnv.PRECHECKIN_AUTOSEND) && date === null;
	const run = () => runPrecheckinAutosend(db, { enabled, origin: customerLinkOrigin(url), date });

	if (url.searchParams.get('wait') === '1' || !platform?.context?.waitUntil) return json(await run());
	platform.context.waitUntil(
		run()
			.then((r) => console.log('[precheckin-send]', JSON.stringify({ dryRun: r.dryRun, counts: r.counts, sent: r.sent, failed: r.failed, skipped: r.skipped })))
			.catch((e) => console.error('[precheckin-send] 失敗:', e instanceof Error ? e.message : e))
	);
	return json({ accepted: true, dryRun: !enabled }, { status: 202 });
};
