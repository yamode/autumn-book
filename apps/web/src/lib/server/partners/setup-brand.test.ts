// 設定メールの名乗り・子ユーザーのログインIDの接頭辞（複数施設化 S5b・§7.11・§9・2026-10-09）
import { describe, expect, it } from 'vitest';
import { childLoginIdPrefix, commonFacilityBrand, partnerSetupBrand } from './setup-brand';

const fac = (id: string, name: string, enabled: boolean) => ({ id, slug: id, name, enabled, bookingEnabled: enabled, sortOrder: 0 });

describe('commonFacilityBrand', () => {
  it('共通の頭から区切りを落とす', () => {
    expect(commonFacilityBrand(['山人-yamado-', '山人-oga-'])).toBe('山人');
    expect(commonFacilityBrand(['山人-oga-'])).toBe('山人-oga');
    expect(commonFacilityBrand(['A館', 'B館'])).toBe('');
    expect(commonFacilityBrand([])).toBe('');
  });
});

describe('partnerSetupBrand', () => {
  const base = { facility_id: 'f-2', facility_name: '山人-oga-' };
  it('1施設なら施設名（従来どおり）', () => {
    const b = partnerSetupBrand({ ...base, primary_facility_id: 'f-1', facilities: [fac('f-1', '山人-yamado-', false), fac('f-2', '山人-oga-', true)] });
    expect(b).toEqual({ facilityId: 'f-2', senderName: '山人-oga-', label: '山人-oga-', subjectName: '山人-oga-' });
  });
  it('2施設なら差出人は既定の施設・本文はオンの施設を列挙・件名は共通名', () => {
    const b = partnerSetupBrand({ ...base, primary_facility_id: 'f-1', facilities: [fac('f-1', '山人-yamado-', true), fac('f-2', '山人-oga-', true)] });
    expect(b).toEqual({ facilityId: 'f-1', senderName: '山人-yamado-', label: '山人（山人-yamado-・山人-oga-）', subjectName: '山人' });
  });
  it('既定の施設がオフ・未設定ならオンの先頭', () => {
    const b = partnerSetupBrand({ ...base, primary_facility_id: null, facilities: [fac('f-1', '山人-yamado-', true), fac('f-2', '山人-oga-', true)] });
    expect(b.facilityId).toBe('f-1');
  });
  it('オンが無ければ既定の施設（N9）', () => {
    const b = partnerSetupBrand({ ...base, primary_facility_id: 'f-1', facilities: [fac('f-1', '山人-yamado-', false)] });
    expect(b).toMatchObject({ facilityId: 'f-1', label: '山人-yamado-' });
  });
});

describe('childLoginIdPrefix', () => {
  it('マスタのログインIDの最初の - の前', () => {
    expect(childLoginIdPrefix('saishunkan-ab12cd')).toBe('saishunkan');
    expect(childLoginIdPrefix('OGA-x7k2mp')).toBe('oga');
  });
  it('- が無い短いIDはそのまま', () => {
    expect(childLoginIdPrefix('jtb01')).toBe('jtb01');
  });
  it('英数字 2〜20 文字に収まらなければ partner', () => {
    expect(childLoginIdPrefix('a.b-xx')).toBe('partner');
    expect(childLoginIdPrefix('x-abc')).toBe('partner');
    expect(childLoginIdPrefix('averyveryverylongloginidname')).toBe('partner');
    expect(childLoginIdPrefix(null)).toBe('partner');
  });
});
