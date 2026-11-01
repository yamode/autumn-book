<script lang="ts">
	// プラン詳細の写真（2026-11-01）。EC の商品ページと同じく「大きなメイン写真 1 枚＋サムネイルで切り替え」。
	// - メイン写真: 左右の矢印・スワイプ・←/→ キーで前後へ。右下に「n/全体」
	// - サムネイル: 横一列。はみ出す分は横スクロール（選んだものは見える位置へ寄せる）
	// - メイン写真を押すと拡大表示（Esc で閉じる・背景を押しても閉じる）
	// タイル状に並べると 1 枚あたりが小さく、写真が 1〜2 枚だと余白が目立つため（取引先ページの PartnerPhotoGallery と同じ作り）。
	// - 客室を選んで入ってきたとき（room）: プランの写真のあとに、その客室の写真を続ける。サムネイルは「プラン｜お部屋：○○」で区切り、
	//   客室の写真を出している間はメイン写真の左上に「お部屋：○○」を出す。1 枚目はプランの写真のまま（2026-11-01 案B）
	import type { Photo } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { photos, room = null }: { photos: Photo[]; room?: { name: string; photos: Photo[] } | null } = $props();

	const roomPhotos = $derived(room?.photos ?? []);
	const all = $derived([...photos, ...roomPhotos]);
	const planCount = $derived(photos.length);
	const grouped = $derived(roomPhotos.length > 0 && planCount > 0);
	const isRoom = (i: number) => roomPhotos.length > 0 && i >= planCount;

	let current = $state(0);
	let open = $state(false);
	const count = $derived(all.length);
	const index = $derived(Math.min(current, Math.max(count - 1, 0)));
	const main = $derived(all[index]);

	function go(d: number) {
		if (count < 2) return;
		current = (index + d + count) % count;
	}

	// 選んだ写真のサムネイルを見える位置へ寄せる（ページ全体は縦に動かさない）
	let strip = $state<HTMLDivElement>();
	let modalStrip = $state<HTMLDivElement>();
	function reveal(box: HTMLDivElement | undefined) {
		// サムネイルは「プラン｜お部屋」の区切りで入れ子になるので、並び順ではなく data-i で探す（box を relative にして offsetLeft を box 基準に）
		const el = box?.querySelector<HTMLElement>(`[data-i="${index}"]`);
		if (!box || !el) return;
		const left = el.offsetLeft - (box.clientWidth - el.clientWidth) / 2;
		box.scrollTo({ left, behavior: 'smooth' });
	}
	$effect(() => reveal(strip));

	// サムネイル列の左右の ◀▶（はみ出しているときだけ、その向きにまだ続きがあれば出す）
	let canLeft = $state(false);
	let canRight = $state(false);
	function updateEdges() {
		if (!strip) return;
		canLeft = strip.scrollLeft > 4;
		canRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4;
	}
	$effect(() => {
		const box = strip;
		if (!box) return;
		void all.length;
		updateEdges();
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(updateEdges);
		ro.observe(box);
		return () => ro.disconnect();
	});
	function scrollStrip(dir: -1 | 1) {
		strip?.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: 'smooth' });
	}
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

{#snippet thumbs(variant: 'page' | 'modal')}
	{#snippet thumb(p: Photo, i: number)}
		<button
			type="button"
			data-i={i}
			class="shrink-0 overflow-hidden border-2 transition {variant === 'page'
				? `aspect-[3/2] w-[88px] rounded-md sm:w-[104px] ${i === index ? 'border-brand-800' : 'border-transparent opacity-70 hover:opacity-100'}`
				: `h-16 w-24 rounded sm:h-20 sm:w-32 ${i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}`}"
			onclick={() => (current = i)}
			aria-label={m.photo_gallery_item({ n: String(i + 1) })}
			aria-pressed={i === index}
		>
			<img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
		</button>
	{/snippet}
	{#if grouped}
		<!-- プランと客室の写真を区切って並べる（見出しは小さく・長い客室名は省略） -->
		{@const labelCls = variant === 'page' ? 'text-stone-500' : 'text-white/70'}
		<div class="shrink-0">
			<p class="mb-0.5 text-[11px] {labelCls}">{m.plan_gallery_group_plan()}</p>
			<div class="flex gap-1.5">{#each photos as p, i (p.url + i)}{@render thumb(p, i)}{/each}</div>
		</div>
		<div class="mx-1 w-px shrink-0 self-stretch {variant === 'page' ? 'bg-stone-300' : 'bg-white/30'}" aria-hidden="true"></div>
		<div class="shrink-0">
			<p class="mb-0.5 max-w-[16rem] truncate text-[11px] {labelCls}">{m.plan_gallery_group_room({ room: room?.name ?? '' })}</p>
			<div class="flex gap-1.5">{#each roomPhotos as p, j (p.url + j)}{@render thumb(p, planCount + j)}{/each}</div>
		</div>
	{:else}
		{#each all as p, i (p.url + i)}{@render thumb(p, i)}{/each}
	{/if}
{/snippet}

{#snippet roomBadge()}
	{#if isRoom(index) && room}
		<span class="pointer-events-none absolute left-2 top-2 max-w-[70%] truncate rounded bg-white/90 px-2 py-0.5 text-xs font-medium text-brand-900">{m.plan_gallery_group_room({ room: room.name })}</span>
	{/if}
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
			{@render roomBadge()}
		</figure>

		{#if count > 1}
			<div class="relative mt-2">
				<div bind:this={strip} onscroll={updateEdges} class="relative flex items-end gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{@render thumbs('page')}
				</div>
				{#if canLeft}
					<button type="button" class="absolute inset-y-0 left-0 z-10 flex w-10 items-center justify-center bg-gradient-to-r from-white via-white/90 to-transparent text-stone-700 hover:text-brand-900" onclick={() => scrollStrip(-1)} aria-label={m.facility_gallery_prev()}>
						<span class="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow ring-1 ring-stone-200">{@render chevron('left', 'h-4 w-4')}</span>
					</button>
				{/if}
				{#if canRight}
					<button type="button" class="absolute inset-y-0 right-0 z-10 flex w-10 items-center justify-center bg-gradient-to-l from-white via-white/90 to-transparent text-stone-700 hover:text-brand-900" onclick={() => scrollStrip(1)} aria-label={m.facility_gallery_next()}>
						<span class="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow ring-1 ring-stone-200">{@render chevron('right', 'h-4 w-4')}</span>
					</button>
				{/if}
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
					{@render roomBadge()}
				</div>
				{#if main.caption}<p class="relative mt-2 text-sm font-medium text-white">{main.caption}</p>{/if}
				{#if count > 1}
					<div bind:this={modalStrip} class="relative mt-3 flex items-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{@render thumbs('modal')}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
