import { describe, expect, it } from 'vitest';
import { buildPartnerContents, displayPlanName, groupSections, partnerContentScope, planAnchor } from './partner-contents';
import type { PartnerRateRule } from './partner-pricing';

const rule = (over: Partial<PartnerRateRule>): PartnerRateRule => ({
  id: 'r',
  label: '',
  roomCodes: [],
  planGroupCodes: [],
  mealTypes: [],
  guestCounts: [],
  weekdays: [],
  dateFrom: null,
  dateTo: null,
  action: 'adjust',
  adjustType: 'percent',
  value: 0,
  ...over
});

const RAW = {
  rooms: [
    { code: '01', name: '山祇│ジュニア', photos: [{ url: 'https://x/1.webp', caption: '', category: 'room' }], specs: [], sections: [] },
    { code: '05', name: '迦具土│オーシャン', description: '海の見える部屋' }
  ],
  plans: [
    { plan_code: 'a003', plan_label: '基本■2食■スタンダード(+20350円)', name: 'スタンダード', description: 'セレナーデ', highlight_tags: ['2食付き'] },
    { plan_code: 'a003', plan_label: '基本■2食■ファミリー(+19800円)', name: 'ファミリー' },
    { plan_code: 'a000', plan_label: '基本■素泊■素泊(±0円)', name: '素泊まり', photos: [{ url: 'https://x/2.webp' }] }
  ]
};

describe('partnerContentScope', () => {
  it('「調整して出す」ルールの部屋・プランだけを対象にし、先行案内は除く', () => {
    const s = partnerContentScope({ rules: [rule({ roomCodes: ['01'], planGroupCodes: ['a003', 'advance'] }), rule({ action: 'hide', roomCodes: ['05'], planGroupCodes: ['a000'] })] });
    expect([...(s.rooms ?? [])]).toEqual(['01']);
    expect([...(s.plans ?? [])]).toEqual(['a003']);
  });
  it('部屋の指定が無いルールがあれば全部屋', () => {
    expect(partnerContentScope({ rules: [rule({ planGroupCodes: ['a003'] })] }).rooms).toBeNull();
  });
});

describe('buildPartnerContents', () => {
  it('範囲内で、紹介の中身があるプランだけを返す', () => {
    const out = buildPartnerContents(RAW, { rules: [rule({ planGroupCodes: ['a003'] })] });
    expect(out.rooms.map((r) => r.code)).toEqual(['01', '05']);
    expect(out.plans.map((p) => p.name)).toEqual(['スタンダード']);
    expect(out.plans[0].tags).toEqual(['2食付き']);
  });
  it('ルールが無ければ何も出さない', () => {
    const out = buildPartnerContents(RAW, { rules: [] });
    expect(out.rooms).toEqual([]);
    expect(out.plans).toEqual([]);
  });
  it('https 以外の写真は捨てる', () => {
    const out = buildPartnerContents({ rooms: [{ code: '01', photos: [{ url: 'javascript:alert(1)' }, { url: 'https://ok/a.webp' }] }] }, { rules: [rule({ planGroupCodes: ['a000'] })] });
    expect(out.rooms[0].photos.map((p) => p.url)).toEqual(['https://ok/a.webp']);
  });
});

describe('planAnchor', () => {
  it('同じコードでも表示名が違えば別の ID になり、同じ入力では安定する', () => {
    const a = planAnchor('a003', '基本■2食■スタンダード(+20350円)');
    expect(a).toBe(planAnchor('a003', '基本■2食■スタンダード(+20350円)'));
    expect(a).not.toBe(planAnchor('a003', '基本■2食■ファミリー(+19800円)'));
    expect(a).toMatch(/^plan-a003-[0-9a-z]+$/);
  });
});

describe('groupSections / displayPlanName', () => {
  it('続く同じ見出しをまとめる', () => {
    const g = groupSections([
      { group: '浴室', title: 'a', text: '', note: '', photo: null },
      { group: '浴室', title: 'b', text: '', note: '', photo: null },
      { group: 'アメニティ', title: 'c', text: '', note: '', photo: null }
    ]);
    expect(g.map((x) => [x.group, x.items.length])).toEqual([['浴室', 2], ['アメニティ', 1]]);
  });
  it('調整表記を落とす', () => {
    expect(displayPlanName('基本■2食■スタンダード(+20350円)')).toBe('スタンダード');
  });
});
