// ブラウザ側のエラー監視（Sentry・2026-11-23）。設定と個人情報の消し方は $lib/sentry.ts。
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE, scrubSentryEvent } from '$lib/sentry';

Sentry.init({
	dsn: SENTRY_DSN,
	enabled: !dev,
	environment: location.hostname.endsWith('.pages.dev') ? 'preview' : 'production',
	release: `autumn-book@${__APP_VERSION__}`,
	tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
	beforeSend: scrubSentryEvent,
	// 拡張機能・古いブラウザ由来でこちらでは直せないもの
	ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured']
});

export const handleError = Sentry.handleErrorWithSentry();
