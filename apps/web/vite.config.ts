import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

// バージョン表記の出所はモノレポルートの package.json（コミットメッセージの vX.Y.Z と一致させる）
const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(rootPkg.version)
	},
	plugins: [
		tailwindcss(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// ロケール判定戦略: URL → cookie → Accept-Language → baseLocale(ja)
			strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
			// URL戦略: ja はプレフィックスなし、en は /en/...、zh-TW は /zh-TW/...
			urlPatterns: [
				{
					pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
					// 具体的なパターンを先に置く（ja のキャッチオールが先だと /en/... も ja に一致する）
					localized: [
						['en', ':protocol://:domain(.*)::port?/en/:path(.*)?'],
						['zh-TW', ':protocol://:domain(.*)::port?/zh-TW/:path(.*)?'],
						['ja', ':protocol://:domain(.*)::port?/:path(.*)?']
					]
				}
			]
		}),
		sveltekit()
	],
	server: { fs: { allow: ['../..'] } }
});
