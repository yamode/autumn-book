<script lang="ts">
	// QR コードを SVG で描く。印刷にも耐えるようベクタのまま出す（$lib/qr）。
	import { qrSvg } from '$lib/qr';

	let {
		value,
		/** 画面上の1辺（px）。紙の実寸は印刷側の CSS で決める。 */
		px = 160,
		/** 代替テキスト（読み上げ・画像が出ないとき）。 */
		label = 'QR コード'
	}: { value: string; px?: number; label?: string } = $props();

	const qr = $derived(qrSvg(value));
</script>

{#if qr.size > 0}
	<svg
		viewBox="0 0 {qr.size} {qr.size}"
		width={px}
		height={px}
		role="img"
		aria-label={label}
		shape-rendering="crispEdges"
		xmlns="http://www.w3.org/2000/svg">
		<!-- 余白ごと白で塗る。濃い背景の上に置いても読めるようにするため。 -->
		<rect width={qr.size} height={qr.size} fill="#ffffff" />
		<path d={qr.path} fill="#000000" />
	</svg>
{/if}
