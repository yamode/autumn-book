<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatYen, formatDateJa, todayStr, addDays } from '$lib/format';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { STAY_STATUS, stayStatusClass } from './stay-status';
	import { channelLabel, channelBadgeClass } from '$lib/booking-channel';

	let { data } = $props();

	// 期間のワンタップ絞り込み（ステータス・経路・検索語は保ったまま期間だけ変える）
	const today = todayStr();
	const monthEnd = (() => {
		const [y, m] = today.split('-').map(Number);
		return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
	})();
	const PRESETS = [
		{ label: '本日到着', from: today, to: today },
		{ label: '明日到着', from: addDays(today, 1), to: addDays(today, 1) },
		{ label: '7日以内', from: today, to: addDays(today, 7) },
		{ label: '今月', from: today.slice(0, 8) + '01', to: monthEnd }
	];
	function presetHref(from: string, to: string): string {
		const q = new URLSearchParams({ status: data.filters.status, channel: data.filters.channel, q: data.filters.q, from, to });
		return `?${q}`;
	}
	const detailHref = (code: string) => `/admin/reservations/${encodeURIComponent(code)}`;

	// 取引先予約の前受金（銀行振込）の印: 入金待ち・期限超過・取消後の返金待ち（2026-10-28）
	const advanceBadgeClass = (tone: string) =>
		tone === 'overdue' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-amber-50 text-amber-800 ring-amber-200';

	const MAIL_LABEL: Record<string, string> = {
		sent: '送信済',
		pending: '送信待ち',
		processing: '送信中',
		failed: '送信失敗'
	};

	function mailClass(s: string | null): string {
		if (s === 'sent') return 'text-emerald-600';
		if (s === 'failed') return 'text-red-600';
		if (s) return 'text-amber-600';
		return 'text-stone-400';
	}
	/** メールの状態の前に付ける小さな丸の色 */
	function mailDot(s: string | null): string {
		if (s === 'sent') return 'bg-emerald-500';
		if (s === 'failed') return 'bg-red-500';
		if (s) return 'bg-amber-500';
		return 'bg-stone-300';
	}

	function shortTime(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	const fieldCls = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-2 text-sm md:py-1.5';
</script>

<svelte:head><title>予約管理 ｜ 山人管理</title></svelte:head>

<PageHeader
	title="予約管理"
	facility={data.currentFacility.name}
	description="予約サイト・アプリからのご予約と、取引先ページ（限定URL）からのご予約の確認・取り消しはここで行います。部屋割り・チェックインは PMS。"
/>

{#if data.error}
	<p class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</p>
{/if}

{#if data.mailQueue}
	{@const bad = data.mailQueue.stuck || data.mailQueue.failed_24h > 0}
	<!-- 送信が滞っていると「予約は入ったのに客に何も届かない」状態になるので上部に常時出す -->
	<div
		class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-xs {bad
			? 'border-red-200 bg-red-50 text-red-700'
			: 'border-stone-200 bg-white text-stone-500'}"
	>
		<span class="font-medium text-stone-700 {bad ? 'text-red-700' : ''}">メール送信</span>
		<span>待機 {data.mailQueue.pending + data.mailQueue.processing}</span>
		<span>失敗（24h） {data.mailQueue.failed_24h}</span>
		{#if data.mailQueue.last_sent_at}
			<span>最終送信 {shortTime(data.mailQueue.last_sent_at)}</span>
		{/if}
		<span class="ml-auto inline-flex items-center gap-1.5 font-medium">
			<span class="h-2 w-2 rounded-full {bad ? 'bg-red-500' : 'bg-emerald-500'}" aria-hidden="true"></span>
			{#if data.mailQueue.stuck}滞留（10分以上未送信）{:else if data.mailQueue.failed_24h > 0}失敗あり{:else}正常{/if}
		</span>
	</div>
{/if}

<!-- 絞り込み（GET）。スマホは2列の格子、広い画面は横並び -->
<form method="GET" class="mb-4 rounded-xl border border-stone-200 bg-white p-3 text-sm">
	<div class="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end">
		<label class="flex flex-col gap-1 text-xs text-stone-500">
			ステータス
			<select name="status" class={fieldCls}>
				<option value="" selected={data.filters.status === ''}>すべて</option>
				<option value="reserved" selected={data.filters.status === 'reserved'}>予約済</option>
				<option value="checked_in" selected={data.filters.status === 'checked_in'}>チェックイン済</option>
				<option value="checked_out" selected={data.filters.status === 'checked_out'}>宿泊済</option>
				<option value="cancelled" selected={data.filters.status === 'cancelled'}>キャンセル</option>
				<option value="no_show" selected={data.filters.status === 'no_show'}>不泊</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-stone-500">
			経路
			<select name="channel" class={fieldCls}>
				<option value="autumn_booking" selected={data.filters.channel === 'autumn_booking'}>直販のみ（サイト・アプリ）</option>
				<option value="rms_partner" selected={data.filters.channel === 'rms_partner'}>取引先予約（限定URL）</option>
				<option value="ota" selected={data.filters.channel === 'ota'}>OTA経由のみ（閲覧のみ）</option>
				<option value="" selected={data.filters.channel === ''}>OTA・電話も含む（閲覧のみ）</option>
			</select>
		</label>
		<label class="col-span-2 flex flex-col gap-1 text-xs text-stone-500 md:col-span-1">
			チェックイン
			<span class="flex items-center gap-1">
				<input type="date" name="from" value={data.filters.from} class="{fieldCls} min-w-0" />
				<span class="shrink-0">〜</span>
				<input type="date" name="to" value={data.filters.to} class="{fieldCls} min-w-0" />
			</span>
		</label>
		<label class="col-span-2 flex flex-col gap-1 text-xs text-stone-500 md:col-span-1 md:min-w-[16rem]">
			検索
			<input
				name="q"
				value={data.filters.q}
				placeholder={data.isAdmin ? '予約番号・氏名・カナ・電話・メール' : '予約番号・氏名・カナ'}
				class={fieldCls}
			/>
		</label>
		<div class="col-span-2 flex items-center gap-2 md:col-span-1">
			<button type="submit" class="min-h-10 flex-1 rounded-md bg-brand-800 px-4 text-sm text-white hover:bg-brand-700 md:min-h-0 md:flex-none md:py-1.5">絞り込む</button>
			<a href="/admin/reservations" class="inline-flex min-h-10 items-center px-2 text-xs text-stone-500 hover:underline md:min-h-0">条件をリセット</a>
		</div>
	</div>
	<div class="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-3">
		{#each PRESETS as p (p.label)}
			<a
				href={presetHref(p.from, p.to)}
				class="inline-flex min-h-9 items-center rounded-full px-3.5 text-xs md:min-h-0 md:py-1 {data.filters.from === p.from && data.filters.to === p.to
					? 'bg-brand-800 text-white'
					: 'bg-stone-100 text-stone-600 hover:bg-stone-200'}">{p.label}</a
			>
		{/each}
	</div>
</form>

<!-- スマホ・タブレット縦: カード表示（フロントが手元で到着を確認しやすいように）。予約番号・お名前・日付・部屋・状態・金額が一目で分かる -->
<ul class="space-y-2 md:hidden">
	{#each data.list as b (b.stay_id)}
		<li>
			<a
				href={detailHref(b.booking_code)}
				class="block rounded-xl border border-stone-200 bg-white p-3.5 text-sm shadow-sm active:bg-stone-50 {b.stay_status === 'cancelled' ? 'opacity-60' : ''}"
			>
				<div class="flex items-center justify-between gap-2">
					<span class="font-mono text-[13px] font-medium text-accent-600">{b.booking_code}</span>
					<span class={stayStatusClass(b.stay_status)}>{STAY_STATUS[b.stay_status] ?? b.stay_status}</span>
				</div>
				<div class="mt-1.5 flex items-baseline justify-between gap-3">
					<p class="min-w-0 truncate text-base font-medium text-stone-900">
						{b.guest_name ?? '—'}
						{#if b.source === 'autumn_booking'}<span class="ml-1 text-[11px] font-normal text-stone-400">{b.is_member ? '会員' : '非会員'}</span>{/if}
					</p>
					<p class="shrink-0 font-medium tabular-nums text-stone-800">{b.total_amount != null ? formatYen(b.total_amount) : '—'}</p>
				</div>
				<p class="mt-0.5 text-[13px] text-stone-600">
					{formatDateJa(b.check_in_date)}・{b.nights}泊・大人{b.adult_count}名{#if (b.room_count ?? 1) > 1}・{b.room_count}室{#if b.room_index}（{b.room_index}室目）{/if}{/if}
				</p>
				<p class="truncate text-[13px] text-stone-600">{b.room_name ?? '—'}</p>
				<div class="mt-2 flex items-center justify-between gap-2 border-t border-stone-100 pt-2 text-xs text-stone-500">
					<span class="min-w-0 truncate"><span class="rounded px-1.5 py-0.5 text-[11px] {channelBadgeClass(b)}">{channelLabel(b)}</span>{#if b.partner_advance}<span class="ml-1 rounded px-1 py-0.5 text-[11px] ring-1 {advanceBadgeClass(b.partner_advance.tone)}">{b.partner_advance.label}</span>{/if}</span>
					{#if b.source === 'autumn_booking'}
						<span class="inline-flex shrink-0 items-center gap-1 {mailClass(b.mail_status)}">
							<span class="h-1.5 w-1.5 rounded-full {mailDot(b.mail_status)}" aria-hidden="true"></span>
							{MAIL_LABEL[b.mail_status ?? ''] ?? 'メールなし'}
						</span>
					{/if}
				</div>
			</a>
		</li>
	{:else}
		<li class="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-8 text-center text-sm text-stone-500">該当する予約がありません。期間や条件を変えてみてください。</li>
	{/each}
</ul>

<div class="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
	<table class="w-full min-w-[860px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs font-medium text-stone-500">
				<th class="px-3 py-2.5 font-medium">予約番号</th>
				<th class="px-3 font-medium">ゲスト</th>
				<th class="px-3 font-medium">チェックイン</th>
				<th class="px-3 font-medium">泊数・人数</th>
				<th class="px-3 font-medium">室数</th>
				<th class="px-3 font-medium">部屋</th>
				<th class="px-3 text-right font-medium">金額</th>
				<th class="px-3 font-medium">経路</th>
				<th class="px-3 font-medium">メール</th>
				<th class="px-3 font-medium">状態</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-stone-100">
			{#each data.list as b (b.stay_id)}
				<!-- 行のどこを押しても詳細へ（キーボードは予約番号のリンクで辿る） -->
				<tr
					class="cursor-pointer hover:bg-stone-50 {b.stay_status === 'cancelled' ? 'opacity-60' : ''}"
					onclick={(e) => {
						if (!(e.target as Element).closest('a')) goto(detailHref(b.booking_code));
					}}
				>
					<td class="px-3 py-2.5">
						<a href={detailHref(b.booking_code)} class="font-mono font-medium text-accent-600 hover:underline">{b.booking_code}</a>
					</td>
					<td class="px-3">
						{b.guest_name ?? '—'}
						{#if b.source === 'autumn_booking'}
							<span class="block text-[10px] text-stone-400">{b.is_member ? '会員' : '非会員'}</span>
						{/if}
					</td>
					<td class="px-3 whitespace-nowrap">{formatDateJa(b.check_in_date)}</td>
					<td class="px-3 whitespace-nowrap">{b.nights}泊・{b.adult_count}名</td>
					<!-- 公式の複数室予約（M2）: 予約の室数と、この行（滞在）が何室目か -->
					<td class="px-3 whitespace-nowrap">{b.room_count ?? 1}室{#if (b.room_count ?? 1) > 1 && b.room_index}<span class="block text-[10px] text-stone-400">{b.room_index}室目</span>{/if}</td>
					<td class="max-w-[180px] truncate px-3">{b.room_name ?? '—'}</td>
					<td class="px-3 text-right whitespace-nowrap tabular-nums">{b.total_amount != null ? formatYen(b.total_amount) : '—'}</td>
					<td class="px-3 text-xs"><span class="inline-block rounded px-1.5 py-0.5 {channelBadgeClass(b)}">{channelLabel(b)}</span>{#if b.partner_advance}<span class="mt-0.5 block w-fit rounded px-1 py-0.5 text-[11px] ring-1 {advanceBadgeClass(b.partner_advance.tone)}">{b.partner_advance.label}</span>{/if}</td>
					<td class="px-3 text-xs whitespace-nowrap {mailClass(b.mail_status)}">
						{#if b.source === 'autumn_booking' && MAIL_LABEL[b.mail_status ?? '']}
							<span class="inline-flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full {mailDot(b.mail_status)}" aria-hidden="true"></span>{MAIL_LABEL[b.mail_status ?? '']}</span>
						{:else}—{/if}
					</td>
					<td class="px-3">
						<span class={stayStatusClass(b.stay_status)}>{STAY_STATUS[b.stay_status] ?? b.stay_status}</span>
					</td>
				</tr>
			{:else}
				<tr><td colspan="10" class="px-3 py-8 text-center text-stone-500">該当する予約がありません。期間や条件を変えてみてください。</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-3 text-xs text-stone-400">
	該当 {data.list.length} 件{data.filters.channel === 'autumn_booking' ? '（直販）' : data.filters.channel === 'rms_partner' ? '（取引先予約）' : data.filters.channel === 'ota' ? '（OTA経由）' : ''}
	{#if data.truncated}／ 表示は 200 件までです。期間を絞ってください。{/if}
</p>
<p class="mt-1 text-xs text-stone-400">
	※ 部屋割り・チェックイン操作・現場帳票は PMS で行います。本画面は予約の確認と取り消し用です。
</p>
{#if !data.live}
	<p class="mt-1 text-xs text-amber-600">
		※ この環境はデモデータです（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</p>
{/if}
