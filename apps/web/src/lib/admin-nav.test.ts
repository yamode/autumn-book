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
		expect(at('/admin/partners/123')).toBe('取引先 > 取引先の一覧');
		expect(at('/admin/partners/invoices')).toBe('取引先 > 予定請求書');
		expect(at('/admin/security/users')).toBe('ユーザー・セキュリティ > 二段階認証・パスキー');
	});
	it('客室案内は ?tab で分ける（古い ?all は客室スリップ・バナーと入口QRは表示の設定）', () => {
		expect(at('/admin/inroom')).toBe('客室案内 > きょうの運用');
		expect(at('/admin/inroom?tab=guides')).toBe('客室案内 > 館内案内の内容');
		expect(at('/admin/inroom?tab=slips')).toBe('客室案内 > 客室スリップ');
		expect(at('/admin/inroom?all=1')).toBe('客室案内 > 客室スリップ');
		expect(at('/admin/inroom?tab=settings')).toBe('客室案内 > 表示の設定');
		expect(at('/admin/inroom/banners')).toBe('客室案内 > 表示の設定');
		expect(at('/admin/inroom/entry')).toBe('客室案内 > 表示の設定');
		expect(at('/admin/inroom/billing')).toBe('客室案内 > 精算案内');
		expect(at('/admin/inroom/preview')).toBe('客室案内 > プレビュー・QR');
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
