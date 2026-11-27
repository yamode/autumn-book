<script lang="ts">
	import BathExtraQuota from '$lib/components/BathExtraQuota.svelte';
	// マイページの貸切風呂の事前予約（2026-11-22）。
	// 館内向けの /r/bath（STEP1〜3 のフォーム）ではなく、マイページの見た目で
	//   日付を選ぶ → 時間のボタンを押す → 「この時間で予約する」
	// の 1 画面で済ませる。予約済みの時間はいちばん上に出し、そこから変更・取消できる。
	import { page } from '$app/state';
	import { enhance } from '$lib/enhance';
	import BackLink from '$lib/components/BackLink.svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { bathRoomDisplay } from '$lib/private-bath-display';
	import type { BathSlot } from '$lib/server/private-bath';

	let { data, form } = $props();
	const ctx = $derived(form?.refreshedCtx ?? data.ctx);
	const bookingOpen = $derived(data.pmsEnabled && ctx.ok && ctx.enabled);
	const c = $derived(data.content?.fields ?? {});
	const done = $derived(page.url.searchParams.get('done'));

	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	function fmt(ymd: string, opts: Intl.DateTimeFormatOptions): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', { ...opts, timeZone: 'Asia/Tokyo' }).format(new Date(`${ymd}T00:00:00+09:00`));
		} catch {
			return ymd;
		}
	}
	const longDate = (ymd: string) => fmt(ymd, { month: 'long', day: 'numeric', weekday: 'short' });
	const yen = (v: number) => `¥${v.toLocaleString('ja-JP')}`;

	const baths = $derived(ctx.baths ?? []);
	const mine = $derived(ctx.mine ?? []);
	const changing = $derived(mine.find((r) => r.id === data.changeId));
	const groupShared = $derived(Boolean(ctx.group?.shared));

	let pickedBath = $state<string | null>(null);
	let date = $state('');
	let from = $state('');

	const bath = $derived((pickedBath === null ? null : baths.find((b) => (b.bath_id ?? '') === pickedBath)) ?? baths[0]);

	function period(t: string): 'am' | 'pm' {
		return Number(t.slice(0, 2)) < 12 ? 'am' : 'pm';
	}
	function limitReached(d: string, s: BathSlot): boolean {
		if (typeof s.limit_reached === 'boolean') return s.limit_reached;
		return mine.filter((r) => r.date === d && period(r.from) === period(s.from)).length >= (ctx.per_room_per_range ?? 1);
	}
	const bookable = (d: string, s: BathSlot) => !s.taken && !s.closed && !limitReached(d, s);

	// 日付は「取れる枠が1つでもある日」だけ選べる。全部埋まった日も並べて「満」と見せる
	const days = $derived(bath?.days ?? []);
	const openDays = $derived(days.filter((d) => d.slots.some((s) => bookable(d.date, s))));
	const day = $derived(days.find((d) => d.date === date));
	const hasBookable = $derived(baths.some((b) => b.days.some((d) => d.slots.some((s) => bookable(d.date, s)))));
	const picked = $derived(day?.slots.find((s) => s.from === from && bookable(date, s)));

	// 初めは最初の取れる日を開いておく（浴室を替えたときも同じ）
	$effect(() => {
		if (!openDays.some((d) => d.date === date)) {
			date = openDays[0]?.date ?? '';
			from = '';
		}
	});
	// 変更のときは、変更する予約の浴室から始める
	$effect(() => {
		if (changing) pickedBath = changing.bath_id ?? '';
	});

	function slotState(s: BathSlot): string {
		if (s.mine) return m.account_bath_slot_mine();
		if (s.taken) return m.bath_taken();
		if (s.closed) return m.bath_closed_slot();
		if (limitReached(date, s)) return m.account_bath_slot_limit();
		return '';
	}

	const errorText = (code: string | undefined): string => {
		if (code === 'change_unavailable') return m.bath_change_unavailable();
		if (code === 'not_open') return m.bath_closed();
		if (code === 'slot_taken') return m.bath_err_taken();
		if (code === 'per_room_limit') return groupShared ? m.bath_err_limit_group() : m.bath_err_limit();
		if (code === 'past_cutoff') return m.bath_err_cutoff();
		if (code === 'slot_unavailable') return m.bath_err_unavailable();
		if (code === 'choose') return m.bath_choose();
		return m.bath_err_generic();
	};
	let submitting = $state(false);
</script>

<svelte:head><title>{m.membership_bath_title()} ｜ {m.account_layout_heading()}</title></svelte:head>

<BackLink href={data.backHref} target={data.backIsList ? m.reservation_breadcrumb_list() : m.account_bath_back_detail()} />

