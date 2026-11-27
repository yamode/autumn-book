// Autumn Live の人の流れの受け手（docs/autumn-live.md §7.1）。Book の公開画面（components/LiveBeacon.svelte）から届く。
// 本文: { sid, stage, facility, source, leave }。名前・会員番号は受け取らない。IP は回数の上限にだけ使い、保存しない。
// 数えないもの: 別のサイトからの送信（Origin 違い）・運営のログイン中（locals.staff）・ボットの UA・1 IP の送りすぎ。
// 記録は book.live_beacon（service_role だけ・admin-client.ts の例外その16）。失敗しても 204 を返す（画面に影響させない）。
import type { RequestHandler } from './$types';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { clientIp } from '$lib/server/login-rate-limit';
import { isBotUserAgent, parseLiveBeacon } from '$lib/live-beacon';

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

// 1 IP あたり 10 分 120 回まで（この実行環境の中だけの目安。60 秒ごとの信号なら 1 タブ 10 回）
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, { start: number; n: number }>();
function tooMany(ip: string | null): boolean {
	const key = ip ?? 'unknown';
	const now = Date.now();
	const h = hits.get(key);
	if (!h || now - h.start > WINDOW_MS) {
		if (hits.size > 5000) hits.clear();
		hits.set(key, { start: now, n: 1 });
		return false;
	}
	h.n++;
	return h.n > MAX_PER_WINDOW;
}

export const POST: RequestHandler = async (event) => {
	const { request, url, locals } = event;
	if (request.headers.get('origin') !== url.origin) return done();
	if (locals.staff || isBotUserAgent(request.headers.get('user-agent'))) return done();
	if (tooMany(clientIp(request))) return done();
	let body: unknown;
	try {
		const text = await request.text();
		if (text.length > 512) return done();
		body = JSON.parse(text);
	} catch {
		return done();
	}
	const b = parseLiveBeacon(body);
	if (!b) return done();
	const svc = partnerServiceClient();
	if (!svc) return done();
	const work = Promise.resolve(
		svc.schema('book').rpc('live_beacon', { p_sid: b.sid, p_stage: b.stage, p_facility: b.facility, p_source: b.source, p_leave: b.leave })
	).then(({ error }) => {
		if (error) console.error('[live-beacon] 記録できませんでした:', error.message);
	});
	const wait = event.platform?.context?.waitUntil;
	if (wait) wait.call(event.platform?.context, work);
	else await work;
	return done();
};
