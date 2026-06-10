import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// 本番は @sveltejs/adapter-cloudflare に切替（設計書 §0）。開発中は auto
		adapter: adapter()
	}
};

export default config;
