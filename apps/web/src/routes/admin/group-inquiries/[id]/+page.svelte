<script lang="ts">
	// 管理画面: 団体照会の詳細と回答（docs/partner-group-booking.md §8.3・§7.2・§7.3・§7.5・§14.4）。
	// 左に条件とやりとり、右に在庫（泊ごとの残室）・料金（自動計算の内訳）・受付枠（月別）。下に回答フォーム。
	// 料金の変更（1名あたりの単価・合計）と「受付枠を超えても受ける」は管理者だけ（form.isAdmin・サーバでも確かめる）。
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import PartnerPriceTable from '$lib/components/PartnerPriceTable.svelte';
	import { creditMonthLabel } from '$lib/partner-credit';
	import { partnerNightLines } from '$lib/partner-booking';
	import {
		describeGroupBooker,
		describeGroupStay,
		describeRoomAdults,
		groupNightDates,
		groupRoomsTotal,
		MAX_GROUP_ANSWER_MESSAGE_LENGTH,
		overrideUnitPrices,
		spreadTotalOverRooms,
		type GroupAnswer
	} from '$lib/partner-group';
	import type { PageData } from './$types';

	type FormResult = { answered?: true; status?: string; mailed?: boolean; message?: string } | null | undefined;
	let { data, form }: { data: PageData; form?: FormResult } = $props();

	const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
	const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '—');
	const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
	const day = (iso: string) => {
		const d = new Date(`${iso}T00:00:00Z`);
		return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
	};
	const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));

	const r = $derived(data.inquiry);
	const f = $derived(data.form);
	const isAdmin = $derived(f?.isAdmin === true);

	// ---- 回答フォーム（手元で編集・送信は ?/answer） ----
	type PriceMode = 'auto' | 'keep' | 'unit' | 'total';
	const init = untrack(() => ({ row: data.inquiry, form: data.form }));
	let answer = $state<GroupAnswer>(init.row?.answer ?? (init.row?.quote_status === 'closed' ? 'declined' : 'ok'));
	let priceMode = $state<PriceMode>(
		((m: string | undefined): PriceMode => {
			const mode = (m ?? 'auto') as PriceMode;
			// スタッフは料金を変えられない（unit / total は管理者だけ）
			if ((mode === 'unit' || mode === 'total') && !init.form?.isAdmin) return init.row?.answer_rooms ? 'keep' : 'auto';
			return mode;
		})(init.form?.defaultPriceMode)
	);
	let unitInputs = $state<Record<string, string>>(
		Object.fromEntries((init.form?.adultsSteps ?? []).map((n) => [String(n), init.form?.unitPrices[String(n)] != null ? String(init.form.unitPrices[String(n)]) : '']))
	);
	let totalInput = $state(init.row?.answer_total != null ? String(init.row.answer_total) : init.row?.quote_total != null ? String(init.row.quote_total) : '');
	let message = $state(init.row?.answer_message ?? '');
	let expiresOn = $state(init.form?.defaultExpiresOn ?? '');
	let creditOverride = $state(init.row?.credit_override ?? false);
	let busy = $state(false);

	const dates = $derived(r ? groupNightDates(r.check_in_date, r.nights) : []);
	const toNum = (s: string) => Math.round(Number(String(s).replace(/[,，円\s]/g, '')));
	// 回答額のプレビュー（保存時はサーバで同じ計算・lib/partner-group.ts）
	const preview = $derived.by(() => {
		if (!r) return null;
		if (priceMode === 'auto') return r.quote_status === 'ok' && r.quote_rooms ? { rooms: r.quote_rooms, total: r.quote_total ?? groupRoomsTotal(r.quote_rooms) } : null;
		if (priceMode === 'keep') return r.answer_rooms ? { rooms: r.answer_rooms, total: r.answer_total ?? groupRoomsTotal(r.answer_rooms) } : null;
		if (priceMode === 'unit') {
			const units: Record<string, number> = {};
			for (const [k, v] of Object.entries(unitInputs)) if (String(v).trim()) units[k] = toNum(v);
			const rooms = overrideUnitPrices(r.rooms, dates, units, r.quote_rooms);
			return rooms ? { rooms, total: groupRoomsTotal(rooms) } : null;
		}
		const spread = String(totalInput).trim() ? spreadTotalOverRooms(r.rooms, dates, toNum(totalInput)) : null;
		return spread ? { rooms: spread.rooms, total: spread.total } : null;
	});
	const bathTax = $derived(r ? ((priceMode === 'keep' ? r.answer_bath_tax : null) ?? r.quote_bath_tax ?? 0) : 0);
	const creditOver = $derived(!!(data.credit?.over || r?.quote_credit?.over));
	const needsMessage = $derived(answer === 'conditional' && !message.trim());

	const actorOf = (k: string) => (k === 'partner' ? '取引先' : k === 'staff' ? '宿' : '自動');
	const eventText = (d: Record<string, unknown> | null) => {
		if (!d) return '';
		const parts: string[] = [];
		if (typeof d.answer === 'string' && data.labels) parts.push(data.labels.answer[d.answer as GroupAnswer] ?? d.answer);
		if (typeof d.total === 'number') parts.push(`宿泊料金 ${yen(d.total)}${d.price_changed ? '（料金を変更）' : ''}`);
		if (d.credit_override === true) parts.push('受付枠超過を承認');
		if (typeof d.expires_at === 'string') parts.push(`期限 ${dt(d.expires_at)}`);
		if (typeof d.booking_code === 'string') parts.push(`予約 ${d.booking_code}`);
		if (typeof d.reason === 'string') parts.push(d.reason === 'interrupted' ? '承諾の処理が途中で止まったため、回答ありに戻しました' : d.reason);
		if (d.recovered === true) parts.push('承諾の途中で止まった照会に予約を結び直しました');
		if (d.revised === true) parts.push('回答の修正');
		return parts.join('・');
	};
	const inputCls = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-stone-50';
