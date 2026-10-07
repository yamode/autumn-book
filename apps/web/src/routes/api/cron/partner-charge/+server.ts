// 取引先予約「オンライン決済（チェックイン日）」の請求（pg_cron が 08:05〜20:05 JST に毎時起動・autumn-shared 20260926082024）。
//
// チェックイン日を迎えた「請求予定（scheduled）」の予約に、登録カードで請求する（$lib/server/partners/booking の chargeDueBookings）。
// 請求失敗の予約は自動では再請求しない（取引先のカード登録し直し・スタッフの再請求で行う）。
// Stripe の呼び出しが続くので waitUntil に逃がして即202（pg_net 5秒タイムアウト回避）。?wait=1 なら結果を待って返す（手動確認用）。
//
// 2026-10-07: 取引先予約の添付ファイルの掃除（古い仮置き・PMS へ送らずに終わった予約の添付）と、画面が PMS へ知らせ損ねた
// 変更の知らせ直しを相乗りさせた（maintainBookingAttachments・docs/partner-booking-attachments.md §7.5）。
// Stripe が未設定の環境でも掃除は行う。
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { chargeDueBookings, onlinePaymentReady } from '$lib/server/partners/booking';
import { maintainBookingAttachments } from '$lib/server/partners/booking-attachments';
import { partnerAdminClient } from '$lib/server/partners/store';

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
  return presented.length > 0 && presented === secret;
}

export const POST: RequestHandler = async ({ request, url, platform }) => {
  const cronSecret = privateEnv.CRON_SECRET;
  if (!cronSecret) throw error(503, 'CRON_SECRET が未設定です。');
  if (!isAuthorized(request, cronSecret)) throw error(401, 'Unauthorized');
  const db = partnerAdminClient();
  if (!db) throw error(503, 'SUPABASE_SERVICE_ROLE_KEY / URL が未設定です。');

  const run = async () => {
    const charge = onlinePaymentReady() ? await chargeDueBookings(db, url.origin) : { skipped: 'Stripe が設定されていません' };
    // 添付の掃除は請求とは独立（失敗しても請求の結果は返す）
    const attachments = await maintainBookingAttachments(db).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return { ...charge, attachments };
  };
  if (url.searchParams.get('wait') === '1' || !platform?.context?.waitUntil) return json(await run());
  platform.context.waitUntil(
    run().catch((e) => {
      console.error('[partner-charge] 失敗:', e instanceof Error ? e.message : e);
    })
  );
  return json({ accepted: true }, { status: 202 });
};
