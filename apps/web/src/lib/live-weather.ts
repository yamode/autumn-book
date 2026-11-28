// Autumn Live の空の天気（docs/autumn-live.md §11）。画面（live-screen/engine.ts）・サーバ（server/live-weather.ts）・テストから使う。
//
// - WEATHER: 天気の型（快晴〜吹雪・雷雨まで）。見た目は数の組（雲の量・暗さ・雨・雪・霧・風・稲光…）で持ち、
//   画面は今の値から次の値へゆっくり移す（急に切り替えない）。型を足すときはここに 1 行足すだけでよい
// - classifyWeather: 気象庁の観測（アメダス）と天気予報から、いまの天気の型を決める
// - randomWeather: 「おまかせ」のとき、その月らしい天気を選ぶ

/** 見た目の数。どれも 0〜1（lightning は 1 分あたりの回数） */
export type WeatherLook = {
	/** 雲の量 */
	cloud: number;
	/** 雲の暗さ（白い雲→灰色の雨雲） */
	dark: number;
	/** 空一面にかかる薄い雲（うす曇り） */
	veil: number;
	/** 空を灰色に沈める強さ */
	dim: number;
	/** 太陽・月の見え方 */
	sun: number;
	/** 星の見え方 */
	stars: number;
	/** 霧・もや */
	fog: number;
	/** 雨の量 */
	rain: number;
	/** 雪の量 */
	snow: number;
	/** 風（雨・雪が斜めに流れる・雲が速い） */
	wind: number;
	/** 稲光（1 分あたり） */
	lightning: number;
};

export type WeatherId =
	| 'clear' | 'sunny' | 'fair' | 'partly' | 'haze' | 'cloudy' | 'overcast' | 'windy'
	| 'mist' | 'fog'
	| 'drizzle' | 'lightRain' | 'rain' | 'heavyRain' | 'downpour' | 'showers' | 'sunshower' | 'thunder'
	| 'sleet'
	| 'flurries' | 'lightSnow' | 'snow' | 'heavySnow' | 'blizzard' | 'snowShowers';

const L = (o: Partial<WeatherLook>): WeatherLook => ({ cloud: 0, dark: 0, veil: 0, dim: 0, sun: 1, stars: 1, fog: 0, rain: 0, snow: 0, wind: 0.1, lightning: 0, ...o });

