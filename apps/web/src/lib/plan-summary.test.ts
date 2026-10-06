import { describe, expect, it } from 'vitest';
import { planSummary, stripMore } from './plan-summary';

describe('planSummary', () => {
  it('<!--more--> までを要約にする（行数で切らない）', () => {
    const src = '\n　\n男鹿の海を望む宿。\n**全8章**のコース。\n四季の味わい。\n<!--more-->\n■-ご夕食-■\n詳しい説明';
    expect(planSummary(src)).toBe('男鹿の海を望む宿。\n全8章のコース。\n四季の味わい。');
  });
  it('区切りが無ければ、飾りの見出し行を飛ばして最初の3行', () => {
    const src = '\n  \n■-ご夕食-■  \n【スタンダードランク／-セレナーデ-】  \n山人-oga-を味わう基本のコース。  \n\n潮騒に耳を澄ませて  \n男鹿の海\n秋田の山';
    expect(planSummary(src)).toBe('山人-oga-を味わう基本のコース。\n潮騒に耳を澄ませて\n男鹿の海');
  });
  it('空なら空文字', () => {
    expect(planSummary('')).toBe('');
  });
});

describe('stripMore', () => {
  it('区切りの行だけを取り除く', () => {
    expect(stripMore('前\n  <!-- more -->  \n後')).toBe('前\n\n後');
  });
});

describe('テンプレートとの兼ね合い', () => {
  it('先頭の特典テンプレートが展開で消え、区切りより前が空なら自動で抜き出す', () => {
    expect(planSummary('\n  \n<!--more-->\n■-ご夕食-■\n全8章のコース。\n秋田の山々')).toBe('全8章のコース。\n秋田の山々');
  });
});

describe('旧形式の特典ブロックと区切り', () => {
  it('特典ブロックは区切りの手前で止まり、区切りと要約が残る', async () => {
    const { expandPlanText } = await import('./plan-templates');
    const perk = { id: '1', key: 'official', title: '■公式HP限定特典■', body: '', kind: 'perk' as const, bannerLabel: '公式HP限定特典', sortOrder: 0 };
    const { text, perks } = expandPlanText('■公式HP限定特典■\nウェルカムドリンク\n<!--more-->\n全8章のコース。', [perk]);
    expect(perks).toHaveLength(1);
    expect(planSummary(text)).toBe('全8章のコース。');
    expect(stripMore(text).includes('全8章のコース。')).toBe(true);
  });
});
