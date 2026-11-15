// 事前チェックインのリンクを開いた瞬間の、読み込み中の画面（precheckin-splash.ts）
import { describe, expect, it } from 'vitest';
import { looksLikePrecheckinToken, precheckinSplashHtml, splashNextUrl } from './precheckin-splash';

describe('読み込み中の画面', () => {
	it('同じパスに ?go=1 を付けて開き直す', () => {
		expect(splashNextUrl('/ci/XJX7E9A1M2R9H7YW')).toBe('/ci/XJX7E9A1M2R9H7YW?go=1');
		const html = precheckinSplashHtml('/ci/XJX7E9A1M2R9H7YW');
		expect(html).toContain('location.replace("/ci/XJX7E9A1M2R9H7YW?go=1")');
		// JavaScript が無くても進める
		expect(html).toContain('<noscript><meta http-equiv="refresh" content="0;url=/ci/XJX7E9A1M2R9H7YW?go=1" /></noscript>');
		expect(html).toContain('href="/ci/XJX7E9A1M2R9H7YW?go=1"');
	});
	it('検索に載せない・参照元を渡さない・外部の読み込みをしない', () => {
		const html = precheckinSplashHtml('/ci/XJX7E9A1M2R9H7YW');
		expect(html).toContain('noindex');
		expect(html).toContain('name="referrer" content="no-referrer"');
		expect(html).not.toMatch(/(src|href)="https?:/);
	});
	it('言語ごとの文言', () => {
		expect(precheckinSplashHtml('/ci/A', 'ja')).toContain('ご案内を準備しています');
		expect(precheckinSplashHtml('/en/ci/A', 'en')).toContain('Preparing your page');
		expect(precheckinSplashHtml('/zh-TW/ci/A', 'zh-TW')).toContain('lang="zh-TW"');
	});
	it('トークンの形（16 文字・前の 43 文字）だけ、この画面を挟む', () => {
		expect(looksLikePrecheckinToken('XJX7E9A1M2R9H7YW')).toBe(true);
		expect(looksLikePrecheckinToken('A'.repeat(43))).toBe(true);
		expect(looksLikePrecheckinToken('demo-precheckin-000000000000000000000000000')).toBe(true);
		expect(looksLikePrecheckinToken('short')).toBe(false);
		expect(looksLikePrecheckinToken('abc"><script>alert(1)</script>xx')).toBe(false);
	});
});
