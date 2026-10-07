// 公式サイト会員のお支払いカード（保存カード・2026-10-07・docs/saved-cards.md §6.2）の入口の共通処理。
// /account/cards（一覧・削除・既定）と /account/cards/api（登録）から使う。
// 使えるのは Supabase の会員ログイン（MEMBER_SUPABASE）・Stripe の鍵がそろっているときだけ。デモ（DATA_SOURCE=demo）では使えない。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { inlinePaymentReady, STRIPE_APP_BOOK, STRIPE_PURPOSE_MEMBER_CARD } from '$lib/server/stripe';
import type { CardOwnerRef } from '$lib/server/payments/saved-cards';

export type MemberCardsState = 'ready' | 'demo' | 'unavailable';

/** この環境で会員のお支払いカードを使えるか */
export function memberCardsState(): MemberCardsState {
  if (DATA_SOURCE !== 'supabase' || !MEMBER_SUPABASE) return 'demo';
  if (!inlinePaymentReady() || !partnerServiceClient()) return 'unavailable';
  return 'ready';
}

/** ログイン中の会員 id（会員でなければ null） */
export const memberUserIdOf = (event: Pick<RequestEvent, 'locals'>): string | null =>
  event.locals.user?.role === 'member' ? event.locals.user.id : null;

/** service_role のクライアント（book.member_payment_profiles を読み書きする） */
export const memberCardDb = (): SupabaseClient | null => partnerServiceClient();

/** 会員のカードの持ち主（SetupIntent・PaymentMethod の metadata） */
export const memberCardOwner = (userId: string): CardOwnerRef => ({
  app: STRIPE_APP_BOOK,
  purpose: STRIPE_PURPOSE_MEMBER_CARD,
  refKey: 'member_user_id',
  refId: userId
});
