// 保存カード（マイページのカード登録・2026-10-07・docs/saved-cards.md §7.1）の共通処理。
//
// - Customer の単位: 取引先は取引先に1つ（当面は public.rms_partners.stripe_customer_id・現状は施設ごとの行。統合後は取引先で1つ）、
//   公式サイト会員は会員ごと（book.member_payment_profiles）。どちらも最初のカード登録時に作る
// - テスト／本番のキーを切り替えた後は、保存している Customer（別世界の id）を無いものとして作り直す（stripe_livemode）
// - 登録: SetupIntent（Customer 付き・usage=off_session）→ ブラウザで confirmSetup（allow_redisplay='always'）→ confirmCardSetup で
//   Intent を取り直して「自分の Customer の・完了した」登録かを確かめ、期限切れ・二重登録を弾き、PaymentMethod の metadata に同意を残す
// - 予約画面: CustomerSession を渡すと Payment Element の「保存済み」にカードが並ぶ（Intent には同じ Customer を付ける）
// - 削除・既定: PaymentMethod を取り直し、自分の Customer のものか確かめてから操作する（他の Customer の id を送られても 403）
//
// DB の列（20261007022727 / 20261007022730）が未適用の環境では、読み取りは「Customer なし」として従来どおり動く
// （予約画面に保存カードが出ないだけ）。登録しようとしたときだけ「現在ご利用いただけません」で止める。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createCustomer,
  createCustomerSession,
  createSetupIntent,
  detachPaymentMethod,
  isStripeIdempotencyError,
  isStripeResourceMissing,
  listPaymentMethods,
  retrieveCustomer,
  retrievePaymentMethod,
  retrieveSetupIntent,
  StripeError,
  stripeTestMode,
  updateCustomer,
  updatePaymentMethod,
  type StripePaymentMethod
} from '$lib/server/stripe';
import { buildIntentMetadata } from './metadata';
import { checkSetupIntent, idOf } from './verify';
import {
  bookingBlocksCardRemoval,
  cardExpiredOn,
  duplicateCardOf,
  SAVED_CARD_CONSENT_VERSION,
  SAVED_CARD_REDISPLAY_LIMIT,
  savedCardOf,
  savedCardsOf,
  savedCardView,
  shortHash,
  type SavedCard,
  type SavedCardView
} from '$lib/saved-cards';

export class SavedCardError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

type AnySchema = { schema: (s: string) => SupabaseClient };
const bookDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('book');

const UNAVAILABLE = '現在ご利用いただけません。時間をおいてお試しください。';
const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
// 今のキーのモード（本番 = true）
const liveNow = () => !stripeTestMode();

// 保存している Customer が使えるか（Stripe に残っていて削除されていない）。作る経路（登録）でだけ確かめる
async function customerAlive(id: string): Promise<boolean> {
  try {
    const c = await retrieveCustomer(id);
    return !c.deleted;
  } catch (e) {
    if ((e instanceof StripeError && e.status === 404) || isStripeResourceMissing(e)) return false;
    throw e;
  }
}

/**
 * Customer を作る。冪等キーには名前・メールのハッシュを混ぜる（変わった再送が同じキーの別パラメータにならないように）。
 * それでも冪等キーの衝突（idempotency_error）になったら、同時に作った別の要求が台帳に書いた id を読み直して使う。
 * 読み直しても無ければ、キーを変えて作る（Customer が1つ余分にできても害は無い）。
 */
async function createOwnedCustomer(
  args: { name: string; email: string | null; metadata: Record<string, string>; keyBase: string },
  reread: () => Promise<string | null>
): Promise<string> {
  const key = `${args.keyBase}-${shortHash(`${args.name}|${args.email ?? ''}`)}`;
  try {
    return (await createCustomer({ name: args.name, email: args.email, metadata: args.metadata, idempotencyKey: key })).id;
  } catch (e) {
    if (!isStripeIdempotencyError(e)) throw e;
    const again = await reread();
    if (again) return again;
    console.warn('[saved-cards] Customer 作成の冪等キーが衝突したため、キーを変えて作り直します:', args.keyBase);
    return (await createCustomer({ name: args.name, email: args.email, metadata: args.metadata, idempotencyKey: `${key}-${Date.now()}` })).id;
  }
}

