import { describe, expect, it } from 'vitest';
import { inquiryListSearch } from './inquiry-list-return';

describe('一覧の絞り込みを覚える', () => {
	it('状態・検索語・ページ・過去のやり取りだけ残す', () => {
		expect(inquiryListSearch('?status=new&origin=current&q=%E8%A8%AD%E5%82%99&page=2&x=1')).toBe('?status=new&origin=current&q=%E8%A8%AD%E5%82%99&page=2');
		expect(inquiryListSearch('')).toBe('');
		expect(inquiryListSearch('?evil=1')).toBe('');
	});
});
