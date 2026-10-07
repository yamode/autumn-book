import { describe, expect, it } from 'vitest';
import {
  bookActorUserId,
  creditMonthLabel,
  creditMonthShort,
  creditMonthText,
  creditOverLine,
  creditOverSubjectPrefix,
  creditUpdatedSource,
  isCreditOver,
  isSelectableCreditOverAction,
  nextMonths,
  normalizeCreditCheck,
  normalizeCreditOverAction,
  parseCreditSettingsInput,
  readAgencyCreditMeta,
  showsCredit,
  stayMonths,
  stayRoomNightsByMonth
} from './partner-credit';

describe('stayRoomNightsByMonth（延べ室数＝室数×その月の泊数）', () => {
  it('月またぎ: 1/31〜2/2 の1室は 1月1室・2月1室（チェックアウト日は数えない）', () => {
    expect(stayRoomNightsByMonth('2027-01-31', 2, 1)).toEqual({ '2027-01': 1, '2027-02': 1 });
  });
  it('2室×3泊＝6室（同じ月）', () => {
    expect(stayRoomNightsByMonth('2027-02-10', 3, 2)).toEqual({ '2027-02': 6 });
  });
  it('月末にチェックアウトする滞在は翌月を含まない', () => {
    expect(stayRoomNightsByMonth('2027-01-30', 2, 1)).toEqual({ '2027-01': 2 });
  });
  it('年またぎ・うるう年', () => {
    expect(stayRoomNightsByMonth('2027-12-31', 2, 3)).toEqual({ '2027-12': 3, '2028-01': 3 });
    expect(stayRoomNightsByMonth('2028-02-28', 2, 1)).toEqual({ '2028-02': 2 });
  });
  it('不正な入力は空', () => {
    expect(stayRoomNightsByMonth('2027/01/01', 1, 1)).toEqual({});
    expect(stayRoomNightsByMonth('2027-01-01', 0, 1)).toEqual({});
    expect(stayRoomNightsByMonth('2027-01-01', 1, 0)).toEqual({});
  });
});

