import { describe, expect, it } from 'vitest';
import { partnerTitle } from './partner-title';

describe('partnerTitle', () => {
  const portal = { facilityName: '山人-oga-', partnerName: '再春館製薬所' };
  it('宿・取引先・専用予約を先頭に、ページ名を後ろに', () => {
    expect(partnerTitle(portal, '料金カレンダー')).toBe('山人-oga- 再春館製薬所様 専用予約｜料金カレンダー');
    expect(partnerTitle(portal)).toBe('山人-oga- 再春館製薬所様 専用予約');
  });
  it('取引先名が無ければ省く', () => {
    expect(partnerTitle({ facilityName: '山人-oga-' }, '覚書')).toBe('山人-oga- 専用予約｜覚書');
  });
});
