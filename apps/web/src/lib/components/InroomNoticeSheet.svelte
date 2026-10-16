<script lang="ts">
	// 客室案内の全客室へのお知らせ（2026-10-17）。管理画面（/admin/inroom）から施設ごとに一斉に出す。
	// 開いた端末で「確認しました」を押すと、その端末では次から出さない（既読は localStorage・inroom-notice-read.ts）。
	// サーバーでは既読が分からないので、表示はブラウザで既読を読んでから（最初の描画では出さない）。
	// 画面の中央に出し、掲載日時を添える。出ている間は後ろの画面をスクロールさせない（2026-10-17 指示）。
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { addReadIds, loadReadIds, saveReadIds, unreadNotices } from '$lib/inroom-notice-read';

	type Notice = { id: string; title: string; body: string; startsAt?: string };
	let { notices = [] }: { notices?: Notice[] } = $props();

	let readIds = $state<string[] | null>(null);
	$effect(() => {
		readIds = loadReadIds();
	});
	const unread = $derived(readIds === null ? [] : unreadNotices(notices, readIds));

	// 出ている間は後ろの画面のスクロールを止める（閉じたら元に戻す）
	$effect(() => {
		if (!unread.length) return;
		const html = document.documentElement;
		const prev = { html: html.style.overflow, body: document.body.style.overflow };
		html.style.overflow = 'hidden';
		document.body.style.overflow = 'hidden';
		return () => {
			html.style.overflow = prev.html;
			document.body.style.overflow = prev.body;
		};
	});

	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	function postedLabel(iso?: string): string {
		if (!iso) return '';
		try {
			const t = new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(iso));
			return m.inroom_notice_posted({ time: t });
		} catch {
			return '';
		}
	}

	function confirmRead() {
		const next = addReadIds(readIds ?? [], unread.map((n) => n.id));
		saveReadIds(next);
		readIds = next;
	}
</script>

{#if unread.length}
	<div class="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black/50 p-4" role="presentation">
		<div
			class="max-h-[85dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl bg-white p-5 shadow-xl"
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
						{#if postedLabel(n.startsAt)}<p class="mt-0.5 text-xs tabular-nums text-stone-400">{postedLabel(n.startsAt)}</p>{/if}
						<div class="notice-body mt-1.5 text-sm text-stone-700"><MarkdownView source={n.body} /></div>
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

<style>
	/* お知らせ本文（Markdown）は詰めて出す */
	.notice-body :global(p) {
		margin: 0.35em 0;
		line-height: 1.75;
	}
	.notice-body :global(p:first-child) {
		margin-top: 0;
	}
</style>
