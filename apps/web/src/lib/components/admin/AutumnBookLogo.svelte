<script lang="ts">
	// 正本: static/brand/autumn-book-logo.svg（文字はアウトライン化済み）。
	let { class: klass = 'h-8 w-auto', markOnly = false }: { class?: string; markOnly?: boolean } = $props();
</script>

<img
	src={markOnly ? '/brand/autumn-book-symbol.svg' : '/brand/autumn-book-logo.svg'}
	alt="Autumn Book"
	width={markOnly ? 821 : 1291}
	height={markOnly ? 709 : 192}
	class={klass}
/>
