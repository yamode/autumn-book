<script lang="ts">
	import { formatYen, formatDateJa } from '$lib/format';

	let { data } = $props();

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

	/** 経路。直販はサイト／アプリまで割り、それ以外はチャネル名（OTA 等） */
	function channelLabel(b: (typeof data.list)[number]): string {
		if (b.source === 'autumn_booking') return b.client === 'app' ? 'アプリ' : 'サイト';
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
	予約サイト・アプリからのご予約の確認と取り消しはここで行います。部屋割り・チェックインは PMS。
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
				>直販（サイト・アプリ）</option
			>
			<option value="" selected={data.filters.channel === ''}>すべて（OTA含む・閲覧）</option>
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
			placeholder="予約番号・氏名・カナ"
			class="rounded-md border border-stone-300 px-2 py-1.5"
		/>
	</label>
	<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white">絞り込む</button>
</form>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[860px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">予約番号</th><th>ゲスト</th><th>チェックイン</th><th>泊数</th><th
					>部屋</th
				><th class="text-right">金額</th><th>経路</th><th>メール</th><th>状態</th>
			</tr>
		</thead>
		<tbody>
			{#each data.list as b (b.stay_id)}
				<tr class="border-b border-stone-100 hover:bg-stone-50">
					<td class="px-3 py-2">
						<a
							href="/admin/reservations/{encodeURIComponent(b.booking_code)}"
							class="font-medium text-accent-600 hover:underline">{b.booking_code}</a
						>
					</td>
					<td>
						{b.guest_name ?? '—'}
						{#if b.source === 'autumn_booking'}
							<span class="block text-[10px] text-stone-400">{b.is_member ? '会員' : '非会員'}</span>
						{/if}
					</td>
					<td>{formatDateJa(b.check_in_date)}</td>
					<td>{b.nights}泊</td>
					<td class="max-w-[180px] truncate">{b.room_name ?? '—'}</td>
					<td class="text-right">{b.total_amount != null ? formatYen(b.total_amount) : '—'}</td>
					<td class="text-xs">{channelLabel(b)}</td>
					<td class="text-xs {mailClass(b.mail_status)}">
						{b.source === 'autumn_booking' ? (MAIL_LABEL[b.mail_status ?? ''] ?? '—') : '—'}
					</td>
					<td>
						<span class="rounded-full px-2 py-0.5 text-xs {statusClass(b.stay_status)}">
							{STAY_STATUS[b.stay_status] ?? b.stay_status}
						</span>
					</td>
				</tr>
			{:else}
				<tr><td colspan="9" class="px-3 py-8 text-center text-stone-400">該当する予約がありません</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-3 text-xs text-stone-400">
	該当 {data.list.length} 件{data.filters.channel === 'autumn_booking' ? '（直販）' : ''}
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
