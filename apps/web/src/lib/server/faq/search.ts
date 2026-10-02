// FAQ ボット（C1）の検索ロジック。設計書 autumn_book_faq_bot_design.md §4。
// 登録済み FAQ だけを対象に、質問文との一致度（0〜1）を計算する。文章生成はしない。
//
// 日本語・繁体字は「文字2-gram」、英語は「単語」で照合する（pg_trgm は日本語と相性が悪いので DB 側では検索しない）。
// 1施設の公開 FAQ は数百件規模なので、全件を毎回スコアリングしても十分速い。

export type FaqLocale = 'ja' | 'en' | 'zh-TW';

export interface SearchableFaq {
	id: string;
	category: string;
	question: string;
	answer: string; // Markdown 原文
	keywords: string[];
}

export interface FaqHit {
	faq: SearchableFaq;
	score: number;
}

/** 「回答あり」とみなす最上位スコアの既定値（施設設定で上書き可） */
export const DEFAULT_ANSWER_THRESHOLD = 0.3;

// 施設共通の表記ゆれ辞書（左のいずれかを右の代表語に寄せる）。正規化後（カタカナ→ひらがな済み）の文字列に適用する。
// FAQ 側も同じ正規化を通すので、代表語そのものの綴りは何でもよい（両側で揃うことが大事）。
// ⚠ 誤爆する語は入れない（例:「何時まで」は温泉にも使うのでチェックアウトに寄せない／「ふろ」は「ふろんと」に含まれる）。
// 上から順に適用する。長い語・限定的な語を先に置く。
const SYNONYMS: [string[], string][] = [
	[['ちぇっくいん', '入室', '到着時間', '到着時刻'], 'ちぇっくいん'],
	[['ちぇっくあうと', '退室', '退館'], 'ちぇっくあうと'],
	// 時間の尋ね方（「何時まで入れる」「利用時間は」を同じ語に寄せる。対象＝温泉・食事などは別の語で決まる）
	[['利用時間', '営業時間', '何時から', '何時まで', '何時に', '何時'], '時間'],
	[['ちゅうしゃじょう', '駐車場', '駐車', 'ぱーきんぐ'], 'ちゅうしゃ'],
	[['わいふぁい', '無線lan', 'むせんlan', 'いんたーねっと'], 'wifi'],
	[['貸切風呂', '貸し切り風呂', '貸切', '貸し切り', 'かしきり', 'ぷらいべーとばす', '家族風呂'], 'かしきり'],
	[['大浴場', '露天風呂', 'お風呂', 'おふろ', '温泉', '浴場'], 'おんせん'],
	[['朝食', '朝ごはん', '朝ご飯', 'あさごはん', 'もーにんぐ'], 'ちょうしょく'],
	[['夕食', '晩ごはん', '晩ご飯', '夕ごはん', '夕ご飯', '夕飯', 'ゆうごはん', 'でぃなー'], 'ゆうしょく'],
	[['きゃんせる', '取り消し', '取消'], 'きゃんせる'],
	[['あれるぎー', '食べられない', '苦手な食材'], 'あれるぎー'],
	[['ぺっと', '犬', '猫'], 'ぺっと'],
	[['送迎', 'お迎え', '送り迎え', 'しゃとる'], 'そうげい'],
	[['支払い', '支払', '決済', 'くれじっと', 'かーど'], 'しはらい'],
	[['子供', '子ども', 'こども', '子連れ', '赤ちゃん', '幼児', '小学生'], 'こども']
];

/** 照合用の正規化: NFKC・小文字化・カタカナ→ひらがな・空白と記号の除去・表記ゆれの統一 */
export function normalize(text: string): string {
	let s = (text ?? '').normalize('NFKC').toLowerCase();
	// カタカナ → ひらがな（長音「ー」はそのまま）
	s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
	// 空白・句読点・記号を除去（英数字・かな・漢字は残す）。英語の単語境界は tokenize 側で別に扱う
	s = s.replace(/[\s\p{P}\p{S}]+/gu, '');
	for (const [variants, canonical] of SYNONYMS) {
		for (const v of variants) if (v !== canonical && s.includes(v)) s = s.split(v).join(canonical);
	}
	return s.slice(0, 200);
}

/** 英語用: 単語に分割（3文字未満とよくある語は除く） */
const EN_STOP = new Set(['the', 'and', 'for', 'are', 'you', 'can', 'what', 'how', 'when', 'where', 'there', 'have', 'does', 'with', 'your', 'from', 'this', 'that', 'any', 'about']);
function words(text: string): string[] {
	return (text ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 3 && !EN_STOP.has(w))
		.map((w) => w.replace(/(ies|es|s)$/, '')); // ごく簡単な語尾の統一
}

/** 文字2-gram の集合（1文字だけの語は1-gram として扱う） */
function bigrams(s: string): Set<string> {
	const out = new Set<string>();
	if (s.length === 1) out.add(s);
	for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
	return out;
}

