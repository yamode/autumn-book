import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, activeNav, visibleNav } from './admin-nav';

const at = (url: string) => {
	const u = new URL(url, 'https://x');
	const r = activeNav(u.pathname, u.searchParams);
	return r ? `${r.item.label} > ${r.leaf.label}` : null;
};

describe('管理画面のメニューの現在地', () => {
	it('子の無い項目・長いパスが優先', () => {
		expect(at('/admin')).toBe('ダッシュボード > ダッシュボード');
		expect(at('/admin/reservations/ABC123')).toBe('予約管理 > 予約管理');
		expect(at('/admin/partners')).toBe('取引先 > 取引先の一覧');
		expect(at('/admin/vip')).toBe('VIP（特別会員） > VIP（特別会員）');
		expect(at('/admin/partners/123')).toBe('取引先 > 取引先の一覧');
		expect(at('/admin/partners/invoices')).toBe('取引先 > 予定請求書');
		expect(at('/admin/security/users')).toBe('ユーザー・セキュリティ > 二段階認証・パスキー');
	});
	it('事前チェックインは一覧も回答の詳細も同じ項目', () => {
		expect(at('/admin/precheckin')).toBe('事前チェックイン > 事前チェックイン');
		expect(at('/admin/precheckin/00000000-0000-4000-8000-000000000001')).toBe('事前チェックイン > 事前チェックイン');
		const group = ADMIN_NAV.find((g) => g.items.some((i) => i.href === '/admin/precheckin'));
		expect(group?.label).toBe('滞在中のお客様');
	});
	it('客室案内は ?tab で分ける（古い ?all は客室スリップ・バナーと入口QRは表示の設定）', () => {
		expect(at('/admin/inroom')).toBe('インフォメーション > きょうの運用');
		expect(at('/admin/inroom?tab=guides')).toBe('インフォメーション > 館内案内の内容');
		expect(at('/admin/inroom?tab=slips')).toBe('インフォメーション > 客室スリップ');
		expect(at('/admin/inroom?all=1')).toBe('インフォメーション > 客室スリップ');
		expect(at('/admin/inroom?tab=settings')).toBe('インフォメーション > 表示の設定');
		expect(at('/admin/inroom/banners')).toBe('インフォメーション > 表示の設定');
		expect(at('/admin/inroom/entry')).toBe('インフォメーション > 表示の設定');
		expect(at('/admin/inroom/billing')).toBe('インフォメーション > 精算案内');
		expect(at('/admin/inroom/preview')).toBe('インフォメーション > プレビュー・QR');
	});
	it('会員サポートは一覧・詳細・よくある質問の編集が同じ項目（会員・サイト・スタッフにも出す）', () => {
		expect(at('/admin/support')).toBe('会員サポート > 会員サポート');
		expect(at('/admin/support/00000000-0000-4000-8000-000000000001')).toBe('会員サポート > 会員サポート');
		expect(at('/admin/support/faqs')).toBe('会員サポート > 会員サポート');
		const group = ADMIN_NAV.find((g) => g.items.some((i) => i.href === '/admin/support'));
		expect(group?.label).toBe('会員・サイト');
		expect(visibleNav('staff').flatMap((g) => g.items.map((i) => i.href))).toContain('/admin/support');
	});
	it('出張シェフは Book で管理しないのでメニューに出さない', () => {
		expect(at('/admin/chef')).toBeNull();
		expect(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href))).not.toContain('/admin/chef');
	});
	it('どこにも無い画面は null', () => {
		expect(at('/admin/mfa')).toBeNull();
	});
	it('1画面は1箇所だけ（同じ href・tab の葉が重ならない）', () => {
		const keys = ADMIN_NAV.flatMap((g) => g.items.flatMap((i) => (i.children ?? [i]).map((l) => l.href)));
		expect(new Set(keys).size).toBe(keys.length);
	});
	it('スタッフにはユーザー管理を出さない', () => {
		const labels = (role: string) => visibleNav(role).flatMap((g) => g.items.flatMap((i) => (i.children ?? [i]).map((l) => l.label)));
		expect(labels('staff')).not.toContain('ユーザー管理');
		expect(labels('admin')).toContain('ユーザー管理');
	});
});
