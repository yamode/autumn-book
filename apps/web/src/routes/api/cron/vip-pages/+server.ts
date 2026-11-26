// VIP（＝特別会員）の専用ページを、会員登録の前に用意する（2026-11-27）。
// PMS で VIP を付けたとき（DB のトリガー）と、取りこぼし用に毎時（pg_cron 'vip_pages'）呼ばれる。
// 呼び先 URL と鍵は Vault（autumn-shared 20261126230136・事前チェックインと同じ鍵 'Bearer <CRON_SECRET>'）。
// 専用ページがまだ無い VIP の顧客を DB（book.vip_pages_needed）に聞き、ページを作って顧客に結ぶ。
// ページができると RMS の取引先料金に並ぶので、会員登録の前に料金を決められる。会員登録したら、そのページに本人が入る。
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { timingSafeEqualText } from '$lib/partner-mfa';
import { partnerAdminClient } from '$lib/server/partners/store';
import { ensureVipPages } from '$lib/server/partners/member-bookings';

function isAuthorized(request: Request, secret: string): boolean {
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
	return presented.length > 0 && timingSafeEqualText(presented, secret);
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const cronSecret = privateEnv.CRON_SECRET;
	if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
	if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
	const db = partnerAdminClient();
	if (!db) throw error(503, 'SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。');
	const run = () => ensureVipPages(db);
	// pg_net は 5 秒で切るので、作るのは応答の後に回す
	if (!platform?.context?.waitUntil) return json(await run());
	platform.context.waitUntil(
		run()
			.then((r) => console.log('[vip-pages]', JSON.stringify(r)))
			.catch((e) => console.error('[vip-pages] 失敗:', e instanceof Error ? e.message : e))
	);
	return json({ accepted: true }, { status: 202 });
};
