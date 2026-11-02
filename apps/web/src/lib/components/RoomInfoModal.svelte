<script lang="ts">
	// 客室の紹介をその場で見せるモーダル（プラン詳細の客室選択から開く。予約の流れを離れずに確認できる）。
	// 本文は取引先ページのお部屋の紹介と同じ部品（写真のギャラリー → 説明・仕様・設備 → 「浴室・アメニティ・設備」を開いて詳しい紹介・2026-11-02）
	import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
	import type { RoomType } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { room = $bindable(null), pageHref }: { room: RoomType | null; pageHref: (room: RoomType) => string } = $props();
	let dialog = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!room) return;
		dialog?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	function close() {
		room = null;
	}
</script>

<svelte:window onkeydown={(event) => { if (room && event.key === 'Escape') close(); }} />

{#if room}
	<div class="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
		<button type="button" class="absolute inset-0 bg-stone-950/55" aria-label={m.common_close()} onclick={close}></button>
		<div bind:this={dialog} data-room-info tabindex="-1" role="dialog" aria-modal="true" aria-label={room.name} class="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:w-[min(94vw,1000px)] sm:rounded-2xl" style="--pt-accent: var(--color-brand-800); --pt-accent-soft: var(--color-stone-100)">
			<div class="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
				<h2 class="font-display min-w-0 truncate text-lg text-brand-900">{room.name}</h2>
				<button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label={m.common_close()} onclick={close}>×</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
				<p class="mb-4 mt-4 text-sm text-stone-500">{#if room.headline && room.headline !== room.name}{room.headline}・{/if}{m.room_detail_capacity({ n: String(room.capacity), size: String(room.sizeM2) })}</p>
				<PartnerContentBody photos={room.photos} description={room.description} specs={room.specs} sections={room.sections} amenities={room.amenities} detailLabel={m.room_detail_more()} />
			</div>
			<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3 sm:px-6">
				<a href={pageHref(room)} target="_blank" rel="noopener" class="text-sm text-brand-700 underline underline-offset-4 hover:text-brand-900">{m.room_info_open_page()} ↗</a>
				<button type="button" onclick={close} class="rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.room_info_back()}</button>
			</div>
		</div>
	</div>
{/if}
