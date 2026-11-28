// Autumn Live の人の流れ（docs/autumn-live.md §7.1）の純関数。ブラウザの送り手（components/LiveBeacon.svelte）と
// 受け手（routes/api/live/beacon/+server.ts）、テスト（live-beacon.test.ts）から使う。
//
// 段: 1 Book 訪問 2 空室検索 3 施設を選ぶ 4 プランを見る 5 予約入力 6 予約
// 流入元: nishiwaga_hp（西和賀HP）／oga_hp（男鹿HP）／search（検索・広告）／sns／direct（直接・その他）

export type LiveSource = 'nishiwaga_hp' | 'oga_hp' | 'search' | 'sns' | 'direct';
export type LiveFacility = 'nishiwaga' | 'oga';
export type LiveBeacon = { sid: string; stage: number; facility: LiveFacility | null; source: LiveSource; leave: boolean };

export const LIVE_BEACON_PATH = '/api/live/beacon';
export const LIVE_SOURCES: readonly LiveSource[] = ['nishiwaga_hp', 'oga_hp', 'search', 'sns', 'direct'];
const SID = /^[A-Za-z0-9_-]{16,40}$/;

/** 計測しない画面（管理画面・取引先・客室案内・事前確認（/ci）・メールの配信停止・Live 自身・MCP）。予約を探しに来た人の流れだけを数える */
export function isLiveTrackedPath(pathname: string): boolean {
	const p = pathname.replace(/^\/(en|zh-TW|ko)(?=\/|$)/, '') || '/';
	return !/^\/(admin|r|p|partner|ci|mail|live|booking-mcp|mcp|api)(\/|$)/.test(p);
}

/** ルート（route.id）と URL の施設から段と施設を決める */
export function liveStageOf(routeId: string | null | undefined, params: Record<string, string | undefined> = {}): { stage: number; facility: LiveFacility | null } {
	const id = String(routeId ?? '').replace(/^\/\(public\)/, '');
	const facility = params.facility === 'nishiwaga' || params.facility === 'oga' ? params.facility : null;
	if (id === '/booking/complete/[code]') return { stage: 6, facility: null };
	if (id === '/booking/hold' || id === '/booking/payment') return { stage: 5, facility: null };
	if (id === '/[brand]/[facility]/plans/[plan]') return { stage: 4, facility };
	if (id.startsWith('/[brand]/[facility]')) return { stage: 3, facility };
	if (id === '/search') return { stage: 2, facility: null };
	return { stage: 1, facility: null };
}

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.co\.jp|search\.yahoo\.com|duckduckgo\.com|baidu\.com|naver\.com|ecosia\.org)$/;
const SNS_HOSTS = /(^|\.)(facebook\.com|fb\.me|instagram\.com|t\.co|twitter\.com|x\.com|line\.me|threads\.net|tiktok\.com|youtube\.com|pinterest\.[a-z.]+|note\.com)$/;

/** 最初の画面の URL と参照元から流入元を決める */
export function liveSourceOf(url: URL, referrer: string): LiveSource {
	const utm = (url.searchParams.get('utm_source') ?? '').toLowerCase();
	const medium = (url.searchParams.get('utm_medium') ?? '').toLowerCase();
	if (utm === 'hp_nishiwaga') return 'nishiwaga_hp';
	if (utm === 'hp_oga') return 'oga_hp';
	let host = '';
	try {
		host = referrer ? new URL(referrer).hostname.toLowerCase() : '';
	} catch {
		host = '';
	}
	if (host === 'www.yamado.co.jp' || host === 'yamado.co.jp') return 'nishiwaga_hp';
	if (host === 'oga.yamado.co.jp') return 'oga_hp';
	if (['cpc', 'ppc', 'paid', 'paidsearch'].includes(medium) || SEARCH_HOSTS.test(host)) return 'search';
	if (medium === 'social' || SNS_HOSTS.test(host)) return 'sns';
	return 'direct';
}

/** 受け手: 本文を確かめる。だめなら null */
export function parseLiveBeacon(body: unknown): LiveBeacon | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.sid !== 'string' || !SID.test(b.sid)) return null;
	const stage = Number(b.stage);
	if (!Number.isInteger(stage) || stage < 1 || stage > 6) return null;
	const facility = b.facility === 'nishiwaga' || b.facility === 'oga' ? b.facility : null;
	const source = LIVE_SOURCES.includes(b.source as LiveSource) ? (b.source as LiveSource) : 'direct';
	return { sid: b.sid, stage, facility, source, leave: b.leave === true };
}

/** ボット・プレビュー取得などの UA（数えない） */
export function isBotUserAgent(ua: string | null | undefined): boolean {
	const s = String(ua ?? '');
	if (!s) return true;
	return /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|node-fetch|axios|go-http|java\//i.test(s);
}

/** タブごとの匿名の番号（22 文字） */
export function newLiveSid(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
