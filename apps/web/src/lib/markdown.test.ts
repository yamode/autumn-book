import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('Markdown の表示', () => {
	it('==文字== は赤字', () => {
		expect(renderMarkdown('お湯の==バルブを閉めて==ください')).toContain('<span style="color:#dc2626;font-weight:600">バルブを閉めて</span>');
	});

	it('赤字の中の太字も効く', () => {
		expect(renderMarkdown('==**大事**==')).toContain('<strong>大事</strong>');
	});

	it('太字・http(s)・電話のリンク', () => {
		const html = renderMarkdown('**太字** [サイト](https://yamado.co.jp) [電話](tel:0197822222)');
		expect(html).toContain('<strong>太字</strong>');
		expect(html).toContain('<a href="https://yamado.co.jp">サイト</a>');
		expect(html).toContain('<a href="tel:0197822222">電話</a>');
	});

	it('javascript: などのリンクは文字だけにする', () => {
		const html = renderMarkdown('[押して](javascript:alert(1))');
		expect(html).not.toContain('<a');
		expect(html).toContain('押して');
	});

	it('生の HTML は出さない', () => {
		expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
	});
});