type Weight = (g: string) => number;
const ONE: Weight = () => 1;

/** 質問側の要素がどれだけ候補側に含まれるか（重み付き。質問が短くても高く出るよう、質問側を分母にする） */
function containment(q: Set<string>, target: Set<string>, w: Weight): number {
	if (q.size === 0 || target.size === 0) return 0;
	let hit = 0, all = 0;
	for (const g of q) { all += w(g); if (target.has(g)) hit += w(g); }
	return all > 0 ? hit / all : 0;
}

/** 互いの重なり（重み付き Dice 係数）。質問と候補の長さが近いほど高い */
function dice(a: Set<string>, b: Set<string>, w: Weight): number {
	if (a.size === 0 || b.size === 0) return 0;
	let hit = 0, sa = 0, sb = 0;
	for (const g of a) { sa += w(g); if (b.has(g)) hit += w(g); }
	for (const g of b) sb += w(g);
	return sa + sb > 0 ? (2 * hit) / (sa + sb) : 0;
}

// 意味の薄い言い回しの2-gram（「〜ですか」「〜ありますか」など）。質問側からだけ除き、
// 「パーキングある？」のような短い質問でも、中身の語で一致度が決まるようにする。
// ⚠ 中身の語に含まれる2-gramは入れない（「せん」は温泉、「しょ」「ょう」は朝食・夕食に含まれる）。
const STOP_BIGRAMS = new Set([
	'です', 'すか', 'ます', 'あり', 'りま', 'ある', 'した', 'たい', 'けど', 'いる', 'れる', 'でき', 'きま',
	'ので', 'から', 'まで', 'ても', 'とは', 'には', 'では', 'って', 'ない', 'くだ', 'ださ', 'さい', 'すが',
	'いつ', 'どこ', 'どう', 'なに', 'でし', 'けま', 'いけ', 'んは', 'は時'
]);

function featuresFor(text: string, locale: FaqLocale, isQuery = false): Set<string> {
	if (locale === 'en') return new Set(words(text));
	const g = bigrams(normalize(text));
	if (isQuery) {
		const kept = new Set([...g].filter((x) => !STOP_BIGRAMS.has(x)));
		if (kept.size > 0) return kept; // 全部が言い回しだけなら元のまま使う
	}
	return g;
}

/**
 * 施設の FAQ 全体から語の重み（IDF）を作る。多くの FAQ に出てくる語（「時間」など）は軽く、
 * 特定の FAQ にしか出ない語（「おんせん」「ちゅうしゃ」など）は重くする。
 */
export function buildWeights(faqs: SearchableFaq[], locale: FaqLocale = 'ja'): Weight {
	const df = new Map<string, number>();
	for (const f of faqs) {
		const seen = new Set<string>([...featuresFor(f.question, locale), ...(f.keywords ?? []).flatMap((k) => [...featuresFor(k, locale)])]);
		for (const g of seen) df.set(g, (df.get(g) ?? 0) + 1);
	}
	const n = Math.max(1, faqs.length);
	return (g) => Math.log(1 + n / (1 + (df.get(g) ?? 0)));
}

/** 1件の FAQ の一致度（0〜1）。weight を省略すると全語を同じ重みで数える */
export function scoreFaq(query: string, faq: SearchableFaq, locale: FaqLocale = 'ja', weight: Weight = ONE): number {
	const q = featuresFor(query, locale, true);
	if (q.size === 0) return 0;

	const question = featuresFor(faq.question, locale);
	// 質問文: 含有率と Dice の平均（短い質問でも長い質問でもそれなりに当たる）
	const qScore = (containment(q, question, weight) + dice(q, question, weight)) / 2;
	// 言い換え: 最も一致するもの
	let kScore = 0;
	for (const k of faq.keywords ?? []) {
		const kf = featuresFor(k, locale);
		kScore = Math.max(kScore, (containment(q, kf, weight) + dice(q, kf, weight)) / 2);
	}
	// 回答本文・カテゴリ: 弱い加点（本文は長いので含有率だけ）
	const aScore = containment(q, featuresFor(faq.answer, locale), weight);
	const cScore = containment(q, featuresFor(faq.category, locale), weight);

	const best = Math.max(qScore, kScore);
	const score = best * 0.8 + aScore * 0.15 + cScore * 0.05;
	return Math.round(Math.min(1, score) * 1000) / 1000;
}

/** 上位 limit 件を返す（スコア 0.1 未満は候補にしない） */
export function searchFaqs(query: string, faqs: SearchableFaq[], locale: FaqLocale = 'ja', limit = 3): FaqHit[] {
	const weight = buildWeights(faqs, locale);
	return faqs
		.map((faq) => ({ faq, score: scoreFaq(query, faq, locale, weight) }))
		.filter((h) => h.score >= 0.1)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}
