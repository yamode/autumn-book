<script lang="ts">
	// 客室案内のアクセスログ（2026-10-17 指示）。日付ごとの一覧と、部屋ごとのまとめ。
	import { goto } from '$app/navigation';

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
		return path;
	}
	const LOCALE_LABEL: Record<string, string> = { ja: '日本語', en: '英語', 'zh-TW': '繁体字' };

	const roomKey = (r: { roomCode: string | null }) => r.roomCode ?? '-';
	const filtered = $derived(room ? data.rows.filter((r) => roomKey(r) === room) : data.rows);

	// 部屋ごとのまとめ（開いた回数・端末の数・最後に開いた時刻）。コードなしは最後に1行
	const byRoom = $derived.by(() => {
		const map = new Map<string, { key: string; roomCode: string | null; guestName: string | null; views: number; visitors: Set<string>; last: string; isDemo: boolean }>();
		for (const r of data.rows) {
			const key = roomKey(r);
			const cur = map.get(key) ?? { key, roomCode: r.roomCode, guestName: r.guestName, views: 0, visitors: new Set<string>(), last: r.createdAt, isDemo: r.isDemo };
			cur.views += 1;
			if (r.visitorId) cur.visitors.add(r.visitorId);
			if (r.createdAt > cur.last) cur.last = r.createdAt;
			cur.guestName ??= r.guestName;
			map.set(key, cur);
		}
		return [...map.values()].sort((a, b) => (a.key === '-' ? 1 : b.key === '-' ? -1 : a.key.localeCompare(b.key, 'ja', { numeric: true })));
	});
	const totalVisitors = $derived(new Set(data.rows.map((r) => r.visitorId).filter(Boolean)).size);
	const roomsWithCode = $derived(byRoom.filter((r) => r.key !== '-').length);

	function changeDate(v: string) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(v)) goto(`?date=${v}`, { keepFocus: true, noScroll: true });
	}
	function shiftDate(days: number) {
		const d = new Date(`${data.date}T00:00:00+09:00`);
		d.setUTCDate(d.getUTCDate() + days);
		changeDate(new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10));
	}
</script>

<svelte:head><title>客室案内のアクセスログ ｜ 管理画面</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
	<div>
		<a href="/admin/inroom" class="text-xs text-stone-500 hover:underline">← 館内案内・客室スリップ</a>
		<h1 class="mt-1 text-lg font-semibold text-stone-800">📈 客室案内のアクセスログ — {data.currentFacility.name}</h1>
		<p class="mt-1 text-xs text-stone-400">
			客室案内のページを開くたびに記録します（開いたままの自動更新は数えません）。滞在コードが紐づいていれば、どの部屋の方かが出ます。
			IP アドレスは残さず、同じ端末かどうかだけを見分けます。記録は180日で消えます。
		</p>
	</div>
	<div class="flex items-center gap-2 text-sm">
		<button type="button" onclick={() => shiftDate(-1)} class="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50">‹ 前日</button>
		<input type="date" value={data.date} max={data.today} onchange={(e) => changeDate(e.currentTarget.value)} class="rounded border border-stone-300 px-2 py-1" />
		<button type="button" onclick={() => shiftDate(1)} disabled={data.date >= data.today} class="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50 disabled:opacity-40">翌日 ›</button>
	</div>
</div>

{#if data.loadError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.loadError}</p>
{/if}
{#if !data.live}
	<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-500">この環境は管理画面が実データに繋がっていないため、このサーバーで記録した分だけを表示しています。</p>
{/if}

<div class="mb-5 grid grid-cols-3 gap-3 text-center">
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-xs text-stone-500">開いた回数</p>
		<p class="mt-1 text-2xl font-semibold tabular-nums text-stone-800">{data.rows.length}</p>
	</div>
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-xs text-stone-500">端末の数</p>
		<p class="mt-1 text-2xl font-semibold tabular-nums text-stone-800">{totalVisitors}</p>
	</div>
	<div class="rounded-xl border border-stone-200 bg-white p-3">
		<p class="text-xs text-stone-500">開いた部屋の数</p>
		<p class="mt-1 text-2xl font-semibold tabular-nums text-stone-800">{roomsWithCode}</p>
	</div>
</div>

{#if data.rows.length === 0}
	<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-8 text-center text-sm text-stone-400">この日のアクセスはありません。</p>
{:else}
	<!-- 部屋ごとのまとめ（押すとその部屋だけの一覧になる） -->
	<section class="mb-5 overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr><th class="px-3 py-2">部屋</th><th class="px-3 py-2">お客様</th><th class="px-3 py-2 text-right">開いた回数</th><th class="px-3 py-2 text-right">端末</th><th class="px-3 py-2">最後に開いた</th></tr>
			</thead>
			<tbody class="divide-y divide-stone-100">
				{#each byRoom as r (r.key)}
					<tr class="cursor-pointer hover:bg-stone-50 {room === r.key ? 'bg-brand-50' : ''}" onclick={() => (room = room === r.key ? '' : r.key)}>
						<td class="px-3 py-2 font-medium text-stone-800">
							{r.key === '-' ? '滞在コードなし（館内案内のみ）' : r.roomCode}
							{#if r.isDemo}<span class="ml-1 rounded bg-amber-50 px-1 text-[11px] text-amber-800">見本</span>{/if}
						</td>
						<td class="px-3 py-2 text-stone-600">{r.guestName ?? '—'}</td>
						<td class="px-3 py-2 text-right tabular-nums">{r.views}</td>
						<td class="px-3 py-2 text-right tabular-nums">{r.visitors.size}</td>
						<td class="px-3 py-2 tabular-nums text-stone-500">{fmtTime(r.last)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-sm font-medium text-stone-700">
			アクセスの一覧{room ? `（${room === '-' ? '滞在コードなし' : room}）` : ''} — {filtered.length}件
		</h2>
		{#if room}<button type="button" onclick={() => (room = '')} class="text-xs text-stone-500 underline">すべて表示</button>{/if}
	</div>
	<section class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr><th class="px-3 py-2">時刻</th><th class="px-3 py-2">部屋</th><th class="px-3 py-2">お客様</th><th class="px-3 py-2">ページ</th><th class="px-3 py-2">言語</th><th class="px-3 py-2">端末</th><th class="px-3 py-2">端末ID</th></tr>
			</thead>
			<tbody class="divide-y divide-stone-100">
				{#each filtered as r (r.id)}
					<tr>
						<td class="whitespace-nowrap px-3 py-1.5 tabular-nums text-stone-600">{fmtTime(r.createdAt)}</td>
						<td class="whitespace-nowrap px-3 py-1.5">{r.roomCode ?? '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-600">{r.guestName ?? '—'}</td>
						<td class="px-3 py-1.5">{pageLabel(r.path, r.guideId)}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-500">{r.locale ? (LOCALE_LABEL[r.locale] ?? r.locale) : '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 text-stone-500">{r.device ?? '—'}</td>
						<td class="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-stone-400">{r.visitorId ? r.visitorId.slice(0, 6) : '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
{/if}
