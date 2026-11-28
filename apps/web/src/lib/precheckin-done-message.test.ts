import { describe, expect, it } from 'vitest';
import { doneMessageFor, linkifyParts, normalizeDoneMessage } from './precheckin-done-message';

describe('normalizeDoneMessage', () => {
	it('行が無ければ空', () => {
		expect(normalizeDoneMessage(null)).toEqual({ ja: '', en: '', zh: '' });
	});
	it('前後の空白を落とす', () => {
		expect(normalizeDoneMessage({ done_message: ' こんにちは \n', done_message_en: null, done_message_zh: 'x' })).toEqual({
			ja: 'こんにちは',
			en: '',
			zh: 'x'
		});
	});
});

describe('doneMessageFor', () => {
	const msg = { ja: '日本語', en: 'English', zh: '' };
	it('日本語', () => expect(doneMessageFor(msg, 'ja')).toBe('日本語'));
	it('英語', () => expect(doneMessageFor(msg, 'en')).toBe('English'));
	it('繁中が空なら英語', () => expect(doneMessageFor(msg, 'zh-TW')).toBe('English'));
	it('英語も空なら日本語', () => expect(doneMessageFor({ ja: '日本語', en: '', zh: '' }, 'zh-TW')).toBe('日本語'));
	it('全部空なら空', () => expect(doneMessageFor({ ja: '', en: '', zh: '' }, 'en')).toBe(''));
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
