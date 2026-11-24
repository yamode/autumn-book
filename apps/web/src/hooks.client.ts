// ブラウザ側のエラー監視（Sentry・2026-11-23）。設定と個人情報の消し方は $lib/sentry.ts。
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import {
	CHUNK_RELOAD_KEY,
	SENTRY_CLIENT_IGNORE_ERRORS,
	SENTRY_DSN,
	SENTRY_TRACES_SAMPLE_RATE,
	scrubSentryEvent,
	shouldReloadForChunkError
} from '$lib/sentry';

Sentry.init({
	dsn: SENTRY_DSN,
	enabled: !dev,
	environment: location.hostname.endsWith('.pages.dev') ? 'preview' : 'production',
	release: `autumn-book@${__APP_VERSION__}`,
	tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
	beforeSend: scrubSentryEvent,
	// 通信の切断・デプロイ直後の古い画面・拡張機能など、こちらでは直せない雑音（2026-11-25）
	ignoreErrors: SENTRY_CLIENT_IGNORE_ERRORS
});

// デプロイ直後に古い画面のまま操作すると、もう無いファイルを読もうとして失敗する。
// そのときは1回だけ画面を読み込み直して新しい版にする（60 秒以内に繰り返したら止める・2026-11-25）
window.addEventListener('vite:preloadError', (event) => {
	try {
		if (!shouldReloadForChunkError(sessionStorage.getItem(CHUNK_RELOAD_KEY), Date.now())) return;
		sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
	} catch {
		// sessionStorage が使えない（プライベートブラウズの一部など）ときは繰り返しを止められないので読み込み直さない
		return;
	}
	event.preventDefault();
	location.reload();
});

export const handleError = Sentry.handleErrorWithSentry();
