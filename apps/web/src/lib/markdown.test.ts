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

	it('日本語の文中でも太字になる（記号に接していても）', () => {
		expect(renderMarkdown('**「かぎかっこ」**を太字')).toContain('<strong>「かぎかっこ」</strong>を太字');
		expect(renderMarkdown('料金は**¥1,000（税込）**です')).toContain('料金は<strong>¥1,000（税込）</strong>です');
		expect(renderMarkdown('注意：**21:00まで。**以降は不可')).toContain('注意：<strong>21:00まで。</strong>以降は不可');
		expect(renderMarkdown('混み合います。**前日の夜 21:00 まで**にフロントへ')).toContain('<strong>前日の夜 21:00 まで</strong>にフロントへ');
		// 1行に2か所
		expect(renderMarkdown('**朝食**は**7:00〜**です')).toContain('<strong>朝食</strong>は<strong>7:00〜</strong>です');
		// 太字の中の赤字・リンク
		expect(renderMarkdown('**==大事==**')).toContain('<strong><span');
		expect(renderMarkdown('**[地図](https://yamado.co.jp)**')).toContain('<strong><a href="https://yamado.co.jp">地図</a></strong>');
	});

	it('太字の変更で壊さないもの（リスト・斜体・*** ・空白の **）', () => {
		expect(renderMarkdown('* りんご\n* みかん')).toContain('<li>りんご</li>');
		expect(renderMarkdown('これは*斜体*です')).toContain('<em>斜体</em>');
		expect(renderMarkdown('***太字斜体***')).toContain('<em><strong>太字斜体</strong></em>');
		expect(renderMarkdown('a ** b ** c')).not.toContain('<strong>');
		expect(renderMarkdown('閉じない**太字')).not.toContain('<strong>');
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
