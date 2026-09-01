<script lang="ts">
	// 貸切風呂のご予約。館内図の QR から来たお客様が、枠を選んで確定するだけの画面。
	// どのお部屋のご予約かはトークンで決まっているので、お客様に部屋を選ばせない。
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { data, form } = $props();
	const ctx = $derived(data.ctx);
	// 管理画面（/admin/bath）で入れた文章。未入力の欄は null なので既定文言に落ちる。
	const c = $derived(data.content?.fields ?? {});
	const photos = $derived(data.content?.images ?? []);

	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	function fmtDate(ymd: string): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				month: 'long',
				day: 'numeric',
				weekday: 'short',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(`${ymd}T00:00:00+09:00`));
		} catch {
			return ymd;
		}
	}
	const yen = (v: number) => `¥${v.toLocaleString('ja-JP')}`;

	const errorText = (code: string | undefined): string => {
		if (code === 'slot_taken') return m.bath_err_taken();
		if (code === 'per_room_limit') return m.bath_err_limit();
		if (code === 'past_cutoff') return m.bath_err_cutoff();
		if (code === 'choose') return m.bath_choose();
		return m.bath_err_generic();
	};

	// 選択中の枠（浴室ごと）。確定するまでサーバへは送らない。
	let picked = $state<Record<string, string>>({});
	const keyOf = (bathId: string | null) => bathId ?? 'default';
</script>

<svelte:head><title>{m.bath_title()} ｜ YAMADO</title></svelte:head>

<section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
	<h1 class="font-display text-xl text-brand-900">{c.title || m.bath_title()}</h1>

	{#if !ctx.ok}
		<p class="mt-3 text-sm text-stone-600">{m.bath_closed()}</p>
	{:else if !ctx.enabled}
		<p class="mt-3 text-sm text-stone-600">{m.bath_closed()}</p>
	{:else}
		<p class="mt-2 whitespace-pre-line text-sm text-stone-600">{c.lead || m.bath_lead()}</p>
		<p class="mt-1 text-sm text-stone-600">
			{#if (ctx.price_yen ?? 0) > 0}
				{m.bath_price_paid({ price: yen(ctx.price_yen ?? 0) })}
			{:else}
				{m.bath_price_free()}
			{/if}
		</p>
		{#if c.price_note}
			<p class="mt-1 whitespace-pre-line text-sm text-stone-600">{c.price_note}</p>
		{/if}
		<p class="mt-1 text-xs text-stone-400">
			{m.bath_limit({ count: ctx.per_room_per_range ?? 1 })}
		</p>
	{/if}

	{#if form?.done === 'reserved'}
		<p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{c.done || m.bath_done()}</p>
	{:else if form?.done === 'canceled'}
		<p class="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{m.bath_canceled()}</p>
	{:else if form?.error}
		<p class="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{errorText(form.error)}</p>
	{/if}
</section>

{#if photos.length}
	<!-- 管理画面で登録した写真。上から順に出す。 -->
	<section class="mt-4 space-y-3">
		{#each photos as p (p.url)}
			<figure class="overflow-hidden rounded-2xl border border-stone-200 bg-white">
				<img src={p.url} alt={p.caption || m.bath_title()} class="w-full object-cover" loading="lazy" />
				{#if p.caption}
					<figcaption class="px-4 py-2 text-xs text-stone-500">{p.caption}</figcaption>
				{/if}
			</figure>
		{/each}
	</section>
{/if}

<!-- ============ ご予約中の時間（再スキャンでここを見に来る） ============ -->
<section class="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
	<h2 class="font-display text-lg text-brand-900">{m.bath_mine_title()}</h2>
	{#if !ctx.mine?.length}
		<p class="mt-2 text-sm text-stone-500">{m.bath_mine_empty()}</p>
	{:else}
		<ul class="mt-3 space-y-2">
			{#each ctx.mine as r (r.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 pb-2 text-sm">
					<span class="font-medium text-stone-800">{fmtDate(r.date)}</span>
					<span class="tabular-nums text-stone-800">{r.from}{r.to ? `〜${r.to}` : ''}</span>
					{#if r.price_yen > 0}
						<span class="text-xs text-stone-400">{yen(r.price_yen)}</span>
					{/if}
					{#if r.cancelable}
						<form method="POST" action="?/cancel" use:enhance class="ml-auto">
							<input type="hidden" name="slotId" value={r.id} />
							<button
								type="submit"
								class="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
								onclick={(e) => {
									if (!confirm(m.bath_cancel_confirm())) e.preventDefault();
								}}>{m.bath_cancel()}</button>
						</form>
					{:else}
						<span class="ml-auto text-xs text-stone-400">{m.bath_cancel_closed()}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<p class="mt-3 whitespace-pre-line text-xs leading-5 text-stone-400">{c.notice || m.bath_note_phone()}</p>
</section>

<!-- ============ 空き枠 ============ -->
{#if ctx.ok && ctx.enabled}
	{#each ctx.baths ?? [] as bath (bath.bath_id ?? 'default')}
		<section class="mt-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
			<h2 class="font-display text-lg text-brand-900">{bath.bath_name}</h2>

			<form method="POST" action="?/reserve" use:enhance class="mt-3">
				<input type="hidden" name="bathId" value={bath.bath_id ?? ''} />
				<input type="hidden" name="date" value={(picked[keyOf(bath.bath_id)] ?? '').split(' ')[0] ?? ''} />
				<input type="hidden" name="from" value={(picked[keyOf(bath.bath_id)] ?? '').split(' ')[1] ?? ''} />

				{#each bath.days as day (day.date)}
					<h3 class="mt-4 text-sm font-medium text-stone-700">{fmtDate(day.date)}</h3>
					<ul class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each day.slots as slot (slot.from)}
							{@const value = `${day.date} ${slot.from}`}
							{@const disabled = slot.taken || slot.closed}
							<li>
								<label
									class="block cursor-pointer rounded-lg border px-2 py-2 text-center text-sm
										{disabled
										? 'cursor-not-allowed border-stone-100 bg-stone-50 text-stone-300'
										: picked[keyOf(bath.bath_id)] === value
											? 'border-brand-700 bg-brand-50 text-brand-900'
											: 'border-stone-200 text-stone-700 hover:bg-stone-50'}">
									<input
										type="radio"
										class="sr-only"
										name={`pick-${keyOf(bath.bath_id)}`}
										value={value}
										{disabled}
										checked={picked[keyOf(bath.bath_id)] === value}
										onchange={() => (picked[keyOf(bath.bath_id)] = value)} />
									<span class="tabular-nums">{slot.from}</span>
									{#if slot.mine}
										<span class="mt-0.5 block text-[10px] text-emerald-700">✓</span>
									{:else if slot.taken}
										<span class="mt-0.5 block text-[10px]">{m.bath_taken()}</span>
									{:else if slot.closed}
										<span class="mt-0.5 block text-[10px]">{m.bath_closed_slot()}</span>
									{/if}
								</label>
							</li>
						{/each}
					</ul>
				{/each}

				<button
					type="submit"
					disabled={!picked[keyOf(bath.bath_id)]}
					class="mt-4 w-full rounded-lg bg-brand-800 px-4 py-3 text-sm font-medium text-white
						disabled:bg-stone-200 disabled:text-stone-400">
					{m.bath_submit()}
				</button>
			</form>
		</section>
	{/each}
{/if}

<p class="mt-6 text-center">
	<a class="text-sm text-brand-800 underline" href="/r">{m.bath_back()}</a>
</p>
