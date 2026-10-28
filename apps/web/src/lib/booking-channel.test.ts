import { describe, expect, it } from 'vitest';
import { channelBadgeClass, channelLabel, isOtaChannel } from './booking-channel';

describe('isOtaChannel', () => {
	it('販売先マスタの区分が OTA 系なら OTA', () => {
		expect(isOtaChannel({ source: 'tl_lincoln', channel_category: 'net' })).toBe(true);
		expect(isOtaChannel({ source: 'tl_lincoln', channel_category: 'engine' })).toBe(true);
		expect(isOtaChannel({ source: 'x', channel_category: 'agency' })).toBe(true);
	});
	it('直販・取引先・電話・直接・区分なしは OTA ではない', () => {
		expect(isOtaChannel({ source: 'autumn_booking', channel_category: 'net' })).toBe(false);
		expect(isOtaChannel({ source: 'rms_partner', channel_category: 'net' })).toBe(false);
		expect(isOtaChannel({ source: 'x', channel_category: 'direct' })).toBe(false);
		expect(isOtaChannel({ source: 'x', channel_category: 'other' })).toBe(false);
		expect(isOtaChannel({ source: 'x', channel_category: null })).toBe(false);
	});
});

describe('channelLabel', () => {
	it('直販はサイト／アプリ', () => {
		expect(channelLabel({ source: 'autumn_booking', client: 'web', channel_name: '公式' })).toBe('サイト');
		expect(channelLabel({ source: 'autumn_booking', client: 'app', channel_name: null })).toBe('アプリ');
	});
	it('取引先は取引先名、無ければチャネル名', () => {
		expect(channelLabel({ source: 'rms_partner', channel_name: null, partner_name: '山田商事' })).toBe('取引先：山田商事');
		expect(channelLabel({ source: 'rms_partner', channel_name: null })).toBe('取引先予約');
	});
	it('OTA は販売先の名前、無ければコード、さらに無ければ source', () => {
		expect(channelLabel({ source: 'tl', channel_name: '楽天トラベル', channel_code: 'rakuten' })).toBe('楽天トラベル');
		expect(channelLabel({ source: 'tl', channel_name: null, channel_code: 'ikkyu' })).toBe('ikkyu');
		expect(channelLabel({ source: 'tl', channel_name: null })).toBe('tl');
		expect(channelLabel({ source: null, channel_name: null })).toBe('—');
	});
});

describe('channelBadgeClass', () => {
	it('OTA・公式・その他で色が分かれる', () => {
		const ota = channelBadgeClass({ source: 'tl', channel_category: 'net' });
		const official = channelBadgeClass({ source: 'autumn_booking', channel_category: null });
		const other = channelBadgeClass({ source: 'phone', channel_category: 'direct' });
		expect(new Set([ota, official, other]).size).toBe(3);
	});
});
