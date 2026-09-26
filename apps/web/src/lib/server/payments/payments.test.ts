// 同じ画面で払う決済（v0.42.0）の純関数のテスト。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { cleanKey, keyMode, publishableKeyIssue } from './keys';
import { buildIntentMetadata, ELEMENTS_FLOW, isElementsIntentFor } from './metadata';
import { routeStripeEvent } from './webhook-route';
import { checkPaymentIntent, checkSetupIntent, isPaymentIntentId, isReusableIntent, isSetupIntentId, toStripeJpy } from './verify';

const APP = 'autumn-rms';
const PURPOSE = 'rms_partner_booking';
const ROUTE_OPTS = { app: APP, purposes: [PURPOSE], checkoutRefKey: 'partner_booking_id' };
const meta = (extra: Record<string, string> = {}) =>
  buildIntentMetadata({ app: APP, purpose: PURPOSE, refs: { partner_booking_id: 'b1', booking_code: 'PB-2026-000010', ...extra } });

describe('鍵の判定', () => {
  it('貼り付けの空白・引用符・見えない文字を取り除く', () => {
    expect(cleanKey(' "pk_test_abc"​ ')).toBe('pk_test_abc');
    expect(cleanKey(undefined)).toBe('');
  });
  it('テスト / 本番を見分ける', () => {
    expect(keyMode('sk_test_x')).toBe('test');
    expect(keyMode('rk_live_x')).toBe('live');
    expect(keyMode('pk_live_x')).toBe('live');
    expect(keyMode('whsec_x')).toBeNull();
  });
  it('公開可能キーの問題', () => {
    expect(publishableKeyIssue('sk_test_a', '')).toBe('missing');
    expect(publishableKeyIssue('sk_test_a', 'sk_test_b')).toBe('not_publishable');
    expect(publishableKeyIssue('sk_live_a', 'pk_test_b')).toBe('mode_mismatch');
    expect(publishableKeyIssue('sk_test_a', 'pk_test_b')).toBeNull();
    expect(publishableKeyIssue('rk_live_a', 'pk_live_b')).toBeNull();
  });
});

describe('Intent の metadata', () => {
  it('app / purpose / flow を必ず付け、refs で上書きさせない', () => {
    const m = buildIntentMetadata({ app: APP, purpose: PURPOSE, refs: { partner_booking_id: 'b1', app: 'evil', flow: 'x', empty: '', none: null } });
    expect(m).toEqual({ partner_booking_id: 'b1', app: APP, purpose: PURPOSE, flow: ELEMENTS_FLOW });
  });
  it('値は500文字・キーは40文字に切る', () => {
    const m = buildIntentMetadata({ app: APP, purpose: PURPOSE, refs: { ['k'.repeat(60)]: 'v'.repeat(600) } });
    const [k] = Object.keys(m);
    expect(k.length).toBe(40);
    expect(m[k].length).toBe(500);
  });
  it('flow・app・purpose がそろった Intent だけを自分のものとみなす', () => {
    expect(isElementsIntentFor(meta(), APP, [PURPOSE])).toBe(true);
    // チェックイン日の自動請求（flow なし・trigger あり）は対象外
    expect(isElementsIntentFor({ app: APP, purpose: PURPOSE, partner_booking_id: 'b1', trigger: 'cron' }, APP, [PURPOSE])).toBe(false);
    expect(isElementsIntentFor({ ...meta(), app: 'autumn-book' }, APP, [PURPOSE])).toBe(false);
    expect(isElementsIntentFor(null, APP, [PURPOSE])).toBe(false);
  });
});

