// Autumn Live の人の流れ（docs/autumn-live.md §7.1）
import { describe, expect, it } from 'vitest';
import { isBotUserAgent, isLiveTrackedPath, liveSourceOf, liveStageOf, newLiveSid, parseLiveBeacon } from './live-beacon';

describe('段と施設', () => {
	it('画面のルートから段を決める', () => {
		expect(liveStageOf('/(public)')).toEqual({ stage: 1, facility: null });
		expect(liveStageOf('/(public)/account')).toEqual({ stage: 1, facility: null });
		expect(liveStageOf('/(public)/search')).toEqual({ stage: 2, facility: null });
		expect(liveStageOf('/(public)/[brand]/[facility]', { facility: 'oga' })).toEqual({ stage: 3, facility: 'oga' });
		expect(liveStageOf('/(public)/[brand]/[facility]/plans', { facility: 'nishiwaga' })).toEqual({ stage: 3, facility: 'nishiwaga' });
		expect(liveStageOf('/(public)/[brand]/[facility]/rooms/[room]', { facility: 'oga' })).toEqual({ stage: 3, facility: 'oga' });
		expect(liveStageOf('/(public)/[brand]/[facility]/plans/[plan]', { facility: 'oga' })).toEqual({ stage: 4, facility: 'oga' });
		expect(liveStageOf('/(public)/booking/hold')).toEqual({ stage: 5, facility: null });
		expect(liveStageOf('/(public)/booking/payment')).toEqual({ stage: 5, facility: null });
		expect(liveStageOf('/(public)/booking/complete/[code]')).toEqual({ stage: 6, facility: null });
		expect(liveStageOf(null)).toEqual({ stage: 1, facility: null });
	});

	it('知らない施設は施設なし', () => {
		expect(liveStageOf('/(public)/[brand]/[facility]', { facility: 'tokyo' })).toEqual({ stage: 3, facility: null });
	});
});

describe('流入元', () => {
	const u = (q = '') => new URL(`https://book.yamado.app/yamado/nishiwaga${q}`);
	it('HP の utm と参照元', () => {
		expect(liveSourceOf(u('?utm_source=hp_nishiwaga'), '')).toBe('nishiwaga_hp');
		expect(liveSourceOf(u('?utm_source=hp_oga'), '')).toBe('oga_hp');
		expect(liveSourceOf(u(), 'https://www.yamado.co.jp/rooms/')).toBe('nishiwaga_hp');
		expect(liveSourceOf(u(), 'https://yamado.co.jp/')).toBe('nishiwaga_hp');
		expect(liveSourceOf(u(), 'https://oga.yamado.co.jp/')).toBe('oga_hp');
	});
	it('検索・SNS・直接', () => {
		expect(liveSourceOf(u(), 'https://www.google.co.jp/')).toBe('search');
		expect(liveSourceOf(u(), 'https://search.yahoo.co.jp/search?p=x')).toBe('search');
		expect(liveSourceOf(u('?utm_medium=cpc'), '')).toBe('search');
		expect(liveSourceOf(u(), 'https://www.instagram.com/')).toBe('sns');
		expect(liveSourceOf(u(), 'https://t.co/abc')).toBe('sns');
		expect(liveSourceOf(u(), '')).toBe('direct');
		expect(liveSourceOf(u(), 'not a url')).toBe('direct');
		expect(liveSourceOf(u(), 'https://evilyamado.co.jp/')).toBe('direct');
	});
});

describe('受け手の確かめ', () => {
	const sid = newLiveSid();
	it('番号は 22 文字の英数字', () => {
		expect(sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(newLiveSid()).not.toBe(sid);
	});
	it('正しい本文だけ通す', () => {
		expect(parseLiveBeacon({ sid, stage: 3, facility: 'oga', source: 'oga_hp' })).toEqual({ sid, stage: 3, facility: 'oga', source: 'oga_hp', leave: false });
		expect(parseLiveBeacon({ sid, stage: 1, facility: 'x', source: 'evil', leave: true })).toEqual({ sid, stage: 1, facility: null, source: 'direct', leave: true });
		expect(parseLiveBeacon({ sid: 'short', stage: 1 })).toBeNull();
		expect(parseLiveBeacon({ sid, stage: 7 })).toBeNull();
		expect(parseLiveBeacon({ sid, stage: 0 })).toBeNull();
		expect(parseLiveBeacon(null)).toBeNull();
	});
	it('計測しない画面', () => {
		expect(isLiveTrackedPath('/')).toBe(true);
		expect(isLiveTrackedPath('/en/yamado/oga')).toBe(true);
		expect(isLiveTrackedPath('/admin')).toBe(false);
		expect(isLiveTrackedPath('/en/admin/x')).toBe(false);
		expect(isLiveTrackedPath('/p/abc')).toBe(false);
		expect(isLiveTrackedPath('/live')).toBe(false);
		expect(isLiveTrackedPath('/r/x')).toBe(false);
	});
	it('ボットの UA', () => {
		expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
		expect(isBotUserAgent('')).toBe(true);
		expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).toBe(false);
	});
});
