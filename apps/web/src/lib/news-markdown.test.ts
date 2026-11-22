// お知らせのリンク: 「新しいタブで開く」の指定（title の予約語 blank / self）と、CTA ボタンとの組み合わせ
import { describe, expect, it } from 'vitest';
import { newsLinkTitle, parseNewsLinkTitle, renderNewsMarkdown } from './news-markdown';
import { newsBodyHtml } from './server/news/public';

describe('newsLinkTitle / parseNewsLinkTitle', () => {
	it('ボタンの種類と開き方を1つの title にまとめ、読み戻せる', () => {
		expect(newsLinkTitle('cta', 'blank')).toBe('cta blank');
		expect(newsLinkTitle(null, 'self')).toBe('self');
		expect(newsLinkTitle(null, null)).toBe('');
		expect(parseNewsLinkTitle('cta-outline self')).toEqual({ kind: 'cta-outline', target: 'self' });
	});
	it('予約語以外が混ざった title はふつうの title として扱う', () => expect(parseNewsLinkTitle('説明 blank')).toBeNull());
});

describe('renderNewsMarkdown（Book の画面）', () => {
	it('新しいタブの指定があれば target="_blank" と rel を付ける', () =>
		expect(renderNewsMarkdown('[ログイン画面](https://book.yamado.app/auth/login "blank")')).toContain(
			'<a href="https://book.yamado.app/auth/login" target="_blank" rel="noopener noreferrer">ログイン画面</a>'
		));
	it('同じタブの指定なら target="_self"', () => expect(renderNewsMarkdown('[x](https://a.example/ "self")')).toContain('target="_self"'));
	it('CTA ボタンと開き方を同時に指定できる', () => {
		const html = renderNewsMarkdown('[予約](https://www.yamado.co.jp/reservation/ "cta-outline blank")');
		expect(html).toContain('class="news-cta news-cta--outline"');
		expect(html).toContain('target="_blank"');
	});
	it('これまでの CTA（開き方の指定なし）は今までどおり', () =>
		expect(renderNewsMarkdown('[予約](https://a.example/ "cta")')).toContain('<a class="news-cta" href="https://a.example/">'));
	it('指定なしのリンクには target を付けない（Book の画面は同じタブ）', () =>
		expect(renderNewsMarkdown('[x](https://a.example/)')).not.toContain('target='));
});

describe('newsBodyHtml（施設HP）', () => {
	it('指定なしのリンク（これまでのお知らせ）は、今までどおり新しいタブ', () =>
		expect(newsBodyHtml('[x](https://a.example/)')).toContain('target="_blank" rel="noopener noreferrer"'));
	it('同じタブを選んだリンクは新しいタブにしない', () => {
		const html = newsBodyHtml('[x](https://a.example/ "self")');
		expect(html).toContain('target="_self"');
		expect(html).not.toContain('_blank');
	});
	it('新しいタブを選んだリンクに target を二重に付けない', () =>
		expect(newsBodyHtml('[x](https://a.example/ "blank")').match(/target=/g)).toHaveLength(1));
});
