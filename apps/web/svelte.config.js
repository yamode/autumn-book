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
		adapter: adapter()
	}
};

export default config;