</script>

<svelte:head><title>{r ? `${r.group_name} ${r.inquiry_code}` : '団体照会'} ｜ 山人管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/group-inquiries" class="hover:underline">団体照会</a>{#if r} / {r.inquiry_code}{/if}</nav>

{#if data.error || !r || !f || !data.labels}
	<p class="rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error ?? '照会を読み込めませんでした。'}</p>
{:else}
	{@const labels = data.labels}
	<div class="mb-4">
		<div class="flex flex-wrap items-center gap-2">
			<h1 class="text-lg font-bold text-stone-800">{r.group_name}</h1>
			<span class="rounded-full bg-stone-700 px-2 py-0.5 text-[11px] text-white">{labels.status[r.status]}</span>
			{#if r.answer}<span class="text-xs text-stone-500">回答: {labels.answer[r.answer]}{r.answered_by_name ? `（${r.answered_by_name}・${dt(r.answered_at)}）` : ''}</span>{/if}
		</div>
		<p class="mt-0.5 text-xs text-stone-500">
			{r.inquiry_code} ・ {dt(r.created_at)} 受付 ・
			{#if r.partner_id}<a href={`/admin/partners/${r.partner_id}`} class="underline">{r.partner_name}</a>{:else}{r.partner_name}{/if}{r.submitted_by ? `（${r.submitted_by}）` : ''}
			{#if r.bookingCode} ・ <span class="text-emerald-700">予約 {r.bookingCode}{r.bookingStatus === 'cancelled' ? '（取消）' : ''}</span>{/if}
		</p>
	</div>

	{#if form?.answered}
		<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ 回答しました（{labels.status[(form.status ?? r.status) as typeof r.status] ?? form.status}）。{form.mailed ? '取引先へメールでお知らせしました。' : 'メールは送っていません（通知オフ・宛先なし等）。'}</p>
	{:else if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{form.message}</p>
	{/if}

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
		<!-- 左: 条件・やりとり -->
		<div class="min-w-0 space-y-4">
			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-[15px] font-bold text-stone-900">照会の条件</h2>
				<dl class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
					<dt class="text-stone-500">取引先</dt><dd>{r.partner_name}</dd>
					<dt class="text-stone-500">施設</dt><dd>{r.facilityName}</dd>
					<dt class="text-stone-500">日程</dt><dd>{describeGroupStay(r.check_in_date, r.nights)}（{r.check_in_date} 〜 {r.check_out_date}）</dd>
					<dt class="text-stone-500">部屋</dt><dd>{r.room_name}（{r.room_code}）× {r.room_count}室</dd>
					<dt class="text-stone-500">人数</dt><dd>大人{r.adult_total}名（{describeRoomAdults(r.rooms)}）<span class="block text-xs text-stone-500">{r.rooms.map((x, i) => `${i + 1}室目 ${x.adults}名`).join(' / ')}</span></dd>
					<dt class="text-stone-500">プラン</dt><dd>{r.plan_display_name ?? r.plan_name}{r.meal_type ? `（${mealLabel(r.meal_type)}）` : ''}{#if r.plan_display_name && r.plan_display_name !== r.plan_name}<span class="block text-xs text-stone-500">PMS: {r.plan_name}（{r.plan_code}）</span>{/if}</dd>
					<dt class="text-stone-500">夕食開始</dt><dd>{r.extras?.dinnerTime?.value || '—'}</dd>
					<dt class="text-stone-500">支払</dt><dd>{r.payment_label}</dd>
					<dt class="text-stone-500">交通機関</dt><dd>{r.extras?.transport?.value || '—'}</dd>
					<dt class="text-stone-500">備考</dt><dd class="whitespace-pre-wrap">{r.extras?.note || '—'}</dd>
					<dt class="text-stone-500">予約者</dt><dd>{describeGroupBooker(r.booker) || '—'}</dd>
				</dl>
			</section>

			{#if data.siblings.length}
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-2 text-[15px] font-bold text-stone-900">同じ束のほかの照会（{data.siblings.length}件）</h2>
					<ul class="divide-y divide-stone-100 text-sm">
						{#each data.siblings as s (s.id)}
							<li><a href={`/admin/group-inquiries/${s.id}`} class="flex flex-wrap justify-between gap-2 py-1.5 hover:underline"><span>{s.inquiry_code} ・ {describeGroupStay(s.check_in_date, s.nights)} ・ {s.room_name} × {s.room_count}室</span><span class="text-xs text-stone-500">{labels.status[s.status]}</span></a></li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-[15px] font-bold text-stone-900">やりとり</h2>
				{#if data.events.length === 0}
					<p class="text-sm text-stone-500">まだありません。</p>
				{:else}
					<ol class="space-y-2 text-sm">
						{#each data.events as ev (ev.id)}
							{@const msg = typeof ev.detail?.message === 'string' ? ev.detail.message : ''}
							<li class="border-l-2 pl-3 {ev.actor_kind === 'staff' ? 'border-brand-800' : ev.actor_kind === 'partner' ? 'border-sky-500' : 'border-stone-300'}">
								<p><span class="font-medium">{labels.event[ev.kind] ?? ev.kind}</span><span class="ml-2 text-xs text-stone-500">{dt(ev.created_at)} ・ {actorOf(ev.actor_kind)}{ev.actor_label ? `（${ev.actor_label}）` : ''}</span></p>
								{#if eventText(ev.detail)}<p class="text-xs text-stone-600">{eventText(ev.detail)}</p>{/if}
								{#if msg}<p class="mt-0.5 whitespace-pre-wrap text-stone-700">{msg}</p>{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		</div>

		<!-- 右: 在庫・料金・受付枠 -->
		<div class="min-w-0 space-y-4">
			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-[15px] font-bold text-stone-900">在庫（{r.room_name}・いまの残室）</h2>
				{#if data.nightly.length === 0}
					<p class="text-sm text-stone-500">残室を読み込めませんでした。</p>
				{:else}
					<ul class="grid gap-1 text-sm">
						{#each data.nightly as n (n.date)}
							<li class="flex justify-between gap-2 {n.remaining < r.room_count ? 'font-bold text-red-700' : ''}"><span>{day(n.date)}</span><span class="tabular-nums">残り {n.remaining} 室{n.remaining < r.room_count ? `（${r.room_count - n.remaining} 室足りません）` : ''}</span></li>
						{/each}
					</ul>
				{/if}
				<p class="mt-2 text-[11px] text-stone-500">照会の時点の残室: {r.quote_remaining ?? '—'} 室。照会・回答では在庫を押さえません（承諾の時点で確かめます）。</p>
			</section>

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="text-[15px] font-bold text-stone-900">料金（{r.answer_total != null ? '回答額' : '自動計算'}）</h2>
				{#if r.answer_total != null || r.quote_total != null}
					{@const lodging = r.answer_total ?? r.quote_total ?? 0}
					{@const bath = (r.answer_total != null ? r.answer_bath_tax : r.quote_bath_tax) ?? 0}
					<div class="mt-2">
						<PartnerPriceTable {lodging} guests={r.adult_total} nights={r.nights} bathTax={bath} total={lodging + bath} nightLines={data.nightLines} />
					</div>
					{#if r.answer_total != null && r.quote_total != null && r.answer_total !== r.quote_total}
						<p class="mt-1 text-xs text-stone-500">自動計算額 {yen(r.quote_total)} から変更</p>
					{/if}
				{:else}
					<p class="mt-2 text-sm text-amber-800">{labels.quote[r.quote_status] || '自動計算できませんでした'}{r.quote_message ? `（${r.quote_message}）` : ''}</p>
				{/if}
				<p class="mt-2 text-[11px] text-stone-500">自動計算: {r.quote_price_mode === 'precomputed' ? 'RMS の先計算の料金・' : r.quote_price_mode === 'live' ? 'その場の計算・' : ''}{dt(r.created_at)} 時点</p>
			</section>

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-[15px] font-bold text-stone-900">受付枠（与信）</h2>
				{#if data.credit}
					<div class="overflow-x-auto">
						<table class="w-full text-xs tabular-nums">
							<thead class="text-left text-stone-500"><tr><th class="py-1 pr-2 font-medium">月</th><th class="pr-2 text-right font-medium">上限</th><th class="pr-2 text-right font-medium">予約済み</th><th class="pr-2 text-right font-medium">この照会</th><th class="text-right font-medium">残り</th></tr></thead>
							<tbody>
								{#each data.credit.months as m (m.month)}
									<tr class="border-t border-stone-100 {m.over ? 'bg-red-50 font-bold text-red-700' : ''}">
										<td class="py-1 pr-2 whitespace-nowrap">{creditMonthLabel(m.month)}</td>
										<td class="pr-2 text-right">{m.limit}</td>
										<td class="pr-2 text-right">{m.booked}</td>
										<td class="pr-2 text-right">{m.adding}</td>
										<td class="text-right">{m.remaining}{m.over ? `（${-m.remaining} 室超過）` : ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if data.credit.over}<p class="mt-2 text-sm font-bold text-red-700">受付枠を超えます。受けるときは管理者が「受付枠を超えても受ける」を付けて回答してください（付けないと承諾が止まることがあります）。</p>{/if}
				{:else}
					<p class="text-sm text-stone-500">{r.quote_credit ? `照会の時点: ${r.quote_credit.over ? '受付枠を超えていました' : '受付枠の内でした'}` : '与信の対象外（紐づけ無し・与信オフなど）か、終了した照会です。'}</p>
				{/if}
			</section>
		</div>
	</div>

	<!-- 回答 -->
	<section class="mt-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
		<h2 class="text-lg font-bold text-stone-900">{r.status === 'offered' ? '回答の修正' : '回答'}</h2>
		{#if !f.canAnswer}
			<p class="mt-2 text-sm text-stone-500">この照会には回答できません（{labels.status[r.status]}）。{r.status === 'accepted' ? '変更・取消は予約側（取引先詳細の予約一覧・PMS）で行ってください。' : ''}</p>
		{:else}
			<form
				method="POST"
				action="?/answer"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						busy = false;
						await update({ reset: false });
					};
				}}
				class="mt-3 grid gap-4"
			>
				<fieldset class="flex flex-wrap gap-2">
					<legend class="mb-1 text-xs text-stone-500">可否</legend>
					{#each ['ok', 'conditional', 'declined'] as const as a (a)}
						<label class={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${answer === a ? (a === 'declined' ? 'border-stone-700 bg-stone-100' : 'border-emerald-600 bg-emerald-50') : 'border-stone-300'}`}>
							<input type="radio" name="answer" value={a} bind:group={answer} />{labels.answer[a]}
						</label>
					{/each}
				</fieldset>

				{#if answer !== 'declined'}
					<fieldset class="rounded-lg border border-stone-200 p-3">
						<legend class="px-1 text-sm font-bold text-stone-800">料金</legend>
						<div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
							<label class="flex items-center gap-1.5 {r.quote_status !== 'ok' ? 'text-stone-400' : ''}"><input type="radio" name="priceMode" value="auto" bind:group={priceMode} disabled={r.quote_status !== 'ok'} />自動計算額のまま</label>
							{#if r.answer_rooms}<label class="flex items-center gap-1.5"><input type="radio" name="priceMode" value="keep" bind:group={priceMode} />今の回答額のまま</label>{/if}
							<label class="flex items-center gap-1.5 {!isAdmin ? 'text-stone-400' : ''}"><input type="radio" name="priceMode" value="unit" bind:group={priceMode} disabled={!isAdmin} />1名あたりの料金を変える</label>
							<label class="flex items-center gap-1.5 {!isAdmin ? 'text-stone-400' : ''}"><input type="radio" name="priceMode" value="total" bind:group={priceMode} disabled={!isAdmin} />合計を入れる</label>
						</div>
						{#if !isAdmin}
							<p class="mt-1 text-[11px] text-stone-500">料金を変えられるのは管理者だけです。{r.quote_status !== 'ok' && !r.answer_rooms ? '自動計算の料金が無いため、「受けられる」の回答は管理者に依頼してください（「受けられない」はスタッフでも回答できます）。' : ''}</p>
						{/if}
						{#if priceMode === 'unit'}
							<div class="mt-3 grid gap-2 sm:grid-cols-3">
								{#each f.adultsSteps as n (n)}
									<label class="block">
										<span class="mb-0.5 block text-xs text-stone-500">{n}名1室のとき・1名あたり（税込・入湯税別）</span>
										<input name={`unit_${n}`} inputmode="numeric" bind:value={unitInputs[String(n)]} placeholder={f.unitPrices[String(n)] != null ? String(f.unitPrices[String(n)]) : '例: 20000'} class={inputCls} />
									</label>
								{/each}
							</div>
							<p class="mt-1 text-[11px] text-stone-500">空欄の段は自動計算の料金のままです（泊ごとの単価に入れます）。</p>
						{:else if priceMode === 'total'}
							<label class="mt-3 block sm:max-w-xs">
								<span class="mb-0.5 block text-xs text-stone-500">宿泊料金の合計（税込・入湯税別）</span>
								<input name="total" inputmode="numeric" bind:value={totalInput} class={inputCls} />
							</label>
							<p class="mt-1 text-[11px] text-stone-500">人数×泊数で均等に割り、1円未満の端数は最初の部屋の最初の泊に寄せます（割り切れない残りは切り捨て）。</p>
						{/if}
						<div class="mt-3 max-w-md">
							{#if preview}
								<PartnerPriceTable lodging={preview.total} guests={r.adult_total} nights={r.nights} bathTax={bathTax} total={preview.total + bathTax} nightLines={partnerNightLines(preview.rooms)} />
								{#if r.quote_total != null && preview.total !== r.quote_total}<p class="mt-1 text-xs text-amber-800">自動計算額 {yen(r.quote_total)} との差 {preview.total - r.quote_total > 0 ? '+' : ''}{yen(preview.total - r.quote_total)}</p>{/if}
							{:else}
								<p class="text-sm text-amber-800">{priceMode === 'auto' ? '自動計算の料金がありません。' : priceMode === 'unit' ? 'すべての人数の段の1名あたりの料金を入れてください。' : priceMode === 'total' ? '合計を入れてください（1名1泊あたり1円以上）。' : '回答額がありません。'}</p>
							{/if}
						</div>
					</fieldset>
				{/if}

				<label class="block">
					<span class="mb-0.5 block text-xs text-stone-500">取引先への一言（取引先に見えます）{#if answer === 'conditional'}<span class="ml-1 text-red-700">条件付きのときは必須</span>{/if}</span>
					<textarea name="message" bind:value={message} rows="3" maxlength={MAX_GROUP_ANSWER_MESSAGE_LENGTH} placeholder={answer === 'conditional' ? '例: 夕食は 18:00 開始でしたらお受けできます' : answer === 'declined' ? '例: あいにく満室のため、4/17 でしたらご案内できます' : '任意'} class={inputCls}></textarea>
				</label>

				<div class="flex flex-wrap items-end gap-4">
					{#if answer !== 'declined'}
						<label class="block">
							<span class="mb-0.5 block text-xs text-stone-500">回答の有効期限（この日の 23:59 まで）</span>
							<input type="date" name="expiresOn" bind:value={expiresOn} max={r.check_in_date} class={inputCls} />
						</label>
						{#if isAdmin && (creditOver || r.credit_override)}
							<label class="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
								<input type="checkbox" name="creditOverride" bind:checked={creditOverride} />受付枠を超えても受ける（デポジットを求めずに承諾を通す）
							</label>
						{:else if creditOver}
							<p class="text-xs text-red-700">受付枠を超えています。超えても受けるかは管理者が決めます。</p>
						{/if}
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
					<button type="submit" disabled={busy || needsMessage || (answer !== 'declined' && !preview)} class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-40">
						{busy ? '回答しています…' : answer === 'declined' ? '受けられないと回答する' : r.status === 'offered' ? '回答を修正して送る' : '回答して取引先に知らせる'}
					</button>
					<span class="text-xs text-stone-500">送ると取引先へメールが届きます。{answer !== 'declined' && preview ? `回答額 ${yen(preview.total + bathTax)}（入湯税込み）` : ''}</span>
				</div>
			</form>
		{/if}
	</section>
{/if}
