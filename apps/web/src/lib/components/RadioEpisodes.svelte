<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { RadioEpisode, RadioEpisodePage } from '$lib/radio-episodes';

	let { initial, playlist }: { initial: RadioEpisodePage; playlist: string } = $props();
	let added = $state<RadioEpisode[]>([]);
	let next = $state<string | null | undefined>(undefined);
	let busy = $state(false);
	let failed = $state(false);
	let list: HTMLUListElement | undefined;
	let request: AbortController | undefined;
	const cursor = $derived(next === undefined ? initial.next : next);
	const videos = $derived([...initial.items, ...added]);
	const publishDateFormat = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long', timeZone: 'Asia/Tokyo' });
	onDestroy(() => request?.abort());

	async function loadMore(event: MouseEvent) {
		if (!cursor || busy) return;
		busy = true;
		failed = false;
		const controller = new AbortController();
		request = controller;
		try {
			const response = await fetch(`/kitakaze/episodes?before=${encodeURIComponent(cursor)}`, { signal: controller.signal });
			if (!response.ok) throw new Error('episodes_unavailable');
			const result = await response.json() as RadioEpisodePage;
			const known = new Set(videos.map((video) => video.id));
			const newItems = result.items.filter((video) => !known.has(video.id));
			added = [...added, ...newItems];
			next = result.next;
			if (event.detail === 0 && newItems.length) {
				await tick();
				list?.querySelector<HTMLElement>(`[data-episode="${newItems[0].id}"]`)?.focus({ preventScroll: true });
			}
		} catch {
			if (!controller.signal.aborted) failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<ul bind:this={list} class="grid gap-3 sm:grid-cols-2">
	{#each videos as video (video.id)}
		<li class="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-white">
			<a href={`https://www.youtube.com/watch?v=${video.id}&list=${playlist}`}
				data-episode={video.id} target="_blank" rel="noopener"
				class="group block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-800">
				<img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} width="320" height="180" alt="" loading="lazy" class="aspect-video w-full bg-stone-100 object-cover" />
				<div class="space-y-1 p-3">
					<p class="flex flex-wrap items-baseline gap-x-2 text-xs text-stone-600">
						<span>{m.radio_published_on()}</span>
						<time datetime={video.publishedAt}>{publishDateFormat.format(new Date(video.publishedAt))}</time>
					</p>
					<p class="wrap-anywhere text-sm font-medium text-brand-900 group-hover:underline">{video.title}</p>
				</div>
			</a>
		</li>
	{/each}
	{#if busy}
		<li aria-hidden="true" class="overflow-hidden rounded-xl border border-stone-200 bg-white">
			<div class="shimmer-block aspect-video w-full rounded-none"></div>
			<div class="space-y-2 p-3"><div class="shimmer h-3 w-24"></div><div class="shimmer h-4 w-4/5"></div></div>
		</li>
	{/if}
</ul>
<p class="sr-only" role="status">{busy ? m.radio_loading() : m.radio_visible_count({ count: String(videos.length) })}</p>
{#if cursor}
	<div class="mt-4 text-center">
		{#if failed}<p role="alert" class="mb-3 text-sm text-red-800">{m.radio_load_more_error()}</p>{/if}
		<button type="button" onclick={loadMore} aria-disabled={busy} class="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-5 py-2 text-sm font-medium text-brand-900 hover:border-brand-800 sm:w-auto">{m.radio_load_more()}</button>
	</div>
{/if}
