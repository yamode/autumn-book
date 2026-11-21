import { describe, expect, it } from 'vitest';
import { canResendReply, DEMO_SUPPORT_FAQS, groupFaqs, oneLine, splitQuoted, supportAckSubject, supportCodeIn, supportContactLine, supportReplySubject, SUPPORT_CATEGORIES } from './support';

describe('会員サポート: 件名の問い合わせ番号', () => {
	it('[YS-XXXXXX] を取り出す（番号の部分は大文字にそろえる・頭の YS は大文字だけ＝DB の _support_code_in と同じ）', () => {
		expect(supportCodeIn('Re: ログインできない [YS-AB12CD]')).toBe('YS-AB12CD');
		expect(supportCodeIn('re: [YS-ab12cd] 続き')).toBe('YS-AB12CD');
		expect(supportCodeIn('[ys-ab12cd]')).toBeNull();
		expect(supportCodeIn('YS-AB12CD（括弧なし）')).toBeNull();
		expect(supportCodeIn('[YS-AB12C]')).toBeNull();
		expect(supportCodeIn(null)).toBeNull();
	});
	it('返信の件名は Re: <件名> [番号]（Re: を重ねない・番号は 1 つ）', () => {
		expect(supportReplySubject('ログインできない', 'YS-AB12CD')).toBe('Re: ログインできない [YS-AB12CD]');
		expect(supportReplySubject('Re: ログインできない [YS-AB12CD]', 'YS-AB12CD')).toBe('Re: ログインできない [YS-AB12CD]');
		expect(supportReplySubject('RE：確認', 'YS-AB12CD')).toBe('RE：確認 [YS-AB12CD]');
		expect(supportReplySubject('', 'YS-AB12CD')).toBe('Re: お問い合わせ [YS-AB12CD]');
		expect(supportReplySubject(null, 'YS-AB12CD')).toBe('Re: お問い合わせ [YS-AB12CD]');
	});
	it('別の番号が残っていたら付け直す', () => {
		expect(supportReplySubject('Re: 前の件 [YS-ZZZZZZ]', 'YS-AB12CD')).toBe('Re: 前の件 [YS-AB12CD]');
	});
	it('返信の件名から番号を取り出せる（往復で同じ問い合わせにつながる）', () => {
		const s = supportReplySubject('ポイントについて', 'YS-K7M2PQ');
		expect(supportCodeIn(`Re: ${s}`)).toBe('YS-K7M2PQ');
		expect(supportCodeIn(supportAckSubject('YS-K7M2PQ'))).toBe('YS-K7M2PQ');
	});
});

describe('会員サポート: 引用の折りたたみ', () => {
	it('「>」の行から後ろを引用にする', () => {
		const r = splitQuoted('ありがとうございます。\n解決しました。\n\n> 宿の返信\n> 2 行目');
		expect(r.main).toBe('ありがとうございます。\n解決しました。');
		expect(r.quoted).toBe('> 宿の返信\n> 2 行目');
	});
	it('On … wrote: と日本語の「書きました」も引用の始まり', () => {
		expect(splitQuoted('OK\nOn Mon, Nov 22, 2026 at 10:00 YAMADO wrote:\n> x').quoted.startsWith('On Mon')).toBe(true);
		expect(splitQuoted('わかりました\n2026年11月22日(日) 10:00 YAMADO サポート <support@yamado.app>:\n> x')).toEqual({
			main: 'わかりました',
			quoted: '2026年11月22日(日) 10:00 YAMADO サポート <support@yamado.app>:\n> x'
		});
		expect(splitQuoted('わかりました\n2026年11月22日 10:00 山人 さんは書きました:\n> x').main).toBe('わかりました');
	});
	it('引用が無ければ全部が本文・先頭から引用なら全部を本文として見せる', () => {
		expect(splitQuoted('本文だけ')).toEqual({ main: '本文だけ', quoted: '' });
		expect(splitQuoted('> 全部引用')).toEqual({ main: '> 全部引用', quoted: '' });
		expect(splitQuoted('a\r\nb')).toEqual({ main: 'a\nb', quoted: '' });
	});
});

describe('会員サポート: よくある質問', () => {
	it('デモの見本は 10 件・カテゴリはすべて既知', () => {
		expect(DEMO_SUPPORT_FAQS).toHaveLength(10);
		for (const f of DEMO_SUPPORT_FAQS) expect(SUPPORT_CATEGORIES as readonly string[]).toContain(f.category);
	});
	it('カテゴリの順（login → legacy → booking → points → other・知らないものは最後）にまとめる', () => {
		const g = groupFaqs([
			{ category: 'other', q: 1 },
			{ category: 'zzz', q: 2 },
			{ category: 'login', q: 3 },
			{ category: 'points', q: 4 },
			{ category: 'login', q: 5 }
		]);
		expect(g.map((x) => x.category)).toEqual(['login', 'points', 'other', 'zzz']);
		expect(g[0].items.map((x) => x.q)).toEqual([3, 5]);
	});
});

describe('会員サポート: 1 行の値・問い合わせ先・再送', () => {
	it('改行・制御文字は空白にして 1 行に', () => {
		expect(oneLine('a\r\nb\tc\u0000d e')).toBe('a b c d e');
		expect(oneLine('  x  ')).toBe('x');
		expect(oneLine(null)).toBe('');
		expect(supportReplySubject('件名\r\nBcc: x', 'YS-AB12CD')).toBe('Re: 件名 Bcc: x [YS-AB12CD]');
	});
	it('問い合わせ先: support@ は有効なときだけ', () => {
		expect(supportContactLine(true)).toBe('お問い合わせ: support@yamado.app（https://book.yamado.app/help）');
		expect(supportContactLine(false)).not.toContain('support@');
		expect(supportContactLine(false)).toContain('https://book.yamado.app/help');
	});
	it('再送: failed はいつでも・sending は作成から 5 分後から・sent は不可', () => {
		const now = Date.parse('2026-11-22T10:00:00Z');
		expect(canResendReply({ send_status: 'failed', created_at: '2026-11-22T09:59:59Z' }, now)).toBe(true);
		expect(canResendReply({ send_status: 'sending', created_at: '2026-11-22T09:56:00Z' }, now)).toBe(false);
		expect(canResendReply({ send_status: 'sending', created_at: '2026-11-22T09:55:00Z' }, now)).toBe(true);
		expect(canResendReply({ send_status: 'sending', created_at: 'bad' }, now)).toBe(false);
		expect(canResendReply({ send_status: 'sent', created_at: '2026-11-22T09:00:00Z' }, now)).toBe(false);
		expect(canResendReply({ send_status: null, created_at: '2026-11-22T09:00:00Z' }, now)).toBe(false);
	});
});
