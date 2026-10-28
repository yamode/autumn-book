import { describe, expect, it } from 'vitest';
import { gaPageLocation } from './ga-page-location';

const O = 'https://book.yamado.app';

describe('gaPageLocation', () => {
	it('utm_* だけ残し、checkin など他のクエリは落とす', () => {
		expect(gaPageLocation(O, '/yamado/oga', '?utm_source=hp_oga&utm_content=header&checkin=2026-12-20&adults=2')).toBe(
			`${O}/yamado/oga?utm_source=hp_oga&utm_content=header`
		);
	});
	it('utm が無ければクエリ無し', () => {
		expect(gaPageLocation(O, '/search', '?checkin=2026-12-20')).toBe(`${O}/search`);
		expect(gaPageLocation(O, '/', '')).toBe(`${O}/`);
	});
	it('予約コードはパスで置き換える（クエリのトークンは落ちる）', () => {
		expect(gaPageLocation(O, '/booking/complete/AB123', '?t=secret&utm_source=x')).toBe(`${O}/booking/complete/:code?utm_source=x`);
		expect(gaPageLocation(O, '/account/reservations/AB123', '')).toBe(`${O}/account/reservations/:code`);
	});
	it('utm 以外の名前（utmx など）は残さない', () => {
		expect(gaPageLocation(O, '/', '?utmx=1&utm_=2&utm_campaign=reserve')).toBe(`${O}/?utm_campaign=reserve`);
	});
});
