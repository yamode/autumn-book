// HP 配布の検索バー <yamado-search-bar> のビルド（static/embed/search-bar.js を 1 ファイルで出す）。
//   pnpm --filter @autumn-book/web build:embed
// 取引先ページと同じ Svelte の部品（$lib/components/stay-search/*）を、依存ごと 1 本の IIFE にまとめる。
// CSS（Tailwind）は JS に文字列で同梱し、Shadow DOM の <style> に入れる（src/lib/stay-search/embed/embed.css）。
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { shadowCss } from './src/lib/stay-search/shadow-css';

function shadowCssPlugin(): Plugin {
	return {
		name: 'embed-shadow-css',
		enforce: 'post',
		transform(code, id) {
			if (!/embed\.css\?inline$/.test(id)) return null;
			const m = /^export default (".*");?\s*$/s.exec(code);
			if (!m) this.error(`embed.css の取り込み結果の形が想定外です: ${code.slice(0, 80)}`);
			return { code: `export default ${JSON.stringify(shadowCss(JSON.parse(m![1])))};`, map: null };
		}
	};
}

const BANNER = `/*! autumn-book 検索バー <yamado-search-bar>（施設 HP 向けの配布部品・設計書 docs/hp-book-integration.md §3.8）
 * ★生成物。手で直さない。元: apps/web/src/lib/stay-search/embed/（部品は src/lib/components/stay-search/）
 * 再生成: pnpm --filter @autumn-book/web build:embed（pnpm build でも先に作り直す）
 * 使い方: <yamado-search-bar facility="oga" lang="ja">…代替フォーム…</yamado-search-bar>
 *         <script src="https://book.yamado.app/embed/search-bar.js" defer></script>
 */`;

// 最小化のあとで先頭に付ける（rollup の banner だと esbuild の補助関数の後ろに回る）
function bannerPlugin(): Plugin {
	return {
		name: 'embed-banner',
		generateBundle(_, bundle) {
			for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunk.code = `${BANNER}\n${chunk.code}`;
		}
	};
}

export default defineConfig({
	define: { 'process.env.NODE_ENV': JSON.stringify('production') },
	publicDir: false,
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	plugins: [tailwindcss(), svelte({ compilerOptions: { css: 'injected' } }), shadowCssPlugin(), bannerPlugin()],
	build: {
		outDir: 'static/embed',
		emptyOutDir: false,
		copyPublicDir: false,
		target: 'es2020',
		minify: true,
		lib: {
			entry: fileURLToPath(new URL('./src/lib/stay-search/embed/main.ts', import.meta.url)),
			formats: ['iife'],
			name: 'YamadoSearchBar',
			fileName: () => 'search-bar.js'
		},
		rollupOptions: { output: { inlineDynamicImports: true } }
	}
});
