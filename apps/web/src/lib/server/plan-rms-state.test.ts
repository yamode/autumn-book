import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import { planRmsStateOf } from './content-admin';

describe('プランの料金（rms）との関係', () => {
	it('rms 先行（Book で作ったものではない）は rms', () => {
		expect(planRmsStateOf({ managed_by: 'rms_sync', book_origin: false })).toBe('rms');
		expect(planRmsStateOf({ managed_by: 'rms_sync', book_origin: null })).toBe('rms');
	});
	it('ビューを読めなかったときは rms 先行として扱う', () => {
		expect(planRmsStateOf(undefined)).toBe('rms');
	});
	it('Book で作って rms に紐づけ済みなら linked、まだなら awaiting', () => {
		expect(planRmsStateOf({ managed_by: 'rms_sync', book_origin: true })).toBe('linked');
		expect(planRmsStateOf({ managed_by: 'book', book_origin: true })).toBe('awaiting');
	});
});
