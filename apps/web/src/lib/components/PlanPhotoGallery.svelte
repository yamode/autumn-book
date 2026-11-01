<script lang="ts">
	// プラン詳細の写真（2026-11-01）。EC の商品ページと同じく「大きなメイン写真 1 枚＋サムネイルで切り替え」。
	// - メイン写真: 左右の矢印・スワイプ・←/→ キーで前後へ。右下に「n/全体」
	// - サムネイル: 横一列。はみ出す分は横スクロール（選んだものは見える位置へ寄せる）
	// - メイン写真を押すと拡大表示（Esc で閉じる・背景を押しても閉じる）
	// タイル状に並べると 1 枚あたりが小さく、写真が 1〜2 枚だと余白が目立つため（取引先ページの PartnerPhotoGallery と同じ作り）。
	import type { Photo } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { photos }: { photos: Photo[] } = $props();

	let current = $state(0);
	let open = $state(false);
	const count = $derived(photos.length);
	const index = $derived(Math.min(current, Math.max(count - 1, 0)));
	const main = $derived(photos[index]);

	function go(d: number) {
		if (count < 2) return;
		current = (index + d + count) % count;
	}

	// 選んだ写真のサムネイルを見える位置へ寄せる（ページ全体は縦に動かさない）
	let strip = $state<HTMLDivElement>();
	let modalStrip = $state<HTMLDivElement>();
	function reveal(box: HTMLDivElement | undefined) {
		const el = box?.children[index] as HTMLElement | undefined;
		if (!box || !el) return;
		const left = el.offsetLeft - (box.clientWidth - el.clientWidth) / 2;
		box.scrollTo({ left, behavior: 'smooth' });
	}
	$effect(() => reveal(strip));
	$effect(() => {
		if (open) reveal(modalStrip);
	});

	// 拡大表示の間は背面のスクロールを止める
	$effect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prev;
		};
	});
	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') open = false;
		else if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'ArrowRight') go(1);
	}

	// スワイプ（指で左右に払ったら前後の写真へ）
	let touchX: number | null = null;
	const onTouchStart = (e: TouchEvent) => (touchX = e.touches[0]?.clientX ?? null);
	function onTouchEnd(e: TouchEvent) {
		if (touchX === null) return;
		const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
		touchX = null;
		if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
	}

	const arrowBtn =
		'absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/70';
</script>

<svelte:window onkeydown={onKey} />

{#snippet chevron(dir: 'left' | 'right', size: string)}
	<svg viewBox="0 0 24 24" class={size} fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></svg>
{/snippet}

{#if main}
	<div>
		<figure class="relative overflow-hidden rounded-xl bg-stone-200" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
			<button type="button" class="block w-full cursor-zoom-in" onclick={() => (open = true)} aria-label={m.photo_gallery_open()}>
				<!-- 最初の 1 枚はファーストビューなので遅延読み込みしない -->
				<img src={main.url} alt={main.caption} class="aspect-[3/2] w-full object-cover" loading={index === 0 ? 'eager' : 'lazy'} fetchpriority={index === 0 ? 'high' : 'auto'} decoding="async" />
			</button>
			{#if main.caption}
				<figcaption class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-8 text-xs text-white">{main.caption}</figcaption>
			{/if}
			{#if count > 1}
				<button type="button" class="{arrowBtn} left-2" onclick={() => go(-1)} aria-label={m.facility_gallery_prev()}>{@render chevron('left', 'h-5 w-5')}</button>
				<button type="button" class="{arrowBtn} right-2" onclick={() => go(1)} aria-label={m.facility_gallery_next()}>{@render chevron('right', 'h-5 w-5')}</button>
				<span class="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{index + 1}/{count}</span>
			{/if}
		</figure>

		{#if count > 1}
			<div bind:this={strip} class="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{#each photos as p, i (p.url + i)}
					<button
						type="button"
						class="aspect-[3/2] w-[calc((100%-1.125rem)/4)] shrink-0 overflow-hidden rounded-md border-2 transition sm:w-[calc((100%-1.875rem)/6)] {i === index ? 'border-brand-800' : 'border-transparent opacity-70 hover:opacity-100'}"
						onclick={() => (current = i)}
						aria-label={m.photo_gallery_item({ n: String(i + 1) })}
						aria-pressed={i === index}
					>
						<img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if open}
		<!-- 拡大表示（背景を押すと閉じる） -->
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={m.facility_gallery()}>
			<button type="button" class="absolute inset-0 cursor-default" onclick={() => (open = false)} aria-label={m.photo_gallery_close()} tabindex="-1"></button>
			<button type="button" class="absolute right-2 top-2 z-10 p-2 text-3xl leading-none text-white/90 hover:text-white sm:right-4 sm:top-3" onclick={() => (open = false)} aria-label={m.photo_gallery_close()}>×</button>
			<div class="relative flex max-h-full w-full max-w-5xl flex-col pt-8 sm:pt-0">
				<div role="group" class="relative flex min-h-0 items-center justify-center bg-black" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
					<img src={main.url} alt={main.caption} class="max-h-[70vh] w-full object-contain" decoding="async" />
					{#if count > 1}
						<button type="button" class="{arrowBtn} left-2 h-11 w-11" onclick={() => go(-1)} aria-label={m.facility_gallery_prev()}>{@render chevron('left', 'h-6 w-6')}</button>
						<button type="button" class="{arrowBtn} right-2 h-11 w-11" onclick={() => go(1)} aria-label={m.facility_gallery_next()}>{@render chevron('right', 'h-6 w-6')}</button>
						<span class="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{index + 1}/{count}</span>
					{/if}
				</div>
				{#if main.caption}<p class="relative mt-2 text-sm font-medium text-white">{main.caption}</p>{/if}
				{#if count > 1}
					<div bind:this={modalStrip} class="relative mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{#each photos as p, i (p.url + i)}
							<button
								type="button"
								class="h-16 w-24 shrink-0 overflow-hidden rounded border-2 transition sm:h-20 sm:w-32 {i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}"
								onclick={() => (current = i)}
								aria-label={m.photo_gallery_item({ n: String(i + 1) })}
								aria-pressed={i === index}
							>
								<img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
