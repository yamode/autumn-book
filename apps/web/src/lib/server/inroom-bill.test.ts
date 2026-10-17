import { describe, expect, it } from 'vitest';
import { canTestInroomPayment } from './inroom-bill';

// プレビューでの本番 Stripe のテスト決済を使える人（2026-10-17）。管理者で、/admin と同じ二段階認証の関所を通っている人だけ
const locals = (role: string | null, aal: App.Locals['adminAal']) =>
	({ user: role ? { id: 'u1', role, name: 'x' } : null, pendingAuthUser: null, adminAal: aal }) as unknown as App.Locals;

describe('テスト決済を使える人', () => {
	it('管理者で二段階認証が済んでいれば使える', () => {
		expect(canTestInroomPayment(locals('admin', { current: 'aal2', verifiedFactors: 1 }))).toBe(true);
		// 第2要素を登録していない管理者（必須にしていない）は関所と同じく通る
		expect(canTestInroomPayment(locals('admin', { current: 'aal1', verifiedFactors: 0 }))).toBe(true);
	});
	it('登録済みなのに確認していない管理者・スタッフ・会員・未ログインは使えない', () => {
		expect(canTestInroomPayment(locals('admin', { current: 'aal1', verifiedFactors: 1 }))).toBe(false);
		expect(canTestInroomPayment(locals('staff', { current: 'aal2', verifiedFactors: 1 }))).toBe(false);
		expect(canTestInroomPayment(locals('member', null))).toBe(false);
		expect(canTestInroomPayment(locals(null, null))).toBe(false);
	});
});
