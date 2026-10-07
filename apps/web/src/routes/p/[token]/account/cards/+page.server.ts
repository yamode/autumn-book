import { fail } from '@sveltejs/kit';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess } from '$lib/server/partners/store';
import { inlinePaymentReady, stripePublishableKey, STRIPE_APP, STRIPE_PURPOSE_PARTNER_CARD, StripeError } from '$lib/server/stripe';
import {
  confirmCardSetup,
  detachSavedCard,
  listSavedCards,
  partnerCardBlockers,
  partnerCardUsage,
  resolvePartnerCustomer,
  SavedCardError,
  setDefaultCard
} from '$lib/server/payments/saved-cards';
import { isSetupIntentId } from '$lib/server/payments/verify';
import { PARTNER_CARD_RESULT_TEXT, PARTNER_CARD_SAVE_CONSENT, savedCardTitle, savedCardView, type SavedCardView } from '$lib/saved-cards';

// 取引先専用ページ: アカウント → お支払いカード（保存カード・2026-10-07・docs/saved-cards.md §6.1）。
// 取引先に1つの Stripe Customer にカードを保存し、その取引先の全ユーザー（マスタ・子ユーザー）が予約時に選べる（D2・N2）。
// 登録は cards/api（JSON）、削除・既定は form action。どれもログイン中の取引先の Customer だけを扱う（Customer は partner.id から引く）。
// 確認モード（管理画面の「確認ページを開く」）は一覧も出さない（Stripe を呼ばない・Customer を作らない）。POST は portal.ts が 403。

type CardRow = SavedCardView & { bookings: string[] };

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const preview = session.preview === true;
  const ready = inlinePaymentReady();
  let cards: CardRow[] = [];
  let loadError: string | null = null;
  // 3Dセキュア等でリダイレクトして戻ってきたときの登録の確定（通常はモーダルで済み、ここには来ない）
  let returned: { status: string; message: string } | null = null;
  if (!preview && ready) {
    try {
      const customer = await resolvePartnerCustomer(db, partner, { create: false });
      const si = event.url.searchParams.get('setup_intent') ?? '';
      if (customer && isSetupIntentId(si)) {
        const r = await confirmCardSetup(si, customer, { app: STRIPE_APP, purpose: STRIPE_PURPOSE_PARTNER_CARD, refKey: 'partner_id', refId: partner.id });
        returned = { status: r.status, message: PARTNER_CARD_RESULT_TEXT[r.status] ?? PARTNER_CARD_RESULT_TEXT.unknown };
        if (r.status === 'saved') {
          await logPartnerAccess(db, {
            partnerId: partner.id,
            accountId: session.id,
            channel: 'web',
            action: 'card_profile_saved',
            detail: { pm: r.card.id, label: savedCardTitle(r.card), consentText: PARTNER_CARD_SAVE_CONSENT },
            ip: requestMeta(event).ip
          });
        }
      }
      if (customer) {
        const list = await listSavedCards(customer);
        const usage = await partnerCardUsage(db, partner.id, list.map((c) => c.id));
        cards = list.map((c) => ({ ...savedCardView(c), bookings: usage[c.id] ?? [] }));
      }
    } catch (e) {
      console.error('[partner-cards] 一覧を読めません:', e instanceof Error ? e.message : e);
      loadError = '登録済みのカードを読み込めませんでした。時間をおいて開き直してください。';
    }
  }
  return {
    portal: portalHeader(partner, session),
    preview,
    ready,
    stripeKey: ready && !preview ? stripePublishableKey() : null,
    consentText: PARTNER_CARD_SAVE_CONSENT,
    cards,
    loadError,
    returned
  };
};

function failure(e: unknown) {
  if (e instanceof SavedCardError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.message });
  if (e instanceof StripeError) return fail(502, { message: 'カードを操作できませんでした。時間をおいてお試しください。' });
  throw e;
}

async function scope(event: Parameters<typeof requirePortalSession>[0]) {
  const s = await requirePortalSession(event);
  const fd = await event.request.formData();
  const pm = String(fd.get('pm') ?? '');
  const customer = await resolvePartnerCustomer(s.db, s.partner, { create: false });
  return { ...s, pm, customer };
}

export const actions = {
  // 削除: そのカードでまだ請求していない予約があれば断る（§7.5）
  remove: async (event) => {
    try {
      const { db, partner, session, pm, customer } = await scope(event);
      if (!customer) return fail(404, { message: 'カードが見つかりません。' });
      const blockers = await partnerCardBlockers(db, partner.id, pm);
      if (blockers.length) {
        return fail(409, {
          message: `予約番号 ${blockers.join('・')} のお支払いに使われているため削除できません。先に予約一覧から別のカードを登録し直してください。`
        });
      }
      const card = await detachSavedCard(customer, pm);
      const label = card ? savedCardTitle(card) : pm;
      await logPartnerAccess(db, { partnerId: partner.id, accountId: session.id, channel: 'web', action: 'card_profile_removed', detail: { pm, label }, ip: requestMeta(event).ip });
      return { removed: label };
    } catch (e) {
      return failure(e);
    }
  },
  // 既定にする（予約画面の「保存済み」で先頭に出る）
  set_default: async (event) => {
    try {
      const { db, partner, session, pm, customer } = await scope(event);
      if (!customer) return fail(404, { message: 'カードが見つかりません。' });
      const card = await setDefaultCard(customer, pm);
      const label = card ? savedCardTitle(card) : pm;
      await logPartnerAccess(db, { partnerId: partner.id, accountId: session.id, channel: 'web', action: 'card_profile_default', detail: { pm, label }, ip: requestMeta(event).ip });
      return { defaulted: label };
    } catch (e) {
      return failure(e);
    }
  }
};