// ---------------------------------------------------------------------------
// Customer の解決（取引先・会員）
// ---------------------------------------------------------------------------

export type PartnerCustomerOwner = {
  id: string;
  name: string;
  contact_email: string | null;
  // 参考情報として metadata に入れるだけ（Customer は施設に依存させない）
  facility_slug?: string | null;
};

/**
 * 取引先共有の Customer。create=false なら読むだけ（無ければ null）。create=true なら無ければ作って rms_partners に書く。
 * name は取引先名、email は取引先の連絡先（N11）。
 * ⚠ 取引先は将来 Book 内で1つに統合され、施設はオン/オフの設定になる（2026-10-07 ユーザー決定）。Customer は「取引先に1つ」で、
 *   名前・冪等キー・文言で施設を前提にしない。今は rms_partners の行（現状は施設ごとの行）ごとに持つ（N1）。
 */
export async function resolvePartnerCustomer(db: SupabaseClient, partner: PartnerCustomerOwner, opts: { create: boolean }): Promise<string | null> {
  const { data, error } = await db.from('rms_partners').select('stripe_customer_id, stripe_livemode').eq('id', partner.id).maybeSingle();
  if (error) {
    // 列が未適用など。読むだけなら「Customer なし」で従来どおり動かす
    if (!opts.create) return null;
    console.error('[saved-cards] 取引先の Customer を読めません:', error.message);
    throw new SavedCardError(UNAVAILABLE, 503);
  }
  const stored = data?.stripe_customer_id ? String(data.stripe_customer_id) : null;
  const sameMode = data?.stripe_livemode === liveNow();
  if (stored && sameMode && (!opts.create || (await customerAlive(stored)))) return stored;
  if (!opts.create) return null;
  const mode = liveNow() ? 'live' : 'test';
  const created = {
    id: await createOwnedCustomer(
      {
        name: partner.name,
        email: partner.contact_email,
        metadata: { app: 'autumn-rms', purpose: 'rms_partner_card', partner_id: partner.id, ...(partner.facility_slug ? { facility: partner.facility_slug } : {}) },
        // 同じ取引先の2人が同時に初めて登録しても Customer が1つになるよう、取引先とモードから作る（24時間有効）。
        // 作り直し（Stripe 側で消された等）のときは前の id も混ぜて別のキーにする
        keyBase: `rms-partner-shared-customer-${partner.id}-${mode}${stored ? `-${stored}` : ''}`
      },
      async () => {
        const { data: again } = await db.from('rms_partners').select('stripe_customer_id, stripe_livemode').eq('id', partner.id).maybeSingle();
        return again?.stripe_customer_id && again.stripe_customer_id !== stored && again.stripe_livemode === liveNow() ? String(again.stripe_customer_id) : null;
      }
    )
  };
  const { error: upErr } = await db
    .from('rms_partners')
    .update({ stripe_customer_id: created.id, stripe_livemode: liveNow(), stripe_customer_created_at: new Date().toISOString() })
    .eq('id', partner.id);
  if (upErr) {
    console.error('[saved-cards] 取引先の Customer を保存できません:', upErr.message);
    throw new SavedCardError(UNAVAILABLE, 503);
  }
  return created.id;
}

export type MemberCustomerOwner = { userId: string; name: string | null; email: string | null };

