import { describe, expect, it } from 'vitest';
import {
	adminMfaErrorText,
	adminMfaRedirectTarget,
	decideAdminMfaGate,
	isAdminPath,
	normalizeTotpCode,
	parseAdminMfaRequired,
	safeAdminNext
} from './admin-mfa';

const enrolledAal1 = { current: 'aal1', verifiedFactors: 1 };
const enrolledAal2 = { current: 'aal2', verifiedFactors: 1 };
const notEnrolled = { current: 'aal1', verifiedFactors: 0 };

describe('decideAdminMfaGate', () => {
	it('登録済みで aal1 なら、ADMIN_MFA_REQUIRED に関係なく確認画面へ', () => {
		for (const required of [false, true]) {
			expect(decideAdminMfaGate({ pathname: '/admin', role: 'admin', aal: enrolledAal1, required })).toBe('challenge');
			expect(decideAdminMfaGate({ pathname: '/admin/partners/abc', role: 'staff', aal: enrolledAal1, required })).toBe('challenge');
		}
	});

	it('登録済みで aal1 でも、確認画面そのものは通す（ループしない）', () => {
		expect(decideAdminMfaGate({ pathname: '/admin/mfa', role: 'admin', aal: enrolledAal1, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin/mfa/', role: 'admin', aal: enrolledAal1, required: true })).toBe('ok');
	});

	it('登録済みで aal1 なら、登録画面（他の端末の追加）も確認が先', () => {
		expect(decideAdminMfaGate({ pathname: '/admin/security', role: 'admin', aal: enrolledAal1, required: false })).toBe('challenge');
		expect(decideAdminMfaGate({ pathname: '/admin/security/users', role: 'admin', aal: enrolledAal1, required: false })).toBe('challenge');
	});

	it('aal2 なら全部通す', () => {
		expect(decideAdminMfaGate({ pathname: '/admin/partners', role: 'admin', aal: enrolledAal2, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin/mfa', role: 'admin', aal: enrolledAal2, required: true })).toBe('ok');
	});

	it('未登録・必須でない（既定）なら通す', () => {
		expect(decideAdminMfaGate({ pathname: '/admin/partners', role: 'staff', aal: notEnrolled, required: false })).toBe('ok');
	});

	it('未登録・必須なら登録画面へ。登録画面だけは通す', () => {
		expect(decideAdminMfaGate({ pathname: '/admin', role: 'staff', aal: notEnrolled, required: true })).toBe('enroll');
		expect(decideAdminMfaGate({ pathname: '/admin/mfa', role: 'staff', aal: notEnrolled, required: true })).toBe('enroll');
		expect(decideAdminMfaGate({ pathname: '/admin/security/users', role: 'admin', aal: notEnrolled, required: true })).toBe('enroll');
		expect(decideAdminMfaGate({ pathname: '/admin/security', role: 'staff', aal: notEnrolled, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin/security/', role: 'staff', aal: notEnrolled, required: true })).toBe('ok');
	});

	it('ログイン画面・/admin 外・管理者以外・demo（aal なし）は判定しない', () => {
		expect(decideAdminMfaGate({ pathname: '/admin/login', role: 'admin', aal: enrolledAal1, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/auth/logout', role: 'admin', aal: enrolledAal1, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/administrator', role: 'admin', aal: enrolledAal1, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin', role: 'member', aal: enrolledAal1, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin', role: undefined, aal: null, required: true })).toBe('ok');
		expect(decideAdminMfaGate({ pathname: '/admin', role: 'admin', aal: null, required: true })).toBe('ok');
	});
});

describe('adminMfaRedirectTarget', () => {
	it('確認画面へは元の画面を next に付ける', () => {
		expect(adminMfaRedirectTarget('challenge', '/admin/partners', '?tab=1')).toBe('/admin/mfa?next=%2Fadmin%2Fpartners%3Ftab%3D1');
		expect(adminMfaRedirectTarget('challenge', '/admin')).toBe('/admin/mfa');
	});
	it('登録画面と ok', () => {
		expect(adminMfaRedirectTarget('enroll', '/admin/partners')).toBe('/admin/security?enroll=1');
		expect(adminMfaRedirectTarget('ok', '/admin/partners')).toBeNull();
	});
});

describe('safeAdminNext', () => {
	it('/admin 配下だけを許す', () => {
		expect(safeAdminNext('/admin/partners?x=1')).toBe('/admin/partners?x=1');
		expect(safeAdminNext('/admin')).toBe('/admin');
	});
	it('外部・プロトコル相対・バックスラッシュ・/admin 外は /admin に落とす', () => {
		for (const bad of ['/admin/../p/token', '/admin\n', 'https://evil.example/admin', '//evil.example/admin', '/\\evil.example', '/p/token', '/administrator', 'admin', '', null, undefined]) {
			expect(safeAdminNext(bad)).toBe('/admin');
		}
	});
	it('MFA 画面・ログイン画面へは戻さない', () => {
		expect(safeAdminNext('/admin/mfa?next=/admin')).toBe('/admin');
		expect(safeAdminNext('/admin/login')).toBe('/admin');
	});
});

describe('parseAdminMfaRequired', () => {
	it('true 系だけ true・既定 false', () => {
		expect(parseAdminMfaRequired('true')).toBe(true);
		expect(parseAdminMfaRequired(' TRUE ')).toBe(true);
		expect(parseAdminMfaRequired('1')).toBe(true);
		expect(parseAdminMfaRequired('on')).toBe(true);
		expect(parseAdminMfaRequired('false')).toBe(false);
		expect(parseAdminMfaRequired('')).toBe(false);
		expect(parseAdminMfaRequired(undefined)).toBe(false);
		expect(parseAdminMfaRequired('ture')).toBe(false);
	});
});

describe('normalizeTotpCode', () => {
	it('区切り・全角を許して 6 桁にする', () => {
		expect(normalizeTotpCode('123456')).toBe('123456');
		expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
		expect(normalizeTotpCode('123-456')).toBe('123456');
		expect(normalizeTotpCode('１２３４５６')).toBe('123456');
	});
	it('6 桁にならなければ null', () => {
		expect(normalizeTotpCode('12345')).toBeNull();
		expect(normalizeTotpCode('1234567')).toBeNull();
		expect(normalizeTotpCode('12a456')).toBeNull();
		expect(normalizeTotpCode('')).toBeNull();
		expect(normalizeTotpCode(null)).toBeNull();
	});
});

describe('adminMfaErrorText', () => {
	it('TOTP 未有効は設定場所を案内する', () => {
		expect(adminMfaErrorText({ code: 'mfa_totp_enroll_not_enabled' })).toContain('Authentication → Multi-Factor');
	});
	it('コード違い', () => {
		expect(adminMfaErrorText({ code: 'mfa_verification_failed' })).toContain('コードが違います');
	});
	it('不明なエラーは原文を添える', () => {
		expect(adminMfaErrorText({ code: 'x', message: 'boom' })).toContain('boom');
		expect(adminMfaErrorText(null)).toBe('二段階認証の処理に失敗しました。');
	});
});
