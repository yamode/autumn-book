// エラー監視に送る前の個人情報の消し方（$lib/sentry.ts）
import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/sveltekit';
import { scrubSentryEvent, scrubUrl } from './sentry';

describe('scrubUrl', () => {
	it('クエリ・ハッシュと、URL の途中の長いトークンを消す', () => {
		expect(scrubUrl('https://book.yamado.app/plan/abcdefghijklmnopqrstuvwx/pay?email=a@b.jp#x')).toBe('https://book.yamado.app/plan/[token]/pay');
		expect(scrubUrl('/yamado/nishiwaga/plans')).toBe('/yamado/nishiwaga/plans');
	});
});

describe('scrubSentryEvent', () => {
	it('cookie・ヘッダ・本文・利用者・メールアドレスを送らない', () => {
		const event = {
			type: undefined,
			message: 'failed for taro@example.com',
			user: { id: 'u1', email: 'taro@example.com' },
			request: { url: 'https://book.yamado.app/p/ABCDEFGHIJKLMNOPQRSTUVWXYZ/home?x=1', query_string: 'x=1', cookies: { a: 'b' }, headers: { cookie: 'a=b' }, data: { email: 'x' } },
			exception: { values: [{ type: 'Error', value: 'mail to hanako@example.jp failed' }] },
			breadcrumbs: [{ message: 'go', data: { url: 'https://x.test/a?token=1', to: '/plan/abcdefghijklmnopqrstuvwx' } }]
		} as unknown as ErrorEvent;
		const e = scrubSentryEvent(event);
		expect(e.user).toBeUndefined();
		expect(e.request).toEqual({ url: 'https://book.yamado.app/p/[token]/home' });
		expect(e.message).toBe('failed for [email]');
		expect(e.exception?.values?.[0].value).toBe('mail to [email] failed');
		expect(e.breadcrumbs?.[0].data).toEqual({ url: 'https://x.test/a', to: '/plan/[token]' });
	});
});
