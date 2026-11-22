import { fade } from 'svelte/transition';
import { quadOut } from 'svelte/easing';

/**
 * シマーが消えて中身に切り替わるときの、ふわっと出すトランジション（2026-11-22 指示「シマーの後はフェードイン」）。
 * 使い方: `{#if loading}<span class="shimmer" />{:else}<span in:fadeIn>…</span>{/if}`
 *
 * CSS の `.fade-in`（app.css）と長さ・曲線をそろえている（260ms・quadOut ＝ cubic-bezier(0.25, 0.46, 0.45, 0.94)）。
 * こちらを使うのは「同じ場所でシマー → 中身に替わる」ところ。Svelte の in: は既定でローカルなので、
 * - そのブロック自体が読み込み中 → 中身に切り替わったときだけ再生され、
 * - ページの最初の描画（SSR・ページ遷移のフェード中）や、外側の {#key}・{#each} ごと作り直されたとき（月送りなど）は再生されない。
 * そのため、ページ遷移のフェード（PageLoadingBoundary）や月送りのアニメーションと二重にならない。
 * 動きを減らす設定の端末では即時に出す。
 */
export function fadeIn(node: Element) {
	const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	return fade(node, { duration: reduce ? 0 : 260, easing: quadOut });
}