/** 会員の Customer。create=false なら読むだけ。create=true なら無ければ作って book.member_payment_profiles に upsert する。 */
export async function resolveMemberCustomer(db: SupabaseClient, member: MemberCustomerOwner, opts: { create: boolean }): Promise<string | null> {
  const { data, error } = await bookDb(db)
    .from('member_payment_profiles')
    .select('stripe_customer_id, stripe_livemode')
    .eq('user_id', member.userId)
    .maybeSingle();
  if (error) {
    if (!opts.create) return null;
    console.error('[saved-cards] 会員の Customer を読めません:', error.message);
    throw new SavedCardError(UNAVAILABLE, 503);
  }
  const stored = data?.stripe_customer_id ? String(data.stripe_customer_id) : null;
  const sameMode = data?.stripe_livemode === liveNow();
  if (stored && sameMode && (!opts.create || (await customerAlive(stored)))) return stored;
  if (!opts.create) return null;
  // tenant_id は会員の行から（行の作成は book.register_member だけ。無ければ会員ではない）
  const { data: m } = await bookDb(db).from('members').select('tenant_id').eq('user_id', member.userId).maybeSingle();
  if (!m?.tenant_id) throw new SavedCardError('会員の情報を確認できませんでした。', 403);
  const mode = liveNow() ? 'live' : 'test';
  const created = {
    id: await createOwnedCustomer(
      {
        name: member.name || '会員',
        email: member.email,
        metadata: { app: 'autumn-book', purpose: 'book_member_card', member_user_id: member.userId },
        keyBase: `book-member-customer-${member.userId}-${mode}${stored ? `-${stored}` : ''}`
      },
      async () => {
        const { data: again } = await bookDb(db).from('member_payment_profiles').select('stripe_customer_id, stripe_livemode').eq('user_id', member.userId).maybeSingle();
        return again?.stripe_customer_id && again.stripe_customer_id !== stored && again.stripe_livemode === liveNow() ? String(again.stripe_customer_id) : null;
      }
    )
  };
  const { error: upErr } = await bookDb(db)
    .from('member_payment_profiles')
    .upsert(
      { user_id: member.userId, tenant_id: String(m.tenant_id), stripe_customer_id: created.id, stripe_livemode: liveNow() },
      { onConflict: 'user_id' }
    );
  if (upErr) {
    console.error('[saved-cards] 会員の Customer を保存できません:', upErr.message);
    throw new SavedCardError(UNAVAILABLE, 503);
  }
  return created.id;
}

// ---------------------------------------------------------------------------
// 一覧・CustomerSession
// ---------------------------------------------------------------------------

/** Customer の保存カード（マイページで保存したものだけ・既定 → 新しい順）。Customer が消えていれば空 */
export async function listSavedCards(customer: string): Promise<SavedCard[]> {
  try {
    const [c, list] = await Promise.all([retrieveCustomer(customer), listPaymentMethods(customer)]);
    if (c.deleted) return [];
    return savedCardsOf(list.data, idOf(c.invoice_settings?.default_payment_method ?? null));
  } catch (e) {
    // Customer が Stripe 側で消えていた（No such customer）→ 保存カード無し
    if ((e instanceof StripeError && e.status === 404) || isStripeResourceMissing(e)) {
      console.warn('[saved-cards] Customer が Stripe に見つかりません（保存カード無しとして扱う）:', customer);
      return [];
    }
    throw e;
  }
}

/** 予約画面の Payment Element に保存カードを出すための CustomerSession（30 分で失効）。保存のチェックボックス・削除は出さない */
export async function createSavedCardSession(customer: string): Promise<{ clientSecret: string; expiresAt: number }> {
  const s = await createCustomerSession({ customer, save: false, redisplayLimit: SAVED_CARD_REDISPLAY_LIMIT });
  return { clientSecret: s.client_secret, expiresAt: s.expires_at };
}

// ---------------------------------------------------------------------------
// 登録（SetupIntent）
// ---------------------------------------------------------------------------