describe('stayMonths / nextMonths / creditMonthLabel', () => {
  it('滞在が触る月', () => {
    expect(stayMonths('2027-01-31', 2)).toEqual(['2027-01', '2027-02']);
    expect(stayMonths('2027-01-05', 1)).toEqual(['2027-01']);
  });
  it('今後 n か月（年をまたぐ）', () => {
    expect(nextMonths('2026-11', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(nextMonths('2026-11', 0)).toEqual([]);
  });
  it('月の表示', () => {
    expect(creditMonthLabel('2027-02')).toBe('2027年2月');
  });
});

describe('normalizeCreditCheck', () => {
  it('RPC の返り値を画面の形にする', () => {
    const c = normalizeCreditCheck({
      enabled: true,
      settings: { growth_rate: 20, min_rooms: 2, note: 'メモ', updated_at: '2026-10-07T01:00:00Z', updated_by: 'book:u1' },
      over: true,
      months: [
        { month: '2027-01', baseline: 4.33, limit: 6, booked: 5, adding: 1, remaining: 0, over: false },
        { month: '2027-02', baseline: 0, limit: 2, booked: 2, adding: 1, remaining: -1, over: true }
      ]
    });
    expect(c.enabled).toBe(true);
    expect(c.over).toBe(true);
    expect(c.settings).toEqual({ growthRate: 20, minRooms: 2, note: 'メモ', updatedAt: '2026-10-07T01:00:00Z', updatedBy: 'book:u1' });
    expect(c.months[1]).toEqual({ month: '2027-02', baseline: 0, limit: 2, booked: 2, adding: 1, remaining: -1, over: true });
  });
  it('旅行会社以外（enabled=false・settings 無し）・壊れた値は与信なし', () => {
    expect(normalizeCreditCheck({ enabled: false, over: false, months: [] })).toEqual({ enabled: false, settings: null, over: false, months: [] });
    expect(normalizeCreditCheck(null)).toEqual({ enabled: false, settings: null, over: false, months: [] });
  });
});

describe('isCreditOver / creditOverSubjectPrefix / creditOverLine', () => {
  const over = { enabled: true, over: true, months: [{ month: '2027-02', limit: 10, booked: 12, adding: 0, remaining: -2, over: true }] };
  it('予約時の判定が超過なら印を付ける', () => {
    expect(isCreditOver(over)).toBe(true);
    expect(creditOverSubjectPrefix(over)).toBe('【受付枠超過】');
    expect(creditOverLine(over)).toBe('【受付枠超過】2027年2月 上限10室・予約12室');
  });
  it('判定なし・枠内は何も付けない', () => {
    expect(isCreditOver(null)).toBe(false);
    expect(isCreditOver({ enabled: true, over: false, months: [] })).toBe(false);
    expect(creditOverSubjectPrefix(null)).toBe('');
    expect(creditOverLine({ enabled: true, over: false, months: [] })).toBeNull();
  });
});

describe('creditMonthText（取引先ページ）', () => {
  it('残りとこの予約の後の残り', () => {
    expect(creditMonthText({ month: '2027-02', baseline: 8, limit: 10, booked: 7, adding: 2, remaining: 1, over: false })).toEqual({
      head: '2027年2月: 残り 3 室（上限 10 室・ご予約済み 7 室）',
      after: 'このご予約で残り 1 室'
    });
  });
  it('この予約で超える', () => {
    expect(creditMonthText({ month: '2027-02', baseline: 8, limit: 10, booked: 9, adding: 2, remaining: -1, over: true }).after).toBe('このご予約で上限を 1 室超えます');
  });
  it('既に超えている・この予約ぶんが無い', () => {
    expect(creditMonthText({ month: '2027-03', baseline: 0, limit: 2, booked: 4, adding: 0, remaining: -2, over: true })).toEqual({
      head: '2027年3月: 上限を 2 室超えています（上限 2 室・ご予約済み 4 室）',
      after: null
    });
  });
  it('料金カレンダーの短い表示', () => {
    expect(creditMonthShort({ month: '2027-02', limit: 10, booked: 7 })).toBe('2027年2月の受付枠 残り 3 室');
    expect(creditMonthShort({ month: '2027-02', limit: 2, booked: 3 })).toBe('2027年2月の受付枠 上限超過（1 室）');
  });
});

describe('超過時の挙動（credit_over_action）', () => {
  it('不明な値は deposit（列の既定）', () => {
    expect(normalizeCreditOverAction('warn')).toBe('warn');
    expect(normalizeCreditOverAction('ignore')).toBe('ignore');
    expect(normalizeCreditOverAction('x')).toBe('deposit');
  });
  it('Phase 3a で選べるのは warn / ignore だけ', () => {
    expect(isSelectableCreditOverAction('warn')).toBe(true);
    expect(isSelectableCreditOverAction('ignore')).toBe(true);
    expect(isSelectableCreditOverAction('deposit')).toBe(false);
  });
  it('ignore 以外は受付枠を見せる', () => {
    expect(showsCredit('warn')).toBe(true);
    expect(showsCredit('deposit')).toBe(true);
    expect(showsCredit('ignore')).toBe(false);
  });
});

describe('parseCreditSettingsInput', () => {
  it('PMS と同じ文字列にそろえる', () => {
    expect(parseCreditSettingsInput({ enabled: true, growthRate: '２０％', minRooms: '2', note: ' 繁忙期は相談 ' })).toEqual({
      ok: true,
      patch: { credit_enabled: '1', credit_growth_rate: '20', credit_min_rooms: '2', credit_note: '繁忙期は相談' }
    });
  });
  it('空欄は未設定（""）・OFF は ""', () => {
    expect(parseCreditSettingsInput({ enabled: false, growthRate: '', minRooms: '', note: '' })).toEqual({
      ok: true,
      patch: { credit_enabled: '', credit_growth_rate: '', credit_min_rooms: '', credit_note: '' }
    });
  });
  it('範囲外・数でないものは断る', () => {
    expect(parseCreditSettingsInput({ enabled: true, growthRate: '1001', minRooms: '', note: '' }).ok).toBe(false);
    expect(parseCreditSettingsInput({ enabled: true, growthRate: '-5', minRooms: '', note: '' }).ok).toBe(false);
    expect(parseCreditSettingsInput({ enabled: true, growthRate: '', minRooms: '1.5', note: '' }).ok).toBe(false);
    expect(parseCreditSettingsInput({ enabled: true, growthRate: '', minRooms: '10000', note: '' }).ok).toBe(false);
  });
});

describe('readAgencyCreditMeta / 最終更新', () => {
  it('metadata.pms の与信の4キーと最終更新を読む（他のキーは読まない）', () => {
    expect(
      readAgencyCreditMeta({ pms: { credit_enabled: '1', credit_growth_rate: '20', credit_min_rooms: '2', credit_note: 'x', agency_contact: '佐藤', credit_updated_by: 'book:u1' } })
    ).toEqual({ enabled: true, growthRate: '20', minRooms: '2', note: 'x', updatedAt: null, updatedBy: 'book:u1' });
    expect(readAgencyCreditMeta(null).enabled).toBe(false);
  });
  it('更新者の出所', () => {
    expect(bookActorUserId('book:abc')).toBe('abc');
    expect(bookActorUserId('pms:abc')).toBeNull();
    expect(creditUpdatedSource('book:abc', '佐々木')).toBe('book・佐々木');
    expect(creditUpdatedSource('book:abc')).toBe('book');
    expect(creditUpdatedSource(null)).toBe('PMS などで設定');
  });
});
