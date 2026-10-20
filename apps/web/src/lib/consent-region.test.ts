import { describe, expect, it } from 'vitest';
import { consentRequiredFor } from './consent-region';

describe('アクセス解析の同意を先に聞く地域', () => {
	it('EEA・英国・スイスは聞く', () => {
		for (const c of ['DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GB', 'CH', 'de']) expect(consentRequiredFor(c)).toBe(true);
	});
	it('日本などは聞かない', () => {
		for (const c of ['JP', 'US', 'TW', 'KR', 'HK', 'AU']) expect(consentRequiredFor(c)).toBe(false);
	});
	it('国が分からなければ聞く', () => {
		for (const c of [null, undefined, '', 'XX', 'T1', 'JPN']) expect(consentRequiredFor(c)).toBe(true);
	});
});
