<script lang="ts">
	// 客室案内のアクセスログ（2026-10-17 指示）。日付ごとの一覧と、部屋ごとのまとめ。
	import { goto } from '$app/navigation';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data } = $props();

	// 部屋で絞り込む（'' は全部・'-' は滞在コードなし）
	let room = $state('');

	const fmtTime = (iso: string) =>
		new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' });

	function pageLabel(path: string, guideId: string | null): string {
		if (path === '/r') return 'トップ';
		if (guideId) return `案内：${data.guideTitles[guideId] ?? guideId}`;
		if (path === '/r/bath') return '貸切風呂';
		if (path === '/r/bath/code') return '貸切風呂（コード入力）';
		if (path === '/r/bath/complete') return '貸切風呂（予約完了）';
		if (path === '/r/bill') return 'ご精算（明細・お支払い）';
		return path;
	}
	// 押されたリンクの表示（2026-10-21）。電話・メール・予約サイト側（/ で始まる）・他サイト
	function linkLabel(url: string | null): string {
		if (!url) return '—';
		if (/^tel:/i.test(url)) return `電話 ${url.slice(4)}`;
		if (/^mailto:/i.test(url)) return `メール ${url.slice(7)}`;
		if (url.startsWith('/')) return `予約サイト ${url}`;
		return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
	}
	const LOCALE_LABEL: Record<string, string> = { ja: '日本語', en: '英語', 'zh-TW': '繁体字' };

	const roomKey = (r: { roomCode: string | null }) => r.roomCode ?? '-';
	// 数字（回数・端末・部屋）はページ表示だけで数える。リンクのクリックは別に数える
	const views = $derived(data.rows.filter((r) => r.event !== 'link'));
	const clickCount = $derived(data.rows.length - views.length);
	const filtered = $derived(room ? data.rows.filter((r) => roomKey(r) === room) : data.rows);

	// 部屋ごとのまとめ（開いた回数・端末の数・最後に開いた時刻）。コードなしは最後に1行
	const byRoom = $derived.by(() => {
		const map = new Map<string, { key: string; roomCode: string | null; guestName: string | null; views: number; clicks: number; visitors: Set<string>; last: string; isDemo: boolean }>();
		for (const r of data.rows) {
			const key = roomKey(r);
			const cur = map.get(key) ?? { key, roomCode: r.roomCode, guestName: r.guestName, views: 0, clicks: 0, visitors: new Set<string>(), last: r.createdAt, isDemo: r.isDemo };
			if (r.event === 'link') cur.clicks += 1;
			else cur.views += 1;
			if (r.visitorId && r.event !== 'link') cur.visitors.add(r.visitorId);
			if (r.createdAt > cur.last) cur.last = r.createdAt;
			cur.guestName ??= r.guestName;
			map.set(key, cur);
		}
		return [...map.values()].sort((a, b) => (a.key === '-' ? 1 : b.key === '-' ? -1 : a.key.localeCompare(b.key, 'ja', { numeric: true })));
	});
	const totalVisitors = $derived(new Set(views.map((r) => r.visitorId).filter(Boolean)).size);
	const roomsWithCode = $derived(byRoom.filter((r) => r.key !== '-').length);

	function changeDate(v: string) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) goto(`?date=${v}`, { keepFocus: true, noScroll: true });
	}

	// ---- 期間集計（2026-10-21 指示） ----
	const sum = $derived(data.summary);
	function changePeriod(from: string, to: string) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to))
			goto(`?view=period&from=${from}&to=${to}`, { keepFocus: true, noScroll: true });
	}
	const ymd = (d: Date) => d.toISOString().slice(0, 10);
	// JST の今日を UTC の 0 時として扱う（日付の足し引きだけに使う）
	const todayD = $derived(new Date(`${data.today}T00:00:00Z`));
	const presets = $derived.by(() => {
		const t = todayD;
		const y = t.getUTCFullYear();
		const m = t.getUTCMonth();
		const addDays = (n: number) => ymd(new Date(t.getTime() + n * 86400000));
		return [
			{ label: '今月', from: ymd(new Date(Date.UTC(y, m, 1))), to: data.today },
			{ label: '先月', from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) },
			{ label: '過去7日', from: addDays(-6), to: data.today },
			{ label: '過去30日', from: addDays(-29), to: data.today },
			{ label: '過去90日', from: addDays(-89), to: data.today }
		];
	});
	const isPreset = (p: { from: string; to: string }) => p.from === data.from && p.to === data.to;
	const maxPageViews = $derived(Math.max(1, ...(sum?.byPage.map((p) => p.views) ?? [])));
	// 日別は期間の全日を並べる（アクセスの無い日は 0）
	const days = $derived.by(() => {
		if (!sum) return [];
		const map = new Map(sum.byDay.map((d) => [d.day, d]));
		const out: { day: string; views: number; visitors: number }[] = [];
		for (let t = Date.parse(`${data.from}T00:00:00Z`); t <= Date.parse(`${data.to}T00:00:00Z`); t += 86400000) {
			const day = ymd(new Date(t));
			out.push(map.get(day) ?? { day, views: 0, visitors: 0 });
		}
		return out;
	});
	const maxDayViews = $derived(Math.max(1, ...days.map((d) => d.views)));
	const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
	const dayLabel = (day: string) => {
		const d = new Date(`${day}T00:00:00Z`);
		return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
	};
	const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10}%` : '—');
	function shiftDate(days: number) {
		const d = new Date(`${data.date}T00:00:00+09:00`);
		d.setUTCDate(d.getUTCDate() + days);
		changeDate(new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
	}
</script>

<svelte:head><title>客室案内のアクセスログ ｜ 管理画面</title></svelte:head>

<PageHeader
	title="客室案内のアクセスログ"
	facility={data.currentFacility.name}
	description="客室案内のページを開くたびに記録します（開いたままの自動更新は数えません）。滞在コードが紐づいていれば、どの部屋の方かが出ます。客室案内の外へのリンク（他サイト・予約サイト・電話・メール）を押したときも記録します。IP アドレスは残さず、同じ端末かどうかだけを見分けます。記録は180日で消えます。"
>
	{#snippet actions()}
		<div class="inline-flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
			<a href="?date={data.date}" class="rounded-md px-3 py-1.5 {data.view === 'day' ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-50'}">日別の一覧</a>
			<a href="?view=period&from={data.from}&to={data.to}" class="rounded-md px-3 py-1.5 {data.view === 'period' ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-50'}">期間で集計</a>
		</div>
		{#if data.view === 'period'}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<input type="date" value={data.from} max={data.to} onchange={(e) => changePeriod(e.currentTarget.value, data.to)} aria-label="開始日" class="min-h-10 rounded-lg border border-stone-300 bg-white px-2 py-1.5" />
				<span class="text-stone-400">〜</span>
				<input type="date" value={data.to} min={data.from} max={data.today} onchange={(e) => changePeriod(data.from, e.currentTarget.value)} aria-label="終了日" class="min-h-10 rounded-lg border border-stone-300 bg-white px-2 py-1.5" />
			</div>
		{:else}
		<div class="flex items-center gap-2 text-sm">
			<button type="button" onclick={() => shiftDate(-1)} class="min-h-10 shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50">‹ 前日</button>
			<input type="date" value={data.date} max={data.today} onchange={(e) => changeDate(e.currentTarget.value)} class="min-h-10 rounded-lg border border-stone-300 bg-white px-2 py-1.5" />
			<button type="button" onclick={() => shiftDate(1)} disabled={data.date >= data.today} class="min-h-10 shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50 disabled:opacity-40">翌日 ›</button>
		</div>
		{/if}
	{/snippet}
</PageHeader>

{#if data.loadError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.loadError}</p>
{/if}
{#if !data.live}
	<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-500">この環境は管理画面が実データに繋がっていないため、このサーバーで記録した分だけを表示しています。</p>
{/if}

{#if data.view === 'period'}
	{@render periodView()}
{:else}
<div class="mb-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4 sm:gap-3">
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-[11px] text-stone-500 sm:text-xs">開いた回数</p>
		<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{views.length}</p>
	</div>
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-[11px] text-stone-500 sm:text-xs">端末の数</p>
		<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{totalVisitors}</p>
	</div>
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-[11px] text-stone-500 sm:text-xs">開いた部屋の数</p>
		<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{roomsWithCode}</p>
	</div>
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-[11px] text-stone-500 sm:text-xs">外部リンクを押した回数</p>
		<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{clickCount}</p>
	</div>
</div>

{#if data.rows.length === 0}
	<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-400">この日のアクセスはありません。</p>
{:else}
	<!-- 部屋ごとのまとめ（押すとその部屋だけの一覧になる）。スマホでは横スクロール・部屋の列は固定 -->
	<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
		<AdminIcon name="chart" class="h-4 w-4 text-stone-500" />部屋ごとのまとめ
		<span class="text-xs font-normal text-stone-400">押すとその部屋だけ</span>
	</h2>
	<section class="mb-5 overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[520px] text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr>
					<th class="sticky left-0 bg-stone-50 px-3 py-2 font-medium">部屋</th>
					<th class="px-3 py-2 font-medium">お客様</th>
					<th class="px-3 py-2 text-right font-medium">開いた回数</th>
					<th class="px-3 py-2 text-right font-medium">端末</th>
					<th class="px-3 py-2 text-right font-medium">リンク</th>
					<th class="px-3 py-2 font-medium">最後に開いた</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-stone-100">
				{#each byRoom as r (r.key)}
					{@const sel = room === r.key}
					<tr class="group cursor-pointer {sel ? 'bg-brand-50' : 'hover:bg-stone-50'}" onclick={() => (room = room === r.key ? '' : r.key)}>
						<td class="sticky left-0 px-3 py-2.5 font-medium text-stone-800 {sel ? 'bg-brand-50' : 'bg-white group-hover:bg-stone-50'}">
							{r.key === '-' ? '滞在コードなし（館内案内のみ）' : r.roomCode}
							{#if r.isDemo}<span class="ml-1 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">見本</span>{/if}
						</td>
						<td class="px-3 py-2.5 whitespace-nowrap text-stone-600">{r.guestName ?? '—'}</td>
						<td class="px-3 py-2.5 text-right tabular-nums">{r.views}</td>
						<td class="px-3 py-2.5 text-right tabular-nums">{r.visitors.size}</td>
						<td class="px-3 py-2.5 text-right tabular-nums {r.clicks ? '' : 'text-stone-300'}">{r.clicks}</td>
						<td class="px-3 py-2.5 tabular-nums text-stone-500">{fmtTime(r.last)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-sm font-semibold text-stone-800">
			アクセスの一覧{room ? `（${room === '-' ? '滞在コードなし' : room}）` : ''} <span class="font-normal text-stone-500">— {filtered.length}件</span>
		</h2>
		{#if room}<button type="button" onclick={() => (room = '')} class="min-h-9 rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs text-stone-600 hover:bg-stone-50">すべて表示</button>{/if}
	</div>
	<!-- スマホ（md 未満）は1件＝1行のカード（時刻・部屋・ページ、その下に言語・端末）。md 以上は表 -->
	<ul class="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white md:hidden">
		{#each filtered as r (r.id)}
			<li class="px-3 py-2.5 text-sm">
				<div class="flex items-baseline gap-2">
					<span class="shrink-0 tabular-nums text-stone-500">{fmtTime(r.createdAt)}</span>
					<span class="shrink-0 font-medium text-stone-800">{r.roomCode ?? '—'}</span>
					{#if r.guestName}<span class="min-w-0 truncate text-stone-500">{r.guestName}</span>{/if}
				</div>
				<p class="mt-0.5 text-stone-700">{@render pageCell(r)}</p>
				<p class="mt-0.5 text-[11px] text-stone-400">
					{r.locale ? (LOCALE_LABEL[r.locale] ?? r.locale) : '—'}・{r.device ?? '—'}・<span class="font-mono">{r.visitorId ? r.visitorId.slice(0, 6) : '—'}</span>
				</p>
			</li>
		{/each}
	</ul>
	<section class="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
		<table class="w-full text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr><th class="px-3 py-2 font-medium">時刻</th><th class="px-3 py-2 font-medium">部屋</th><th class="px-3 py-2 font-medium">お客様</th><th class="px-3 py-2 font-medium">ページ</th><th class="px-3 py-2 font-medium">言語</th><th class="px-3 py-2 font-medium">端末</th><th class="px-3 py-2 font-medium">端末ID</th></tr>
			</thead>
			<tbody class="divide-y divide-stone-100">
				{#each filtered as r (r.id)}
					<tr>
						<td class="whitespace-nowrap px-3 py-1.5 tabular-nums text-stone-600">{fmtTime(r.createdAt)}</td>
						<td class="whitespace-nowrap px-3 py-1.5">{r.roomCode ?? '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-600">{r.guestName ?? '—'}</td>
						<td class="px-3 py-1.5">{@render pageCell(r)}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-500">{r.locale ? (LOCALE_LABEL[r.locale] ?? r.locale) : '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-500">{r.device ?? '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-stone-400">{r.visitorId ? r.visitorId.slice(0, 6) : '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}
{/if}

{#snippet periodView()}
	<div class="mb-4 flex flex-wrap gap-2">
		{#each presets as p (p.label)}
			<button type="button" onclick={() => changePeriod(p.from, p.to)} class="min-h-9 rounded-full border px-3 py-1 text-xs {isPreset(p) ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}">{p.label}</button>
		{/each}
	</div>
	{#if data.rangeNote}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.rangeNote}</p>
	{/if}
	{#if sum}
		<p class="mb-2 text-xs text-stone-500">{dayLabel(data.from)} 〜 {dayLabel(data.to)}（{days.length}日間）。見本の滞在コードで開いた分は数えません。</p>
		<div class="mb-5 grid grid-cols-2 gap-2 text-center sm:grid-cols-4 sm:gap-3">
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<p class="text-[11px] text-stone-500 sm:text-xs">開いた回数</p>
				<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{sum.totals.views.toLocaleString()}</p>
			</div>
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<p class="text-[11px] text-stone-500 sm:text-xs">端末の数</p>
				<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{sum.totals.visitors.toLocaleString()}</p>
			</div>
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<p class="text-[11px] text-stone-500 sm:text-xs">開いた部屋の数</p>
				<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{sum.totals.rooms.toLocaleString()}</p>
			</div>
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<p class="text-[11px] text-stone-500 sm:text-xs">外部リンクを押した回数</p>
				<p class="mt-1 text-xl font-semibold tabular-nums text-stone-800 sm:text-2xl">{sum.totals.clicks.toLocaleString()}</p>
			</div>
		</div>

		{#if sum.totals.views === 0}
			<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-400">この期間のアクセスはありません。</p>
		{:else}
			<!-- ページごと（回数の多い順）。端末＝そのページを開いた端末の数 -->
			<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
				<AdminIcon name="chart" class="h-4 w-4 text-stone-500" />ページごとの回数
			</h2>
			<section class="mb-5 overflow-x-auto rounded-xl border border-stone-200 bg-white">
				<table class="w-full min-w-[520px] text-sm">
					<thead class="bg-stone-50 text-left text-xs text-stone-500">
						<tr>
							<th class="px-3 py-2 font-medium">ページ</th>
							<th class="w-2/5 px-3 py-2 font-medium"><span class="sr-only">割合</span></th>
							<th class="px-3 py-2 text-right font-medium">開いた回数</th>
							<th class="px-3 py-2 text-right font-medium">割合</th>
							<th class="px-3 py-2 text-right font-medium">端末</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-100">
						{#each sum.byPage as p (p.path + (p.guideId ?? ''))}
							<tr>
								<td class="px-3 py-2">{pageLabel(p.path, p.guideId)}</td>
								<td class="px-3 py-2">
									<div class="h-2 rounded-full bg-stone-100"><div class="h-2 rounded-full bg-brand-600" style="width: {(p.views / maxPageViews) * 100}%"></div></div>
								</td>
								<td class="px-3 py-2 text-right tabular-nums">{p.views.toLocaleString()}</td>
								<td class="px-3 py-2 text-right tabular-nums text-stone-500">{pct(p.views, sum.totals.views)}</td>
								<td class="px-3 py-2 text-right tabular-nums text-stone-500">{p.visitors.toLocaleString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<!-- 押された外部リンク（リンク先・押したページごと） -->
			<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
				押された外部リンク <span class="text-xs font-normal text-stone-400">他サイト・予約サイト・電話・メール</span>
			</h2>
			{#if sum.byLink.length === 0}
				<p class="mb-5 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-5 text-center text-sm text-stone-400">この期間に押された外部リンクはありません。</p>
			{:else}
				<section class="mb-5 overflow-x-auto rounded-xl border border-stone-200 bg-white">
					<table class="w-full min-w-[560px] text-sm">
						<thead class="bg-stone-50 text-left text-xs text-stone-500">
							<tr>
								<th class="px-3 py-2 font-medium">リンク先</th>
								<th class="px-3 py-2 font-medium">押したページ</th>
								<th class="px-3 py-2 text-right font-medium">押した回数</th>
								<th class="px-3 py-2 text-right font-medium">端末</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-stone-100">
							{#each sum.byLink as c (c.url + c.path + (c.guideId ?? ''))}
								<tr>
									<td class="max-w-xs px-3 py-2">
										{#if /^https?:/.test(c.url)}
											<a href={c.url} target="_blank" rel="noopener noreferrer" class="break-all text-stone-800 underline decoration-stone-300 hover:decoration-stone-600">{linkLabel(c.url)}</a>
										{:else}
											<span class="break-all">{linkLabel(c.url)}</span>
										{/if}
									</td>
									<td class="px-3 py-2 text-stone-600">{pageLabel(c.path, c.guideId)}</td>
									<td class="px-3 py-2 text-right tabular-nums">{c.clicks.toLocaleString()}</td>
									<td class="px-3 py-2 text-right tabular-nums text-stone-500">{c.visitors.toLocaleString()}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

			<!-- 日ごと（期間の全日。押すとその日の一覧へ） -->
			<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
				日ごとの回数 <span class="text-xs font-normal text-stone-400">押すとその日の一覧</span>
			</h2>
			<section class="mb-5 max-h-[28rem] overflow-y-auto rounded-xl border border-stone-200 bg-white">
				<ul class="divide-y divide-stone-100 text-sm">
					{#each days as d (d.day)}
						<li>
							<a href="?date={d.day}" class="flex items-center gap-3 px-3 py-1.5 hover:bg-stone-50">
								<span class="w-24 shrink-0 tabular-nums text-stone-600">{dayLabel(d.day)}</span>
								<span class="min-w-0 flex-1"><span class="block h-2 rounded-full bg-brand-600" style="width: {(d.views / maxDayViews) * 100}%"></span></span>
								<span class="w-12 shrink-0 text-right tabular-nums {d.views ? 'text-stone-800' : 'text-stone-300'}">{d.views}</span>
								<span class="w-16 shrink-0 text-right text-xs tabular-nums text-stone-400">{d.visitors} 端末</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>

			<div class="mb-5 grid gap-4 md:grid-cols-3">
				<!-- 部屋ごと -->
				<section class="rounded-xl border border-stone-200 bg-white md:col-span-1">
					<h2 class="border-b border-stone-100 px-3 py-2 text-sm font-semibold text-stone-800">部屋ごと</h2>
					<table class="w-full text-sm">
						<tbody class="divide-y divide-stone-100">
							{#each sum.byRoom as r (r.roomCode ?? '-')}
								<tr>
									<td class="px-3 py-1.5">{r.roomCode ?? '滞在コードなし'}</td>
									<td class="px-3 py-1.5 text-right tabular-nums">{r.views.toLocaleString()}</td>
									<td class="px-3 py-1.5 text-right text-xs tabular-nums text-stone-400">{r.visitors} 端末</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
				{#each [{ title: '言語', rows: sum.byLocale, label: (k: string | null) => (k ? (LOCALE_LABEL[k] ?? k) : '—') }, { title: '端末の種類', rows: sum.byDevice, label: (k: string | null) => k ?? '—' }] as g (g.title)}
					<section class="rounded-xl border border-stone-200 bg-white">
						<h2 class="border-b border-stone-100 px-3 py-2 text-sm font-semibold text-stone-800">{g.title}</h2>
						<table class="w-full text-sm">
							<tbody class="divide-y divide-stone-100">
								{#each g.rows as r (r.key ?? '-')}
									<tr>
										<td class="px-3 py-1.5">{g.label(r.key)}</td>
										<td class="px-3 py-1.5 text-right tabular-nums">{r.views.toLocaleString()}</td>
										<td class="px-3 py-1.5 text-right text-xs tabular-nums text-stone-400">{pct(r.views, sum.totals.views)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet pageCell(r: { event: string; path: string; guideId: string | null; linkUrl: string | null })}
	{#if r.event === 'link'}
		<span class="text-sky-800">↗ {linkLabel(r.linkUrl)}</span>
		<span class="text-xs text-stone-400">（{pageLabel(r.path, r.guideId)}から）</span>
	{:else}
		{pageLabel(r.path, r.guideId)}
	{/if}
{/snippet}
