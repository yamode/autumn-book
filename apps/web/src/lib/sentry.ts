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
