import { describe, expect, it } from 'vitest';
import { decideStayForScannedRoom } from './inroom-room-match';

const base = { stayFacilitySlug: 'nishiwaga', stayRoomCode: '201', scannedFacilitySlug: 'nishiwaga', scannedRoomCode: '201' };

describe('decideStayForScannedRoom', () => {
	it('同じ部屋の QR を読み直したら滞在を保つ', () => {
		expect(decideStayForScannedRoom(base)).toBe('keep');
	});

	it('同じ施設の別の部屋なら外す（食事時間・風呂の枠は部屋ごと）', () => {
		expect(decideStayForScannedRoom({ ...base, scannedRoomCode: '305' })).toBe('other-room');
	});

	it('別の施設なら外す', () => {
		expect(decideStayForScannedRoom({ ...base, scannedFacilitySlug: 'oga' })).toBe('other-facility');
	});

	it('別の施設かつ別の部屋なら施設の方を理由にする', () => {
		expect(decideStayForScannedRoom({ ...base, scannedFacilitySlug: 'oga', scannedRoomCode: '305' })).toBe('other-facility');
	});

	it('部屋の割り当てが分からない滞在は外さない', () => {
		expect(decideStayForScannedRoom({ ...base, stayRoomCode: null, scannedRoomCode: '305' })).toBe('keep');
		expect(decideStayForScannedRoom({ ...base, stayRoomCode: '  ', scannedRoomCode: '305' })).toBe('keep');
	});

	it('読んだ QR が部屋名を持たないときは外さない', () => {
		expect(decideStayForScannedRoom({ ...base, scannedRoomCode: '' })).toBe('keep');
	});

	it('施設が分からないときは外さない', () => {
		expect(decideStayForScannedRoom({ ...base, stayFacilitySlug: '', scannedRoomCode: '201' })).toBe('keep');
	});

	it('前後の空白と大小文字は無視する', () => {
		expect(decideStayForScannedRoom({ ...base, stayRoomCode: ' A-1 ', scannedRoomCode: 'a-1' })).toBe('keep');
	});
});