describe('Webhook の振り分け', () => {
  const ev = (type: string, object: Record<string, unknown>) => ({ type, data: { object } });
  it('同じ画面で払う方式の支払完了・カード登録', () => {
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_1', metadata: meta() }), ROUTE_OPTS)).toEqual({ kind: 'payment_intent', id: 'pi_1', purpose: PURPOSE });
    expect(routeStripeEvent(ev('setup_intent.succeeded', { id: 'seti_1', metadata: meta() }), ROUTE_OPTS)).toEqual({ kind: 'setup_intent', id: 'seti_1', purpose: PURPOSE });
  });
  it('チェックイン日の自動請求・旧 Checkout の裏の Intent・他アプリは無視する', () => {
    const offSession = { id: 'pi_2', metadata: { app: APP, purpose: PURPOSE, partner_booking_id: 'b1', trigger: 'cron' } };
    expect(routeStripeEvent(ev('payment_intent.succeeded', offSession), ROUTE_OPTS).kind).toBe('ignore');
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_3', metadata: { app: 'shop', purpose: 'ec', flow: 'elements' } }), ROUTE_OPTS).kind).toBe('ignore');
    expect(routeStripeEvent(ev('payment_intent.payment_failed', { id: 'pi_4', metadata: meta() }), ROUTE_OPTS)).toEqual({ kind: 'ignore', reason: 'payment_intent.payment_failed' });
  });
  it('旧方式（Checkout）の完了は予約 id があり app が自分か未設定のときだけ', () => {
    expect(routeStripeEvent(ev('checkout.session.completed', { id: 'cs_1', metadata: { partner_booking_id: 'b1', app: APP } }), ROUTE_OPTS)).toEqual({ kind: 'checkout_session', id: 'cs_1' });
    expect(routeStripeEvent(ev('checkout.session.completed', { id: 'cs_2', metadata: { partner_booking_id: 'b1' } }), ROUTE_OPTS).kind).toBe('checkout_session');
    expect(routeStripeEvent(ev('checkout.session.completed', { id: 'cs_3', metadata: { partner_booking_id: 'b1', app: 'autumn-book' } }), ROUTE_OPTS).kind).toBe('ignore');
    expect(routeStripeEvent(ev('checkout.session.completed', { id: 'cs_4', metadata: {} }), ROUTE_OPTS).kind).toBe('ignore');
  });
  it('公式サイト予約（app=autumn-book / purpose=book_direct_booking）も同じ宛先で受ける', () => {
    const opts = { ...ROUTE_OPTS, also: [{ app: 'autumn-book', purposes: ['book_direct_booking'] }] };
    const direct = buildIntentMetadata({ app: 'autumn-book', purpose: 'book_direct_booking', refs: { hold_id: 'h1' } });
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_9', metadata: direct }), opts)).toEqual({ kind: 'payment_intent', id: 'pi_9', purpose: 'book_direct_booking' });
    // also が無ければ無視（従来どおり）・取引先予約の判定は変わらない
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_9', metadata: direct }), ROUTE_OPTS).kind).toBe('ignore');
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_1', metadata: meta() }), opts)).toEqual({ kind: 'payment_intent', id: 'pi_1', purpose: PURPOSE });
    // app と purpose の組み合わせが違うものは受けない
    const cross = buildIntentMetadata({ app: 'autumn-book', purpose: PURPOSE, refs: { hold_id: 'h1' } });
    expect(routeStripeEvent(ev('payment_intent.succeeded', { id: 'pi_8', metadata: cross }), opts).kind).toBe('ignore');
  });
  it('返金は台帳で確かめるので常に渡す', () => {
    expect(routeStripeEvent(ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1' }), ROUTE_OPTS).kind).toBe('charge_refunded');
  });
});

describe('Intent の検証', () => {
  const exp = { app: APP, purpose: PURPOSE, refKey: 'partner_booking_id' };
  const pi = (over: Record<string, unknown> = {}) => ({ id: 'pi_1', status: 'succeeded', amount: 32000, amount_received: 32000, currency: 'jpy', metadata: meta(), ...over });
  it('完了・金額一致なら ok', () => {
    expect(checkPaymentIntent(pi(), { ...exp, refId: 'b1', expectedAmount: 32000 })).toEqual({ ok: true, refId: 'b1' });
  });
  it('未完了（3Dセキュア待ち・処理中）は not_succeeded', () => {
    expect(checkPaymentIntent(pi({ status: 'requires_action' }), { ...exp, expectedAmount: 32000 })).toMatchObject({ ok: false, reason: 'not_succeeded', status: 'requires_action' });
  });
  it('別の予約・他用途・金額や通貨の違いを見分ける', () => {
    expect(checkPaymentIntent(pi(), { ...exp, refId: 'b2', expectedAmount: 32000 })).toEqual({ ok: false, reason: 'ref_mismatch' });
    expect(checkPaymentIntent(pi({ metadata: { app: APP, purpose: PURPOSE, partner_booking_id: 'b1' } }), { ...exp, expectedAmount: 32000 })).toEqual({ ok: false, reason: 'not_ours' });
    expect(checkPaymentIntent(pi({ amount_received: 30000 }), { ...exp, expectedAmount: 32000 })).toMatchObject({ reason: 'amount_mismatch', expected: 32000, actual: 30000 });
    expect(checkPaymentIntent(pi({ currency: 'usd' }), { ...exp, expectedAmount: 32000 })).toMatchObject({ reason: 'amount_mismatch' });
  });
  it('カード登録は顧客とカードが付いて succeeded のときだけ', () => {
    const si = { id: 'seti_1', status: 'succeeded', customer: 'cus_1', payment_method: { id: 'pm_1' }, metadata: meta() };
    expect(checkSetupIntent(si, { ...exp, refId: 'b1' })).toEqual({ ok: true, refId: 'b1' });
    expect(checkSetupIntent({ ...si, payment_method: null }, exp)).toMatchObject({ ok: false, reason: 'not_succeeded' });
    expect(checkSetupIntent({ ...si, status: 'requires_payment_method' }, exp)).toMatchObject({ ok: false, reason: 'not_succeeded' });
  });
  it('使い回せる Intent（入力待ち・本人認証待ちで、同じ予約・同じ金額）', () => {
    const e = { ...exp, refId: 'b1', amount: 32000 };
    expect(isReusableIntent({ status: 'requires_payment_method', amount: 32000, metadata: meta() }, e)).toBe(true);
    expect(isReusableIntent({ status: 'succeeded', amount: 32000, metadata: meta() }, e)).toBe(false);
    expect(isReusableIntent({ status: 'canceled', amount: 32000, metadata: meta() }, e)).toBe(false);
    expect(isReusableIntent({ status: 'requires_payment_method', amount: 30000, metadata: meta() }, e)).toBe(false);
    expect(isReusableIntent({ status: 'requires_payment_method', amount: 32000, metadata: meta() }, { ...e, refId: 'b2' })).toBe(false);
  });
  it('金額と id の入口チェック', () => {
    expect(toStripeJpy(32000.4)).toBe(32000);
    expect(() => toStripeJpy(49)).toThrow();
    expect(() => toStripeJpy(Number.NaN)).toThrow();
    expect(isPaymentIntentId('pi_3Abc')).toBe(true);
    expect(isPaymentIntentId('pi_3Abc_secret_x')).toBe(false);
    expect(isSetupIntentId('seti_1Xy')).toBe(true);
    expect(isSetupIntentId('cs_test_1')).toBe(false);
  });
});
