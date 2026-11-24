// エラー監視（Sentry・2026-11-23）。サーバー（hooks.server.ts）とブラウザ（hooks.client.ts）で同じ設定を使う。
// プロジェクト: yamado / autumn-book（https://yamado.sentry.io/projects/autumn-book/）。DSN は公開してよい値（送信先の宛名）。
// 個人情報は送らない: 既定で個人情報を付けない上に、送る前に scrubSentryEvent で URL のトークン・クエリ・cookie・ヘッダ・メールアドレスを消す。
// プロジェクト側でも IP アドレスを保存しない・機密項目を消す設定にしてある。操作の録画（リプレイ）は使わない。
import type { ErrorEvent } from '@sentry/sveltekit';

export const SENTRY_DSN = 'https://3df68956bc50cf7642cc567c4a07c7e6@o4511170881454080.ingest.us.sentry.io/4512477776904192';

/** 性能の計測は少しだけ（無料枠を使い切らないように） */
export const SENTRY_TRACES_SAMPLE_RATE = 0.02;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// URL の途中の長い英数字（予約・プラン・取引先ページのトークンなど）
const TOKEN_SEGMENT = /\/[A-Za-z0-9_-]{20,}(?=\/|$)/g;

/** URL からクエリ・ハッシュ・トークンらしい部分を消す */
export function scrubUrl(url: string): string {
	const noQuery = url.split(/[?#]/)[0];
	return noQuery.replace(TOKEN_SEGMENT, '/[token]').replace(EMAIL, '[email]');
}

function scrubText(text: string): string {
	return text.replace(EMAIL, '[email]');
}

/** Sentry に送る前に個人情報を消す（beforeSend） */
export function scrubSentryEvent<T extends ErrorEvent>(event: T): T {
	if (event.request) {
		if (event.request.url) event.request.url = scrubUrl(event.request.url);
		delete event.request.query_string;
		delete event.request.cookies;
		delete event.request.headers;
		delete event.request.data;
	}
	delete event.user;
	if (event.transaction) event.transaction = scrubUrl(event.transaction);
	if (event.message) event.message = scrubText(event.message);
	for (const ex of event.exception?.values ?? []) {
		if (ex.value) ex.value = scrubText(ex.value);
	}
	for (const b of event.breadcrumbs ?? []) {
		if (b.message) b.message = scrubText(b.message);
		if (b.data && typeof b.data.url === 'string') b.data.url = scrubUrl(b.data.url);
		if (b.data && typeof b.data.to === 'string') b.data.to = scrubUrl(b.data.to);
		if (b.data && typeof b.data.from === 'string') b.data.from = scrubUrl(b.data.from);
	}
	return event;
}

/**
 * ブラウザから Sentry に送らないエラー（こちらでは直せない雑音・2026-11-25）。
 * - 通信の切断（お客様の電波・機内モード・画面を閉じた途中の通信）: Safari は "Load failed"、Chrome は "Failed to fetch"、Firefox は "NetworkError …"
 * - デプロイ直後に古い画面のまま操作して、もう無いファイルを読もうとしたもの（hooks.client.ts で1回だけ再読み込みして直す）
 * - 拡張機能・古いブラウザ由来のもの
 * サーバー側の失敗は hooks.server.ts から別に届くので、ここで消しても本物の不具合は見落とさない。
 */
export const SENTRY_CLIENT_IGNORE_ERRORS: (string | RegExp)[] = [
	/^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)( \(.*\))?$/,
	'Importing a module script failed',
	'Failed to fetch dynamically imported module',
	'error loading dynamically imported module',
	'Unable to preload CSS',
	'ResizeObserver loop',
	'Non-Error promise rejection captured'
];

/** Sentry の ignoreErrors と同じ当て方（文字列は部分一致・正規表現はそのまま）。テスト用 */
export function isIgnoredClientError(message: string): boolean {
	return SENTRY_CLIENT_IGNORE_ERRORS.some((p) => (typeof p === 'string' ? message.includes(p) : p.test(message)));
}

/** デプロイ直後の読み込み失敗で再読み込みしたかの印（同じ画面で何度も再読み込みを繰り返さないため） */
export const CHUNK_RELOAD_KEY = 'ab_chunk_reload_at';
/** この時間内に2回目の失敗が来たら、再読み込みせずにそのまま（Sentry にも送らない） */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/** いま再読み込みしてよいか（前回の再読み込みから CHUNK_RELOAD_WINDOW_MS 以上たっているか） */
export function shouldReloadForChunkError(lastReloadAt: string | null, now: number): boolean {
	const last = Number(lastReloadAt);
	return !Number.isFinite(last) || last <= 0 || now - last > CHUNK_RELOAD_WINDOW_MS;
}
