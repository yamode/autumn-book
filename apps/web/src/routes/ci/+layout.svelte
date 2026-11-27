<script lang="ts">
	// 事前チェックイン（/ci・お客様向け）のシェル。客室案内（/r）と同じ黒いヘッダーと淡いグレーの地にそろえる。
	// 手順: ① ご予約内容（/ci）→ ② お食事の時間（/ci/meals）→ ③ 貸切風呂（/ci/bath・任意）→ ④ 完了（/ci/done）
	// 締め切りは設けない（リンクの有効期限＝チェックアウト日 11:00 まで直せる）。公式サイトへの誘導バナーは出さない（2026-11-14）。
	// 検索エンジンには載せない（noindex）。
	import { page } from '$app/state';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import PageLoadingBoundary from '$lib/components/PageLoadingBoundary.svelte';
	import { pendingPage } from '$lib/page-transition';
	import * as m from '$lib/paraglide/messages';
	import { DEMO_PRECHECKIN_CODE } from '$lib/precheckin';
	import { canBookBathInPrecheckin } from '$lib/precheckin-p3';

	let { data, children } = $props();

	const path = $derived(page.url.pathname.replace(/^\/(en|zh-TW)(?=\/|$)/, ''));
	const pending = $derived(pendingPage('checkin'));
	const route = $derived(pending?.route.id ?? path);
	const showBath = $derived(data.ctx ? canBookBathInPrecheckin(data.ctx) : false);
	const steps = $derived([m.ci_step_basic(), m.ci_step_meals(), ...(showBath ? [m.ci_step_bath()] : []), m.ci_step_done()]);
	const step = $derived(route === '/ci/done' ? steps.length : route === '/ci/bath' ? 3 : route === '/ci/meals' ? 2 : 1);
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

<div class="min-h-screen bg-ci text-stone-900" class:ci-enter={data.entrance}>
	<div class="mx-auto flex min-h-screen max-w-md flex-col bg-ci shadow-sm">
		<header class="sticky top-0 z-30 flex h-10 items-center bg-black pl-5 pr-3 text-white">
			<span class="ci-in-name flex-1 truncate text-[15px]">{data.ctx?.facility.name ?? m.ci_title()}</span>
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
				<!-- 手順を移ったとき（①→②→③）は、短くふわっと出す。入力の手を止めない長さ（0.35 秒） -->
				{#key path}
					<div class="ci-stage mt-4">
						<PageLoadingBoundary shell="checkin" padding="py-2" title={steps[step - 1]}>
							{@render children()}
						</PageLoadingBoundary>
					</div>
				{/key}
			{:else}
				<PageLoadingBoundary shell="checkin" padding="py-2" title={steps[step - 1]}>
					<div class="mt-6 rounded-2xl bg-white p-5 text-sm shadow-sm">
						<h1 class="text-base font-semibold">{m.ci_title()}</h1>
						<p class="mt-3 leading-relaxed">{errorText}</p>
						<p class="mt-3 text-xs text-stone-500">{m.ci_err_help()}</p>
					</div>
				</PageLoadingBoundary>
			{/if}
		</main>
	</div>
</div>

<style>
	/*
	 * 演出（2026-11-15・ユーザー指示「旅の気分が上がる、ゆったりした感じに」）。
	 * 1) リンクから入った直後の 1 回（.ci-enter）: 施設名 → 題 → 手順 → 中身 の順に、下から少し浮かび上がりながら
	 *    1 つずつ現れる（1 つ 1.5 秒・0.25 秒ずつずらす・全部が出そろうまで約 3 秒。先に出るものは 1 秒ほどで読める）。
	 * 2) 手順を移ったとき（.ci-stage）: 短いフェードだけ（0.35 秒）。
	 * 端末で「動きを減らす」にしている方には、どちらも出さない。
	 */
	@keyframes ci-rise {
		from {
			opacity: 0;
			transform: translateY(14px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@keyframes ci-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ci-stage {
		animation: ci-fade 0.35s ease both;
	}
	.ci-enter .ci-stage {
		animation: none;
	}
	.ci-enter .ci-in-name {
		animation: ci-fade 1.4s ease 0.15s both;
	}
	.ci-enter :global(main > h1),
	.ci-enter :global(main > ol),
	.ci-enter :global(main > p),
	.ci-enter .ci-stage :global([data-transition-content] > section),
	.ci-enter .ci-stage :global([data-transition-content] > form > *) {
		animation: ci-rise 1.5s cubic-bezier(0.2, 0.6, 0.2, 1) both;
	}
	.ci-enter :global(main > p) {
		animation-delay: 0.2s;
	}
	.ci-enter :global(main > h1) {
		animation-delay: 0.25s;
	}
	.ci-enter :global(main > ol) {
		animation-delay: 0.5s;
	}
	.ci-enter .ci-stage :global([data-transition-content] > section) {
		animation-delay: 0.75s;
	}
	.ci-enter .ci-stage :global([data-transition-content] > form > *) {
		animation-delay: 1.4s;
	}
	.ci-enter .ci-stage :global([data-transition-content] > form > *:nth-child(1)) {
		animation-delay: 1s;
	}
	.ci-enter .ci-stage :global([data-transition-content] > form > *:nth-child(2)) {
		animation-delay: 1.25s;
	}
	@media (prefers-reduced-motion: reduce) {
		.ci-stage,
		.ci-enter .ci-in-name,
		.ci-enter :global(main > h1),
		.ci-enter :global(main > ol),
		.ci-enter :global(main > p),
		.ci-enter .ci-stage :global([data-transition-content] > section),
		.ci-enter .ci-stage :global([data-transition-content] > form > *) {
			animation: none;
		}
	}

	/* 客室案内（/r）と同じ地色 */
	:global(.bg-ci) {
		background-color: #ebedf2;
	}
</style>