<div class="space-y-4">
	<!-- 見出し：どの滞在の予約か -->
	<section class="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
		<h2 class="text-lg font-semibold text-brand-900">{c.title || m.membership_bath_title()}</h2>
		<p class="mt-1 text-sm text-stone-600">
			{ctx.facility?.name ?? ''}{#if ctx.check_in_date && ctx.check_out_date}<span class="text-stone-400"> ／ </span>{m.account_bath_stay({ from: longDate(ctx.check_in_date), to: longDate(ctx.check_out_date) })}{/if}
		</p>
		{#if bathRoomDisplay(ctx, getLocale())}
			<p class="mt-0.5 text-sm text-stone-500">{m.bath_room()}：{bathRoomDisplay(ctx, getLocale())}</p>
		{/if}
		{#if bookingOpen}
			<ul class="mt-3 space-y-1 text-[13px] leading-6 text-stone-600">
				<li>{(ctx.price_yen ?? 0) > 0 ? m.bath_price_paid({ price: yen(ctx.price_yen ?? 0) }) : m.bath_price_free()}</li>
				<li>{m.bath_booking_deadline({ reserve: String(ctx.cutoff_min ?? 10), cancel: String(ctx.cancel_min ?? 10) })}</li>
				<li class="text-stone-500">{groupShared ? m.bath_limit_group({ count: ctx.per_room_per_range ?? 1 }) : m.bath_limit({ count: ctx.per_room_per_range ?? 1 })}</li>
			</ul>
			{#if c.lead}<p class="mt-2 whitespace-pre-line text-[13px] leading-6 text-stone-600">{c.lead}</p>{/if}
		{:else}
			<p class="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{m.bath_closed()}</p>
		{/if}
	</section>

	{#if done === 'reserved' || done === 'changed' || done === 'canceled'}
		<p role="status" class="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
			{done === 'reserved' ? m.bath_reserved_success() : done === 'changed' ? m.bath_change_success() : m.bath_canceled()}
		</p>
	{/if}
	{#if form?.error}
		<p role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
			{errorText(form.error)}{#if form.refreshedCtx}<br />{m.bath_availability_refreshed()}{/if}
		</p>
	{/if}

	<!-- 予約済みの時間 -->
	{#if mine.length}
		<section class="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
			<h2 class="font-semibold text-brand-900">{m.bath_mine_title()}</h2>
			<ul class="mt-3 space-y-2">
				{#each mine as r (r.id)}
					<li class="flex flex-wrap items-center gap-3 rounded-xl border p-3 {r.id === data.changeId ? 'border-brand-800 bg-brand-50' : 'border-stone-200'}">
						<div class="min-w-[11rem] flex-1">
							<p class="text-sm text-stone-600">{longDate(r.date)}{#if baths.length > 1}<span class="text-stone-400"> · {baths.find((b) => (b.bath_id ?? '') === (r.bath_id ?? ''))?.bath_name}</span>{/if}</p>
							<p class="text-lg font-semibold tabular-nums text-brand-900">{r.from}{r.to ? `〜${r.to}` : ''}</p>
							{#if r.price_yen > 0}<p class="text-xs text-stone-500">{yen(r.price_yen)}</p>{/if}
						</div>
						{#if r.cancelable && data.pmsEnabled}
							<div class="flex gap-2">
								{#if r.id !== data.changeId}
									<a href={`?change=${r.id}#bath-pick`} class="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-medium text-brand-900 hover:bg-stone-50">{m.bath_change()}</a>
								{/if}
								<form method="POST" action="?/cancel" use:enhance>
									<input type="hidden" name="slotId" value={r.id} />
									<button type="submit" class="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-stone-500 hover:bg-stone-50 hover:text-rose-700"
										onclick={(e) => { if (!confirm(m.bath_cancel_confirm())) e.preventDefault(); }}>{m.bath_cancel()}</button>
								</form>
							</div>
						{:else}
							<p class="text-xs text-stone-500">{m.bath_cancel_closed()}</p>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- 新しく予約する（変更のときは、選んだ時間に付け替える） -->
	{#if bookingOpen}
		<section id="bath-pick" class="scroll-mt-24 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
			{#if changing}
				<div class="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-xl bg-brand-50 p-3 text-sm">
					<div>
						<p class="font-medium text-brand-900">{m.bath_change_current({ date: longDate(changing.date), time: changing.from })}</p>
						<p class="mt-0.5 text-stone-600">{m.bath_change_started()}</p>
					</div>
					<a href={page.url.pathname} class="inline-flex min-h-11 items-center text-sm text-brand-800 underline">{m.bath_change_back()}</a>
				</div>
			{:else if data.changeUnavailable}
				<p role="alert" class="mb-4 rounded-xl bg-stone-100 p-3 text-sm">{m.bath_change_unavailable()}</p>
			{/if}

			<h2 class="font-semibold text-brand-900">{changing ? m.bath_change_submit() : m.account_bath_new_heading()}</h2>

			{#if hasBookable}
				{#if baths.length > 1}
					<div class="mt-3" role="radiogroup" aria-label={m.bath_field_bath()}>
						<p class="text-xs text-stone-500">{m.bath_field_bath()}</p>
						<div class="mt-1.5 flex flex-wrap gap-2">
							{#each baths as b (b.bath_id ?? 'default')}
								{@const on = (bath?.bath_id ?? '') === (b.bath_id ?? '')}
								<button type="button" role="radio" aria-checked={on}
									onclick={() => { pickedBath = b.bath_id ?? ''; from = ''; }}
									class="min-h-11 rounded-full border px-4 text-sm {on ? 'border-brand-900 bg-brand-900 text-white' : 'border-stone-300 text-stone-700 hover:bg-stone-50'}">{b.bath_name}</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- 日付 -->
				<div class="mt-4">
					<p class="text-xs text-stone-500">{m.bath_label_date()}</p>
					<div class="mt-1.5 flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label={m.bath_label_date()}>
						{#each days as d (d.date)}
							{@const open = openDays.some((o) => o.date === d.date)}
							{@const on = d.date === date}
							<button type="button" role="radio" aria-checked={on} disabled={!open}
								onclick={() => { date = d.date; from = ''; }}
								class="flex min-h-14 min-w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-sm
									{on ? 'border-brand-900 bg-brand-900 text-white' : open ? 'border-stone-300 text-stone-800 hover:bg-stone-50' : 'border-stone-200 bg-stone-50 text-stone-300'}">
								<span class="font-medium">{fmt(d.date, { month: 'numeric', day: 'numeric' })}</span>
								<span class="text-xs {on ? 'text-white/80' : ''}">{open ? fmt(d.date, { weekday: 'short' }) : d.slots.some((s) => s.mine) ? m.account_bath_slot_mine() : m.bath_taken()}</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- 時間 -->
				{#if day}
					<div class="mt-4">
						<BathExtraQuota slots={day.slots} />
						<p class="text-xs text-stone-500">{m.bath_label_time()}</p>
						<div class="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={m.bath_label_time()}>
							{#each day.slots as s (s.from)}
								{@const ok = bookable(date, s)}
								{@const on = ok && s.from === from}
								<button type="button" role="radio" aria-checked={on} disabled={!ok}
									onclick={() => (from = s.from)}
									class="flex min-h-14 flex-col items-center justify-center rounded-xl border px-2 text-sm tabular-nums
										{on ? 'border-brand-900 bg-brand-900 text-white' : ok ? 'border-stone-300 text-stone-800 hover:border-brand-800 hover:bg-brand-50' : s.mine ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-stone-50 text-stone-300'}">
									<span class="text-base font-semibold">{s.from}</span>
									<span class="text-[11px] {on ? 'text-white/80' : ok ? 'text-stone-500' : ''}">{ok ? (s.to ? `〜${s.to}` : '') : slotState(s)}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- 確定 -->
				<form method="POST" action="?/reserve"
					use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }}
					class="mt-5 rounded-xl bg-stone-50 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
					<input type="hidden" name="bathId" value={bath?.bath_id ?? ''} />
					<input type="hidden" name="date" value={date} />
					<input type="hidden" name="from" value={from} />
					{#if data.changeId}<input type="hidden" name="changeId" value={data.changeId} />{/if}
					<p class="text-sm {picked ? 'font-medium text-brand-900' : 'text-stone-500'}" aria-live="polite">
						{#if picked}
							{longDate(date)} {picked.from}{picked.to ? `–${picked.to}` : ''}{#if baths.length > 1}<span class="text-stone-500"> · {bath?.bath_name}</span>{/if}{#if (ctx.price_yen ?? 0) > 0}<span class="ml-1 text-stone-600">（{yen(ctx.price_yen ?? 0)}）</span>{/if}
						{:else}
							{m.bath_choose()}
						{/if}
					</p>
					<button type="submit" disabled={!picked || submitting} aria-busy={submitting}
						class="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-900 px-5 text-sm font-semibold text-white hover:bg-brand-800 disabled:bg-stone-200 disabled:text-stone-400 sm:mt-0 sm:w-auto">
						{changing ? m.bath_change_submit() : m.bath_submit()}
					</button>
				</form>
			{:else}
				<p class="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-600">
					{changing ? m.bath_no_availability() : mine.length ? (groupShared ? m.bath_limit_reached_group() : m.bath_limit_reached()) : m.bath_no_availability()}
				</p>
			{/if}
		</section>
	{/if}

	<p class="whitespace-pre-line px-1 text-xs leading-5 text-stone-400">{c.notice || m.bath_note_phone()}</p>
</div>
