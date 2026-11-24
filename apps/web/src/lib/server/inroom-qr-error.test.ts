import { describe, expect, it } from 'vitest';
import { issueQrErrorMessage } from './inroom-qr-error';

// supabase-js のエラーは Error ではなく { message, code, ... } のただのオブジェクト
const pg = (message: string) => ({ message, code: 'P0001', details: null, hint: null });

describe('issueQrErrorMessage', () => {
	it('チェックアウト日の 11:00 を過ぎた（stay_expired）は終了と分かる言葉にする', () => {
		expect(issueQrErrorMessage(pg('stay_expired'))).toContain('11:00 を過ぎた');
	});
	it('取消・ノーショー（stay_not_found）', () => {
		expect(issueQrErrorMessage(pg('stay_not_found'))).toContain('取消・ノーショー');
	});
	it('権限なし（forbidden）', () => {
		expect(issueQrErrorMessage(pg('forbidden'))).toContain('権限');
	});
	it('知らない理由は元の文言を添える', () => {
		expect(issueQrErrorMessage(pg('something_else'))).toBe('URLの取得に失敗しました（something_else）');
	});
	it('Error でも同じに扱う', () => {
		expect(issueQrErrorMessage(new Error('stay_expired'))).toContain('11:00 を過ぎた');
	});
	it('理由が取れなければ従来の文言', () => {
		expect(issueQrErrorMessage(null)).toBe('URLの取得に失敗しました');
		expect(issueQrErrorMessage('x')).toBe('URLの取得に失敗しました');
	});
});
