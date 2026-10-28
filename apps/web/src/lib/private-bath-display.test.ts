import { describe, expect, it } from 'vitest';
import { bathGuestDisplay, bathRoomDisplay } from './private-bath-display';

describe('bathGuestDisplay（お名前）', () => {
	it('旧トークン（display_name なし）は guest_name を敬称付きで出す', () => {
		expect(bathGuestDisplay({ guest_name: 'プライム ME JAPAN' })).toEqual({ name: 'プライム ME JAPAN', honorific: true });
	});
	it('部屋ごとのお客様名（guest）は敬称付き', () => {
		expect(bathGuestDisplay({ guest_name: '代表 太郎', display_name: '山田 花子', display_kind: 'guest' })).toEqual({
			name: '山田 花子',
			honorific: true
		});
	});
	it('ツアー名は敬称を付けない', () => {
		expect(bathGuestDisplay({ guest_name: '代表', display_name: '東北周遊5日間', display_kind: 'tour' })).toEqual({
			name: '東北周遊5日間',
			honorific: false
		});
	});
	it('どちらも空なら null', () => {
		expect(bathGuestDisplay({ guest_name: ' ', display_name: null })).toBeNull();
		expect(bathGuestDisplay({})).toBeNull();
	});
});

describe('bathRoomDisplay（お部屋）', () => {
	const room = { room_code: '落の蘆', room_label: '落の蘆', room_number: '201', room_name_en: 'Ochi no Ro' };
	it('日本語・繁体字は全角カッコで番号だけ添える', () => {
		expect(bathRoomDisplay(room, 'ja')).toBe('落の蘆（201）');
		expect(bathRoomDisplay(room, 'zh-TW')).toBe('落の蘆（201）');
	});
	it('英語は英語名＋半角カッコ', () => {
		expect(bathRoomDisplay(room, 'en')).toBe('Ochi no Ro (201)');
	});
	it('英語名が無ければ日本語名で出す', () => {
		expect(bathRoomDisplay({ ...room, room_name_en: null }, 'en')).toBe('落の蘆 (201)');
	});
	it('部屋番号が無い・部屋名と同じなら部屋名だけ', () => {
		expect(bathRoomDisplay({ ...room, room_number: null }, 'ja')).toBe('落の蘆');
		expect(bathRoomDisplay({ room_code: '201', room_label: '201', room_number: '201' }, 'ja')).toBe('201');
	});
	it('古い DB（新しい項目なし）は room_code のまま', () => {
		expect(bathRoomDisplay({ room_code: '落の蘆' }, 'en')).toBe('落の蘆');
	});
	it('割当部屋の名前を優先し、トークンの古い部屋名を使わない', () => {
		expect(bathRoomDisplay({ room_code: '旧部屋', room_label: '萌木', room_number: '201' }, 'ja')).toBe('萌木（201）');
	});
});
