import { describe, expect, it } from 'vitest';
import { doneMessageFor, doneTitleFor, linkifyParts, normalizeDoneMessage } from './precheckin-done-message';

const M = (o: Partial<{ ja: string; en: string; zh: string; titleJa: string; titleEn: string; titleZh: string }>) => ({
	ja: '',
	en: '',
	zh: '',
	titleJa: '',
	titleEn: '',
	titleZh: '',
	...o
});

describe('normalizeDoneMessage', () => {
	it('行が無ければ空', () => {
		expect(normalizeDoneMessage(null)).toEqual(M({}));
	});
	it('前後の空白を落とす', () => {
		expect(normalizeDoneMessage({ done_message: ' こんにちは \n', done_message_en: null, done_message_zh: 'x', done_title: ' ご案内 ' })).toEqual(
			M({ ja: 'こんにちは', zh: 'x', titleJa: 'ご案内' })
		);
	});
});

describe('doneMessageFor', () => {
	const msg = M({ ja: '日本語', en: 'English' });
	it('日本語', () => expect(doneMessageFor(msg, 'ja')).toBe('日本語'));
	it('英語', () => expect(doneMessageFor(msg, 'en')).toBe('English'));
	it('繁中が空なら英語', () => expect(doneMessageFor(msg, 'zh-TW')).toBe('English'));
	it('英語も空なら日本語', () => expect(doneMessageFor(M({ ja: '日本語' }), 'zh-TW')).toBe('日本語'));
	it('全部空なら空', () => expect(doneMessageFor(M({}), 'en')).toBe(''));
	it('見出しも同じ落とし方・空なら出さない', () => {
		expect(doneTitleFor(M({ titleJa: 'ご案内', titleEn: 'Info' }), 'zh-TW')).toBe('Info');
		expect(doneTitleFor(M({ titleJa: 'ご案内' }), 'en')).toBe('ご案内');
		expect(doneTitleFor(M({ ja: '本文だけ' }), 'ja')).toBe('');
	});
});

describe('linkifyParts', () => {
	it('URL だけリンクにする', () => {
		expect(linkifyParts('地図は https://example.com/map です')).toEqual([
			{ text: '地図は ' },
			{ text: 'https://example.com/map', href: 'https://example.com/map' },
			{ text: ' です' }
		]);
	});
	it('末尾の句読点は含めない', () => {
		expect(linkifyParts('See https://example.com.')).toEqual([
			{ text: 'See ' },
			{ text: 'https://example.com', href: 'https://example.com' },
			{ text: '.' }
		]);
	});
	it('日本語の句点で切る', () => {
		expect(linkifyParts('https://example.com。次')).toEqual([
			{ text: 'https://example.com', href: 'https://example.com' },
			{ text: '。次' }
		]);
	});
	it('URL が無ければそのまま', () => {
		expect(linkifyParts('<b>太字</b>')).toEqual([{ text: '<b>太字</b>' }]);
	});
});
