// 表示中の言語の訳文（book.content_translations の fields）を、日本語の元データに重ねる（2026-11-22）。
// 取得は $lib/server/supabase-data の withTranslations。ここは重ね方だけ（純粋関数）。
import { normalizeSpecs, normalizeSections } from '$lib/content-blocks';
import type { Photo } from '$lib/types';

/** 訳文の1行を重ねる。空文字・null・空配列・元に無いキーは無視して日本語を残す */
export function mergeTranslation<T>(base: T, fields: Record<string, unknown>): T {
	const merged = { ...(base as object) } as Record<string, unknown>;
	for (const [key, value] of Object.entries(fields)) {
		if (value === '' || value === null || value === undefined) continue;
		if (key === 'photoCaptions') {
			if (!Array.isArray(value) || !Array.isArray(merged.photos)) continue;
			merged.photos = (merged.photos as Photo[]).map((p, i) => {
				const c = value[i];
				return typeof c === 'string' && c.trim() ? { ...p, caption: c } : p;
			});
			continue;
		}
		if (key === 'specs') {
			const specs = normalizeSpecs(value);
			if (specs.length) merged.specs = specs;
			continue;
		}
		if (key === 'sections') {
			const sections = normalizeSections(value);
			if (sections.length) merged.sections = sections;
			continue;
		}
		// 配列が空の訳（amenities: [] など）は「訳していない」とみなして日本語を残す
		if (Array.isArray(value) && value.length === 0) continue;
		if (!(key in merged)) continue;
		merged[key] = value;
	}
	return merged as T;
}


// ---- 決まった言い回しの辞書（客室の設備・夕食のコース名）----
// 設備やコース名は同じ言葉が多くの客室・プランに出るので、1件ずつ訳を入れずにここで訳す（2026-11-22）。
// 辞書に無い言葉は日本語のまま出す（訳を足すときはここに1行足す）。
type Glossary = Record<string, { en: string; 'zh-TW': string }>;

const AMENITIES: Glossary = {
	'温泉掛け流しの客室半露天風呂': { en: 'Semi-open-air bath with free-flowing hot spring water', 'zh-TW': '源泉放流的客房半露天溫泉' },
	'無料Wi-Fi': { en: 'Free Wi-Fi', 'zh-TW': '免費 Wi-Fi' },
	'BOSEサウンドシステム': { en: 'Bose sound system', 'zh-TW': 'Bose 音響' },
	'テラス': { en: 'Terrace', 'zh-TW': '露台' },
	'エアコン': { en: 'Air conditioning', 'zh-TW': '空調' },
	'テレビ': { en: 'TV', 'zh-TW': '電視' },
	'空気清浄機': { en: 'Air purifier', 'zh-TW': '空氣清淨機' },
	'湯沸かしポット': { en: 'Electric kettle', 'zh-TW': '電熱水壺' },
	'加湿器': { en: 'Humidifier', 'zh-TW': '加濕器' },
	'ドライヤー': { en: 'Hair dryer', 'zh-TW': '吹風機' },
	'冷蔵庫': { en: 'Refrigerator', 'zh-TW': '冰箱' }
};

const DINNER_COURSES: Glossary = {
	'スタンダードコース': { en: 'Standard course', 'zh-TW': '標準套餐' },
	'フルコース': { en: 'Full course', 'zh-TW': '全套餐' },
	'銀雪コース': { en: 'Ginsetsu chicken course', 'zh-TW': '「銀雪」土雞套餐' },
	'すっぽん丸鍋のコース': { en: 'Soft-shell turtle (suppon) hot pot course', 'zh-TW': '甲魚（鱉）火鍋套餐' },
	'4種極みコース': { en: 'Four-meat course', 'zh-TW': '四種肉品套餐' }
};

function term(g: Glossary, ja: string, locale: string): string {
	const hit = g[ja.trim()];
	return hit && (locale === 'en' || locale === 'zh-TW') ? hit[locale] : ja;
}

/** 設備（amenities）と夕食のコース名（dinnerCourse）を辞書で訳す。ja・辞書に無い言葉はそのまま */
export function localizeTerms<T>(item: T, locale: string): T {
	if (locale === 'ja') return item;
	const o = item as Record<string, unknown>;
	const out = { ...o };
	if (Array.isArray(o.amenities)) out.amenities = (o.amenities as unknown[]).map((a) => (typeof a === 'string' ? term(AMENITIES, a, locale) : a));
	if (typeof o.dinnerCourse === 'string') out.dinnerCourse = term(DINNER_COURSES, o.dinnerCourse, locale);
	return out as T;
}