/** 天気の型（並びは画面の選択肢の順） */
export const WEATHER: Record<WeatherId, { name: string; look: WeatherLook }> = {
	clear: { name: '快晴', look: L({ wind: 0.05 }) },
	sunny: { name: '晴れ', look: L({ cloud: 0.18 }) },
	fair: { name: '晴れ時々くもり', look: L({ cloud: 0.38, sun: 0.95, stars: 0.8 }) },
	partly: { name: '晴れ間のあるくもり', look: L({ cloud: 0.62, dark: 0.15, dim: 0.08, sun: 0.65, stars: 0.5 }) },
	haze: { name: 'うす曇り', look: L({ cloud: 0.3, veil: 0.75, dim: 0.12, sun: 0.55, stars: 0.3 }) },
	cloudy: { name: 'くもり', look: L({ cloud: 0.86, dark: 0.35, veil: 0.4, dim: 0.3, sun: 0.12, stars: 0.15 }) },
	overcast: { name: 'どんより', look: L({ cloud: 1, dark: 0.6, veil: 0.7, dim: 0.5, sun: 0, stars: 0 }) },
	windy: { name: '風の強い晴れ', look: L({ cloud: 0.3, wind: 0.85 }) },
	mist: { name: 'もや', look: L({ cloud: 0.55, dark: 0.15, veil: 0.5, dim: 0.22, sun: 0.4, stars: 0.2, fog: 0.4, wind: 0.03 }) },
	fog: { name: '霧', look: L({ cloud: 0.8, dark: 0.2, veil: 0.8, dim: 0.35, sun: 0.1, stars: 0, fog: 0.85, wind: 0.02 }) },
	drizzle: { name: '霧雨', look: L({ cloud: 0.95, dark: 0.45, veil: 0.7, dim: 0.42, sun: 0, stars: 0, fog: 0.3, rain: 0.14, wind: 0.05 }) },
	lightRain: { name: '小雨', look: L({ cloud: 0.95, dark: 0.5, veil: 0.6, dim: 0.42, sun: 0, stars: 0, rain: 0.3 }) },
	rain: { name: '雨', look: L({ cloud: 1, dark: 0.65, veil: 0.7, dim: 0.52, sun: 0, stars: 0, fog: 0.1, rain: 0.58, wind: 0.15 }) },
	heavyRain: { name: '強い雨', look: L({ cloud: 1, dark: 0.78, veil: 0.8, dim: 0.62, sun: 0, stars: 0, fog: 0.2, rain: 0.82, wind: 0.3 }) },
	downpour: { name: '大雨', look: L({ cloud: 1, dark: 0.88, veil: 0.9, dim: 0.72, sun: 0, stars: 0, fog: 0.32, rain: 1, wind: 0.42 }) },
	showers: { name: 'にわか雨', look: L({ cloud: 0.75, dark: 0.55, veil: 0.2, dim: 0.3, sun: 0.35, stars: 0.2, rain: 0.48, wind: 0.2 }) },
	sunshower: { name: '天気雨', look: L({ cloud: 0.35, dark: 0.15, sun: 0.9, stars: 0.6, rain: 0.26, wind: 0.1 }) },
	thunder: { name: '雷雨', look: L({ cloud: 1, dark: 0.92, veil: 0.9, dim: 0.78, sun: 0, stars: 0, fog: 0.15, rain: 0.85, wind: 0.45, lightning: 5 }) },
	sleet: { name: 'みぞれ', look: L({ cloud: 1, dark: 0.55, veil: 0.75, dim: 0.48, sun: 0, stars: 0, fog: 0.15, rain: 0.32, snow: 0.32, wind: 0.2 }) },
	flurries: { name: '風花', look: L({ cloud: 0.3, dark: 0.05, sun: 0.85, stars: 0.6, snow: 0.12, wind: 0.25 }) },
	lightSnow: { name: '小雪', look: L({ cloud: 0.92, dark: 0.3, veil: 0.7, dim: 0.3, sun: 0.05, stars: 0, snow: 0.3, wind: 0.1 }) },
	snow: { name: '雪', look: L({ cloud: 1, dark: 0.42, veil: 0.8, dim: 0.42, sun: 0, stars: 0, fog: 0.12, snow: 0.62, wind: 0.12 }) },
	heavySnow: { name: '大雪', look: L({ cloud: 1, dark: 0.5, veil: 0.9, dim: 0.55, sun: 0, stars: 0, fog: 0.3, snow: 0.95, wind: 0.18 }) },
	blizzard: { name: '吹雪', look: L({ cloud: 1, dark: 0.55, veil: 1, dim: 0.62, sun: 0, stars: 0, fog: 0.55, snow: 1, wind: 1 }) },
	snowShowers: { name: 'にわか雪', look: L({ cloud: 0.75, dark: 0.35, veil: 0.2, dim: 0.25, sun: 0.35, stars: 0.2, snow: 0.45, wind: 0.2 }) }
};
export const WEATHER_IDS = Object.keys(WEATHER) as WeatherId[];
export const isWeatherId = (s: unknown): s is WeatherId => typeof s === 'string' && s in WEATHER;

/** 気象庁の観測（アメダス。無い値は null） */
export type WeatherObs = {
	temp: number | null;
	humidity: number | null;
	/** 前 10 分・前 1 時間の降水量（mm） */
	precip10m: number | null;
	precip1h: number | null;
	/** 前 10 分・前 1 時間の日照（時間。前 1 時間なら 0〜1） */
	sun10m: number | null;
	sun1h: number | null;
	/** 前 1 時間の降雪（cm） */
	snow1h: number | null;
	/** 風速（m/s） */
	wind: number | null;
};
/** 気象庁の天気予報（今日の天気コード 100〜450 と文） */
export type WeatherForecast = { code: string | null; text: string | null };

/**
 * いまの天気の型を決める。
 * daylight: 日が出ていて、日の出・日の入りから 1 時間以上離れている（日照の値が使える）
 */
