// 取引先の月次請求書（利用明細書＋適格請求書）の自動発行・送信。
// pg_cron が毎月 28〜31 日の 15:00〜15:50 JST（06:00〜06:50 UTC）に10分おき・計6回呼ぶ（pg_net のタイムアウトは 60 秒）。
//
// 月末日（JST）かどうかは issueMonthEndInvoices が判定し、月末日でなければ何もしない。
// Workers の waitUntil は応答後 30 秒で打ち切られるので使わず、同期で処理して結果を返す。
// 1回の呼び出しは時間予算（20 秒）内で処理できる分だけ進め、残りは次の呼び出しで続ける（発行済み・送信済みは飛ばす＝冪等）。
// 1社の処理の途中では止めないので、応答までは最長で約 40 秒（予算 20 秒＋PDF 15 秒＋メール）。
//
//   ?date=YYYY-MM-DD  … 「今日」を上書きする（テスト用。CRON_SECRET で認証済みのリクエストだけ）
//   ?notify=1|0       … 発行元・振込先が未設定のときの通知（発行元設定の通知先・2026-10-09）を出すか。省くと 15:00 台の最初の呼び出し（JST の分が 10 未満）だけ出す
//                       （1日に6回呼ぶので、同じ通知を6通送らないため）
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { issueMonthEndInvoices } from '$lib/server/partners/invoices';
import { partnerAdminClient } from '$lib/server/partners/store';

// 1回の呼び出しの時間予算（これを過ぎたら次の取引先に進まず返す）
const BUDGET_MS = 20_000;

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
  return presented.length > 0 && presented === secret;
}

export const POST: RequestHandler = async ({ request, url }) => {
  const cronSecret = privateEnv.CRON_SECRET;
  if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
  if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
  const db = partnerAdminClient();
  if (!db) throw error(503, 'SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。');

  // ここまで来たら CRON_SECRET で認証済み。テスト用の日付上書きを受け付ける
  const dateParam = url.searchParams.get('date') ?? '';
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) throw error(400, 'date は YYYY-MM-DD で指定してください。');
  const notifyParam = url.searchParams.get('notify');
  // 分は JST でも UTC でも同じ（時差が整数時間）
  const notifyMissingBankAccount = notifyParam === '1' ? true : notifyParam === '0' ? false : new Date().getUTCMinutes() < 10;

  try {
    const result = await issueMonthEndInvoices(db, url.origin, {
      today: dateParam || undefined,
      budgetMs: BUDGET_MS,
      notifyMissingBankAccount
    });
    console.log('[partner-invoices] 結果:', JSON.stringify(result));
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[partner-invoices] 失敗:', message);
    return json({ error: message }, { status: 500 });
  }
};
