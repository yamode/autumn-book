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

{#snippet forumThreads(count: number, chip: boolean)}
	<!-- ForumThreadCard と同じ形（左に丸い頭文字・タイトル 2 行ぶん・右に投稿数） -->
	<div class="border-t border-stone-800">
		{#each Array(count) as _, i (i)}
			<div class="flex items-start gap-3.5 border-b border-stone-200 px-1 py-[1.125rem]">
				<div class="shimmer h-10 w-10 shrink-0" style:border-radius="9999px"></div>
				<div class="min-w-0 flex-1 space-y-2">
					{#if chip}<div class="shimmer h-4 w-20" style:border-radius="9999px"></div>{/if}
					<div class="shimmer h-4 {['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5'][i % 4]}"></div>
					<div class="shimmer h-3 w-36"></div>
				</div>
				<div class="shimmer h-4 w-8 self-center"></div>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet forumHero(small: boolean)}
	<div class="space-y-2.5">
		{#if small}<div class="shimmer h-3.5 w-36"></div>{/if}
		<div class="shimmer h-3 w-40"></div>
		{#if title}<h1 class="text-[1.75rem] font-bold leading-snug text-stone-900 sm:text-[2.25rem]">{title}</h1>{:else}<div class="shimmer h-9 w-48"></div>{/if}
		<div class="shimmer h-4 w-full max-w-md"></div>
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
		{#if shape === 'inroom'}
			<!-- 客室案内のトップ: 端まで広がる写真 → 滞在カード（ようこそ＋お部屋・チェックアウト）→ 案内のカード 2 列。
			     写真を端まで出すため、PageLoadingBoundary はこの形のとき余白を付けない -->
			<div class="shimmer-block h-48 w-full rounded-none"></div>
			<div class="space-y-3 px-4 py-3">
				<div class="space-y-3 rounded-lg bg-white px-4 py-4 shadow-card">
					<div class="shimmer h-4 w-48 max-w-full"></div>
					<div class="flex justify-between gap-3"><div class="shimmer h-3.5 w-14"></div><div class="shimmer h-3.5 w-16"></div></div>
					<div class="flex justify-between gap-3"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-3.5 w-24"></div></div>
				</div>
				<!-- 貸切風呂のご予約／フロントへお電話（アイコン＋文字が左右に 2 つ） -->
				<div class="grid grid-cols-2 divide-x divide-stone-100 rounded-lg bg-white py-4 shadow-card">
					{#each [0, 1] as i (i)}
						<div class="flex flex-col items-center gap-2"><div class="shimmer h-6 w-6" style:border-radius="9999px"></div><div class="shimmer h-3.5 w-24"></div></div>
					{/each}
				</div>
				<div class="grid grid-cols-2 gap-3">
					{#each [0, 1, 2, 3, 4, 5] as i (i)}
						<div class="flex h-24 items-center justify-center rounded-lg bg-white shadow-card"><div class="shimmer h-4 w-20"></div></div>
					{/each}
				</div>
			</div>
		{:else if shape === 'search-results'}
			{@render searchCards()}
		{:else if shape === 'plans-results'}
			{@render planRooms()}
		{:else if kind === 'videos' || shape === 'videos'}
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
		{:else if shape === 'community'}
			<!-- コミュニティのトップ: 英字の小見出し → 見出し → 説明 → 丸いボタン → 掲示板のカード（スマホは横並び）→ 最近の投稿 -->
			<div class="mx-auto max-w-5xl space-y-8 pt-4 sm:pt-8">
				<div>{@render forumHero(false)}<div class="mt-5 shimmer h-10 w-28" style:border-radius="9999px"></div></div>
				<div class="space-y-3.5">
					<div class="shimmer h-5 w-28"></div>
					<div class="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
						{#each [0, 1, 2] as i (i)}
							<div class="space-y-2 border-t border-stone-800 pb-5 pt-4 {i === 2 ? 'sm:hidden lg:block' : ''}">
								<div class="shimmer h-3 w-6"></div><div class="shimmer h-5 w-2/5"></div><div class="shimmer h-3.5 w-4/5"></div>
								<div class="flex gap-3 pt-2"><div class="shimmer h-3 w-10"></div><div class="shimmer h-3 w-24"></div></div>
							</div>
						{/each}
					</div>
				</div>
				<div class="space-y-3.5"><div class="shimmer h-5 w-28"></div>{@render forumThreads(4, true)}</div>
			</div>
		{:else if shape === 'community-board'}
			<!-- 掲示板: 戻る → 小見出し・板の名前・説明（右に「新しい話題」）→ スレッドのカード -->
			<div class="mx-auto max-w-5xl space-y-7 pt-4 sm:pt-6">
				<div class="flex flex-wrap items-end justify-between gap-4">{@render forumHero(true)}<div class="shimmer h-11 w-36" style:border-radius="9999px"></div></div>
				{@render forumThreads(5, false)}
			</div>
		{:else if shape === 'community-thread'}
			<!-- スレッド: 戻る → 板と固定のしるし → タイトル → 投稿数 → 投稿の枠（1 番目は内側に枠） -->
			<div class="mx-auto max-w-3xl space-y-6 pt-4 sm:pt-6">
				<div class="space-y-3">
					<div class="shimmer h-3.5 w-40"></div>
					<div class="flex gap-1.5"><div class="shimmer h-5 w-24" style:border-radius="9999px"></div><div class="shimmer h-5 w-16" style:border-radius="9999px"></div></div>
					{#if title}<h1 class="text-2xl font-bold leading-snug text-stone-900">{title}</h1>{:else}<div class="shimmer h-8 w-3/4"></div>{/if}
					<div class="shimmer h-3.5 w-48"></div>
				</div>
				<div class="border-y border-t-stone-800 border-b-stone-200">
					{#each [0, 1, 2] as i (i)}
						<div class="flex gap-3.5 px-1 py-5 {i === 0 ? 'border-b border-stone-800' : i === 2 ? 'border-t border-stone-200' : ''}">
							<div class="shimmer hidden h-10 w-10 shrink-0 sm:block" style:border-radius="9999px"></div>
							<div class="min-w-0 flex-1 space-y-2.5">
								<div class="flex items-center gap-2"><div class="shimmer h-7 w-7 sm:hidden" style:border-radius="9999px"></div><div class="shimmer h-4 w-28"></div><div class="shimmer h-3 w-20"></div></div>
								<div class="shimmer h-4 w-full"></div><div class="shimmer h-4 {i === 0 ? 'w-11/12' : 'w-2/3'}"></div>{#if i === 0}<div class="shimmer h-4 w-3/5"></div>{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else if shape === 'home'}
			<!-- 公式サイトのトップ: 大きな見出し（2 行）→ 検索の枠 → 宿のカード 2 列（写真が上） -->
			<div class="mx-auto max-w-6xl space-y-12 pt-4 sm:pt-10">
				<div class="space-y-4">
					<div class="shimmer h-9 w-4/5 max-w-xl sm:h-12"></div>
					<div class="shimmer h-9 w-3/5 max-w-md sm:h-12"></div>
					<div class="shimmer h-4 w-full max-w-lg"></div>
					<div class="shimmer mt-6 h-14 w-full rounded-xl"></div>
				</div>
				<div class="space-y-5">
					<div class="shimmer h-7 w-48"></div>
					<div class="grid gap-x-8 gap-y-10 sm:grid-cols-2">
						{#each [0, 1] as i (i)}
							<div class="space-y-3"><div class="shimmer-block aspect-[4/3] w-full rounded-xl"></div><div class="shimmer h-6 w-1/2"></div><div class="shimmer h-4 w-full"></div><div class="shimmer h-4 w-4/5"></div></div>
						{/each}
					</div>
				</div>
			</div>
		{:else if shape === 'facility'}
			<!-- 施設のページ: 大きな写真 → 施設名 → 紹介文 → 写真と文の組 2 つ -->
			<div class="space-y-8">
				<div class="shimmer-block aspect-[16/9] max-h-[28rem] w-full rounded-xl"></div>
				<div class="mx-auto max-w-3xl space-y-3 text-center">
					<div class="mx-auto shimmer h-8 w-56"></div>
					<div class="mx-auto shimmer h-4 w-full"></div>
					<div class="mx-auto shimmer h-4 w-4/5"></div>
				</div>
				{#each [0, 1] as i (i)}
					<div class="grid items-center gap-6 md:grid-cols-2">
						<div class="shimmer-block aspect-[4/3] w-full rounded-xl {i === 1 ? 'md:order-2' : ''}"></div>
						<div class="space-y-3"><div class="shimmer h-6 w-2/5"></div><div class="shimmer h-4 w-full"></div><div class="shimmer h-4 w-11/12"></div><div class="shimmer h-4 w-3/4"></div></div>
					</div>
				{/each}
			</div>
		{:else if shape === 'news-list'}
			<!-- お知らせの一覧: 見出し → 日付と題名の行 -->
			<div class="mx-auto max-w-3xl space-y-5">
				{@render heading()}
				<div class="divide-y divide-stone-200 border-y border-stone-200">
					{#each [0, 1, 2, 3, 4] as i (i)}
						<div class="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6"><div class="shimmer h-3.5 w-24 shrink-0"></div><div class="shimmer h-4 {['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5', 'w-1/2'][i]}"></div></div>
					{/each}
				</div>
			</div>
		{:else if shape === 'article'}
			<!-- 記事・規約・ヘルプ: 見出し → 日付 → 段落 -->
			<div class="mx-auto max-w-3xl space-y-6">
				<div class="space-y-3">{@render heading()}<div class="shimmer h-3.5 w-32"></div></div>
				{#each [0, 1, 2] as p (p)}
					<div class="space-y-2.5">
						{#each ['w-full', 'w-11/12', 'w-full', p === 2 ? 'w-1/2' : 'w-3/4'] as w, i (i)}<div class="shimmer h-4 {w}"></div>{/each}
					</div>
				{/each}
			</div>
		{:else if shape === 'plan-detail'}
			<!-- プラン・客室の詳細: パンくず → 名前 → 写真と説明（左）＋料金の枠（右・PC） -->
			<div class="space-y-4">
				<div class="shimmer h-3 w-40"></div>
				{@render heading()}
				<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:gap-x-8">
					<div class="space-y-4">
						<div class="shimmer-block aspect-[16/10] w-full rounded-xl"></div>
						<div class="flex gap-2">{#each [0, 1, 2, 3] as i (i)}<div class="shimmer-block h-14 w-20 rounded-lg"></div>{/each}</div>
						<div class="space-y-2.5 pt-2"><div class="shimmer h-4 w-full"></div><div class="shimmer h-4 w-11/12"></div><div class="shimmer h-4 w-3/4"></div></div>
						<div class="space-y-2 rounded-xl border border-stone-200 bg-white p-4">{@render rows(4)}</div>
					</div>
					<div class="h-fit space-y-3 rounded-xl border border-stone-200 bg-white p-5">
						<div class="shimmer h-4 w-24"></div>
						<div class="shimmer h-8 w-40"></div>
						<div class="shimmer h-3.5 w-32"></div>
						<div class="shimmer h-10 w-full" style:border-radius="0.5rem"></div>
						<div class="shimmer h-12 w-full" style:border-radius="0.5rem"></div>
					</div>
				</div>
			</div>
		{:else if shape === 'form'}
			<!-- 入力の画面（予約の変更・オプション・新しい話題など）: 見出し → 説明 → 入力欄の枠 → ボタン -->
			<div class="mx-auto max-w-2xl space-y-4">
				{@render heading()}
				<div class="shimmer h-4 w-4/5"></div>
				<div class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
					{#each [0, 1, 2, 3] as i (i)}<div class="space-y-1.5"><div class="shimmer h-3.5 w-28"></div><div class="shimmer {i === 3 ? 'h-24' : 'h-10'} w-full" style:border-radius="0.375rem"></div></div>{/each}
					<div class="shimmer mt-2 h-11 w-40" style:border-radius="0.5rem"></div>
				</div>
			</div>
		{:else if shape === 'reservation-detail'}
			<!-- 予約の詳細: 施設名・状態 → 予約内容の枠（左）＋金額・操作の枠（右・PC） -->
			<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
				<div class="space-y-4">
					<div class="flex flex-wrap items-center gap-2">{@render heading()}<div class="shimmer h-6 w-20" style:border-radius="9999px"></div></div>
					<div class="shimmer h-3.5 w-48"></div>
					<div class="shimmer-block aspect-[16/7] w-full rounded-xl"></div>
					<div class="space-y-3 rounded-xl border border-stone-200 bg-white p-4">{@render rows(5)}</div>
					<div class="space-y-2.5 rounded-xl border border-stone-200 bg-white p-4"><div class="shimmer h-5 w-32"></div><div class="shimmer h-4 w-full"></div><div class="shimmer h-4 w-2/3"></div></div>
				</div>
				<div class="h-fit space-y-3 rounded-xl border border-stone-200 bg-white p-4">
					{@render rows(3)}
					<div class="flex justify-between border-t border-stone-100 pt-3"><div class="shimmer h-5 w-16"></div><div class="shimmer h-6 w-28"></div></div>
					<div class="shimmer h-11 w-full" style:border-radius="0.5rem"></div>
					<div class="shimmer h-11 w-full" style:border-radius="0.5rem"></div>
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
