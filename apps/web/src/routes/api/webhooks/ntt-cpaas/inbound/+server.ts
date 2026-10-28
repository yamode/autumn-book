// NTT CPaaS の Webhook: お客様からの SMS の返信（双方向 SMS）。results[].from / message / receivedAt / messageId /
// pairedMessageId を保存し、pairedMessageId から送信 → 事前チェックインを引く（引けない返信も保存だけする）。
// 返信は管理画面 /admin/precheckin/[stayId] の「お客様からの返信」に出る。個人情報なので保存は 90 日で消す想定。
// docs/pre-checkin.md §18・P4。登録先: NTT CPaaS マイページの「番号詳細 → SMS のインバウンド構成」に
//   https://book.yamado.app/api/webhooks/ntt-cpaas/inbound を登録し、セキュリティ設定を BASIC（NTT_CPAAS_WEBHOOK_SECRET と同じ値）にする。
// 認証は Basic（時間一定で比較）。NTT_CPAAS_WEBHOOK_SECRET が未設定なら 503 で受けない。
import type { RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { partnerAdminClient } from '$lib/server/partners/store';
import { handleNttWebhook } from '$lib/server/precheckin-sms';

export const POST: RequestHandler = ({ request }) =>
	handleNttWebhook(request, 'inbound', { svc: partnerAdminClient(), secret: privateEnv.NTT_CPAAS_WEBHOOK_SECRET ?? null });
