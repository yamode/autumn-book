// NTT CPaaS の Webhook: 到達結果（DLR）。results[].messageId で送信記録を更新する
// （DELIVERED→delivered、REJECTED/EXPIRED→failed、UNDELIVERABLE→undeliverable、PENDING は据え置き）。
// docs/pre-checkin.md §18・P4。登録先: NTT CPaaS マイページの「サブスクリプション管理」（SMS の配信レポート）に
//   https://book.yamado.app/api/webhooks/ntt-cpaas/dlr を登録し、セキュリティ設定を BASIC（NTT_CPAAS_WEBHOOK_SECRET と同じ「ユーザー名:パスワード」）にする。
// 認証は Basic（時間一定で比較）。NTT_CPAAS_WEBHOOK_SECRET が未設定なら 503 で受けない。
import type { RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { partnerAdminClient } from '$lib/server/partners/store';
import { handleNttWebhook } from '$lib/server/precheckin-sms';

export const POST: RequestHandler = ({ request }) =>
	handleNttWebhook(request, 'dlr', { svc: partnerAdminClient(), secret: privateEnv.NTT_CPAAS_WEBHOOK_SECRET ?? null });
