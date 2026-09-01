<script lang="ts">
	// 貸切風呂のご予約。
	//
	// 画面の作りは、現行の予約フォーム（talkappi の問い合わせフォーム）をそのまま踏襲する:
	//   概要（折りたたみ）→ STEP1 フォームのご入力 → STEP2 入力内容確認 → STEP3 送信完了
	//   入力は「日付」を選ぶと「時間帯」の選択肢が空き枠だけに絞られる、という順番。
	// 現行フォームにあった「お部屋番号」「メールアドレス」の欄は置かない ── どのお部屋の
	// ご予約かは QR のトークンで確定しており、控えはこの画面の「ご予約中の時間」で確認できるため。
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

	// ---- 入力の状態（確定するまでサーバへは送らない）----
	let step = $state<1 | 2>(1);
	let pickedBath = $state<string | null>(null); // null = 先頭の浴室
	let date = $state('');
	let from = $state('');

	const baths = $derived(ctx.baths ?? []);
	const bath = $derived(
		(pickedBath === null ? null : baths.find((b) => (b.bath_id ?? '') === pickedBath)) ?? baths[0]
	);
	const days = $derived(bath?.days ?? []);
	/** その日の「まだ取れる」枠だけ。埋まり・締切済みは選択肢に出さない（現行フォームと同じ）。 */
	const slots = $derived((days.find((d) => d.date === date)?.slots ?? []).filter((s) => !s.taken && !s.closed));
	const pickedSlot = $derived(slots.find((s) => s.from === from));
	const canConfirm = $derived(Boolean(date && from));

	// 送信が通ったら完了（STEP3）。失敗したら入力に戻して理由を出す。
	const done = $derived(form?.done === 'reserved');
	$effect(() => {
		if (form?.error) step = 1;
	});

	function onBathChange(v: string) {
		pickedBath = v;
		date = '';
		from = '';
	}
	function onDateChange(v: string) {
		date = v;
		from = '';
	}
	function reset() {
		step = 1;
		date = '';
		from = '';
	}

	const stepNo = $derived(done ? 3 : step);
	const STEPS = $derived([m.bath_step1(), m.bath_step2(), m.bath_step3()]);
</script>

<svelte:head><title>{c.title || m.bath_title()} ｜ YAMADO</title></svelte:head>

