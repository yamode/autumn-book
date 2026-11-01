/// <reference types="vitest/config" />
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
			// ロケール判定戦略: URL の接頭辞 → cookie（公式サイトのみ） → URL（接頭辞なし＝ja） → baseLocale(ja)
			// custom-stickyLocale は src/lib/locale-strategy.ts（接頭辞の無い URL でも切り替えた言語を保つ・cookie の読み書きもここ）。
			// 'cookie' を入れると管理画面を開いただけで cookie が ja に上書きされるので入れない（url が ja を必ず返すので preferredLanguage も届かない）
			strategy: ['custom-stickyLocale', 'url', 'baseLocale'],
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
	server: { fs: { allow: ['../..'] } },
	// 純関数のテスト（取引先ページの料金・予約・紹介の計算など）。`pnpm --filter @autumn-book/web test`
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
