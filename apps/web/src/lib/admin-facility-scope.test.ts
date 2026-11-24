import { describe, expect, it } from 'vitest';
import { canOperateFacility, isFacilityScopedAdminPath, isTenantWideAdminPath, pickFacilityId } from './admin-facility-scope';

const ALL = ['f-nishiwaga', 'f-oga'];

// ログインし直したあとに「担当の施設」から始まること（2026-11-24 の不具合）。
describe('pickFacilityId', () => {
	it('クッキーが無ければ担当の施設から始める（先頭の施設ではない）', () => {
		expect(pickFacilityId(ALL, undefined, { bookIds: ['f-oga'] })).toEqual({ id: 'f-oga', fromCookie: false });
	});

	it('担当が全施設なら先頭', () => {
		expect(pickFacilityId(ALL, undefined, 'all')).toEqual({ id: 'f-nishiwaga', fromCookie: false });
	});

	it('クッキーがあればそれに従う（担当外の施設も開ける＝閲覧のみ）', () => {
		expect(pickFacilityId(ALL, 'f-nishiwaga', { bookIds: ['f-oga'] })).toEqual({ id: 'f-nishiwaga', fromCookie: true });
	});

	it('知らないクッキーは無視して担当の施設', () => {
		expect(pickFacilityId(ALL, 'f-unknown', { bookIds: ['f-oga'] })).toEqual({ id: 'f-oga', fromCookie: false });
	});

	it('担当がどれでもなければ先頭（締め出さない）', () => {
		expect(pickFacilityId(ALL, undefined, { bookIds: ['f-gone'] })).toEqual({ id: 'f-nishiwaga', fromCookie: false });
	});
});

describe('canOperateFacility', () => {
	it('担当の施設だけ true・all は全部 true', () => {
		expect(canOperateFacility({ bookIds: ['f-oga'] }, 'f-oga')).toBe(true);
		expect(canOperateFacility({ bookIds: ['f-oga'] }, 'f-nishiwaga')).toBe(false);
		expect(canOperateFacility('all', 'f-nishiwaga')).toBe(true);
	});
});

// 担当外の施設を開いているときに「保存を止める画面」の線引き（2026-11-24 指示）。
describe('isFacilityScopedAdminPath', () => {
	it('施設に紐づく画面は対象（保存を止める）', () => {
		for (const p of ['/admin/inroom', '/admin/inroom/billing', '/admin/reservations', '/admin/plans', '/admin/rooms', '/admin/facility', '/admin/bath', '/admin/precheckin']) {
			expect(isFacilityScopedAdminPath(p), p).toBe(true);
		}
	});

	it('テナント共通の画面は対象外（そのまま編集できる）', () => {
		for (const p of ['/admin/members', '/admin/members/legacy', '/admin/coupons', '/admin/cancel-policies', '/admin/users', '/admin/support', '/admin/push', '/admin/app']) {
			expect(isFacilityScopedAdminPath(p), p).toBe(false);
		}
	});

	it('/admin/inquiries は施設ごと・/admin/inquiries/ai は共通（最長一致）', () => {
		expect(isFacilityScopedAdminPath('/admin/inquiries')).toBe(true);
		expect(isFacilityScopedAdminPath('/admin/inquiries/123')).toBe(true);
		expect(isFacilityScopedAdminPath('/admin/inquiries/ai')).toBe(false);
	});

	it('ログイン・二段階認証・SSO・施設切替は止めない（止めるとログインできなくなる）', () => {
		for (const p of ['/admin/login', '/admin/login/reset', '/admin/login/passkey/verify', '/admin/mfa', '/admin/mfa/passkey/verify', '/admin/sso', '/admin/switch']) {
			expect(isFacilityScopedAdminPath(p), p).toBe(false);
		}
	});

	it('ダッシュボードと /admin の外は対象外', () => {
		expect(isFacilityScopedAdminPath('/admin')).toBe(false);
		expect(isFacilityScopedAdminPath('/r/start')).toBe(false);
		expect(isFacilityScopedAdminPath('/')).toBe(false);
	});

	it('前方一致で隣の名前を巻き込まない', () => {
		// /admin/members（共通）が /admin/members-foo を共通扱いしない
		expect(isTenantWideAdminPath('/admin/members-foo')).toBe(false);
		expect(isFacilityScopedAdminPath('/admin/members-foo')).toBe(true);
	});

	it('メニューに無い画面は施設に紐づく扱い（安全側）', () => {
		expect(isFacilityScopedAdminPath('/admin/something-new')).toBe(true);
	});
});