<div class="space-y-3 px-4 py-3">
	<!-- ============ 概要（折りたたみ） ============ -->
	<!-- 見出しは黒ヘッダーに出るので、ここでは繰り返さない -->
	<section class="overflow-hidden rounded-lg bg-white shadow-card">
		{#if ctx.ok && ctx.enabled}
			<details open class="group">
				<summary class="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-medium text-stone-800 marker:content-['']">
					{m.bath_overview()}
					<span class="text-stone-300 transition-transform group-open:rotate-180">▾</span>
				</summary>
				<div class="px-5 pb-5 text-[13px] leading-6 text-stone-600">
					<p class="whitespace-pre-line">{c.lead || m.bath_lead()}</p>
					<p class="mt-2">
						{#if (ctx.price_yen ?? 0) > 0}
							{m.bath_price_paid({ price: yen(ctx.price_yen ?? 0) })}
						{:else}
							{m.bath_price_free()}
						{/if}
					</p>
					{#if c.price_note}
						<p class="mt-1 whitespace-pre-line">{c.price_note}</p>
					{/if}
					<p class="mt-2 text-stone-400">{m.bath_limit({ count: ctx.per_room_per_range ?? 1 })}</p>
				</div>
			</details>
		{:else}
			<p class="px-5 pb-5 pt-3 text-sm text-stone-600">{m.bath_closed()}</p>
		{/if}
	</section>

	{#if photos.length}
		<section class="space-y-3">
			{#each photos as p (p.url)}
				<figure class="overflow-hidden rounded-lg bg-white shadow-card">
					<img src={p.url} alt={p.caption || m.bath_title()} class="w-full object-cover" loading="lazy" />
					{#if p.caption}
						<figcaption class="px-4 py-2 text-xs text-stone-500">{p.caption}</figcaption>
					{/if}
				</figure>
			{/each}
		</section>
	{/if}

	{#if ctx.ok && ctx.enabled}
		<!-- ============ ステップ表示 ============ -->
		<ol class="flex overflow-hidden rounded-lg text-[11px] shadow-card">
			{#each STEPS as label, i}
				{@const n = i + 1}
				<li
					class="step flex flex-1 flex-col items-center justify-center py-2 {n === stepNo
						? 'is-active bg-[#48575f] text-white'
						: 'bg-[#f6f7f9] text-[#a1a4aa]'}"
				>
					<span class="font-medium">STEP{n}</span>
					<span class="mt-0.5 leading-tight">{label}</span>
				</li>
			{/each}
		</ol>

		{#if form?.error}
			<p class="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorText(form.error)}</p>
		{/if}

		{#if done}
			<!-- ============ STEP3 送信完了 ============ -->
			<section class="rounded-lg bg-white px-5 py-6 text-center shadow-card">
				<p class="text-[15px] leading-7 text-stone-800">{c.done || m.bath_done()}</p>
				<button
					type="button"
					onclick={reset}
					class="mt-5 inline-block w-full max-w-[220px] rounded border border-[#48575f] py-2.5 text-sm text-[#48575f]"
				>{m.bath_new()}</button>
			</section>
		{:else if step === 1}
			<!-- ============ STEP1 フォームのご入力 ============ -->
			<section class="rounded-lg bg-white px-5 py-5 shadow-card">
				{#if baths.length > 1}
					<div class="mb-5">
						<div class="flex items-center gap-2">
							<span class="text-sm text-stone-900">{m.bath_field_bath()}</span>
							<span class="text-[11px] text-[#e53361]">※</span>
						</div>
						<select
							value={bath?.bath_id ?? ''}
							onchange={(e) => onBathChange((e.currentTarget as HTMLSelectElement).value)}
							class="mt-2 w-full rounded border border-[#e3e5e8] bg-white px-3 py-2 text-sm text-[#3d3f45]"
						>
							{#each baths as b (b.bath_id ?? 'default')}
								<option value={b.bath_id ?? ''}>{b.bath_name}</option>
							{/each}
						</select>
					</div>
				{/if}

				<div class="flex items-center gap-2">
					<span class="text-sm text-stone-900">{m.bath_field_datetime()}</span>
					<span class="text-[11px] text-[#e53361]">※</span>
				</div>

				<div class="mt-3 space-y-3">
					<label class="block">
						<span class="text-xs text-stone-400">{m.bath_label_date()}</span>
						<select
							value={date}
							onchange={(e) => onDateChange((e.currentTarget as HTMLSelectElement).value)}
							class="mt-1 w-full rounded border border-[#e3e5e8] bg-white px-3 py-2 text-sm text-[#3d3f45]"
						>
							<option value="" disabled>{m.bath_select_date()}</option>
							{#each days as d (d.date)}
								<option value={d.date}>{fmtDate(d.date)}</option>
							{/each}
						</select>
					</label>

					<label class="block">
						<span class="text-xs text-stone-400">{m.bath_label_time()}</span>
						<select
							bind:value={from}
							disabled={!date}
							class="mt-1 w-full rounded border border-[#e3e5e8] bg-white px-3 py-2 text-sm text-[#3d3f45] disabled:bg-stone-50 disabled:text-stone-300"
						>
							<option value="" disabled>{m.bath_select_time()}</option>
							{#each slots as s (s.from)}
								<option value={s.from}>{s.from}{s.to ? `-${s.to}` : ''}</option>
							{/each}
						</select>
					</label>

					{#if date && slots.length === 0}
						<p class="text-xs text-[#e53361]">{m.bath_no_slots()}</p>
					{/if}
				</div>

				<div class="mt-6 text-center">
					<button
						type="button"
						disabled={!canConfirm}
						onclick={() => (step = 2)}
						class="w-full max-w-[220px] rounded bg-[#48575f] py-3 text-[15px] text-white disabled:bg-stone-200 disabled:text-stone-400"
					>{m.bath_to_confirm()}</button>
				</div>
			</section>
		{:else}
			<!-- ============ STEP2 入力内容確認 ============ -->
			<section class="rounded-lg bg-white px-5 py-5 shadow-card">
				<dl class="divide-y divide-stone-100 text-sm">
					<div class="flex items-baseline justify-between py-2.5">
						<dt class="text-stone-400">{m.bath_room()}</dt>
						<dd class="font-medium text-stone-800">{ctx.room_code}</dd>
					</div>
					{#if baths.length > 1}
						<div class="flex items-baseline justify-between py-2.5">
							<dt class="text-stone-400">{m.bath_field_bath()}</dt>
							<dd class="font-medium text-stone-800">{bath?.bath_name}</dd>
						</div>
					{/if}
					<div class="flex items-baseline justify-between py-2.5">
						<dt class="text-stone-400">{m.bath_label_date()}</dt>
						<dd class="font-medium text-stone-800">{fmtDate(date)}</dd>
					</div>
					<div class="flex items-baseline justify-between py-2.5">
						<dt class="text-stone-400">{m.bath_label_time()}</dt>
						<dd class="font-medium tabular-nums text-stone-800">
							{from}{pickedSlot?.to ? `-${pickedSlot.to}` : ''}
						</dd>
					</div>
				</dl>

				<p class="mt-3 text-xs text-stone-500">
					{#if (ctx.price_yen ?? 0) > 0}
						{m.bath_price_paid({ price: yen(ctx.price_yen ?? 0) })}
					{:else}
						{m.bath_price_free()}
					{/if}
				</p>

				<form method="POST" action="?/reserve" use:enhance class="mt-6 text-center">
					<input type="hidden" name="bathId" value={bath?.bath_id ?? ''} />
					<input type="hidden" name="date" value={date} />
					<input type="hidden" name="from" value={from} />
					<button type="submit" class="w-full max-w-[220px] rounded bg-[#48575f] py-3 text-[15px] text-white">
						{m.bath_send()}
					</button>
				</form>
				<div class="mt-3 text-center">
					<button type="button" onclick={() => (step = 1)} class="text-sm text-stone-500 underline">
						{m.bath_back_edit()}
					</button>
				</div>
			</section>
		{/if}
	{/if}

	<!-- ============ ご予約中の時間 ============ -->
	<section class="rounded-lg bg-white px-5 py-5 shadow-card">
		<h2 class="text-sm font-medium text-stone-900">{m.bath_mine_title()}</h2>
		{#if form?.done === 'canceled'}
			<p class="mt-2 rounded bg-stone-100 px-3 py-2 text-sm text-stone-700">{m.bath_canceled()}</p>
		{/if}
		{#if !ctx.mine?.length}
			<p class="mt-2 text-sm text-stone-400">{m.bath_mine_empty()}</p>
		{:else}
			<ul class="mt-3 divide-y divide-stone-100">
				{#each ctx.mine as r (r.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
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
									class="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600"
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
		<p class="mt-4 whitespace-pre-line text-xs leading-5 text-stone-400">{c.notice || m.bath_note_phone()}</p>
	</section>
</div>

<style>
	/* 現行フォームのステップ表示（右向きの矢印でつなぐ帯）を写している */
	.step {
		position: relative;
	}
	.step + .step {
		padding-left: 10px;
	}
	.step:not(:last-child)::after {
		content: '';
		position: absolute;
		right: -9px;
		top: 0;
		bottom: 0;
		width: 0;
		height: 0;
		margin: auto 0;
		border-top: 24px solid transparent;
		border-bottom: 24px solid transparent;
		border-left: 9px solid #f6f7f9;
		z-index: 1;
	}
	.step.is-active:not(:last-child)::after {
		border-left-color: #48575f;
	}
</style>
