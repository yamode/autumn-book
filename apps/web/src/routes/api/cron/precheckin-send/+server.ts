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
import { autosendEnabled } from '$lib/precheckin-sms';
import { partnerAdminClient } from '$lib/server/partners/store';
import { runPrecheckinAutosend } from '$lib/server/precheckin-sms';
import { customerLinkOrigin } from '$lib/server/public-origin';

function isAuthorized(request: Request, secret: string): boolean {
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
	return presented.length > 0 && timingSafeEqualText(presented, secret);
}

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const cronSecret = privateEnv.CRON_SECRET;
	if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
	if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
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
