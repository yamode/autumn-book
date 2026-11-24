import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SSR and client builds must share a stable payload key, including separate Vite phases.
		// pollInterval: 新しい版が出たら次の画面遷移を通常の読み込みにして、古い画面のまま操作し続けないようにする（2026-11-25）
		version: { name: appVersion, pollInterval: 300_000 },
		// OAuth token exchanges are x-www-form-urlencoded server-to-server POSTs without an Origin header.
		// hooks.server.ts applies the SvelteKit form-origin check with an exception for that exact route.
		csrf: { trustedOrigins: ['*'] },
		// Cloudflare Pages デプロイ（設計書 §0）
		adapter: adapter(),
		// ★2026-10-21 監査: CSP を Report-Only で入れた（違反は /api/csp-report に届きログに出る）。
		// ★2026-11-23 レビュー L-1: 強制（directives）へ移した。XSS が 1 つ出ても外部のスクリプトを読ませない。
		//   SvelteKit が自分のインラインスクリプトに nonce を付ける（mode: auto）。違反は引き続き /api/csp-report に届く。
		//   読み込み元を足すときはここへ。メルマガの編集画面（srcdoc の iframe でスクリプトを動かす）だけは
		//   security-headers.ts で Report-Only に戻している（srcdoc は親の CSP を引き継ぐため）。
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': [
					'self',
					'https://js.stripe.com',
					'https://*.js.stripe.com',
					'https://maps.googleapis.com',
					'https://challenges.cloudflare.com',
					'https://www.googletagmanager.com',
					'https://*.googletagmanager.com'
				],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:', 'https:'],
				'connect-src': [
					'self',
					'https://*.supabase.co',
					'wss://*.supabase.co',
					'https://api.stripe.com',
					'https://*.google-analytics.com',
					'https://*.analytics.google.com',
					'https://www.googletagmanager.com',
					'https://*.googletagmanager.com',
					'https://*.g.doubleclick.net',
					'https://www.google.com',
					'https://maps.googleapis.com',
					'https://challenges.cloudflare.com',
					'https://rtc.live.cloudflare.com',
					'wss://rtc.live.cloudflare.com',
					// エラー監視（Sentry・2026-11-23）
					'https://*.ingest.us.sentry.io'
				],
				'frame-src': [
					'self',
					'https://js.stripe.com',
					'https://*.js.stripe.com',
					'https://hooks.stripe.com',
					'https://challenges.cloudflare.com',
					'https://www.google.com',
					'https://maps.google.com',
					// 施設ページのアクセス（AccessSection.svelte）の地図
					'https://www.openstreetmap.org'
				],
				'media-src': ['self', 'blob:', 'https:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				// 他サイトへの埋め込み禁止（security-headers.ts と同じ。強制の CSP を付けるとそちらは付かなくなるため、ここにも書く）
				'frame-ancestors': ['self'],
				'form-action': ['self', 'https://hooks.stripe.com', 'https://autumn-book-member-preview.pages.dev'],
				'report-uri': ['/api/csp-report']
			}
		}
	}
};

export default config;
