// 管理画面の施設タブ（複数施設化 S3・§7.12・決定 N6・2026-10-09）の純関数:
// readPartnerFacilityOverrides / buildPartnerFacilitySettings / buildPartnerCommonSettings / describePartnerFacilityOverride
import { describe, expect, it } from 'vitest';
import {
  buildPartnerCommonSettings,
  buildPartnerFacilitySettings,
  DEFAULT_PARTNER_BOOKING_SETTINGS,
  describePartnerFacilityOverride,
  normalizePartnerBookingSettings,
  readPartnerFacilityOverrides
} from './partner-booking';

const own = {
  planNames: { A1: '専用プラン' },
  perks: [],
  notice: '男鹿の案内',
  notifyEmails: ['oga@example.com'],
  showOfficialPerks: true
};

describe('readPartnerFacilityOverrides（キーの有無で上書きを読む）', () => {
  it('キーが無ければ上書きなし（共通の既定を使う）', () => {
    expect(readPartnerFacilityOverrides({})).toEqual({});
    expect(readPartnerFacilityOverrides(null)).toEqual({});
    expect(readPartnerFacilityOverrides({ planNames: { A: 'x' } })).toEqual({});
  });

  it('0・null も「値あり」として上書きに残す', () => {
    expect(readPartnerFacilityOverrides({ leadDays: 0, cancelDays: null, maxRooms: 3 })).toEqual({ leadDays: 0, cancelDays: null, maxRooms: 3 });
  });

  it('空文字の cancelDays は「画面からは不可」（null）の上書き', () => {
    expect(readPartnerFacilityOverrides({ cancelDays: '' })).toEqual({ cancelDays: null });
  });

  it('値は正規化する（範囲外は丸める・prepayDiscount はオブジェクトごと）', () => {
    expect(readPartnerFacilityOverrides({ cutoffHour: 30, prepayDiscount: { type: 'percent', value: '5' } })).toEqual({
      cutoffHour: 23,
      prepayDiscount: { type: 'percent', value: 5 }
    });
    expect(readPartnerFacilityOverrides({ prepayDiscount: { type: 'none' } })).toEqual({ prepayDiscount: { type: 'none', value: 0 } });
  });

  it('undefined のキーは上書きしない（JSON に残らないので DB の「キーなし」と同じ）', () => {
    expect(readPartnerFacilityOverrides({ leadDays: undefined })).toEqual({});
  });
});

describe('buildPartnerFacilitySettings（施設タブの保存）', () => {
  it('上書きしているキーだけ書き、「共通の既定を使う」のキーは消す', () => {
    const current = { leadDays: 3, maxNights: 2, notice: '古い案内', futureKey: 'keep' };
    const out = buildPartnerFacilitySettings(current, own, { maxNights: 0 as unknown as number, cancelDays: null });
    expect(out).toEqual({ ...own, maxNights: 0, cancelDays: null, futureKey: 'keep' });
    expect('leadDays' in out).toBe(false);
  });

  it('合成すると、上書きしたキーだけ施設の値・他は共通の値', () => {
    const common = { ...DEFAULT_PARTNER_BOOKING_SETTINGS, leadDays: 2, cancelDays: 1, prepayDiscount: { type: 'percent', value: 3 } };
    const facility = buildPartnerFacilitySettings({}, own, { cancelDays: null, prepayDiscount: { type: 'none', value: 0 } });
    const s = normalizePartnerBookingSettings(common, facility);
    expect(s.leadDays).toBe(2);
    expect(s.cancelDays).toBeNull();
    expect(s.prepayDiscount).toEqual({ type: 'none', value: 0 });
    expect(s.notice).toBe('男鹿の案内');
    expect(s.planNames).toEqual({ A1: '専用プラン' });
  });

  it('読んだ上書きをそのまま書き戻すと同じになる（往復）', () => {
    const facility = { ...own, leadDays: 0, cancelDays: null };
    expect(buildPartnerFacilitySettings(facility, own, readPartnerFacilityOverrides(facility))).toEqual(facility);
  });
});

describe('buildPartnerCommonSettings（共通セクションの保存）', () => {
  it('施設ごとのキーは画面から書かず、今の共通の jsonb の値を残す。N6 の既定は共通へ', () => {
    const current = { planNames: { OLD: '旧' }, leadDays: 1, notifyEmails: ['old@example.com'] };
    const settings = normalizePartnerBookingSettings({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, leadDays: 4, planNames: { NEW: '新' }, notice: 'x' });
    const out = buildPartnerCommonSettings(current, settings);
    expect(out.leadDays).toBe(4);
    expect(out.planNames).toEqual({ OLD: '旧' });
    expect(out.notifyEmails).toEqual(['old@example.com']);
    expect('notice' in out).toBe(false);
    expect('perks' in out).toBe(false);
    expect(out.paymentOptions).toEqual(['invoice_monthly']);
  });
});

describe('describePartnerFacilityOverride', () => {
  const s = { ...DEFAULT_PARTNER_BOOKING_SETTINGS, leadDays: 0, cancelDays: null, prepayDiscount: { type: 'percent' as const, value: 5 } };
  it('値の説明', () => {
    expect(describePartnerFacilityOverride('leadDays', s)).toBe('当日');
    expect(describePartnerFacilityOverride('cancelDays', s)).toBe('画面からは不可');
    expect(describePartnerFacilityOverride('cancelDays', { ...s, cancelDays: 2 })).toBe('2日前の同時刻まで');
    expect(describePartnerFacilityOverride('cutoffHour', s)).toBe('18時まで');
    expect(describePartnerFacilityOverride('prepayDiscount', s)).toBe('5%引き');
    expect(describePartnerFacilityOverride('prepayDiscount', DEFAULT_PARTNER_BOOKING_SETTINGS)).toBe('なし');
    expect(describePartnerFacilityOverride('maxRooms', s)).toBe('5室');
    expect(describePartnerFacilityOverride('maxNights', s)).toBe('7泊');
  });
});
