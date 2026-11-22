import { describe, expect, it } from 'vitest';
import { mergeTranslation } from './content-translation';

const base = {
	id: 'p1',
	name: '【素泊まりプラン】男鹿の自然と一体になる特別なひととき。',
	headline: '【素泊まりプラン】',
	description: '日本語の説明',
	amenities: ['Wi-Fi'],
	specs: [{ label: '食事', value: 'なし' }],
	photos: [
		{ url: 'a.jpg', caption: '外観', category: 'exterior' as const },
		{ url: 'b.jpg', caption: 'ラウンジ', category: 'room' as const }
	]
};

describe('mergeTranslation', () => {
	it('訳のある欄だけ差し替え、空の欄は日本語のまま', () => {
		const out = mergeTranslation(base, { name: 'Room Only', headline: 'Room Only', description: '', amenities: [] });
		expect(out.name).toBe('Room Only');
		expect(out.headline).toBe('Room Only');
		expect(out.description).toBe('日本語の説明');
		expect(out.amenities).toEqual(['Wi-Fi']);
	});

	it('写真の説明は順番に差し替え、足りない分は日本語のまま', () => {
		const out = mergeTranslation(base, { photoCaptions: ['[Exterior]'] });
		expect(out.photos.map((p) => p.caption)).toEqual(['[Exterior]', 'ラウンジ']);
		expect(out.photos[0].url).toBe('a.jpg');
	});

	it('仕様の表は形を整えてから差し替える', () => {
		const out = mergeTranslation(base, { specs: [{ label: 'Meals', value: 'No meals' }] });
		expect(out.specs).toEqual([{ label: 'Meals', value: 'No meals' }]);
	});

	it('元に無いキーは足さない', () => {
		const out = mergeTranslation(base, { highlightTags: ['x'], name: 'Room Only' }) as Record<string, unknown>;
		expect('highlightTags' in out).toBe(false);
	});
});

import { localizeTerms } from './content-translation';

describe('localizeTerms', () => {
	it('設備とコース名を辞書で訳し、無い言葉は残す', () => {
		const out = localizeTerms({ amenities: ['無料Wi-Fi', '謎の設備'], dinnerCourse: 'スタンダードコース' }, 'en');
		expect(out.amenities).toEqual(['Free Wi-Fi', '謎の設備']);
		expect(out.dinnerCourse).toBe('Standard course');
	});
	it('日本語ではそのまま', () => {
		const item = { amenities: ['テラス'] };
		expect(localizeTerms(item, 'ja')).toBe(item);
	});
});
