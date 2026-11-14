<script lang="ts">
	// 事前チェックイン（/ci・お客様向け）のシェル。客室案内（/r）と同じ黒いヘッダーと淡いグレーの地にそろえる。
	// 手順: ① ご予約内容（/ci）→ ② お食事の時間（/ci/meals）→ ③ 貸切風呂（/ci/bath・任意）→ ④ 完了（/ci/done）
	// 締め切りは設けない（リンクの有効期限＝チェックアウト日 11:00 まで直せる）。公式サイトへの誘導バナーは出さない（2026-11-14）。
	// 検索エンジンには載せない（noindex）。
	import { page } from '$app/state';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import * as m from '$lib/paraglide/messages';
	import { DEMO_PRECHECKIN_CODE } from '$lib/precheckin';

	let { data, children } = $props();

	const path = $derived(page.url.pathname.replace(/^\/(en|zh-TW)(?=\/|$)/, ''));
	const step = $derived(
		path.startsWith('/ci/done') ? 4 : path.startsWith('/ci/bath') ? 3 : path.startsWith('/ci/meals') ? 2 : 1
	);
	const steps = $derived([m.ci_step_basic(), m.ci_step_meals(), m.ci_step_bath(), m.ci_step_done()]);
	const errorText = $derived(
		data.ciError === 'expired'
			? m.ci_err_expired()
			: data.ciError === 'cancelled'
				? m.ci_err_cancelled()
				: data.ciError === 'locked'
					? m.ci_err_locked()
					: data.ciError === 'none'
						? m.ci_err_none()
						: m.ci_err_invalid_token()
	);
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	<title>{m.ci_title()}{data.ctx ? ` | ${data.ctx.facility.name}` : ''}</title>
</svelte:head>

<div class="min-h-screen bg-ci text-stone-900">
	<div class="mx-auto flex min-h-screen max-w-md flex-col bg-ci shadow-sm">
		<header class="sticky top-0 z-30 flex h-10 items-center bg-black pl-5 pr-3 text-white">
			<span class="flex-1 truncate text-[15px]">{data.ctx?.facility.name ?? m.ci_title()}</span>
			<LocaleSwitcher dark />
		</header>

		<main class="flex-1 px-4 pb-10 pt-4">
			{#if data.ctx}
				{#if data.ctx.bookingCode === DEMO_PRECHECKIN_CODE}
					<p class="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-sky-200">{m.ci_demo_notice()}</p>
				{/if}
				<h1 class="text-lg font-semibold">{m.ci_title()}</h1>
				<!-- 4 つを 1 行に収める。幅は字数に合わせて配る（flex-auto）ので、スマホ幅でも「お食事の時間」が 2 行に割れない -->
				<ol class="mt-3 flex gap-1 text-[11px]" aria-label={m.ci_title()}>
					{#each steps as label, i (label)}
						<li
							class="flex flex-auto items-baseline justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1.5 leading-none {i + 1 === step
								? 'bg-stone-900 text-white'
								: i + 1 < step
									? 'bg-stone-300 text-stone-700'
									: 'bg-white text-stone-400'}"
							aria-current={i + 1 === step ? 'step' : undefined}
						>
							<span class="text-[10px] font-semibold opacity-70">{i + 1}</span>{label}
						</li>
					{/each}
				</ol>
				<div class="mt-4">
					{@render children()}
				</div>
			{:else}
				<div class="mt-6 rounded-2xl bg-white p-5 text-sm shadow-sm">
					<h1 class="text-base font-semibold">{m.ci_title()}</h1>
					<p class="mt-3 leading-relaxed">{errorText}</p>
					<p class="mt-3 text-xs text-stone-500">{m.ci_err_help()}</p>
				</div>
			{/if}
		</main>
	</div>
</div>

<style>
	/* 客室案内（/r）と同じ地色 */
	:global(.bg-ci) {
		background-color: #ebedf2;
	}
</style>
