import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// SSR and client builds must share a stable payload key, including separate Vite phases.
		version: { name: appVersion },
		// Cloudflare Pages デプロイ（設計書 §0）
		adapter: adapter(),
		// ★2026-10-21 監査: CSP を Report-Only で入れる（遮断はしない。違反は /api/csp-report に届きログに出る）。
		//   しばらく違反ログを見て、正当な読み込み元を足し切ってから reportOnly → directives（強制）へ移す。
		//   SvelteKit が自分のインラインスクリプトに nonce を付ける（mode: auto）。
		csp: {
			mode: 'auto',
			reportOnly: {
				'default-src': ['self'],
				'script-src': ['self', 'https://js.stripe.com', 'https://challenges.cloudflare.com', 'https://www.googletagmanager.com'],
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
					'https://challenges.cloudflare.com',
					'https://rtc.live.cloudflare.com',
					'wss://rtc.live.cloudflare.com'
				],
				'frame-src': [
					'self',
					'https://js.stripe.com',
					'https://hooks.stripe.com',
					'https://challenges.cloudflare.com',
					'https://www.google.com',
					'https://maps.google.com'
				],
				'media-src': ['self', 'blob:', 'https:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self', 'https://hooks.stripe.com'],
				'report-uri': ['/api/csp-report']
			}
		}
	}
};

export default config;
