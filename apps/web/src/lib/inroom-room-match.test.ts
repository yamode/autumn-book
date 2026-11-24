import { describe, expect, it } from 'vitest';
import { decideStayForScannedRoom } from './inroom-room-match';

// 既定（風呂も食事も部屋ごと）＝ sharedRooms は自分の部屋だけ
const base = { stayFacilitySlug: 'nishiwaga', sharedRooms: ['201'], scannedFacilitySlug: 'nishiwaga', scannedRoomCode: '201' };

describe('decideStayForScannedRoom', () => {
	it('同じ部屋の QR を読み直したら滞在を保つ', () => {
		expect(decideStayForScannedRoom(base)).toBe('keep');
	});

	it('共有していないグループの別の部屋なら外す（食事時間・風呂の枠が部屋ごと）', () => {
		expect(decideStayForScannedRoom({ ...base, scannedRoomCode: '202' })).toBe('other-room');
	});

	it('風呂も食事も共有しているグループの部屋なら保つ', () => {
		expect(decideStayForScannedRoom({ ...base, sharedRooms: ['201', '202', '203'], scannedRoomCode: '203' })).toBe('keep');
	});

	it('共有しているグループでも、グループの外の部屋なら外す', () => {
		expect(decideStayForScannedRoom({ ...base, sharedRooms: ['201', '202'], scannedRoomCode: '305' })).toBe('other-room');
	});

	it('別の施設なら外す（共有グループでも）', () => {
		expect(decideStayForScannedRoom({ ...base, sharedRooms: ['201', '202'], scannedFacilitySlug: 'oga', scannedRoomCode: '202' })).toBe('other-facility');
	});

	it('部屋が分からない滞在は外さない', () => {
		expect(decideStayForScannedRoom({ ...base, sharedRooms: [], scannedRoomCode: '305' })).toBe('keep');
		expect(decideStayForScannedRoom({ ...base, sharedRooms: ['  '], scannedRoomCode: '305' })).toBe('keep');
	});

	it('読んだ QR が部屋名を持たないときは外さない', () => {
		expect(decideStayForScannedRoom({ ...base, scannedRoomCode: '' })).toBe('keep');
	});

	it('施設が分からないときは施設では外さない', () => {
		expect(decideStayForScannedRoom({ ...base, stayFacilitySlug: '', scannedRoomCode: '201' })).toBe('keep');
	});

	it('前後の空白と大小文字は無視する', () => {
		expect(decideStayForScannedRoom({ ...base, sharedRooms: [' A-1 '], scannedRoomCode: 'a-1' })).toBe('keep');
	});
});