export type CardOwnerRef = {
  app: string;
  purpose: string;
  // metadata のどのキーに持ち主（取引先 id・会員 id）を入れるか
  refKey: 'partner_id' | 'member_user_id';
  refId: string;
};

/** マイページの「カードを追加する」: Customer 付きの SetupIntent を作る（毎回新しく作る・N8） */
export async function prepareCardSetup(args: {
  customer: string;
  owner: CardOwnerRef;
  description: string;
  refs?: Record<string, string | null | undefined>;
}): Promise<{ intentId: string; clientSecret: string }> {
  const si = await createSetupIntent({
    customer: args.customer,
    description: args.description,
    metadata: buildIntentMetadata({ app: args.owner.app, purpose: args.owner.purpose, refs: { [args.owner.refKey]: args.owner.refId, ...(args.refs ?? {}) } })
  });
  if (!si.client_secret) throw new SavedCardError('カード登録の準備ができませんでした。', 502);
  return { intentId: si.id, clientSecret: si.client_secret };
}

export type CardSetupResult =
  | { status: 'saved'; card: SavedCardView }
  // 同じカードが既に保存されていた（新しく付いた方は外した）
  | { status: 'duplicate'; card: SavedCardView | null }
  // 有効期限が切れているカード（外した）
  | { status: 'expired' }
  // まだ登録が終わっていない（3Dセキュアの途中など）
  | { status: 'unpaid' }
  // 自分の登録ではない（別の取引先・会員の Intent）
  | { status: 'unknown' };

/**
 * ブラウザで confirmSetup が済んだ連絡。SetupIntent を取り直し、自分の Customer・用途の完了した登録かを確かめ、
 * 期限切れ・二重登録を弾いてから、カードに保存の同意（allow_redisplay='always'・metadata）を残す。何度呼んでも同じ結果。
 */
export async function confirmCardSetup(intentId: string, customer: string, owner: CardOwnerRef): Promise<CardSetupResult> {
  const si = await retrieveSetupIntent(intentId, true);
  const check = checkSetupIntent(si, { app: owner.app, purpose: owner.purpose, refKey: owner.refKey, refId: owner.refId, customer });
  if (!check.ok) return check.reason === 'not_succeeded' ? { status: 'unpaid' } : { status: 'unknown' };
  const pm = (si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : await retrievePaymentMethod(idOf(si.payment_method)!)) as StripePaymentMethod;
  const fingerprint = pm.card?.fingerprint ?? null;
  // 2回目の連絡（既に外した後）: 同じカードが一覧にあれば二重登録として扱う
  if (idOf(pm.customer ?? null) !== customer) {
    const cards = await listSavedCards(customer);
    const same = fingerprint ? cards.find((c) => c.fingerprint === fingerprint) : null;
    return same ? { status: 'duplicate', card: savedCardView(same) } : { status: 'expired' };
  }
  if (cardExpiredOn(pm.card, todayJst())) {
    await detachPaymentMethod(pm.id).catch(() => undefined);
    return { status: 'expired' };
  }
  const cards = await listSavedCards(customer);
  const dup = duplicateCardOf(cards, { id: pm.id, fingerprint });
  if (dup) {
    // 新しく付いた方を外す（一覧に同じカードが2枚並ばないように・N5）
    await detachPaymentMethod(pm.id).catch(() => undefined);
    const kept = cards.find((c) => c.id === dup) ?? null;
    return { status: 'duplicate', card: kept ? savedCardView(kept) : null };
  }
  const updated = await updatePaymentMethod(pm.id, {
    allowRedisplay: 'always',
    metadata: {
      app: owner.app,
      purpose: owner.purpose,
      [owner.refKey]: owner.refId,
      consent_at: new Date().toISOString(),
      consent_version: SAVED_CARD_CONSENT_VERSION
    }
  });
  // 最初の1枚は既定にする（Payment Element の「保存済み」で先頭に出る）
  const noDefault = !cards.some((c) => c.isDefault);
  if (noDefault) await updateCustomer(customer, { defaultPaymentMethod: pm.id }).catch(() => undefined);
  const card = savedCardOf({ ...updated, card: updated.card ?? pm.card, created: updated.created ?? pm.created }, noDefault ? pm.id : null);
  if (!card) return { status: 'unknown' };
  return { status: 'saved', card: savedCardView(card) };
}

