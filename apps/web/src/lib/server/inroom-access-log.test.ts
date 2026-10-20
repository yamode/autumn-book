import { describe, expect, it } from 'vitest';
import { deviceKind, normalizeInroomPath, summarizeAccess, type AccessLogRow } from './inroom-access-log';

describe('客室案内のアクセスログ', () => {
	it('記録するのは客室案内のページだけ', () => {
		expect(normalizeInroomPath('/r')).toEqual({ path: '/r', guideId: null });
		expect(normalizeInroomPath('/r/')).toEqual({ path: '/r', guideId: null });
		expect(normalizeInroomPath('/r/g/abc-123')).toEqual({ path: '/r/g/abc-123', guideId: 'abc-123' });
		expect(normalizeInroomPath('/r/bath')).toEqual({ path: '/r/bath', guideId: null });
		expect(normalizeInroomPath('/r/bath/complete')).toEqual({ path: '/r/bath/complete', guideId: null });
		expect(normalizeInroomPath('/admin')).toBeNull();
		expect(normalizeInroomPath('/r/api/view')).toBeNull();
		expect(normalizeInroomPath('/r/g/<script>')).toBeNull();
		expect(normalizeInroomPath(123)).toBeNull();
	});

	it('端末の種類だけを残す', () => {
		expect(deviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
		expect(deviceKind('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('Android');
		expect(deviceKind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Mobile/15E148 Safari')).toBe('iPad');
		expect(deviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('PC');
		expect(deviceKind(null)).toBe('その他');
	});

	it('期間集計：ページ・日（JST）・部屋ごとに数え、見本の滞在は除く', () => {
		const row = (createdAt: string, path: string, guideId: string | null, roomCode: string | null, visitorId: string, isDemo = false): AccessLogRow => ({
			id: createdAt + path, createdAt, roomCode, guestName: null, tokenId: null, isDemo, path, guideId, locale: 'ja', device: 'iPhone', visitorId
		});
		const s = summarizeAccess([
			row('2026-10-01T14:59:00Z', '/r', null, '101', 'a'), // JST 10/1 23:59
			row('2026-10-01T15:00:00Z', '/r', null, '101', 'a'), // JST 10/2 0:00
			row('2026-10-02T01:00:00Z', '/r/g/onsen', 'onsen', null, 'b'),
			row('2026-10-02T02:00:00Z', '/r', null, '102', 'c'),
			row('2026-10-02T03:00:00Z', '/r', null, '103', 'z', true)
		]);
		expect(s.totals).toEqual({ views: 4, visitors: 3, rooms: 2 });
		expect(s.byPage).toEqual([
			{ path: '/r', guideId: null, views: 3, visitors: 2 },
			{ path: '/r/g/onsen', guideId: 'onsen', views: 1, visitors: 1 }
		]);
		expect(s.byDay).toEqual([
			{ day: '2026-10-01', views: 1, visitors: 1 },
			{ day: '2026-10-02', views: 3, visitors: 3 }
		]);
		expect(s.byRoom.map((r) => r.roomCode)).toEqual(['101', '102', null]);
	});
});