export function classifyWeather(o: WeatherObs, f: WeatherForecast, daylight: boolean): WeatherId {
	const fc = f.code?.[0] ?? null; // 1 晴 2 曇 3 雨 4 雪
	const ftext = f.text ?? '';
	const p10 = o.precip10m ?? 0, p1h = o.precip1h ?? 0;
	const rate = Math.max(p10 * 6, p1h); // mm/h
	const snowing = (o.snow1h ?? 0) > 0;
	const wet = p10 > 0 || snowing || (o.precip10m == null && p1h > 0);
	const wind = o.wind ?? 0;
	const sunNow = (o.sun10m ?? 0) > 0;
	const sunHour = o.sun1h ?? 0;

	if (wet) {
		const t = o.temp;
		const kind = snowing || (t != null ? t <= 1 : fc === '4') ? 'snow' : t != null && t <= 2.5 ? 'sleet' : 'rain';
		if (kind === 'sleet') return 'sleet';
		if (kind === 'snow') {
			if (wind >= 8) return 'blizzard';
			// 雪の強さは前 1 時間で見る（10 分の雨量計は 0.5mm 刻みで粗い）
			const amt = o.precip1h ?? p10 * 6;
			if (sunNow && amt < 1) return 'flurries';
			if ((o.snow1h ?? 0) >= 3 || amt >= 3) return 'heavySnow';
			if (sunHour >= 0.3) return 'snowShowers';
			if ((o.snow1h ?? 0) <= 1 && amt < 1) return 'lightSnow';
			return 'snow';
		}
		if (ftext.includes('雷') && rate >= 6) return 'thunder'; // 「所により雷」だけでは雷雨にしない。強く降っているとき
		if (sunNow) return 'sunshower';
		if (sunHour >= 0.3) return 'showers';
		if (rate >= 20) return 'downpour';
		if (rate >= 8) return 'heavyRain';
		if (rate >= 2) return 'rain';
		if (rate < 1 && (o.humidity ?? 0) >= 97) return 'drizzle';
		return 'lightRain';
	}

	// 降っていない
	const hum = o.humidity ?? 0;
	if (hum >= 99 && wind < 1.5) return 'fog';
	if (hum >= 97 && wind < 2) return 'mist';
	let id: WeatherId;
	if (daylight && o.sun1h != null) {
		if (sunHour >= 0.95) id = fc === '1' || fc == null ? 'clear' : 'sunny';
		else if (sunHour >= 0.6) id = 'sunny';
		else if (sunHour >= 0.3) id = 'fair';
		else if (sunHour > 0.05) id = 'partly';
		else id = fc === '3' || fc === '4' ? 'overcast' : fc === '1' ? 'haze' : 'cloudy';
	} else {
		// 夜・朝夕は日照が使えないので予報から
		if (fc === '1') id = f.code === '100' ? 'clear' : 'fair';
		else if (fc === '2') id = ftext.includes('晴') ? 'partly' : 'cloudy';
		else if (fc === '3' || fc === '4') id = 'overcast';
		else id = 'fair';
	}
	if (wind >= 10 && (id === 'clear' || id === 'sunny' || id === 'fair')) return 'windy';
	return id;
}

/** 「おまかせ」: その月らしい天気を重みで選ぶ（r は 0〜1 の乱数） */
export function randomWeather(month: number, r: number = Math.random()): WeatherId {
	const winter = month === 12 || month <= 2, shoulder = month === 3 || month === 11, summer = month >= 6 && month <= 9;
	const w: Partial<Record<WeatherId, number>> = winter
		? { clear: 3, sunny: 5, fair: 5, partly: 5, haze: 2, cloudy: 8, overcast: 5, flurries: 6, lightSnow: 10, snow: 10, heavySnow: 5, blizzard: 3, snowShowers: 6, sleet: 2, mist: 1 }
		: shoulder
			? { clear: 4, sunny: 7, fair: 7, partly: 6, haze: 3, cloudy: 8, overcast: 4, windy: 2, mist: 2, fog: 1, drizzle: 2, lightRain: 4, rain: 3, showers: 3, sleet: 3, flurries: 3, lightSnow: 3, snowShowers: 2 }
			: summer
				? { clear: 6, sunny: 10, fair: 8, partly: 6, haze: 4, cloudy: 6, overcast: 2, mist: 2, fog: 2, drizzle: 2, lightRain: 3, rain: 3, heavyRain: 2, downpour: 1, showers: 4, sunshower: 2, thunder: 3 }
				: { clear: 5, sunny: 9, fair: 8, partly: 6, haze: 4, cloudy: 7, overcast: 3, windy: 2, mist: 2, fog: 2, drizzle: 2, lightRain: 4, rain: 3, heavyRain: 1, showers: 3, sunshower: 1, thunder: 1 };
	const entries = Object.entries(w) as [WeatherId, number][];
	const total = entries.reduce((s, [, v]) => s + v, 0);
	let x = Math.min(0.999999, Math.max(0, r)) * total;
	for (const [id, v] of entries) {
		x -= v;
		if (x < 0) return id;
	}
	return entries[entries.length - 1][0];
}

/** 2 つの見た目のあいだ（t: 0〜1） */
export function blendLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
	const o = {} as WeatherLook;
	for (const k of Object.keys(a) as (keyof WeatherLook)[]) o[k] = a[k] + (b[k] - a[k]) * t;
	return o;
}

/** サーバから画面へ渡す、その場所のいまの天気 */
export type PlaceWeather = {
	place: 'nishiwaga' | 'oga';
	name: string;
	station: string;
	id: WeatherId;
	temp: number | null;
	/** 観測の時刻（ISO） */
	observedAt: string;
};
