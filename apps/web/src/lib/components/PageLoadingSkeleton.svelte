<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import type { LoadingShape } from '$lib/page-transition';

	let { title = '', kind = 'page', shape = 'plain' }: {
		title?: string; kind?: 'page' | 'videos'; shape?: LoadingShape;
	} = $props();
</script>

{#snippet heading()}
	<!-- 見出し要素にして、画面ごとの見出しの書体（公式サイトは明朝）をそのまま受ける。aria-hidden の中なので読み上げには出ない -->
	{#if title}<h1 class="text-xl font-semibold leading-snug text-stone-900 sm:text-2xl">{title}</h1>
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

{#snippet rows(count: number)}
	<div class="space-y-2.5">
		{#each Array(count) as _, i (i)}
			<div class="flex justify-between gap-3"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-3.5 {['w-32', 'w-24', 'w-40', 'w-28'][i % 4]}"></div></div>
		{/each}
	</div>
{/snippet}

{#snippet searchCards()}
<div class="space-y-5">
	{#each [0, 1] as i (i)}
		<div class="overflow-hidden rounded-xl border border-stone-200 bg-white md:flex">
			<div class="shimmer-block aspect-video w-full rounded-none md:w-[48%] md:shrink-0"></div>
			<div class="flex flex-1 flex-col gap-2 p-4 md:p-5">
				<div class="shimmer h-3 w-24"></div><div class="shimmer h-6 w-40"></div><div class="shimmer h-3.5 w-full"></div><div class="shimmer h-3.5 w-2/3"></div>
				<div class="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-stone-100 pt-3 md:mt-auto">
					<div class="space-y-1.5"><div class="shimmer h-6 w-32"></div><div class="shimmer h-3 w-28"></div></div>
					<div class="shimmer h-10 w-36" style:border-radius="0.5rem"></div>
				</div>
			</div>
		</div>
	{/each}
</div>
{/snippet}

{#snippet planRooms()}
<div class="space-y-5">
	{#each [0, 1] as i (i)}
		<div class="overflow-hidden rounded-xl border border-stone-200 bg-white md:grid md:grid-cols-[280px_minmax(0,1fr)] md:rounded-2xl">
			<div class="border-b border-stone-200 md:border-b-0 md:border-r">
				<div class="shimmer-block aspect-[16/9] w-full rounded-none md:aspect-[16/11]"></div>
				<div class="space-y-2 p-4 sm:p-5"><div class="shimmer h-5 w-3/5"></div><div class="shimmer h-3 w-2/5"></div></div>
			</div>
			<div class="divide-y divide-stone-200">
				{#each [0, 1] as j (j)}
					<div class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-6">
						<div class="space-y-2"><div class="flex gap-1.5"><div class="shimmer h-5 w-14"></div><div class="shimmer h-5 w-14"></div></div><div class="shimmer h-4 w-3/4"></div><div class="shimmer h-3 w-1/2"></div></div>
						<div class="flex items-end justify-between gap-3 sm:block sm:space-y-2 sm:text-right"><div class="shimmer h-6 w-28 sm:ml-auto"></div><div class="shimmer h-9 w-24 sm:ml-auto"></div></div>
					</div>
				{/each}
			</div>
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
		{#if shape === 'search-results'}
			{@render searchCards()}
		{:else if shape === 'plans-results'}
			{@render planRooms()}
		{:else if kind === 'videos'}
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
				<div class="shimmer h-3.5 w-72 max-w-full"></div>
				<div class="shimmer h-9 w-36"></div>
				<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
					{#each [0, 1, 2, 3] as card (card)}
						<div class="space-y-3 rounded-xl border border-stone-200 bg-white p-4"><div class="shimmer h-5 w-24 max-w-full"></div><div class="shimmer h-7 w-16"></div></div>
					{/each}
				</div>
				<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
					<div class="hidden sm:block">{@render table(5, 4)}</div>
					<!-- スマホ: 「対応が必要なこと」の行の一覧 -->
					<div class="space-y-3 sm:hidden"><div class="shimmer h-4 w-32"></div><div class="rounded-xl border border-stone-200 bg-white p-4">{@render rows(3)}</div></div>
					{@render table(2, 3)}
				</div>
			</div>
		{:else if shape === 'admin-list'}
			<div class="space-y-4">
				{@render heading()}
				<div class="shimmer h-3 w-72 max-w-full"></div>
				<div class="rounded-xl border border-stone-200 bg-white p-4">{@render fields(4)}</div>
				<div class="hidden sm:block">{@render table(6, 6)}</div>
				<div class="sm:hidden">{@render table(2, 5)}</div>
			</div>
		{:else if shape === 'admin-cards'}
			<!-- カードを並べる一覧（料金プラン）: 絞り込み＋カード 2〜3 列 -->
			<div class="space-y-4">
				{@render heading()}
				<div class="rounded-xl border border-stone-200 bg-white p-4"><div class="shimmer h-10 w-full max-w-xl"></div></div>
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each [0, 1, 2, 3, 4, 5] as i (i)}
						<div class="space-y-3 rounded-xl border border-stone-200 bg-white p-4"><div class="shimmer h-5 w-3/4"></div><div class="shimmer h-3.5 w-1/2"></div><div class="shimmer h-3.5 w-2/3"></div></div>
					{/each}
				</div>
			</div>
		{:else if shape === 'admin-split'}
			<!-- 右に要約欄がある詳細（予約・会員・団体のお問い合わせ） -->
			<div class="space-y-4">
				{@render heading()}
				<div class="shimmer h-3 w-72 max-w-full"></div>
				<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
					<div class="min-w-0 space-y-4">
						<div class="rounded-xl border border-stone-200 bg-white p-4">{@render rows(5)}</div>
						{@render table(4, 3)}
					</div>
					<div class="rounded-xl border border-stone-200 bg-white p-4">{@render rows(6)}</div>
				</div>
			</div>
		{:else if shape === 'admin-detail'}
			<!-- 設定・編集の画面はほぼ 1 列（見出し → 説明 → 枠に入った入力欄） -->
			<div class="space-y-4">
				{@render heading()}
				<div class="shimmer h-3 w-72 max-w-full"></div>
				{#each [3, 2] as count, i (i)}
					<div class="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
						<div class="shimmer h-4 w-36"></div>
						{#each Array(count) as _, j (j)}<div class="space-y-1.5"><div class="shimmer h-3 w-28"></div><div class="shimmer h-9 rounded-md"></div></div>{/each}
					</div>
				{/each}
			</div>
		{:else if shape === 'search'}
			<!-- 空室検索: 見出し（スマホは右に「地図で見る」）→ 条件 → 宿のカード（PC は写真 48% が左・スマホは上）＋右に地図 -->
			<div class="space-y-3">
				<div class="flex items-center justify-between gap-3">{@render heading()}<div class="shimmer h-9 w-28 lg:hidden" style:border-radius="9999px"></div></div>
				<div class="space-y-1.5"><div class="shimmer h-4 w-full max-w-xl"></div><div class="shimmer h-4 w-2/3 max-w-sm sm:hidden"></div></div>
				<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
					<div class="space-y-3">
						<div class="shimmer h-3 w-16"></div>
						{@render searchCards()}
					</div>
					<div class="shimmer-block hidden h-[420px] rounded-xl lg:block"></div>
				</div>
			</div>
		{:else if shape === 'plans' || shape === 'rooms'}
			<div class="space-y-4">
				{#if shape === 'plans'}
					<!-- 客室・プラン一覧: パンくず → 施設名 → 紹介・所在地 → タブ → 検索の枠 → 「客室から探す」と絞り込み → 部屋ごとの枠 -->
					<div class="shimmer h-3 w-28"></div>
					<div class="shimmer h-8 w-48"></div>
					<div class="flex flex-wrap justify-between gap-2"><div class="shimmer h-4 w-80 max-w-full"></div><div class="shimmer h-3 w-72 max-w-full"></div></div>
					<div class="flex gap-6 border-b border-stone-200 pb-2"><div class="shimmer h-5 w-20"></div><div class="shimmer h-5 w-20"></div></div>
					<div class="shimmer h-56 rounded-2xl sm:h-20"></div>
					<div class="shimmer h-6 w-36"></div>
					<div class="flex flex-wrap gap-2">{#each ['w-24', 'w-16', 'w-16', 'w-20', 'w-24'] as w, i (i)}<div class="shimmer h-8 {w}" style:border-radius="9999px"></div>{/each}</div>
					<div class="shimmer h-3.5 w-64 max-w-full"></div>
					{@render planRooms()}
				{:else}
					<!-- 客室一覧: 見出し（右に施設名）→ タブ → 部屋ごとに縦に並ぶ（見出し → 写真 3 : 説明 2） -->
					<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-stone-200 pb-3 sm:pb-4">{@render heading()}<div class="shimmer h-4 w-28"></div></div>
					<div class="flex gap-5"><div class="shimmer h-5 w-20"></div><div class="shimmer h-5 w-20"></div></div>
					<div class="space-y-8">
						{#each [0, 1] as i (i)}
							<div class="space-y-3 border-t border-stone-200 pt-5">
								<div class="shimmer h-6 w-56 max-w-full"></div>
								<div class="shimmer h-3 w-40"></div>
								<div class="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
									<div class="shimmer-block aspect-[3/2] w-full rounded-lg"></div>
									<div class="space-y-3"><div class="shimmer h-4 w-full"></div><div class="shimmer h-4 w-11/12"></div><div class="shimmer h-4 w-3/4"></div><div class="mt-4 shimmer h-24 w-full"></div><div class="shimmer h-11 w-full"></div></div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if shape === 'hold'}
			<!-- 予約入力（/booking/hold）。実際の画面と同じ並び・同じ枠（.bk-card・2 列 1fr / 380px）でなぞる -->
			<div class="py-1">
				<div class="mb-1 flex gap-2">{#each ['w-16', 'w-20', 'w-28', 'w-14'] as w (w)}<div class="shimmer h-3 {w}"></div>{/each}</div>
				<!-- 公開サイトの見出しと同じ明朝（app.css の .site-public h1） -->
				<p class="mt-2 text-2xl leading-snug text-stone-900" style="font-family: var(--font-serif-jp); font-weight: 500; letter-spacing: 0.05em">{title}</p>
				<div class="mt-3 flex gap-2"><div class="shimmer h-7 w-20" style:border-radius="9999px"></div><div class="shimmer h-7 w-28" style:border-radius="9999px"></div></div>
				<!-- 「選び直す」と注記（スマホでは注記が下の行に回る） -->
				<div class="mt-3 flex flex-wrap gap-x-2 gap-y-1.5"><div class="shimmer h-4 w-44"></div><div class="shimmer h-3 w-72 max-w-full"></div></div>
				<div class="mt-4 shimmer h-10 w-full" style:border-radius="0.5rem"></div>
				<!-- スマホ: 合計の要約 -->
				<div class="mt-4 space-y-2 rounded-xl border border-stone-200 bg-white p-3 lg:hidden">
					<div class="shimmer h-4 w-32"></div><div class="shimmer h-3 w-3/4"></div><div class="shimmer h-3 w-2/3"></div>
					<div class="flex justify-between border-t border-stone-100 pt-2"><div class="shimmer h-4 w-20"></div><div class="shimmer h-6 w-28"></div></div>
					<div class="ml-auto shimmer h-3 w-20"></div>
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
			<!-- 予約の完了・取消・支払（1 列・中央寄せ max-w-2xl） -->
			<div class="mx-auto max-w-2xl space-y-5 py-4 text-center">
				<div class="mx-auto shimmer h-10 w-10" style:border-radius="9999px"></div>
				{@render heading()}
				<div class="mx-auto shimmer h-4 w-3/4"></div>
				<div class="mx-auto max-w-md space-y-2.5 rounded-xl bg-stone-50 p-4">{@render rows(5)}</div>
				<div class="mx-auto shimmer h-11 w-56"></div>
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
			<!-- 会員特典: 英字の小見出し → 見出し → 導入文 → 「グレードと還元率」 → 説明 → 比べる表 -->
			<div class="pt-3 text-center">
				<div class="mx-auto shimmer h-3.5 w-36"></div>
				<div class="mx-auto mt-3">{@render heading()}</div>
				<div class="mx-auto mt-4 max-w-2xl space-y-2"><div class="mx-auto shimmer h-4 w-11/12"></div><div class="mx-auto shimmer h-4 w-2/3"></div></div>
				<div class="mx-auto mt-10 shimmer h-7 w-56"></div>
				<div class="mx-auto mt-3 shimmer h-3.5 w-4/5 max-w-lg"></div>
				<div class="mt-5 text-left">{@render table(5, 8)}</div>
			</div>
		{:else if shape === 'lookup'}
			<!-- 予約の確認: 見出し → 説明 → 予約の方法ごとの案内の枠（縦に並ぶ） -->
			<div class="mx-auto max-w-2xl space-y-4">
				{@render heading()}
				<div class="shimmer h-4 w-4/5"></div>
				{#each [3, 2, 2] as lines, i (i)}
					<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
						<div class="shimmer h-6 w-3/5"></div>
						{#each Array(lines) as _, j (j)}<div class="shimmer h-3.5 {j === lines - 1 ? 'w-3/4' : 'w-full'}"></div>{/each}
						{#if i === 0}<div class="shimmer h-10 w-28"></div>{/if}
					</div>
				{/each}
			</div>
		{:else if shape === 'account'}
			<!-- マイページのトップ・予約一覧: 見出し → 予約のカード（写真＋文字） -->
			<div class="space-y-3">
				<div class="shimmer h-5 w-32"></div>
				{#each [0, 1] as i (i)}
					<div class="flex items-start gap-4 rounded-2xl border border-stone-200 bg-white p-4">
						<div class="shimmer-block hidden h-24 w-32 shrink-0 rounded-xl sm:block"></div>
						<div class="min-w-0 flex-1 space-y-2"><div class="shimmer h-3.5 w-28"></div><div class="shimmer h-5 w-1/2"></div><div class="shimmer h-4 w-2/5"></div><div class="shimmer h-3.5 w-1/3"></div></div>
					</div>
				{/each}
			</div>
		{:else if shape === 'account-profile'}
			<div class="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:gap-6">
				<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6"><div class="shimmer h-5 w-32"></div><div class="mx-auto shimmer h-24 w-24" style:border-radius="9999px"></div><div class="shimmer h-9"></div></div>
				<div class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
					<div class="shimmer h-5 w-32"></div>
					{#each [0, 1, 2, 3] as i (i)}<div class="space-y-1.5"><div class="shimmer h-3 w-24"></div><div class="shimmer h-10"></div></div>{/each}
				</div>
			</div>
		{:else if shape === 'account-list'}
			<!-- マイページのその他（設定・ポイント・クーポン等）: 見出し → 行の一覧 -->
			<div class="space-y-3">
				<div class="shimmer h-5 w-40"></div>
				<div class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-4">
					{#each [0, 1, 2, 3] as i (i)}<div class="flex items-center justify-between gap-3 py-4"><div class="min-w-0 flex-1 space-y-2"><div class="shimmer h-4 w-2/5"></div><div class="shimmer h-3 w-3/5"></div></div><div class="shimmer h-4 w-4"></div></div>{/each}
				</div>
			</div>
		{:else}
			{@render heading()}
			<div class="mt-4 shimmer h-3.5 w-64 max-w-full"></div>
		{/if}
	</div>
</div>
