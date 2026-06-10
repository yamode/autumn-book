<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>部屋編集 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">部屋コンテンツ編集 — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">部屋タイプの新設・室数・定員の変更は PMS 側（pms.room_types）。ここでは公開ページの見せ方のみ編集します。</p>

<div class="space-y-4">
	{#each data.rooms as room}
		<form method="POST" action="?/save" use:enhance class="rounded-xl border border-stone-200 bg-white p-4">
			<input type="hidden" name="roomId" value={room.id} />
			<div class="flex flex-col gap-4 sm:flex-row">
				<img src={room.photos[0]?.url} alt={room.name} class="h-28 w-full rounded-lg object-cover sm:w-44" />
				<div class="flex-1 space-y-2">
					<div class="flex items-center justify-between">
						<h2 class="font-medium text-stone-800">{room.name} <span class="text-xs font-normal text-stone-400">定員{room.capacity}名・{room.sizeM2}㎡・{room.totalRooms}室</span></h2>
						{#if form?.saved === room.id}<span class="text-xs text-emerald-600">✔ 保存済み</span>{/if}
					</div>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">見出し</span>
						<input name="headline" value={room.headline} class="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5" />
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">説明文</span>
						<textarea name="description" rows="2" class="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5">{room.description}</textarea>
					</label>
					<label class="block text-sm">
						<span class="text-xs text-stone-500">特徴タグ（「、」区切り）</span>
						<input name="amenities" value={room.amenities.join('、')} class="mt-0.5 w-full rounded-md border border-stone-300 px-3 py-1.5" />
					</label>
					<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
				</div>
			</div>
		</form>
	{/each}
</div>
