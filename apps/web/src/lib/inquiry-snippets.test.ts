import { describe, expect, it } from 'vitest';
import { expandSnippet, filterSnippets, insertSnippet, slashQuery, snippetDate } from './inquiry-snippets';

describe('定型文の差し込み', () => {
	it('お名前・担当者名・宿泊日を埋める', () => {
		const t = expandSnippet('{お名前}\n{チェックイン日}から{チェックアウト日}まで。担当：{担当者名}', {
			guestLabel: '山田 太郎 様',
			assignee: '佐藤',
			checkIn: '2026-12-05',
			checkOut: '2026-12-06'
		});
		expect(t).toBe('山田 太郎 様\n12月5日（土）から12月6日（日）まで。担当：佐藤');
	});
	it('分からない値は【要確認】で残す（全角の括弧でも）', () => {
		expect(expandSnippet('｛チェックイン日｝／{担当者名}', { guestLabel: 'お客様', assignee: '' })).toBe('【要確認：チェックイン日】／【要確認：担当者名】');
	});
	it('知らない差し込み項目はそのまま', () => {
		expect(expandSnippet('{料金}', { guestLabel: 'a', assignee: 'b' })).toBe('{料金}');
	});
	it('日付の形', () => {
		expect(snippetDate('2026-11-30')).toBe('11月30日（月）');
		expect(snippetDate(null)).toBe('');
	});
});

describe('「/」の判定', () => {
	it('行頭・空白の直後の / で開く', () => {
		expect(slashQuery('/')).toEqual({ start: 0, query: '' });
		expect(slashQuery('ありがとうございます。\n/お礼')).toEqual({ start: 12, query: 'お礼' });
		expect(slashQuery('はい ／ちゅう')).toEqual({ start: 3, query: 'ちゅう' });
	});
	it('URL や日付の / では開かない', () => {
		expect(slashQuery('https://yamado.co.jp/')).toBeNull();
		expect(slashQuery('12/5')).toBeNull();
		expect(slashQuery('/お礼 ')).toBeNull();
	});
});

describe('絞り込みと差し込み', () => {
	const list = [
		{ id: '1', title: 'お礼', body: 'ありがとうございました', sort_order: 1 },
		{ id: '2', title: '駐車場のご案内', body: '無料のチュウシャジョウ', sort_order: 0 },
		{ id: '3', title: 'キャンセル規定', body: '前日50%', sort_order: 2 }
	];
	it('並び順・名前優先・ひらがなカタカナ無視', () => {
		expect(filterSnippets(list, '').map((s) => s.id)).toEqual(['2', '1', '3']);
		expect(filterSnippets(list, 'きゃんせる').map((s) => s.id)).toEqual(['3']);
		expect(filterSnippets(list, 'ちゅうしゃ').map((s) => s.id)).toEqual(['2']);
	});
	it('「/検索語」を置き換える', () => {
		expect(insertSnippet('前文\n/お礼', 6, 3, 'ありがとう')).toEqual({ body: '前文\nありがとう', caret: 8 });
	});
});
