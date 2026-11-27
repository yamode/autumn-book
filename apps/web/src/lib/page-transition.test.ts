// ページ移動の読み込み中の形（$lib/page-transition の loadingShape）。
// A面（公開サイト）と B面（取引先ページ）のどのページも、汎用の1行（plain）にならないこと（2026-11-23 総点検）。
import { describe, expect, it } from 'vitest';
import { loadingShape } from './page-transition';

// src/routes の +page.svelte から SvelteKit の route.id を作る
const pages = Object.keys(import.meta.glob(['/src/routes/**/+page.svelte']));
const routeIds = pages
	.map((p) => p.replace('/src/routes', '').replace(/\/\+page\.svelte$/, '') || '/')
	.filter((id) => id.startsWith('/(public)') || id.startsWith('/p/'));

// B面のメニューの最上位は PartnerPageSkeleton が受け持つ（p/[token]/+layout.svelte）
const PARTNER_MENU_TOP = /^\/p\/\[token\]\/[^/]+$/;

describe('loadingShape', () => {
	it('A面・B面のページを見つけている', () => {
		expect(routeIds).toContain('/(public)');
		expect(routeIds).toContain('/p/[token]/group/[id]');
	});
	it('どのページも汎用の1行（plain）にならない', () => {
		const plain = routeIds.filter((id) => !PARTNER_MENU_TOP.test(id) && loadingShape(id) === 'plain');
		expect(plain).toEqual([]);
	});
	it('詳細は詳細の形、入力は入力の形', () => {
		expect(loadingShape('/(public)')).toBe('home');
		expect(loadingShape('/(public)/[brand]/[facility]/plans/[plan]')).toBe('plan-detail');
		expect(loadingShape('/(public)/account/reservations/[code]')).toBe('reservation-detail');
		expect(loadingShape('/(public)/account/reservations/[code]/amend')).toBe('form');
		expect(loadingShape('/p/[token]/group/[id]')).toBe('reservation-detail');
		expect(loadingShape('/p/[token]')).toBe('auth');
	});
});