// ---------------------------------------------------------------------------
// 削除・既定
// ---------------------------------------------------------------------------

const PM_ID = /^pm_[A-Za-z0-9]+$/;

// 自分の Customer の保存カードか（他の Customer の id を送られても操作しない）
async function ownCard(customer: string, pmId: string): Promise<StripePaymentMethod> {
  if (!PM_ID.test(pmId)) throw new SavedCardError('カードの指定が正しくありません。', 400);
  let pm: StripePaymentMethod;
  try {
    pm = await retrievePaymentMethod(pmId);
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) throw new SavedCardError('カードが見つかりません。', 404);
    throw e;
  }
  if (idOf(pm.customer ?? null) !== customer || pm.allow_redisplay !== 'always') throw new SavedCardError('このカードは操作できません。', 403);
  return pm;
}

/** 保存カードを外す（削除）。取引先は呼び出し前に partnerCardBlockers で未請求の予約が無いことを確かめる */
export async function detachSavedCard(customer: string, pmId: string): Promise<SavedCardView | null> {
  const pm = await ownCard(customer, pmId);
  await detachPaymentMethod(pm.id);
  const c = savedCardOf(pm, null);
  return c ? savedCardView(c) : null;
}

/** 既定のカードにする */
export async function setDefaultCard(customer: string, pmId: string): Promise<SavedCardView | null> {
  const pm = await ownCard(customer, pmId);
  await updateCustomer(customer, { defaultPaymentMethod: pm.id });
  const c = savedCardOf(pm, pm.id);
  return c ? savedCardView(c) : null;
}

// ---------------------------------------------------------------------------
// 取引先: 保存カードを使っている未請求の予約（削除ガード・§7.5）
// ---------------------------------------------------------------------------

/** カード（PaymentMethod id）ごとの、削除を止める予約番号。読めなければ空（削除時は partnerCardBlockers が改めて確かめる） */
export async function partnerCardUsage(db: SupabaseClient, partnerId: string, pmIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!pmIds.length) return out;
  const { data, error } = await db
    .from('rms_partner_bookings')
    .select('booking_code, stripe_payment_method_id, status, payment_status, cancel_fee_settlement, cancel_fee_status, cancelled_at')
    .eq('partner_id', partnerId)
    .in('stripe_payment_method_id', pmIds);
  if (error) throw new SavedCardError(UNAVAILABLE, 503);
  for (const r of data ?? []) {
    if (!bookingBlocksCardRemoval(r)) continue;
    const pm = String(r.stripe_payment_method_id);
    (out[pm] ??= []).push(String(r.booking_code));
  }
  return out;
}

/** このカードの削除を止める予約番号（無ければ空） */
export async function partnerCardBlockers(db: SupabaseClient, partnerId: string, pmId: string): Promise<string[]> {
  return (await partnerCardUsage(db, partnerId, [pmId]))[pmId] ?? [];
}

/** 管理画面の取引先詳細に出す保存カードの枚数と最終登録日時（読むだけ・N10）。Customer が無ければ 0 枚 */
export async function partnerSavedCardSummary(db: SupabaseClient, partner: PartnerCustomerOwner): Promise<{ count: number; lastAt: string | null }> {
  const customer = await resolvePartnerCustomer(db, partner, { create: false });
  if (!customer) return { count: 0, lastAt: null };
  const cards = await listSavedCards(customer);
  const lastAt = cards.reduce<string | null>((max, c) => (c.created && (!max || c.created > max) ? c.created : max), null);
  return { count: cards.length, lastAt };
}
