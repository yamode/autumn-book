<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import type { LoadingShape } from '$lib/page-transition';

	let { title = '', kind = 'page', shape = 'plain' }: {
		title?: string; kind?: 'page' | 'videos'; shape?: LoadingShape;
	} = $props();
</script>

{#snippet heading()}
	{#if title}<p class="text-xl font-semibold leading-snug text-stone-900 sm:text-2xl">{title}</p>
	{:else}<div class="shimmer h-7 w-44 max-w-full"></div>{/if}
{/snippet}

{#snippet fields(count: number)}
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each Array(count) as _, i (i)}
			<div class="min-w-0 space-y-2"><div class="shimmer h-3 w-2/3"></div><div class="shimmer h-9 rounded-md"></div></div>
		{/each}
	</div>
{/snippet}

{#snippet table(cols: number, rows: number)}
	<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
		{#each Array(rows + 1) as _, row (row)}
			<div class="grid gap-4 border-b border-stone-100 px-4 {row === 0 ? 'bg-stone-50 py-3' : 'py-3.5'}" style:grid-template-columns={'1.15fr ' + 'minmax(0,1fr) '.repeat(cols - 1)}>
				{#each Array(cols) as _, col (col)}
					<div class="shimmer min-w-0 {row === 0 ? 'h-2.5 w-3/4' : 'h-3 w-full'}"></div>
				{/each}
			</div>
		{/each}
	</div>
{/snippet}

{#snippet pictureCards(count: number, plan = false)}
	<div class="space-y-5">
		{#each Array(count) as _, i (i)}
			<div class={'overflow-hidden rounded-xl border border-stone-200 bg-white ' + (plan ? 'md:grid md:grid-cols-[280px_minmax(0,1fr)]' : '')}>
				<div class="shimmer-block w-full rounded-none {plan ? 'aspect-[16/9] md:aspect-[16/11]' : 'aspect-[16/7]'}"></div>
				<div class="space-y-3 px-4 py-5 sm:px-5">
					<div class="shimmer h-5 w-2/5"></div>
					<div class="shimmer h-3 w-3/4"></div>
					<div class="ml-auto shimmer h-8 w-24"></div>
				</div>
			</div>
		{/each}
	</div>
{/snippet}

<div data-page-skeleton data-skeleton-shape={shape} aria-busy="true" class="min-w-0">
	<p role="status" class="sr-only">{kind === 'videos' ? m.radio_loading() : title ? `${title} · ${m.common_loading()}` : m.common_loading()}</p>
	<div aria-hidden="true">
		{#if kind === 'videos'}
			<div class="grid gap-3 sm:grid-cols-2">
				{#each [0, 1, 2, 3] as card (card)}
					<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
						<div class="shimmer-block aspect-video w-full rounded-none"></div>
						<div class="space-y-2 p-3"><div class="shimmer h-3 w-24 max-w-full"></div><div class="shimmer h-4 w-4/5"></div></div>
					</div>
				{/each}
			</div>
		{:else if shape === 'admin-dashboard'}
			<div class="space-y-4">
				{@render heading()}
				<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{#each [0, 1, 2, 3] as card (card)}
						<div class="space-y-3 rounded-xl border border-stone-200 bg-white p-4"><div class="shimmer h-5 w-24 max-w-full"></div><div class="shimmer h-7 w-16"></div></div>
					{/each}
				</div>
				<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
					{@render table(5, 4)}
					{@render table(2, 3)}
				</div>
			</div>
		{:else if shape === 'admin-list' || shape === 'admin-detail'}
			<div class="space-y-4">
				{@render heading()}
				<div class="shimmer h-3 w-72 max-w-full"></div>
				{#if shape === 'admin-list'}
					<div class="rounded-xl border border-stone-200 bg-white p-4">{@render fields(4)}</div>
					<div class="hidden sm:block">{@render table(6, 6)}</div>
					<div class="sm:hidden">{@render table(2, 5)}</div>
				{:else}
					<div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
						<div class="rounded-xl border border-stone-200 bg-white p-4">{@render fields(8)}</div>
						{@render table(2, 3)}
					</div>
				{/if}
			</div>
		{:else if shape === 'search'}
			<div class="space-y-3">
				{@render heading()}
				<div class="shimmer h-4 w-56 max-w-full"></div>
				<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
					<div class="space-y-3"><div class="shimmer h-3 w-20"></div>{@render pictureCards(2)}</div>
					<div class="shimmer-block hidden h-[420px] rounded-xl lg:block"></div>
				</div>
			</div>
		{:else if shape === 'plans' || shape === 'rooms'}
			<div class="space-y-4">
				<div class="shimmer h-3 w-28"></div>
				{@render heading()}
				<div class="flex gap-3 border-b border-stone-200 pb-2"><div class="shimmer h-5 w-24"></div><div class="shimmer h-5 w-24"></div></div>
				{#if shape === 'plans'}
					<div class="shimmer h-28 rounded-2xl sm:h-16"></div>
					<div class="shimmer h-5 w-32"></div>
					{@render pictureCards(2, true)}
				{:else}
					<div class="grid gap-4 md:grid-cols-2">{@render pictureCards(1)}{@render pictureCards(1)}</div>
				{/if}
			</div>
		{:else if shape === 'hold'}
			<!-- 予約入力（/booking/hold）。実際の画面と同じ並び・同じ枠（.bk-card・2 列 1fr / 380px）でなぞる -->
			<div class="py-1">
				<div class="mb-1 flex gap-2">{#each ['w-16', 'w-20', 'w-28', 'w-14'] as w (w)}<div class="shimmer h-3 {w}"></div>{/each}</div>
				<!-- 公開サイトの見出しと同じ明朝（app.css の .site-public h1） -->
				<p class="mt-2 text-2xl leading-snug text-stone-900" style="font-family: var(--font-serif-jp); font-weight: 500; letter-spacing: 0.05em">{title}</p>
				<div class="mt-3 flex gap-2"><div class="shimmer h-7 w-20" style:border-radius="9999px"></div><div class="shimmer h-7 w-28" style:border-radius="9999px"></div></div>
				<div class="mt-3 shimmer h-4 w-64 max-w-full"></div>
				<div class="mt-4 shimmer h-10 w-full" style:border-radius="0.5rem"></div>
				<!-- スマホ: 合計の要約 -->
				<div class="mt-4 space-y-2 rounded-xl border border-stone-200 bg-white p-3 lg:hidden">
					<div class="shimmer h-4 w-32"></div><div class="shimmer h-3 w-3/4"></div>
					<div class="flex justify-between border-t border-stone-100 pt-2"><div class="shimmer h-4 w-12"></div><div class="shimmer h-5 w-24"></div></div>
				</div>
				<div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
					<div class="grid min-w-0 gap-5">
						{#if !page.data.user}
							<!-- 非会員だけに出る「会員の方はログイン」の枠 -->
							<div class="space-y-3 rounded-xl border border-accent-500/40 bg-amber-50/60 p-4">
								<div class="shimmer h-4 w-64 max-w-full"></div>
								<div class="flex items-center gap-3"><div class="shimmer h-8 w-24"></div><div class="shimmer h-3.5 w-56 max-w-full"></div></div>
							</div>
						{/if}
						<div class="bk-card">
							<div class="mb-5 shimmer h-5 w-40"></div>
							<div class="grid gap-4 sm:grid-cols-2">
								{#each [0, 1, 2, 3, 4, 5, 6] as i (i)}
									<div class="min-w-0 space-y-1.5 {i === 4 ? 'sm:col-span-2' : ''}"><div class="shimmer h-3.5 w-24"></div><div class="shimmer h-10"></div></div>
								{/each}
							</div>
							<div class="mt-4 grid gap-3 sm:grid-cols-2">
								{#each [0, 1, 2] as i (i)}
									<div class="min-w-0 space-y-1.5 {i > 0 ? 'sm:col-span-2' : ''}"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-10"></div></div>
								{/each}
							</div>
						</div>
						<div class="bk-card">
							<div class="mb-5 shimmer h-5 w-48"></div>
							<div class="grid gap-4 sm:grid-cols-2">
								<div class="space-y-1.5"><div class="shimmer h-3.5 w-24"></div><div class="shimmer h-10"></div></div>
								<div class="flex items-end pb-2"><div class="shimmer h-5 w-40"></div></div>
								<div class="space-y-1.5 sm:col-span-2"><div class="shimmer h-3.5 w-32"></div><div class="shimmer h-20"></div></div>
							</div>
						</div>
					</div>
					<div class="bk-card">
						<div class="flex items-start gap-3">
							<div class="shimmer-block h-[72px] w-[72px] shrink-0 rounded-lg"></div>
							<div class="min-w-0 flex-1 space-y-2 pt-1"><div class="shimmer h-5 w-3/4"></div><div class="shimmer h-3.5 w-1/2"></div></div>
						</div>
						<div class="mt-4 space-y-2.5">
							{#each ['w-24', 'w-36', 'w-28', 'w-20'] as w (w)}
								<div class="flex justify-between gap-2"><div class="shimmer h-3.5 w-14"></div><div class="shimmer h-3.5 {w}"></div></div>
							{/each}
						</div>
						<div class="mt-4 space-y-2.5 border-t border-stone-200 pt-3">
							<div class="flex justify-between"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-3.5 w-16"></div></div>
							<div class="flex justify-between"><div class="shimmer h-3.5 w-16"></div><div class="shimmer h-3.5 w-14"></div></div>
							<div class="flex justify-between pt-1"><div class="shimmer h-5 w-12"></div><div class="shimmer h-6 w-28"></div></div>
						</div>
						<div class="mt-4 space-y-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3">
							<div class="shimmer h-4 w-36"></div><div class="shimmer h-3 w-full"></div><div class="shimmer h-3 w-4/5"></div>
						</div>
						<div class="mt-4 shimmer h-12 w-full rounded-lg"></div>
					</div>
				</div>
			</div>
		{:else if shape === 'booking'}
			<div class="space-y-4">
				{@render heading()}
				<div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
					<div class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">{@render fields(8)}<div class="shimmer h-11 w-full"></div></div>
					<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-5"><div class="shimmer h-24 w-full"></div><div class="shimmer h-4 w-36"></div><div class="shimmer h-4 w-24"></div></div>
				</div>
			</div>
		{:else if shape === 'auth'}
			<div class="mx-auto max-w-md space-y-4 pt-4 text-center">
				{@render heading()}
				<div class="mx-auto shimmer h-4 w-4/5"></div>
				<div class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
					<div class="shimmer h-12"></div><div class="shimmer h-10"></div><div class="shimmer h-11"></div>
				</div>
			</div>
		{:else if shape === 'membership'}
			<div class="space-y-6 pt-3 text-center">
				{@render heading()}
				<div class="mx-auto shimmer h-4 w-3/4 max-w-lg"></div>
				{@render table(5, 8)}
			</div>
		{:else if shape === 'account'}
			<div class="space-y-4">
				{@render heading()}
				<div class="rounded-2xl border border-stone-200 bg-white p-5">
					<div class="mb-4 shimmer h-5 max-w-40"></div>
					{@render fields(4)}
				</div>
			</div>
		{:else}
			{@render heading()}
			<div class="mt-4 shimmer h-3.5 w-64 max-w-full"></div>
		{/if}
	</div>
</div>
