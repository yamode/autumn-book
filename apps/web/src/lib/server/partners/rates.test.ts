// 取引先に見せる日付範囲の切り詰め（今日〜何日先・公開終了日・1回31日）のテスト。
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePartnerPricing } from '$lib/partner-pricing';
import { clampPartnerRange, loadPartnerRates, partnerRangeChunks } from './rates';

const partner = { max_days_ahead: 90, valid_until: null };

describe('clampPartnerRange', () => {
  it('過去は今日から、先は max_days_ahead まで・1回31日に収める', () => {
    expect(clampPartnerRange(partner, '2026-09-01', '2026-09-30', '2026-09-26')).toEqual({
      from: '2026-09-26',
      to: '2026-09-30',
      earliest: '2026-09-26',
      latest: '2026-12-25'
    });
    expect(clampPartnerRange(partner, '2026-10-01', '2026-12-31', '2026-09-26')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(clampPartnerRange(partner, '2026-12-20', '2027-01-31', '2026-09-26')).toMatchObject({ from: '2026-12-20', to: '2026-12-25' });
  });

  it('公開終了日で切る・範囲外は null', () => {
    expect(clampPartnerRange({ ...partner, valid_until: '2026-10-10' }, '2026-10-01', '2026-10-31', '2026-09-26')).toMatchObject({ to: '2026-10-10' });
    expect(clampPartnerRange(partner, '2027-01-01', '2027-01-31', '2026-09-26')).toBeNull();
    expect(clampPartnerRange(partner, '2026-08-01', '2026-08-31', '2026-09-26')).toBeNull();
  });
});

describe('partnerRangeChunks', () => {
  it('公開範囲を31日ずつに切れ目なく分ける', () => {
    const chunks = partnerRangeChunks(partner, '2026-09-26');
    expect(chunks[0]).toEqual({ from: '2026-09-26', to: '2026-10-26' });
    expect(chunks[1]).toEqual({ from: '2026-10-27', to: '2026-11-26' });
    expect(chunks[chunks.length - 1].to).toBe('2026-12-25');
    expect(chunks).toHaveLength(3);
  });

  it('公開終了日で止める・終了済みは空', () => {
    expect(partnerRangeChunks({ ...partner, valid_until: '2026-10-05' }, '2026-09-26')).toEqual([{ from: '2026-09-26', to: '2026-10-05' }]);
    expect(partnerRangeChunks({ ...partner, valid_until: '2026-09-01' }, '2026-09-26')).toEqual([]);
  });
});

// 先計算（2026-10-09・docs/partner-rank-rates.md §7）: 保存済みの最終料金を読み、無ければ従来の経路に切り替える
describe('loadPartnerRates（保存済みの最終料金と従来の経路）', () => {
  const FAC = '10000000-0000-0000-0000-000000000001';
  const pricing = normalizePartnerPricing({ rules: [{ planGroupCodes: ['a001'], action: 'adjust', adjustType: 'percent', value: -50 }] });
  const partner = (id: string) => ({ id, facility_id: FAC, pricing, show_inventory: true, include_advance: false, max_days_ahead: 730 });
  const option = { planGroupCode: 'a001', planLabel: '素泊', roomCode: '101', mealType: '素泊' };
  const rooms = [{ roomCode: '101', name: '和室' }];
  const inventory = { '2026-11-01': { isClosed: false, remainingRoomCount: 3, byRoomType: [{ remaining: 3, roomCode: '101' }] } };
  // rpc の呼び出しを記録する偽の DB（from は使わない）
  const fakeDb = (answers: Record<string, { data?: unknown; error?: { message: string } | null }>) => {
    const calls: string[] = [];
    const db = {
      rpc: async (name: string) => {
        calls.push(name);
        const a = answers[name] ?? { data: null };
        return { data: a.data ?? null, error: a.error ?? null };
      }
    } as unknown as SupabaseClient;
    return { db, calls };
  };
  const range = (d: string) => ({ from: d, to: d });
  const live = {
    data: { rooms, inventory, priceSource: 'standard', days: [{ date: '2026-11-01', options: [{ ...option, pricesByGuest: { 2: 20_000 } }] }] }
  };

  it('ready=true なら最終料金をそのまま使い、ルールは当てない（precomputed）', async () => {
    const { db, calls } = fakeDb({
      rms_partner_portal_prices: {
        data: {
          ready: true,
          rooms,
          inventory,
          priceSource: 'partner_rank',
          computedAt: '2026-10-09T10:00:00Z',
          computedTo: '2027-10-09',
          days: [{ date: '2026-11-01', options: [{ ...option, pricesByGuest: { 2: 18_000 }, basePricesByGuest: { 2: 20_000 } }] }]
        }
      }
    });
    const r = await loadPartnerRates(db, partner('p-pre'), range('2026-11-01'), { includeBase: true });
    expect(calls).toEqual(['rms_partner_portal_prices']);
    expect(r.priceMode).toBe('precomputed');
    expect(r.priceSource).toBe('partner_rank');
    expect(r.computedAt).toBe('2026-10-09T10:00:00Z');
    expect(r.days[0].rooms[0].plans[0].pricesPerPerson).toEqual({ '2': 18_000 });
    expect(r.days[0].rooms[0].plans[0].basePricesPerPerson).toEqual({ '2': 20_000 });
    expect(r.days[0].remainingRooms).toBe(3);
  });

  it('保存済みの料金のキャッシュは特別レートが変わると読み直す（同じなら使い回す）', async () => {
    const pre = { ready: true, rooms, inventory, priceSource: 'standard', computedTo: '2099-12-31', days: [] };
    const { db, calls } = fakeDb({ rms_partner_portal_prices: { data: pre } });
    await loadPartnerRates(db, partner('p-key'), range('2026-11-03'));
    await loadPartnerRates(db, partner('p-key'), range('2026-11-03'));
    expect(calls).toHaveLength(1);
    const changed = normalizePartnerPricing({ rules: [{ planGroupCodes: ['a001'], action: 'adjust', adjustType: 'percent', value: -10 }] });
    await loadPartnerRates(db, { ...partner('p-key'), pricing: changed }, range('2026-11-03'));
    expect(calls).toHaveLength(2);
  });

  it('ready=false なら従来の経路（TS のルールを当てる・live）', async () => {
    const { db, calls } = fakeDb({ rms_partner_portal_prices: { data: { ready: false } }, rms_partner_portal_source: live });
    const r = await loadPartnerRates(db, partner('p-notready'), range('2026-11-01'));
    expect(calls).toEqual(['rms_partner_portal_prices', 'rms_partner_portal_source']);
    expect(r.priceMode).toBe('live');
    expect(r.computedAt).toBeNull();
    expect(r.days[0].rooms[0].plans[0].pricesPerPerson).toEqual({ '2': 10_000 });
  });

  it('保存済みの料金の RPC が失敗しても、従来の経路で出す', async () => {
    const { db } = fakeDb({ rms_partner_portal_prices: { error: { message: 'boom' } }, rms_partner_portal_source: live });
    const r = await loadPartnerRates(db, partner('p-error'), range('2026-11-02'));
    expect(r.priceMode).toBe('live');
  });

  it('計算済みの先端が公開範囲の最終日に届いていなければ、従来の経路で出す', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const pre = { ready: true, rooms, inventory: {}, priceSource: 'standard', computedTo: plus(9), days: [] };
    const short = fakeDb({ rms_partner_portal_prices: { data: pre }, rms_partner_portal_source: live });
    const r1 = await loadPartnerRates(short.db, { ...partner('p-edge'), max_days_ahead: 10 }, { from: plus(10), to: plus(10) });
    expect(r1.priceMode).toBe('live');
    // 公開範囲の先端まで計算済みなら、その先を求められても保存済みの料金（売らない日）で出す
    const done = fakeDb({ rms_partner_portal_prices: { data: { ...pre, computedTo: plus(10) } } });
    const r2 = await loadPartnerRates(done.db, { ...partner('p-edge2'), max_days_ahead: 10 }, { from: plus(10), to: plus(11) });
    expect(r2.priceMode).toBe('precomputed');
  });
});
