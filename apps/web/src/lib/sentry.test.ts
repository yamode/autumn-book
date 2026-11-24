// エラー監視に送る前の個人情報の消し方（$lib/sentry.ts）
import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/sveltekit';
import { CHUNK_RELOAD_WINDOW_MS, isIgnoredClientError, scrubSentryEvent, scrubUrl, shouldReloadForChunkError } from './sentry';

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

describe('isIgnoredClientError（ブラウザの雑音・2026-11-25）', () => {
	it('通信の切断・デプロイ直後の読み込み失敗は送らない', () => {
		for (const m of [
			'Load failed',
			'TypeError: Load failed',
			'Failed to fetch',
			'TypeError: Failed to fetch (book.yamado.app)',
			'NetworkError when attempting to fetch resource.',
			'Importing a module script failed.',
			'TypeError: Failed to fetch dynamically imported module: https://book.yamado.app/_app/immutable/nodes/13.js',
			'error loading dynamically imported module: https://book.yamado.app/_app/x.js'
		]) expect(isIgnoredClientError(m), m).toBe(true);
	});
	it('本物の不具合らしいものは送る', () => {
		for (const m of [
			"TypeError: Cannot read properties of undefined (reading 'id')",
			'Failed to fetch plans: 500',
			'Error: 予約を確定できませんでした'
		]) expect(isIgnoredClientError(m), m).toBe(false);
	});
});

describe('shouldReloadForChunkError', () => {
	it('初回は読み込み直し、直後の2回目は繰り返さない', () => {
		const now = 1_800_000_000_000;
		expect(shouldReloadForChunkError(null, now)).toBe(true);
		expect(shouldReloadForChunkError('abc', now)).toBe(true);
		expect(shouldReloadForChunkError(String(now - 1000), now)).toBe(false);
		expect(shouldReloadForChunkError(String(now - CHUNK_RELOAD_WINDOW_MS - 1), now)).toBe(true);
	});
});
