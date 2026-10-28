// 取引先予約の複数部屋タイプ（P2）: 全体取消のあとの部屋ごとの行と、メールの「お部屋」の行。
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingSummaryLines, markBookingRoomsCancelled, type PartnerBookingRow } from './booking';

// update(...).eq(...).eq(...) を記録するだけの見せかけの db
function fakeDb(error: { message: string } | null = null) {
  const calls: { table: string; values: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const db = {
    from(table: string) {
      return {
        update(values: Record<string, unknown>) {
          const call = { table, values, filters: [] as [string, unknown][] };
          calls.push(call);
          const chain = {
            eq(col: string, v: unknown) {
              call.filters.push([col, v]);
              return chain;
            },
            then(resolve: (r: { error: typeof error }) => void) {
              resolve({ error });
            }
          };
          return chain;
        }
      };
    }
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('markBookingRoomsCancelled', () => {
  it('同じ予約の confirmed の部屋の行を、予約本体の取消日時で cancelled にする', async () => {
    const { db, calls } = fakeDb();
    await markBookingRoomsCancelled(db, 'pb-1', '2027-01-12T03:00:00.000Z');
    expect(calls).toEqual([
      {
        table: 'rms_partner_booking_rooms',
        values: { status: 'cancelled', cancelled_at: '2027-01-12T03:00:00.000Z' },
        filters: [
          ['partner_booking_id', 'pb-1'],
          ['status', 'confirmed']
        ]
      }
    ]);
  });
  it('取消日時が無ければ今の日時。失敗しても例外にしない', async () => {
    const { db, calls } = fakeDb({ message: 'boom' });
    await expect(markBookingRoomsCancelled(db, 'pb-2', null)).resolves.toBeUndefined();
    expect(typeof calls[0].values.cancelled_at).toBe('string');
  });
});

describe('bookingSummaryLines（複数部屋タイプ）', () => {
  const row = (rooms: NonNullable<PartnerBookingRow['detail']['rooms']>): PartnerBookingRow =>
    ({
      id: 'pb-1',
      facility_id: 'f',
      partner_id: 'p',
      partner_name: '取引先',
      booking_code: 'PB-2026-000012',
      status: 'confirmed',
      stay_ids: [],
      room_code: 'm',
      room_name: 'メゾネット',
      plan_code: 'a000',
      plan_name: '基本■2食',
      meal_type: '2食',
      check_in_date: '2027-03-01',
      check_out_date: '2027-03-02',
      nights: 1,
      room_count: rooms.length,
      adult_total: rooms.reduce((s, r) => s + r.adults, 0),
      guest_name: '山田 太郎',
      guest_kana: null,
      guest_phone: '0197-00-0000',
      guest_email: null,
      total_amount: 100000,
      bath_tax_amount: 0,
      prepay_discount_amount: 0,
      payment_method_name: null,
      payment_status: 'none',
      detail: { rooms }
    }) as unknown as PartnerBookingRow;

  it('お部屋は部屋タイプ別の室数、人数は「N室目（部屋タイプ）」', () => {
    const lines = bookingSummaryLines(
      row([
        { adults: 2, room_code: 'm', room_name: 'メゾネット', nights: [] },
        { adults: 3, room_code: 'h1', room_name: 'ハリウッドツイン麓花坊', nights: [] },
        { adults: 2, room_code: 'm', room_name: 'メゾネット', nights: [] }
      ])
    );
    expect(lines).toContain('お部屋: メゾネット × 2室／ハリウッドツイン麓花坊 × 1室');
    expect(lines).toContain('人数: 1室目（メゾネット） 2名 / 2室目（ハリウッドツイン麓花坊） 3名 / 3室目（メゾネット） 2名');
  });
  it('1つの部屋タイプの予約は従来どおり', () => {
    const lines = bookingSummaryLines(row([{ adults: 2, nights: [] }, { adults: 2, nights: [] }]));
    expect(lines).toContain('お部屋: メゾネット × 2室');
    expect(lines).toContain('人数: 1室目 2名 / 2室目 2名');
  });
});
