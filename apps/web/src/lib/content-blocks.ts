// 部屋タイプ・プラン紹介（book.room_type_contents / book.plan_contents）の jsonb 列を
// 「必ず使える形」に整える純関数。**純関数だけ**（DB・SvelteKit に依存しない）。
//
// 正本は autumn-book の DB（2026-09-26 決定）。autumn-rms の取引先専用ページも同じ列を読むので、
// 保存のたびにここで正規化して、壊れた要素・空要素を DB に残さない。
//
// 動作確認（テストランナーは無いので node の型ストリップで直接叩く）:
//   node --experimental-strip-types -e "import('./src/lib/content-blocks.ts').then(m => console.log(m.normalizeSpecs([{label:' 広さ ',value:'48㎡'},{label:'',value:''}])))"

/** 仕様表の1行（例: 広さ / 48㎡）。value は改行を含むことがある。 */
export interface ContentSpec {
	label: string;
	value: string;
}

/**
 * 紹介ブロック1つ。group は見出し（同じ group が連続するものをまとめて見せる）。
 * photo は画像 URL 1枚。note は小さな注記。
 */
export interface ContentSection {
	group: string;
	title: string;
	text: string;
	note?: string;
	photo?: string;
}

/** 写真のカテゴリ（lib/types.ts の Photo['category'] と同じ並び）。 */
export const PHOTO_CATEGORIES = ['exterior', 'room', 'bath', 'meal', 'view'] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

export const PHOTO_CATEGORY_LABELS: Record<PhotoCategory, string> = {
	exterior: '外観',
	room: '客室',
	bath: '風呂',
	meal: 'お食事',
	view: '景色'
};

export interface ContentPhoto {
	url: string;
	caption: string;
	category: PhotoCategory;
}

/** 件数の上限（誤操作で巨大な jsonb を書かないための安全弁）。 */
export const MAX_SPECS = 40;
export const MAX_SECTIONS = 40;
export const MAX_PHOTOS = 30;

/** 文字列化して前後の空白を落とす。改行コードは \n に揃える（行中の改行は残す）。 */
function text(v: unknown): string {
	if (v === null || v === undefined) return '';
	return String(v).replace(/\r\n?/g, '\n').trim();
}

/** 画像 URL として受け付けるもの（http(s) か、サイト内の絶対パス）。 */
function isImageUrl(s: string): boolean {
	return /^https?:\/\//i.test(s) || s.startsWith('/');
}

/**
 * specs を正規化する。
 * - 配列でなければ空
 * - label・value の両方が空の行は落とす
 * - 片方だけ入っている行は残す（「備考」だけ・値だけの行を消さない）
 */
export function normalizeSpecs(raw: unknown): ContentSpec[] {
	if (!Array.isArray(raw)) return [];
	const out: ContentSpec[] = [];
	for (const x of raw) {
		if (!x || typeof x !== 'object') continue;
		const o = x as Record<string, unknown>;
		const label = text(o.label);
		const value = text(o.value);
		if (!label && !value) continue;
		out.push({ label, value });
		if (out.length >= MAX_SPECS) break;
	}
	return out;
}

/**
 * sections を正規化する。
 * - title・text・note・photo がすべて空の行は落とす（group だけの行は中身が無いので落とす）
 * - note / photo は空ならキーごと持たない（DB に "" を残さない）
 * - photo は URL として読めないものを落とす
 */
export function normalizeSections(raw: unknown): ContentSection[] {
	if (!Array.isArray(raw)) return [];
	const out: ContentSection[] = [];
	for (const x of raw) {
		if (!x || typeof x !== 'object') continue;
		const o = x as Record<string, unknown>;
		const group = text(o.group);
		const title = text(o.title);
		const body = text(o.text);
		const note = text(o.note);
		const photoRaw = text(o.photo);
		const photo = photoRaw && isImageUrl(photoRaw) ? photoRaw : '';
		if (!title && !body && !note && !photo) continue;
		const s: ContentSection = { group, title, text: body };
		if (note) s.note = note;
		if (photo) s.photo = photo;
		out.push(s);
		if (out.length >= MAX_SECTIONS) break;
	}
	return out;
}

