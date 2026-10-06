import { describe, expect, it } from 'vitest';
import { expandPlanText, findBlock, replaceBlockWithToken, usedTemplateKeys, type PlanTextTemplate } from './plan-templates';

const tpl = (key: string, title: string, body: string, kind: 'body' | 'perk' = 'body', bannerLabel: string | null = null): PlanTextTemplate => ({
  id: key,
  key,
  title,
  body,
  kind,
  bannerLabel,
  sortOrder: 0
});
const breakfast = tpl('breakfast', '■-ご朝食-■', '波の煌めきが差し込むレストランにて。  \n一日の始まりを。');
const perk = tpl('official-perk', '■-公式HP限定特典-■', '【貸切露天風呂 無料サービス】  \n・公式HPからのご予約限定の特典です。', 'perk', '公式HP限定特典');

const legacy = [
  '■-ご夕食-■  ',
  'プランごとの夕食の説明  ',
  '  ',
  '■-ご朝食-■  ',
  '波の煌めきが差し込むレストランにて。  ',
  '一日の始まりを。  ',
  '  ',
  ' ――――――――――――――  ',
  '■-公式HP限定特典-■  ',
  '【貸切露天風呂 無料サービス】  ',
  '・公式HPからのご予約限定の特典です。  ',
  '――――――――――――――'
].join('\n');

describe('expandPlanText', () => {
  it('本文テンプレートは見出しと本文に展開し、特典は取り出す', () => {
    const { text, perks } = expandPlanText('はじめに\n\n{{tpl:breakfast}}\n\n{{tpl:official-perk}}', [breakfast, perk]);
    expect(text).toContain('■-ご朝食-■  \n波の煌めき');
    expect(text).not.toContain('{{tpl:');
    expect(perks).toEqual([{ key: 'official-perk', label: '公式HP限定特典', title: '■-公式HP限定特典-■', body: perk.body }]);
  });
  it('知らない差し込み印は消す', () => {
    expect(expandPlanText('A{{tpl:nothing}}B', []).text).toBe('AB');
  });
  it('差し込み印にしていない古い紹介文からも、特典の見出しのブロックを区切り線ごと取り出す', () => {
    const { text, perks } = expandPlanText(legacy, [perk]);
    expect(perks.map((p) => p.key)).toEqual(['official-perk']);
    expect(text).not.toContain('公式HP限定特典');
    expect(text).not.toContain('――');
    expect(text).toContain('■-ご朝食-■');
  });
});

describe('replaceBlockWithToken', () => {
  it('同じ本文のブロックだけ差し込み印にする（空白の違いは無視）', () => {
    const r = replaceBlockWithToken(legacy, breakfast);
    expect(r.result).toBe('replaced');
    expect(r.text).toContain('{{tpl:breakfast}}');
    expect(r.text).not.toContain('波の煌めき');
    expect(r.text).toContain('■-ご夕食-■');
    expect(findBlock(r.text, '■-公式HP限定特典-■')).not.toBeNull();
  });
  it('本文が違えば置き換えない', () => {
    expect(replaceBlockWithToken(legacy, tpl('dinner', '■-ご夕食-■', '別の文章')).result).toBe('different');
  });
  it('特典は前後の区切り線ごと置き換える', () => {
    const r = replaceBlockWithToken(legacy, perk);
    expect(r.result).toBe('replaced');
    expect(r.text).not.toContain('――');
    expect(usedTemplateKeys(r.text)).toEqual(['official-perk']);
  });
  it('すぐ後ろに別の差し込み印があっても、そこでブロックを区切る', () => {
    const text = '■-ご朝食-■  \n波の煌めきが差し込むレストランにて。  \n一日の始まりを。  \n   \n{{tpl:official-perk}}';
    const r = replaceBlockWithToken(text, breakfast);
    expect(r.result).toBe('replaced');
    expect(usedTemplateKeys(r.text)).toEqual(['breakfast', 'official-perk']);
  });
  it('見出しが無い・置き換え済み', () => {
    expect(replaceBlockWithToken('本文だけ', breakfast).result).toBe('absent');
    expect(replaceBlockWithToken('{{tpl:breakfast}}', breakfast).result).toBe('already');
  });
});
