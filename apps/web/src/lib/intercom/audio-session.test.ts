import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpeakerOnlyDevice, setCallAudioSession } from './audio-session';

describe('isSpeakerOnlyDevice', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('Android は true', () => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' });
		expect(isSpeakerOnlyDevice()).toBe(true);
	});

	it('iPhone の Safari は false（通話モードにできる）', () => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
		expect(isSpeakerOnlyDevice()).toBe(false);
	});

	it('navigator が無い環境でも例外を出さず false', () => {
		vi.stubGlobal('navigator', undefined);
		expect(isSpeakerOnlyDevice()).toBe(false);
	});
});

describe('setCallAudioSession', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('通話中は play-and-record、終わったら auto に戻す', () => {
		const audioSession = { type: 'auto' };
		vi.stubGlobal('navigator', { audioSession });
		setCallAudioSession(true);
		expect(audioSession.type).toBe('play-and-record');
		setCallAudioSession(false);
		expect(audioSession.type).toBe('auto');
	});

	it('Audio Session API が無いブラウザでは何もせず例外も出さない', () => {
		vi.stubGlobal('navigator', {});
		expect(() => setCallAudioSession(true)).not.toThrow();
	});

	it('type の設定が例外になっても通話を止めない', () => {
		const audioSession = {
			set type(_v: string) {
				throw new Error('not allowed');
			}
		};
		vi.stubGlobal('navigator', { audioSession });
		expect(() => setCallAudioSession(true)).not.toThrow();
	});

	it('navigator が無い環境（サーバー側）でも例外を出さない', () => {
		vi.stubGlobal('navigator', undefined);
		expect(() => setCallAudioSession(true)).not.toThrow();
	});
});
