import { describe, expect, it } from 'vitest';
import { WEATHER, WEATHER_IDS, blendLook, classifyWeather, randomWeather, type WeatherObs } from './live-weather';

const dry: WeatherObs = { temp: 10, humidity: 60, precip10m: 0, precip1h: 0, sun10m: 0, sun1h: 0, snow1h: 0, wind: 2 };
const obs = (o: Partial<WeatherObs>): WeatherObs => ({ ...dry, ...o });
const fc = (code: string | null, text = '') => ({ code, text });

describe('天気の型', () => {
	it('25 の型があり、見た目の数はどれも範囲内', () => {
		expect(WEATHER_IDS.length).toBe(25);
		for (const id of WEATHER_IDS) {
			const l = WEATHER[id].look;
			for (const [k, v] of Object.entries(l)) {
				if (k === 'lightning') expect(v).toBeGreaterThanOrEqual(0);
				else expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(0), expect(v, `${id}.${k}`).toBeLessThanOrEqual(1);
			}
		}
	});
	it('あいだの見た目', () => {
		const m = blendLook(WEATHER.clear.look, WEATHER.overcast.look, 0.5);
		expect(m.cloud).toBeCloseTo(0.5);
		expect(m.sun).toBeCloseTo(0.5);
	});
});

describe('観測から天気を決める', () => {
	it('昼の日照で晴れ〜くもり', () => {
		expect(classifyWeather(obs({ sun1h: 1 }), fc('100'), true)).toBe('clear');
		expect(classifyWeather(obs({ sun1h: 1 }), fc('201', 'くもり 時々 晴れ'), true)).toBe('sunny');
		expect(classifyWeather(obs({ sun1h: 0.4 }), fc('101'), true)).toBe('fair');
		expect(classifyWeather(obs({ sun1h: 0.1 }), fc('200'), true)).toBe('partly');
		expect(classifyWeather(obs({ sun1h: 0 }), fc('200'), true)).toBe('cloudy');
		expect(classifyWeather(obs({ sun1h: 0 }), fc('300'), true)).toBe('overcast');
		expect(classifyWeather(obs({ sun1h: 0 }), fc('100'), true)).toBe('haze');
	});
	it('夜は予報から', () => {
		expect(classifyWeather(dry, fc('100'), false)).toBe('clear');
		expect(classifyWeather(dry, fc('101'), false)).toBe('fair');
		expect(classifyWeather(dry, fc('201', 'くもり 時々 晴れ'), false)).toBe('partly');
		expect(classifyWeather(dry, fc('200', 'くもり'), false)).toBe('cloudy');
		expect(classifyWeather(dry, fc('402'), false)).toBe('overcast');
	});
	it('霧・もや・強い風', () => {
		expect(classifyWeather(obs({ humidity: 100, wind: 0.7 }), fc('200'), false)).toBe('fog');
		expect(classifyWeather(obs({ humidity: 97, wind: 1.5 }), fc('200'), false)).toBe('mist');
		expect(classifyWeather(obs({ sun1h: 1, wind: 12 }), fc('100'), true)).toBe('windy');
	});
	it('雨の強さ', () => {
		expect(classifyWeather(obs({ precip10m: 0.5, precip1h: 0.5, humidity: 99 }), fc('300'), false)).toBe('rain'); // 10 分 0.5mm＝毎時 3mm
		expect(classifyWeather(obs({ precip10m: null, precip1h: 0.5, humidity: 99 }), fc('300'), false)).toBe('drizzle');
		expect(classifyWeather(obs({ precip10m: null, precip1h: 1, humidity: 80 }), fc('300'), false)).toBe('lightRain');
		expect(classifyWeather(obs({ precip10m: 1.5, precip1h: 6 }), fc('300'), false)).toBe('heavyRain');
		expect(classifyWeather(obs({ precip10m: 4, precip1h: 25 }), fc('300'), false)).toBe('downpour');
		expect(classifyWeather(obs({ precip10m: 1, precip1h: 5 }), fc('300', '雨 所により 雷 を伴う'), false)).toBe('thunder');
		expect(classifyWeather(obs({ precip10m: 0.5, sun10m: 0.1 }), fc('101'), true)).toBe('sunshower');
		expect(classifyWeather(obs({ precip10m: 0.5, sun1h: 0.5 }), fc('101'), true)).toBe('showers');
	});
	it('気温で雪・みぞれ', () => {
		expect(classifyWeather(obs({ temp: 2, precip10m: 0.5 }), fc('300'), false)).toBe('sleet');
		expect(classifyWeather(obs({ temp: -1, precip10m: 0.5, precip1h: 0.5 }), fc('400'), false)).toBe('lightSnow');
		expect(classifyWeather(obs({ temp: -1, precip10m: 0.5, precip1h: 1.5, snow1h: 2 }), fc('400'), false)).toBe('snow');
		expect(classifyWeather(obs({ temp: -3, precip10m: 1, snow1h: 4 }), fc('400'), false)).toBe('heavySnow');
		expect(classifyWeather(obs({ temp: -3, precip10m: 1, wind: 9 }), fc('400'), false)).toBe('blizzard');
		expect(classifyWeather(obs({ temp: -1, precip10m: 0.5, sun10m: 0.1 }), fc('101'), true)).toBe('flurries');
		expect(classifyWeather(obs({ temp: 5, precip10m: 0, snow1h: 1 }), fc('400'), false)).toBe('lightSnow'); // 積雪が増えていれば雪
	});
});

describe('おまかせ', () => {
	it('どの乱数でも型を返す', () => {
		for (const m of [1, 4, 7, 11, 12]) for (let r = 0; r <= 1; r += 0.05) expect(WEATHER_IDS).toContain(randomWeather(m, r));
	});
	it('真冬に雷雨・夏に吹雪は出ない', () => {
		const jan = new Set(Array.from({ length: 200 }, (_, i) => randomWeather(1, i / 200)));
		const aug = new Set(Array.from({ length: 200 }, (_, i) => randomWeather(8, i / 200)));
		expect(jan.has('thunder')).toBe(false);
		expect(aug.has('blizzard')).toBe(false);
		expect(jan.has('snow')).toBe(true);
	});
});
