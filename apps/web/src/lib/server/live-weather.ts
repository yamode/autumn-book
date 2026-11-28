// Autumn Live の空の天気を、気象庁の観測（アメダス 10 分ごと）と天気予報から決める（docs/autumn-live.md §11）。
// 出典: 気象庁（https://www.jma.go.jp/bosai/）。政府標準利用規約に沿って、画面の「見方」に出典を出す。
// 読めない・形が変わったときは null を返し、画面は「おまかせ」の天気にする。10 分覚える（気象庁へは 10 分に 1 回まで）。
import { classifyWeather, type PlaceWeather, type WeatherForecast, type WeatherObs } from '$lib/live-weather';
import { sunTimes } from '$lib/live-screen/sun';
import { TtlCache } from '$lib/server/ttl-cache';

const BASE = 'https://www.jma.go.jp/bosai';
const PLACES = [
	// 西和賀（湯本温泉）: アメダス湯田・岩手県内陸の予報
	{ place: 'nishiwaga', name: '西和賀', station: '33631', stationName: '湯田', office: '030000', area: '030010', lat: 39.31, lon: 140.78 },
	// 男鹿: アメダス男鹿・秋田県沿岸の予報
	{ place: 'oga', name: '男鹿', station: '32286', stationName: '男鹿', office: '050000', area: '050010', lat: 39.91, lon: 139.9 }
] as const;

const cache = new TtlCache<{ at: string; places: PlaceWeather[] } | null>(10 * 60_000, 1);

async function getJson(url: string): Promise<unknown> {
	const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json();
}
const num = (v: unknown): number | null => (Array.isArray(v) && typeof v[0] === 'number' && (v[1] === 0 || v[1] == null) ? v[0] : null);

/** アメダスの 1 地点の値を観測の形に */
export function amedasToObs(row: Record<string, unknown> | undefined): WeatherObs | null {
	if (!row) return null;
	return {
		temp: num(row.temp),
		humidity: num(row.humidity),
		precip10m: num(row.precipitation10m),
		precip1h: num(row.precipitation1h),
		sun10m: num(row.sun10m),
		sun1h: num(row.sun1h),
		snow1h: num(row.snow1h),
		wind: num(row.wind)
	};
}

/** 予報の JSON から、その区域の今日の天気コードと文 */
export function forecastOf(data: unknown, area: string): WeatherForecast {
	try {
		const ts = (data as { timeSeries: { areas: { area: { code: string }; weatherCodes?: string[]; weathers?: string[] }[] }[] }[])[0].timeSeries[0];
		const a = ts.areas.find((x) => x.area.code === area);
		return { code: a?.weatherCodes?.[0] ?? null, text: a?.weathers?.[0]?.replace(/　/g, ' ') ?? null };
	} catch {
		return { code: null, text: null };
	}
}

/** 日が出ていて、日の出・日の入りから 1 時間以上離れているか（日照の値が使えるか） */
function isDaylight(now: Date, lat: number, lon: number): boolean {
	const s = sunTimes(now, lat, lon);
	const j = new Date(now.getTime() + 9 * 3600_000);
	const h = j.getUTCHours() + j.getUTCMinutes() / 60;
	return h >= s.rise + 1 && h <= s.set - 1;
}

export async function loadLiveWeather(now = new Date()): Promise<{ at: string; places: PlaceWeather[] } | null> {
	const hit = cache.get('w');
	if (hit !== undefined) return hit;
	let out: { at: string; places: PlaceWeather[] } | null = null;
	try {
		const latest = (await (await fetch(`${BASE}/amedas/data/latest_time.txt`, { signal: AbortSignal.timeout(5000) })).text()).trim();
		const t = new Date(latest);
		if (Number.isNaN(t.getTime())) throw new Error('latest_time');
		const j = new Date(t.getTime() + 9 * 3600_000);
		const stamp = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, '0')}${String(j.getUTCDate()).padStart(2, '0')}${String(j.getUTCHours()).padStart(2, '0')}${String(j.getUTCMinutes()).padStart(2, '0')}00`;
		const [map, ...fcs] = await Promise.all([getJson(`${BASE}/amedas/data/map/${stamp}.json`), ...PLACES.map((p) => getJson(`${BASE}/forecast/data/forecast/${p.office}.json`).catch(() => null))]);
		const places: PlaceWeather[] = [];
		PLACES.forEach((p, i) => {
			const o = amedasToObs((map as Record<string, Record<string, unknown>>)[p.station]);
			if (!o) return;
			const f = forecastOf(fcs[i], p.area);
			places.push({ place: p.place, name: p.name, station: p.stationName, id: classifyWeather(o, f, isDaylight(now, p.lat, p.lon)), temp: o.temp, observedAt: t.toISOString() });
		});
		out = places.length ? { at: t.toISOString(), places } : null;
	} catch (e) {
		console.error('[live-weather] 気象庁の値を読めませんでした:', e instanceof Error ? e.message : e);
		out = null;
	}
	cache.set('w', out);
	return out;
}
