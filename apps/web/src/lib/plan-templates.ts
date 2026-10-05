// プラン紹介文のテンプレートブロック（book.plan_text_templates・2026-10-06）。
// 紹介文には {{tpl:<key>}} の差し込み印だけを書き、表示するときにテンプレートの見出し・本文に展開する。
// kind='perk'（公式HP限定特典など）は本文に出さず、予約ボタン横のバナー（押すとモーダル）用に取り出す。
// まだ差し込み印に置き換えていない紹介文でも、特典テンプレートと同じ見出しのブロックは本文から取り出す。

export type PlanTextTemplate = {
  id: string;
  key: string;
  /** 見出し（例: ■-ご朝食-■）。展開時に本文の前に出す */
  title: string;
  body: string;
  kind: 'body' | 'perk';
  /** 特典のバナーの文字（例: 公式HP限定特典） */
  bannerLabel: string | null;
  sortOrder: number;
};

export type PlanPerkBlock = { key: string; label: string; title: string; body: string };

export const templateToken = (key: string) => `{{tpl:${key}}}`;
const TOKEN_RE = /\{\{tpl:([a-z0-9][a-z0-9_-]{0,39})\}\}/g;

/** 区切り線（――― だけの行） */
const isRule = (line: string) => /^\s*[―\-ー─━]{5,}\s*$/.test(line);
/** ブロックの見出し（■ で始まる行） */
const isHeading = (line: string) => /^\s*■/.test(line);
/** Markdown の改行（行末の2つ以上の空白）や前後の空白を落として比べる */
const norm = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t　]+$/u, '').replace(/^[ \t]+/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

/** 見出し title のブロック（見出し行〜次の見出し・区切り線・文末の手前）。無ければ null */
export function findBlock(text: string, title: string): { start: number; end: number; body: string } | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const head = lines.findIndex((l) => l.trim().replace(/[ \t　]+$/u, '') === title.trim());
  if (head < 0) return null;
  let end = head + 1;
  while (end < lines.length && !isHeading(lines[end]) && !isRule(lines[end])) end++;
  return { start: head, end, body: lines.slice(head + 1, end).join('\n') };
}

/** 紹介文を表示用に展開する（本文テンプレートは差し込み、特典テンプレートは取り出す） */
export function expandPlanText(description: string, templates: PlanTextTemplate[]): { text: string; perks: PlanPerkBlock[] } {
  const byKey = new Map(templates.map((t) => [t.key, t]));
  const perks: PlanPerkBlock[] = [];
  const addPerk = (t: PlanTextTemplate) => {
    if (!perks.some((p) => p.key === t.key)) perks.push({ key: t.key, label: t.bannerLabel || t.title, title: t.title, body: t.body });
  };
  let text = description.replace(TOKEN_RE, (_, key: string) => {
    const t = byKey.get(key);
    if (!t) return '';
    if (t.kind === 'perk') {
      addPerk(t);
      return '';
    }
    return `${t.title}  \n${t.body.replace(/\r\n?/g, '\n')}`;
  });
  // 差し込み印にしていない古い紹介文: 特典テンプレートと同じ見出しのブロックを本文から取り出す
  for (const t of templates) {
    if (t.kind !== 'perk') continue;
    const block = findBlock(text, t.title);
    if (!block) continue;
    addPerk(t);
    text = removeLines(text, block.start, block.end, true);
  }
  return { text: text.replace(/\n{4,}/g, '\n\n\n').replace(/\s+$/, ''), perks };
}

/** 行 [start, end) を消す。withRules なら、すぐ前後（空行をはさんでも）の区切り線も消す */
function removeLines(text: string, start: number, end: number, withRules: boolean): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let s = start;
  let e = end;
  if (withRules) {
    let i = s - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    if (i >= 0 && isRule(lines[i])) s = i;
    let j = e;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && isRule(lines[j])) e = j + 1;
  }
  lines.splice(s, e - s);
  return lines.join('\n');
}

/**
 * 紹介文の中の「同じ見出し・同じ本文」のブロックを差し込み印に置き換える（テンプレートの画面の一括置き換え用）。
 * 本文が少しでも違うブロックは置き換えない（プランごとに書き分けている文章を消さないため）。
 */
export function replaceBlockWithToken(
  description: string,
  template: Pick<PlanTextTemplate, 'key' | 'title' | 'body' | 'kind'>
): { result: 'replaced' | 'different' | 'absent' | 'already'; text: string } {
  const token = templateToken(template.key);
  if (description.includes(token)) return { result: 'already', text: description };
  const block = findBlock(description, template.title);
  if (!block) return { result: 'absent', text: description };
  if (norm(block.body) !== norm(template.body)) return { result: 'different', text: description };
  const lines = description.replace(/\r\n?/g, '\n').split('\n');
  let s = block.start;
  let e = block.end;
  if (template.kind === 'perk') {
    // 特典は前後の区切り線ごと差し込み印にする（表示では本文から外れてバナーになる）
    let i = s - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    if (i >= 0 && isRule(lines[i])) s = i;
    let j = e;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && isRule(lines[j])) e = j + 1;
  } else {
    // 次のブロックとの間の空行は残す
    while (e > s + 1 && lines[e - 1].trim() === '') e--;
  }
  lines.splice(s, e - s, token);
  return { result: 'replaced', text: lines.join('\n') };
}

/** 紹介文で使っている差し込み印のキー */
export const usedTemplateKeys = (description: string) => [...description.matchAll(TOKEN_RE)].map((m) => m[1]);
