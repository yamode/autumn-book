import { describe, expect, it } from 'vitest';
import { deviceKind, normalizeInroomPath } from './inroom-access-log';

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
});
