// 取引先ページ「お支払いカード」の登録 API（保存カード・2026-10-07・docs/saved-cards.md §6.1・§7.7）。POST JSON { action, ... }
//   prepare … 取引先共有の Customer（無ければ作る）に SetupIntent を作る（毎回新しく・N8）→ { clientSecret, returnUrl }
//   confirm … ブラウザで confirmSetup が済んだ連絡 { intentId } → SetupIntent を取り直して確かめ、期限切れ・二重登録を弾いて保存
//             → { result: { status, card? }, message }
// 確認モードは portal.ts（requirePortalApi）が 403。Webhook の setup_intent.succeeded は purpose が違うので無視される（ここだけで確定する）。
import { error, json } from '@sveltejs/kit';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { logPartnerAccess } from '$lib/server/partners/store';
import { inlinePaymentReady, STRIPE_APP, STRIPE_PURPOSE_PARTNER_CARD, StripeError } from '$lib/server/stripe';
import { confirmCardSetup, prepareCardSetup, resolvePartnerCustomer, SavedCardError } from '$lib/server/payments/saved-cards';
import { isSetupIntentId } from '$lib/server/payments/verify';
import { PARTNER_CARD_RESULT_TEXT, PARTNER_CARD_SAVE_CONSENT, savedCardTitle } from '$lib/saved-cards';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event);
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const reply = (data: unknown, status = 200) => json(data, { status, headers: PORTAL_HEADERS });
  const owner = { app: STRIPE_APP, purpose: STRIPE_PURPOSE_PARTNER_CARD, refKey: 'partner_id' as const, refId: partner.id };
  try {
    if (!inlinePaymentReady()) return reply({ ok: false, message: '現在ご利用いただけません。' }, 503);
    if (action === 'prepare') {
      const customer = await resolvePartnerCustomer(db, partner, { create: true });
      const si = await prepareCardSetup({
        customer: customer!,
        owner,
        description: `${partner.name} お支払いカードの登録（予約時に選べるカードとして保存）`,
        // 施設は参考情報（取引先は将来施設に依存しなくなる）
        refs: { account_id: session.id, facility: partner.facility_slug }
      });
      return reply({ ok: true, clientSecret: si.clientSecret, returnUrl: `${event.url.origin}/p/${event.params.token}/account/cards` });
    }
    if (action === 'confirm') {
      const intentId = String(body.intentId ?? '');
      if (!isSetupIntentId(intentId)) throw error(400, '登録の指定が正しくありません。');
      const customer = await resolvePartnerCustomer(db, partner, { create: false });
      if (!customer) return reply({ ok: true, result: { status: 'unknown' }, message: PARTNER_CARD_RESULT_TEXT.unknown });
      const result = await confirmCardSetup(intentId, customer, owner);
      if (result.status === 'saved') {
        await logPartnerAccess(db, {
          partnerId: partner.id,
          accountId: session.id,
          channel: 'web',
          action: 'card_profile_saved',
          detail: { pm: result.card.id, label: savedCardTitle(result.card), consentText: PARTNER_CARD_SAVE_CONSENT },
          ip: requestMeta(event).ip
        });
      }
      return reply({ ok: true, result, message: PARTNER_CARD_RESULT_TEXT[result.status] ?? PARTNER_CARD_RESULT_TEXT.unknown });
    }
    throw error(400, '不明な操作です。');
  } catch (e) {
    if (e instanceof SavedCardError) return reply({ ok: false, message: e.message }, e.status);
    if (e instanceof StripeError) return reply({ ok: false, message: 'カード登録の準備ができませんでした。時間をおいてお試しください。' }, 502);
    throw e;
  }
};
