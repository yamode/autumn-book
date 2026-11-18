import { describe, expect, it } from 'vitest';
import { mergeContentTranslation } from './supabase-data';
import type { RoomType } from '$lib/types';

const room = {
	id: 'r1', facilityId: 'f1', slug: '07', name: 'ラグジュアリースイート', headline: 'ラグジュアリースイート', description: '説明',
	capacity: 4, sizeM2: 62, totalRooms: 0, amenities: ['エアコン'],
	photos: [{ url: 'a.webp', caption: '', category: 'room' }, { url: 'b.webp', caption: '浴室', category: 'bath' }],
	specs: [{ label: '広さ', value: '62㎡' }], sections: []
} as unknown as RoomType;

describe('mergeContentTranslation', () => {
	it('翻訳がある項目だけ上書きし、空は日本語のまま', () => {
		const out = mergeContentTranslation(room, {
			name: 'Luxury Suite', headline: '', description: 'Desc', amenities: ['Air conditioning'],
			specs: [{ label: 'Size', value: '62㎡' }], photoCaptions: ['', 'Bathroom']
		});
		expect(out.name).toBe('Luxury Suite');
		expect(out.headline).toBe('ラグジュアリースイート');
		expect(out.description).toBe('Desc');
		expect(out.amenities).toEqual(['Air conditioning']);
		expect(out.specs[0].label).toBe('Size');
		expect(out.photos.map((p) => p.caption)).toEqual(['', 'Bathroom']);
		expect(room.name).toBe('ラグジュアリースイート');
	});
});