/** photos を正規化する。URL の無いものは落とし、知らないカテゴリは fallback にする。 */
export function normalizePhotos(raw: unknown, fallback: PhotoCategory = 'room'): ContentPhoto[] {
	if (!Array.isArray(raw)) return [];
	const out: ContentPhoto[] = [];
	for (const x of raw) {
		if (!x || typeof x !== 'object') continue;
		const o = x as Record<string, unknown>;
		const url = text(o.url);
		if (!url || !isImageUrl(url)) continue;
		const cat = text(o.category) as PhotoCategory;
		out.push({
			url,
			caption: text(o.caption),
			category: (PHOTO_CATEGORIES as readonly string[]).includes(cat) ? cat : fallback
		});
		if (out.length >= MAX_PHOTOS) break;
	}
	return out;
}

/**
 * 読点・カンマ区切りの入力を配列にする（amenities / highlight_tags 用）。
 * 全角・半角の読点とカンマ、改行で区切り、空要素と重複を落とす。
 */
export function parseList(input: unknown): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const s of String(input ?? '').split(/[、,，\n]/)) {
		const t = s.trim();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

/** DB の text[] / jsonb string[] を文字列配列に整える。 */
export function normalizeStringList(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return parseList(raw.map((x) => (typeof x === 'string' ? x : '')).join('\n'));
}

/** フォームの hidden に入れた JSON を読む。壊れていれば空配列。 */
export function parseJsonArray(input: unknown): unknown[] {
	try {
		const v = JSON.parse(String(input ?? '[]'));
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

/** 配列の i 番目を上下に動かした新しい配列（範囲外なら元のまま）。 */
export function moveItem<T>(arr: readonly T[], index: number, dir: -1 | 1): T[] {
	const next = [...arr];
	const j = index + dir;
	if (index < 0 || index >= next.length || j < 0 || j >= next.length) return next;
	[next[index], next[j]] = [next[j], next[index]];
	return next;
}

/** 公開側の表示用: 同じ group が「連続する」ものを1つの見出しにまとめる。 */
export function groupSections(sections: readonly ContentSection[]): { group: string; items: ContentSection[] }[] {
	const out: { group: string; items: ContentSection[] }[] = [];
	for (const s of sections) {
		const last = out[out.length - 1];
		if (last && last.group === s.group) last.items.push(s);
		else out.push({ group: s.group, items: [s] });
	}
	return out;
}

/**
 * 管理画面で編集する1件ぶん（部屋・プラン共通）。
 * tags は部屋なら amenities、プランなら highlight_tags に書く。sortOrder はプランだけが使う。
 */
export interface ContentDraft {
	headline: string;
	description: string;
	isPublished: boolean;
	tags: string[];
	specs: ContentSpec[];
	sections: ContentSection[];
	photos: ContentPhoto[];
	sortOrder: number;
}

/**
 * フォームから来た下書き（JSON を parse しただけの unknown）を保存できる形にする。
 * 空要素の除去・型の正規化はすべてここで行い、DB へは戻り値だけを書く。
 */
export function normalizeContentDraft(raw: unknown, photoFallback: PhotoCategory = 'room'): ContentDraft {
	const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const tags = Array.isArray(o.tags) ? normalizeStringList(o.tags) : parseList(o.tags);
	const sortRaw = Number(o.sortOrder);
	return {
		headline: text(o.headline),
		description: text(o.description),
		isPublished: o.isPublished === true || o.isPublished === 'on' || o.isPublished === 'true',
		tags,
		specs: normalizeSpecs(o.specs),
		sections: normalizeSections(o.sections),
		photos: normalizePhotos(o.photos, photoFallback),
		sortOrder: Number.isFinite(sortRaw) ? Math.max(0, Math.min(9999, Math.trunc(sortRaw))) : 0
	};
}

/** 写真アップロードで受け付ける形式と上限（book-photos バケットの設定と同じ）。 */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** アップロードされたファイルを受け付けられるか。だめならその理由（画面に出す文言）。 */
export function photoFileProblem(file: { size: number; type: string } | null | undefined): string | null {
	if (!file || file.size === 0) return '写真を選んでください。';
	if (file.size > PHOTO_MAX_BYTES) return '写真は10MBまでです。';
	if (!(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
		return 'JPEG・PNG・WebP・AVIF の画像を選んでください。';
	}
	return null;
}
