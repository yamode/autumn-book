// 受電端末の OS・アプリの更新を開発者にメールで知らせる（2026-10-30 指示）。
// pg_cron 'intercom_device_notify'（10 分ごと・autumn-shared 20261030043942）が呼ぶ。呼び先 URL と認証は Vault。
// 送り先は INTERCOM_ALERT_EMAIL（カンマ区切り）。未設定なら何も送らない。中身は lib/server/intercom-device-notify.ts。
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { timingSafeEqualText } from '$lib/partner-mfa';
import { partnerAdminClient } from '$lib/server/partners/store';
import { parseRecipients, runIntercomDeviceNotify } from '$lib/server/intercom-device-notify';

function isAuthorized(request: Request, secret: string): boolean {
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
	return presented.length > 0 && timingSafeEqualText(presented, secret);
}

export const POST: RequestHandler = async ({ request }) => {
	const cronSecret = privateEnv.CRON_SECRET;
	if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
	if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
	const db = partnerAdminClient();
	if (!db) throw error(503, 'SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。');
	try {
		return json(await runIntercomDeviceNotify(db, { recipients: parseRecipients(privateEnv.INTERCOM_ALERT_EMAIL) }));
	} catch (e) {
		console.error('[intercom-device-notify] 失敗:', e instanceof Error ? e.message : e);
		throw error(500, '通知の処理に失敗しました。');
	}
};
