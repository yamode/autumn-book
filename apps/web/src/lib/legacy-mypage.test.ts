import { describe, expect, it } from 'vitest';
import { jstDate, legacyMypageState, safeHttpsUrl } from './legacy-mypage';

const at = (iso: string) => new Date(iso);
const URL_NW = 'https://www.yamado.co.jp/?tripla_booking_widget_open=signIn';
const URL_OGA = 'https://oga.yamado.co.jp/?tripla_booking_widget_open=signIn';

describe('legacyMypageState', () => {
	it('URL が空なら出さない', () => {
		expect(legacyMypageState(at('2026-12-01T00:00:00+09:00'), {})).toEqual({ kind: 'hidden' });
		expect(legacyMypageState(at('2026-12-01T00:00:00+09:00'), { url: ' ', until: '2027-08-31' })).toEqual({ kind: 'hidden' });
	});
	it('https 以外は無効', () => {
		expect(safeHttpsUrl('javascript:alert(1)')).toBe('');
		expect(safeHttpsUrl('http://example.com')).toBe('');
		expect(safeHttpsUrl('not a url')).toBe('');
	});
	it('施設別の URL を共通 URL より優先し、施設ごとにリンクを返す', () => {
		const s = legacyMypageState(at('2026-12-01T00:00:00+09:00'), { urlNishiwaga: URL_NW, urlOga: URL_OGA, launchDate: '2026-12-01' });
		expect(s).toEqual({
			kind: 'active',
			phase: 'former',
			links: [
				{ facility: 'nishiwaga', url: URL_NW },
				{ facility: 'oga', url: URL_OGA }
			]
		});
	});
	it('共通 URL だけなら両施設に同じ URL', () => {
		const s = legacyMypageState(at('2026-12-01T00:00:00+09:00'), { url: URL_NW });
		expect(s.kind === 'active' && s.links.map((l) => l.url)).toEqual([URL_NW, URL_NW]);
	});
	it('公開日より前は current、以後は former（日本時間）', () => {
		const cfg = { url: URL_NW, launchDate: '2026-12-01' };
		expect(legacyMypageState(at('2026-11-30T14:59:59Z'), cfg)).toMatchObject({ phase: 'current' }); // JST 11/30 23:59
		expect(legacyMypageState(at('2026-11-30T15:00:00Z'), cfg)).toMatchObject({ phase: 'former' }); // JST 12/01 00:00
	});
	it('期限当日は表示、翌日から終了', () => {
		const cfg = { url: URL_NW, until: '2027-08-31' };
		expect(legacyMypageState(at('2027-08-31T14:59:59Z'), cfg).kind).toBe('active');
		expect(legacyMypageState(at('2027-08-31T15:00:00Z'), cfg)).toEqual({ kind: 'ended' });
	});
	it('期限が不正な書式なら期限なし扱い', () => {
		expect(legacyMypageState(at('2030-01-01T00:00:00Z'), { url: URL_NW, until: 'soon' }).kind).toBe('active');
	});
	it('jstDate', () => {
		expect(jstDate(at('2026-11-30T15:00:00Z'))).toBe('2026-12-01');
	});
});
