<script lang="ts">
	import { goto } from '$app/navigation';
	import { formatYen, formatDateJa, todayStr, addDays } from '$lib/format';

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

	/** core.stays.status → 表示名。予約済以外も一覧に出す（絞り込みで切り替える） */
	const STAY_STATUS: Record<string, string> = {
		reserved: '予約済',
		checked_in: 'チェックイン済',
		checked_out: '宿泊済',
		stayed: '宿泊済',
		cancelled: 'キャンセル',
		no_show: '不泊'
	};

	function statusClass(s: string): string {
		if (s === 'reserved') return 'bg-emerald-50 text-emerald-700';
		if (s === 'cancelled' || s === 'no_show') return 'bg-stone-100 text-stone-500';
		return 'bg-blue-50 text-blue-600';
	}

	/** 経路。直販はサイト／アプリまで割り、取引先予約は取引先名、それ以外はチャネル名（OTA 等） */
	function channelLabel(b: (typeof data.list)[number]): string {
		if (b.source === 'autumn_booking') return b.client === 'app' ? 'アプリ' : 'サイト';
		if (b.source === 'rms_partner') return b.partner_name ? `取引先：${b.partner_name}` : (b.channel_name ?? '取引先予約');
		return b.channel_name ?? b.source ?? '—';
	}

	const MAIL_LABEL: Record<string, string> = {
		sent: '✔ 送信済',
		pending: '⏳ 送信待ち',
		processing: '⏳ 送信中',
		failed: '⚠ 失敗'
	};

	function mailClass(s: string | null): string {
		if (s === 'sent') return 'text-emerald-600';
		if (s === 'failed') return 'text-red-600';
		if (s) return 'text-amber-600';
		return 'text-stone-400';
	}

	function shortTime(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
</script>

<svelte:head><title>予約管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">予約管理 — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-500">
	予約サイト・アプリからのご予約と、取引先ページ（限定URL）からのご予約の確認・取り消しはここで行います。部屋割り・チェックインは PMS。
</p>

{#if data.error}
	<p class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</p>
{/if}

{#if data.mailQueue}
	<!-- 送信が滞っていると「予約は入ったのに客に何も届かない」状態になるので上部に常時出す -->
	<div
		class="mb-4 flex flex-wrap items-center gap-4 rounded-xl border px-3 py-2 text-xs {data.mailQueue
			.stuck || data.mailQueue.failed_24h > 0
			? 'border-red-200 bg-red-50 text-red-700'
			: 'border-stone-200 bg-white text-stone-500'}"
	>
		<span class="font-medium">メール送信</span>
		<span>待機 {data.mailQueue.pending + data.mailQueue.processing}</span>
		<span>失敗（24h） {data.mailQueue.failed_24h}</span>
		{#if data.mailQueue.last_sent_at}
			<span>最終送信 {shortTime(data.mailQueue.last_sent_at)}</span>
		{/if}
		<span class="ml-auto">
			{#if data.mailQueue.stuck}滞留（10分以上未送信）{:else if data.mailQueue.failed_24h > 0}失敗あり{:else}● 正常{/if}
		</span>
	</div>
{/if}

<form
	method="GET"
	class="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm"
>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		ステータス
		<select name="status" class="rounded-md border border-stone-300 px-2 py-1.5">
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
		<select name="channel" class="rounded-md border border-stone-300 px-2 py-1.5">
			<option value="autumn_booking" selected={data.filters.channel === 'autumn_booking'}
				>直販のみ（サイト・アプリ）</option
			>
			<option value="rms_partner" selected={data.filters.channel === 'rms_partner'}>取引先予約（限定URL）</option>
			<option value="" selected={data.filters.channel === ''}>OTA・電話も含む（閲覧のみ）</option>
		</select>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		チェックイン
		<span class="flex items-center gap-1">
			<input
				type="date"
				name="from"
				value={data.filters.from}
				class="rounded-md border border-stone-300 px-2 py-1.5"
			/>
			<span>〜</span>
			<input
				type="date"
				name="to"
				value={data.filters.to}
				class="rounded-md border border-stone-300 px-2 py-1.5"
			/>
		</span>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		検索
		<input
			name="q"
			value={data.filters.q}
			placeholder={data.isAdmin ? '予約番号・氏名・カナ・電話・メール' : '予約番号・氏名・カナ'}
			class="rounded-md border border-stone-300 px-2 py-1.5"
		/>
	</label>
	<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white">絞り込む</button>
	<a href="/admin/reservations" class="px-2 py-1.5 text-xs text-stone-500 hover:underline">条件をリセット</a>
	<div class="flex w-full flex-wrap gap-1.5 pt-1">
		{#each PRESETS as p (p.label)}
			<a
				href={presetHref(p.from, p.to)}
				class="rounded-full px-3 py-1 text-xs {data.filters.from === p.from && data.filters.to === p.to
					? 'bg-brand-800 text-white'
					: 'bg-stone-100 text-stone-600 hover:bg-stone-200'}">{p.label}</a
			>
		{/each}
	</div>
</form>

<!-- スマホ: カード表示（フロントが手元で到着を確認しやすいように） -->
<ul class="space-y-2 sm:hidden">
	{#each data.list as b (b.stay_id)}
		<li>
			<a
				href={detailHref(b.booking_code)}
				class="block rounded-xl border border-stone-200 bg-white p-3 text-sm {b.stay_status === 'cancelled' ? 'opacity-60' : ''}"
			>
				<div class="flex items-center justify-between gap-2">
					<span class="font-mono font-medium text-accent-600">{b.booking_code}</span>
					<span class="rounded-full px-2 py-0.5 text-xs {statusClass(b.stay_status)}">{STAY_STATUS[b.stay_status] ?? b.stay_status}</span>
				</div>
				<p class="mt-1 font-medium text-stone-800">{b.guest_name ?? '—'}</p>
				<p class="text-xs text-stone-500">
					{formatDateJa(b.check_in_date)}・{b.nights}泊・大人{b.adult_count}名・{b.room_name ?? '—'}
				</p>
				<p class="mt-1 flex justify-between text-xs text-stone-500">
					<span>{channelLabel(b)}</span>
					<span>{b.total_amount != null ? formatYen(b.total_amount) : '—'}</span>
				</p>
			</a>
		</li>
	{:else}
		<li class="rounded-xl border border-stone-200 bg-white px-3 py-8 text-center text-sm text-stone-500">該当する予約がありません。期間や条件を変えてみてください。</li>
	{/each}
</ul>

<div class="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white sm:block">
	<table class="w-full min-w-[860px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">予約番号</th>
				<th class="px-3">ゲスト</th>
				<th class="px-3">チェックイン</th>
				<th class="px-3">泊数・人数</th>
				<th class="px-3">部屋</th>
				<th class="px-3 text-right">金額</th>
				<th class="px-3">経路</th>
				<th class="px-3">メール</th>
				<th class="px-3">状態</th>
			</tr>
		</thead>
		<tbody>
			{#each data.list as b (b.stay_id)}
				<!-- 行のどこを押しても詳細へ（キーボードは予約番号のリンクで辿る） -->
				<tr
					class="cursor-pointer border-b border-stone-100 hover:bg-stone-50 {b.stay_status === 'cancelled' ? 'opacity-60' : ''}"
					onclick={(e) => {
						if (!(e.target as Element).closest('a')) goto(detailHref(b.booking_code));
					}}
				>
					<td class="px-3 py-2">
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
					<td class="max-w-[180px] truncate px-3">{b.room_name ?? '—'}</td>
					<td class="px-3 text-right whitespace-nowrap">{b.total_amount != null ? formatYen(b.total_amount) : '—'}</td>
					<td class="px-3 text-xs">{channelLabel(b)}</td>
					<td class="px-3 text-xs whitespace-nowrap {mailClass(b.mail_status)}">
						{b.source === 'autumn_booking' ? (MAIL_LABEL[b.mail_status ?? ''] ?? '—') : '—'}
					</td>
					<td class="px-3">
						<span class="rounded-full px-2 py-0.5 text-xs whitespace-nowrap {statusClass(b.stay_status)}">
							{STAY_STATUS[b.stay_status] ?? b.stay_status}
						</span>
					</td>
				</tr>
			{:else}
				<tr><td colspan="9" class="px-3 py-8 text-center text-stone-500">該当する予約がありません。期間や条件を変えてみてください。</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-3 text-xs text-stone-400">
	該当 {data.list.length} 件{data.filters.channel === 'autumn_booking' ? '（直販）' : data.filters.channel === 'rms_partner' ? '（取引先予約）' : ''}
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
