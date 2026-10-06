// プラン紹介文（Markdown）の「一覧用の要約」。
// 本文の中に WordPress と同じ区切り <!--more--> を1行で入れると、そこまでを一覧（取引先の「プランのご紹介」の
// カード）に出す要約にする。区切りより後ろも含めた全文は詳細（プラン詳細・公式サイト）で出し、区切り自体は表示しない。
// 区切りが無い紹介文は、飾りの見出し行（■-ご夕食-■ など）を除いた最初の数行を要約にする。

/** 区切りの行（前後の空白は許す） */
export const MORE_MARKER = '<!--more-->';
const MORE_LINE = /^[ \t　]*<!--\s*more\s*-->[ \t　]*$/m;
const MORE_LINES = /^[ \t　]*<!--\s*more\s*-->[ \t　]*$/gm;

/** 区切りの行を取り除いた全文 */
export function stripMore(src: string): string {
  return (src ?? '').replace(MORE_LINES, '');
}

/** 一覧に出す要約（プレーンテキスト・改行は保つ）。無ければ空文字 */
export function planSummary(src: string, maxLines = 3): string {
  const text = src ?? '';
  // 区切りより前が空（特典テンプレートだけが先頭にあり、展開で消えた等）なら、区切りが無いものとして抜き出す
  const m = MORE_LINE.exec(text);
  if (m) {
    const lines = text.slice(0, m.index).split('\n').map(plain).filter(Boolean);
    if (lines.length) return lines.join('\n');
  }
  return stripMore(text)
    .split('\n')
    .map(plain)
    .filter((l) => l && !isDecoration(l))
    .slice(0, maxLines)
    .join('\n');
}

// Markdown の記号を外して1行のプレーンテキストに
function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 写真
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンク
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+/, '') // 見出し・リスト・引用
    .replace(/\*\*|__|`/g, '')
    .replace(/\{[^}]+\}/g, '') // 差込変数・テンプレート
    .replace(/^\|.*\|$/, '') // 表
    .replace(/^[-=]{3,}$/, '')
    .trim()
    .replace(/^[　\s]+|[　\s]+$/g, '');
}

// 「■-ご夕食-■」「【プラン説明】」のような飾りの見出し行（要約の自動抜き出しでは飛ばす）
function isDecoration(line: string): boolean {
  return /^[■□◆◇●○◎★☆]/.test(line) || /^【[^】]*】$/.test(line) || /^[-―─=＝~〜]+.*[-―─=＝~〜]+$/.test(line);
}
