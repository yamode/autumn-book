<script lang="ts">
	// 管理画面ダッシュボード（2026-10-17 モダン化・第2段階）。
	// その日の運用（到着・出発・連泊中・明日）→ 対応が必要なこと → 一覧 → よく使う画面 の順に、ひと目で読めるようにする。
	// PC は「一覧（左）＋未対応・入口（右）」の段組み、スマホは1〜2列で上から順に読む。
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import AdminIcon, { type AdminIconName } from '$lib/components/admin/AdminIcon.svelte';
	import { formatDateJa } from '$lib/format';
	import type { DashboardRow } from './+page.server';

	let { data } = $props();

	const STAY_STATUS: Record<string, string> = {
		reserved: '予約済',
		checked_in: 'チェックイン済',
		checked_out: '宿泊済',
		stayed: '宿泊済'
	};

	// 予約一覧へのリンク（その日のチェックイン・全経路）
	const listHref = (from: string, to: string) => `/admin/reservations?from=${from}&to=${to}&channel=`;

	const adults = (rows: DashboardRow[]) => rows.reduce((s, r) => s + r.adult_count, 0);

	let mailWarn = $derived(!!data.mailQueue && (data.mailQueue.stuck || data.mailQueue.failed_24h > 0));
	// 本日・明日の到着／出発・連泊中のうち、確認メールが送れていない予約
	let mailFailedRows = $derived(
		[...data.arrivalsToday, ...data.arrivalsTomorrow, ...data.departuresToday, ...data.inHouse].filter(
			(r, i, all) => r.mail_status === 'failed' && all.findIndex((x) => x.booking_code === r.booking_code) === i
		)
	);

	// よく使う画面への入口（URL はメニューと同じ）
	const SHORTCUTS: { href: string; label: string; icon: AdminIconName }[] = [
		{ href: '/admin/reservations', label: '予約管理', icon: 'calendar' },
		{ href: '/admin/group-inquiries', label: '団体照会', icon: 'users' },
		{ href: '/admin/inroom', label: '客室案内', icon: 'phone' },
		{ href: '/admin/bath', label: '貸切風呂', icon: 'bath' },
		{ href: '/admin/plans', label: 'プラン・部屋', icon: 'plan' },
		{ href: '/admin/upgrades', label: 'アップグレード提案', icon: 'upgrade' }
	];

	// 状態の点の色（未対応の行）
	const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', error: 'bg-red-500', off: 'bg-stone-300' } as const;
</script>

<svelte:head><title>ダッシュボード ｜ 山人管理</title></svelte:head>

