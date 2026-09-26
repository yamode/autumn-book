<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>部屋編集 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">部屋編集 — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	部屋タイプの新設・室数・定員の変更は PMS 側（pms.room_types）。ここでは公式サイトと取引先ページでの見せ方を編集します。
</p>

{#if data.loadError}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}">{data.loadError}</p>
{/if}

<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
	{#each data.rooms as room (room.id)}
		<a href="/admin/rooms/{room.id}" class="flex items-center gap-4 border-b border-stone-100 p-3 last:border-b-0 hover:bg-stone-50">
			{#if room.photos[0]}
				<img src={room.photos[0].url} alt={room.name} class="h-16 w-24 shrink-0 rounded-md object-cover" />
			{:else}
				<div class="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-stone-100 text-[10px] text-stone-400">写真なし</div>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium text-stone-800">
					{room.name}
					<span class="ml-1 text-xs font-normal text-stone-400">{room.code}{room.capacityMax ? `・定員${room.capacityMin ?? 1}〜${room.capacityMax}名` : ''}</span>
				</p>
				<p class="truncate text-xs text-stone-500">{room.headline || '（見出し未入力）'}</p>
				<p class="mt-0.5 text-[11px] text-stone-400">写真 {room.photos.length}・仕様 {room.specs.length}・ブロック {room.sections.length}</p>
			</div>
			<div class="flex shrink-0 flex-col items-end gap-1">
				{#if !room.hasContent}
					<span class="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">未作成</span>
				{:else if room.isPublished}
					<span class="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] text-white">公開中</span>
				{:else}
					<span class="rounded-full bg-stone-600 px-2 py-0.5 text-[11px] text-white">下書き</span>
				{/if}
				{#if !room.isActive}
					<span class="text-[11px] text-rose-600">PMS で無効</span>
				{/if}
			</div>
		</a>
	{:else}
		<p class="p-4 text-sm text-stone-500">部屋タイプがありません。</p>
	{/each}
</div>
