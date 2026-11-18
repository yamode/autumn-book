import { describe, expect, it } from 'vitest';
import { translationFieldsFromForm } from './content-translations-admin';
import type { TranslationSource } from '$lib/content-translation';

const source: TranslationSource = {
	name: '部屋',
	headline: '見出し',
	description: '説明',
	tags: ['2食付き'],
	amenities: ['エアコン', 'テレビ'],
	specs: [
		{ label: '広さ', value: '62㎡' },
		{ label: '人数', value: '1～2名' }
	],
	sections: [{ group: '浴室', title: '半露天風呂', text: '本文', photo: 'https://example.com/a.webp' }],
	photoCaptions: ['', '浴室']
};

const formOf = (entries: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
};

describe('translationFieldsFromForm', () => {
	it('訳のある項目だけを持ち、表と紹介ブロックは日本語の並びで組み立てる', () => {
		const fields = translationFieldsFromForm(
			formOf({ name: 'Room', headline: '', description: 'Desc\r\nline', amenities: 'Air conditioning\nTV\n', spec_label_0: 'Size', sec_title_0: 'Semi-open-air Bath', caption_1: 'Bathroom' }),
			source,
			'room_type'
		);
		expect(fields.name).toBe('Room');
		expect(fields.headline).toBeUndefined();
		expect(fields.description).toBe('Desc\nline');
		expect(fields.amenities).toEqual(['Air conditioning', 'TV']);
		expect(fields.specs).toEqual([
			{ label: 'Size', value: '62㎡' },
			{ label: '人数', value: '1～2名' }
		]);
		expect(fields.sections).toEqual([{ group: '浴室', title: 'Semi-open-air Bath', text: '本文', photo: 'https://example.com/a.webp' }]);
		expect(fields.photoCaptions).toEqual(['', 'Bathroom']);
	});

	it('プランは見出しの訳を名前にも使い、何も入れなければ空', () => {
		expect(translationFieldsFromForm(formOf({ headline: 'Plan', tags: 'Dinner & breakfast' }), source, 'plan')).toEqual({
			name: 'Plan',
			headline: 'Plan',
			highlightTags: ['Dinner & breakfast']
		});
		expect(translationFieldsFromForm(formOf({}), source, 'plan')).toEqual({});
	});
});