<!-- きょうの数字（1枚）。押すとその一覧の位置へ移る -->
{#snippet kpi(icon: AdminIconName, label: string, value: number, sub: string | null, href: string)}
	<a {href} class="group flex min-w-0 flex-col rounded-xl border border-stone-200 bg-white p-3 transition hover:border-stone-300 hover:shadow-sm sm:p-4">
		<span class="flex items-center gap-2 text-xs font-medium text-stone-500">
			<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600"><AdminIcon name={icon} class="h-4 w-4" /></span>
			<span class="truncate">{label}</span>
		</span>
		<span class="mt-2 text-2xl font-semibold text-stone-900 tabular-nums sm:text-3xl">{value}<span class="ml-0.5 text-sm font-normal text-stone-500">件</span></span>
		{#if sub}<span class="mt-0.5 truncate text-xs text-stone-400">{sub}</span>{/if}
	</a>
{/snippet}

<!-- 一覧の見出し（件数・予約管理へのリンク） -->
{#snippet listHeader(title: string, count: number, href: string | null)}
	<div class="mb-2 flex items-center justify-between gap-2">
		<h2 class="text-sm font-semibold text-stone-800">{title}<span class="ml-1.5 text-stone-400 tabular-nums">{count}</span></h2>
		{#if href}
			<a {href} class="flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-800 hover:text-brand-700">
				予約管理で開く<AdminIcon name="chevron" class="h-3.5 w-3.5" />
			</a>
		{/if}
	</div>
{/snippet}

{#snippet guestTable(rows: DashboardRow[], empty: string, showCheckout = false)}
	{#if rows.length === 0}
		<p class="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-500">{empty}</p>
	{:else}
		<!-- スマホ：1件1枚のカード（横スクロールの表を避ける） -->
		<ul class="space-y-2 sm:hidden">
			{#each rows as r (r.booking_code)}
				<li>
					<a href="/admin/reservations/{r.booking_code}" class="block rounded-lg border border-stone-200 p-3 active:bg-stone-50">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="truncate font-medium text-stone-800">{r.guest_name ?? '—'}</p>
								{#if r.guest_kana}<p class="truncate text-[11px] text-stone-400">{r.guest_kana}</p>{/if}
							</div>
							<span class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">{STAY_STATUS[r.stay_status] ?? r.stay_status}</span>
						</div>
						<p class="mt-1.5 truncate text-xs text-stone-600">{r.room_name ?? '—'}{#if r.plan_name}<span class="text-stone-400"> ／ {r.plan_name}</span>{/if}</p>
						<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500">
							<span class="font-mono text-accent-600">{r.booking_code}</span>
							<span>大人{r.adult_count}名・{r.nights}泊</span>
							<span>{showCheckout ? `出発 ${formatDateJa(r.check_out_date)}` : (r.channel_name ?? r.source ?? '—')}</span>
							{#if r.mail_status === 'failed'}<span class="rounded bg-red-50 px-1 text-[10px] text-red-700">確認メール失敗</span>{/if}
						</p>
					</a>
				</li>
			{/each}
		</ul>
		<!-- PC・タブレット：表 -->
		<div class="hidden overflow-x-auto sm:block">
			<table class="w-full min-w-[560px] text-sm">
				<thead>
					<tr class="border-b border-stone-200 text-left text-xs text-stone-500">
						<th class="px-3 py-1.5 font-medium">予約番号</th>
						<th class="px-3 font-medium">ゲスト</th>
						<th class="px-3 font-medium">客室 / プラン</th>
						<th class="px-3 font-medium">人数・泊数</th>
						<th class="px-3 font-medium">{showCheckout ? 'チェックアウト' : '経路'}</th>
						<th class="px-3 font-medium">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.booking_code)}
						<tr class="border-b border-stone-100 last:border-0 hover:bg-stone-50">
							<td class="px-3 py-2">
								<a href="/admin/reservations/{r.booking_code}" class="font-mono text-accent-600 hover:underline">{r.booking_code}</a>
							</td>
							<td class="px-3">
								{r.guest_name ?? '—'}
								{#if r.guest_kana}<span class="block text-[11px] text-stone-400">{r.guest_kana}</span>{/if}
							</td>
							<td class="px-3">
								{r.room_name ?? '—'}
								{#if r.plan_name}<span class="block text-[11px] text-stone-400">{r.plan_name}</span>{/if}
							</td>
							<td class="px-3 whitespace-nowrap">大人{r.adult_count}名・{r.nights}泊</td>
							<td class="px-3 whitespace-nowrap">{showCheckout ? formatDateJa(r.check_out_date) : (r.channel_name ?? r.source ?? '—')}</td>
							<td class="px-3 whitespace-nowrap">
								<span class="text-xs">{STAY_STATUS[r.stay_status] ?? r.stay_status}</span>
								{#if r.mail_status === 'failed'}<span class="ml-1 rounded bg-red-50 px-1 text-[10px] text-red-700">確認メール失敗</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/snippet}

<!-- 対応が必要なことの1行 -->
{#snippet todoRow(tone: keyof typeof DOT, label: string, value: string, href: string | null)}
	{#if href}
		<a {href} class="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50">
			<span class="h-2 w-2 shrink-0 rounded-full {DOT[tone]}"></span>
			<span class="min-w-0 flex-1 text-stone-700">{label}</span>
			<span class="shrink-0 font-medium text-stone-900 tabular-nums">{value}</span>
			<AdminIcon name="chevron" class="h-3.5 w-3.5 shrink-0 text-stone-400" />
		</a>
	{:else}
		<div class="flex items-center gap-2.5 px-3 py-2.5 text-sm">
			<span class="h-2 w-2 shrink-0 rounded-full {DOT[tone]}"></span>
			<span class="min-w-0 flex-1 text-stone-700">{label}</span>
			<span class="shrink-0 font-medium text-stone-900 tabular-nums">{value}</span>
		</div>
	{/if}
{/snippet}

<PageHeader
	title="ダッシュボード"
	facility={data.currentFacility.name}
	description="本日 {formatDateJa(data.today)}・OTA・電話を含む全経路{data.live ? '' : '（デモデータ）'}"
>
	{#snippet actions()}
		<a href={listHref(data.today, data.today)} class="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">
			<AdminIcon name="calendar" class="h-4 w-4" />本日の予約を開く
		</a>
	{/snippet}
</PageHeader>

{#if data.error}
	<p class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</p>
{/if}

<!-- きょうの運用：スマホ2列・PC4列 -->
<section aria-label="きょうの運用" class="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
	{@render kpi('calendar', '本日の到着', data.arrivalsToday.length, `大人 ${adults(data.arrivalsToday)} 名`, '#arrivals-today')}
	{@render kpi('logout', '本日の出発', data.departuresToday.length, null, '#departures-today')}
	{@render kpi('member', '連泊中', data.inHouse.length, '昨日以前に到着', '#in-house')}
	{@render kpi('calendar', '明日の到着', data.arrivalsTomorrow.length, `大人 ${adults(data.arrivalsTomorrow)} 名`, '#arrivals-tomorrow')}
</section>

<!-- PC：左に一覧、右に未対応とよく使う画面。スマホ：未対応 → 一覧 → よく使う画面 の順 -->
<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_340px]">
	<section aria-label="対応が必要なこと" class="min-w-0 lg:col-start-2 lg:row-start-1">
		<h2 class="mb-2 text-sm font-semibold text-stone-800">対応が必要なこと</h2>
		<div class="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
			{#await data.groupInquiryBadge}
				{@render todoRow('off', '団体照会の回答待ち', '…', '/admin/group-inquiries?status=submitted')}
			{:then n}
				{#if n === null}
					{@render todoRow('off', '団体照会の回答待ち', '—', '/admin/group-inquiries')}
				{:else}
					{@render todoRow(n > 0 ? 'warn' : 'ok', '団体照会の回答待ち', `${n} 件`, '/admin/group-inquiries?status=submitted')}
				{/if}
			{/await}
			{#if data.mailQueue}
				{@render todoRow(
					mailWarn ? 'error' : 'ok',
					'メール送信',
					data.mailQueue.stuck ? '滞留' : data.mailQueue.failed_24h > 0 ? `失敗 ${data.mailQueue.failed_24h}` : '正常',
					'/admin/reservations'
				)}
				<p class="px-3 pb-2.5 -mt-1.5 pl-[1.85rem] text-[11px] text-stone-400">
					待機 {data.mailQueue.pending + data.mailQueue.processing}・失敗（24時間） {data.mailQueue.failed_24h}
				</p>
			{:else}
				{@render todoRow('off', 'メール送信', '—', null)}
				<p class="px-3 pb-2.5 -mt-1.5 pl-[1.85rem] text-[11px] text-stone-400">{data.live ? '状態を取得できません' : 'デモでは対象外'}</p>
			{/if}
			{@render todoRow(mailFailedRows.length > 0 ? 'error' : 'ok', '確認メールが届いていない予約', `${mailFailedRows.length} 件`, null)}
			{#if mailFailedRows.length > 0}
				<ul class="space-y-1 px-3 pb-2.5 pl-[1.85rem] text-xs">
					{#each mailFailedRows as r (r.booking_code)}
						<li class="truncate">
							<a href="/admin/reservations/{r.booking_code}" class="font-mono text-accent-600 hover:underline">{r.booking_code}</a>
							<span class="text-stone-500">{r.guest_name ?? ''}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<p class="mt-1.5 text-[11px] text-stone-400">団体照会の件数は、担当できる全施設の合計です。</p>
	</section>

	<div class="min-w-0 space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
		<section id="arrivals-today" class="scroll-mt-20 rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
			{@render listHeader('本日の到着', data.arrivalsToday.length, listHref(data.today, data.today))}
			{@render guestTable(data.arrivalsToday, '本日の到着予定はありません')}
		</section>
		<section id="departures-today" class="scroll-mt-20 rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
			{@render listHeader('本日の出発', data.departuresToday.length, null)}
			{@render guestTable(data.departuresToday, '本日の出発予定はありません', true)}
		</section>
		<section id="in-house" class="scroll-mt-20 rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
			{@render listHeader('連泊中', data.inHouse.length, null)}
			{@render guestTable(data.inHouse, '連泊中のお客様はいません', true)}
		</section>
		<section id="arrivals-tomorrow" class="scroll-mt-20 rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
			{@render listHeader('明日の到着', data.arrivalsTomorrow.length, listHref(data.tomorrow, data.tomorrow))}
			{@render guestTable(data.arrivalsTomorrow, '明日の到着予定はありません')}
		</section>
		<p class="text-[11px] text-stone-500">到着予定時刻・送迎・連絡事項は予約番号から詳細を開いて確認してください。</p>
	</div>

	<section aria-label="よく使う画面" class="min-w-0 lg:col-start-2 lg:row-start-2 lg:self-start">
		<h2 class="mb-2 text-sm font-semibold text-stone-800">よく使う画面</h2>
		<div class="grid grid-cols-2 gap-2">
			{#each SHORTCUTS as s (s.href)}
				<a href={s.href} class="flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-2.5 text-sm text-stone-700 hover:border-stone-300 hover:bg-stone-50">
					<span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-600"><AdminIcon name={s.icon} class="h-4 w-4" /></span>
					<span class="min-w-0 truncate">{s.label}</span>
				</a>
			{/each}
		</div>
	</section>
</div>
