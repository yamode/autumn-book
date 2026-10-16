<script lang="ts">
	// 客室案内の全客室へのお知らせ（2026-10-17）。管理画面（/admin/inroom）から施設ごとに一斉に出す。
	// 開いた端末で「確認しました」を押すと、その端末では次から出さない（既読は localStorage・inroom-notice-read.ts）。
	// サーバーでは既読が分からないので、表示はブラウザで既読を読んでから（最初の描画では出さない）。
	import * as m from '$lib/paraglide/messages';
	import { addReadIds, loadReadIds, saveReadIds, unreadNotices } from '$lib/inroom-notice-read';

	type Notice = { id: string; title: string; body: string };
	let { notices = [] }: { notices?: Notice[] } = $props();

	let readIds = $state<string[] | null>(null);
	$effect(() => {
		readIds = loadReadIds();
	});
	const unread = $derived(readIds === null ? [] : unreadNotices(notices, readIds));

	function confirmRead() {
		const next = addReadIds(readIds ?? [], unread.map((n) => n.id));
		saveReadIds(next);
		readIds = next;
	}
</script>

{#if unread.length}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
		<div
			class="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="inroom-notice-heading"
		>
			<p id="inroom-notice-heading" class="flex items-center gap-2 text-xs font-semibold tracking-wide text-amber-700">
				<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
				</svg>
				{m.inroom_notice_heading()}
			</p>
			<div class="mt-3 divide-y divide-stone-100">
				{#each unread as n (n.id)}
					<section class="py-3 first:pt-0 last:pb-0">
						{#if n.title}<h2 class="text-[15px] font-semibold text-stone-900">{n.title}</h2>{/if}
						<p class="mt-1 whitespace-pre-line text-sm leading-relaxed text-stone-700">{n.body}</p>
					</section>
				{/each}
			</div>
			<button
				type="button"
				onclick={confirmRead}
				class="mt-5 w-full rounded-lg bg-stone-900 py-3 text-sm font-medium text-white active:bg-stone-700"
			>
				{m.inroom_notice_ok()}
			</button>
		</div>
	</div>
{/if}
