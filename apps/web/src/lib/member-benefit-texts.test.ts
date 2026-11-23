// 会員特典の説明文の上書き（$lib/member-benefit-texts）
import { describe, expect, it } from 'vitest';
import { MEMBER_BENEFIT_TEXT_KEYS, siteText } from './member-benefit-texts';
import ja from '../../messages/ja.json';

describe('siteText', () => {
	it('上書きがあればそれ、空や無いときは元の文言', () => {
		expect(siteText({ a: '上書き' }, 'a', () => '元')).toBe('上書き');
		expect(siteText({ a: '  ' }, 'a', () => '元')).toBe('元');
		expect(siteText(undefined, 'a', () => '元')).toBe('元');
	});
	it('編集できる項目は、どれも画面の文言に実在する', () => {
		for (const key of MEMBER_BENEFIT_TEXT_KEYS) expect(ja).toHaveProperty(key);
		expect(new Set(MEMBER_BENEFIT_TEXT_KEYS).size).toBe(MEMBER_BENEFIT_TEXT_KEYS.length);
	});
});
