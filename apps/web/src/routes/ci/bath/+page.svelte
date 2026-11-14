<script lang="ts">
	// ③ 貸切風呂（任意）。この画面の中で予約・取消まで行う（2026-11-14。以前は /r/bath へ案内するだけ）。
	// 時間を選ぶ目安として、選んだ夕食・朝食の時間に所要時間の目安（book.precheckin_settings・既定 夕食 120 分／朝食 60 分）を
	// 足した時間帯を上に出し、重なる枠には「お食事と重なります」を付ける（選べなくはしない）。
	// 空き・上限・締切・料金・取消期限の正は RPC（/r/bath と同じ）。ここで外すのは画面の見た目だけ。
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate } from '$lib/precheckin';
	import { mealWindows, overlapsMeal } from '$lib/precheckin-p3';

	let { data, form } = $props();
	const ctx = $derived(data.ctx!);
	const bath = $derived(data.bath);
	const bc = $derived(bath.ctx);

	const windows = $derived(mealWindows(ctx.rooms, data.mealMinutes));
	const hasMeal = $derived(ctx.rooms.some((r) => r.nights.some((n) => n.dinner.offered || n.breakfast.offered)));
	const typeLabel = (t: 'dinner' | 'breakfast') => (t === 'dinner' ? m.ci_dinner() : m.ci_breakfast());

	const baths = $derived(bc?.baths ?? []);
	const mine = $derived([...(bc?.mine ?? [])].sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from)));
	const bathName = (id: string | null) => baths.find((b) => (b.bath_id ?? '') === (id ?? ''))?.bath_name ?? '';

	let pickedBath = $state<string | null>(null);
	// 選んだ枠（'YYYY-MM-DD|HH:MM'）
	let picked = $state('');
	const unit = $derived((pickedBath === null ? null : baths.find((b) => (b.bath_id ?? '') === pickedBath)) ?? baths[0]);
	const bookable = (s: { taken: boolean; closed: boolean; limit_reached?: boolean }) => !s.taken && !s.closed && s.limit_reached !== true;
	const isMorning = (from: string) => Number(from.slice(0, 2)) < 12;
	// 日付×午前/午後ごとのまとまり（1 部屋で時間帯ごとに 1 枠ずつ取れる＝当日の夜と翌朝はそれぞれ取れる）。
	// その時間帯を取ってあれば「予約済み」、枠が全部埋まっていれば「空きなし」を出す
	const groups = $derived(
		(unit?.days ?? []).flatMap((d) =>
			[false, true]
				.map((morning) => {
					const all = d.slots.filter((s) => isMorning(s.from) === morning);
					const done = mine.some((r) => r.date === d.date && isMorning(r.from) === morning) || (all.length > 0 && all.every((s) => s.limit_reached === true));
					return { key: `${d.date}|${morning ? 'am' : 'pm'}`, date: d.date, morning, done, any: all.length > 0, slots: all.filter(bookable) };
				})
				// 取ってある時間帯は上の「ご予約済みの時間」に出ているので、ここには出さない
				.filter((g) => g.any && !g.done)
				.sort((x, y) => (x.morning === y.morning ? 0 : x.morning ? -1 : 1))
		)
	);
	const pickedDate = $derived(picked.split('|')[0] ?? '');
	const pickedFrom = $derived(picked.split('|')[1] ?? '');
	$effect(() => {
		if (picked && !groups.some((g) => g.slots.some((s) => `${g.date}|${s.from}` === picked))) picked = '';
	});

	const errorText = $derived.by(() => {
		const e = form?.error;
		if (!e) return '';
		if (e === 'slot_taken') return m.bath_err_taken();
		if (e === 'per_room_limit') return bc?.group?.shared ? m.bath_err_limit_group() : m.bath_err_limit();
		if (e === 'past_cutoff') return m.bath_err_cutoff();
		if (e === 'slot_unavailable') return m.bath_err_unavailable();
		if (e === 'choose') return m.bath_choose();
		if (e === 'not_open') return m.bath_closed();
		if (e === 'cancel_failed') return m.ci_bath_cancel_failed();
		return m.bath_err_generic();
	});
	const selectCls = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[16px]';
	const dayLabel = (date: string, morning: boolean) => `${slashDate(date)} ${morning ? m.ci_bath_morning() : m.ci_bath_afternoon()}`;
</script>

<section class="rounded-2xl bg-white p-5 text-sm shadow-sm">
	<h2 class="text-base font-semibold">{m.ci_step_bath()}</h2>
	<p class="mt-2 leading-relaxed">{m.ci_bath_lead()}</p>

	{#if hasMeal}
		<div class="mt-4 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
			<h3 class="text-xs font-semibold text-stone-600">{m.ci_meal_window_title()}</h3>
			{#if windows.length}
				<ul class="mt-1.5 space-y-1">
					{#each windows as w (w.key)}
						<li class="flex flex-wrap items-baseline gap-x-2">
							<span class="whitespace-nowrap text-stone-600">{slashDate(w.date)} {typeLabel(w.type)}</span>
							<span class="whitespace-nowrap font-medium">{m.ci_meal_window_row({ from: w.from, to: w.to, minutes: String(w.minutes) })}</span>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-xs leading-relaxed text-stone-500">{m.ci_meal_window_note()}</p>
			{:else}
				<p class="mt-1 text-stone-500">{m.ci_meal_window_unset()}</p>
			{/if}
		</div>
	{/if}

	{#if form && 'reserved' in form && form.reserved}
		<p class="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800 ring-1 ring-emerald-200" role="status">
			{m.ci_bath_reserved({ date: slashDate(form.reserved.date), from: form.reserved.from })}
		</p>
	{:else if form && 'canceled' in form && form.canceled}
		<p class="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-stone-700 ring-1 ring-stone-200" role="status">{m.bath_canceled()}</p>
	{/if}
	{#if errorText}
		<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700 ring-1 ring-red-200" role="alert">{errorText}</p>
	{/if}

	{#if bath.state === 'ready' && bc}
		<h3 class="mt-4 text-xs font-semibold text-stone-500">{m.ci_bath_mine()}</h3>
		{#if mine.length}
			<ul class="mt-1 divide-y divide-stone-100">
				{#each mine as r (r.id)}
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{slashDate(r.date)}
							<span class="font-medium">{r.from}{r.to ? `–${r.to}` : ''}</span>
							{#if baths.length > 1 && bathName(r.bath_id)}<span class="ml-1 text-stone-500">{bathName(r.bath_id)}</span>{/if}
						</span>
						{#if r.cancelable}
							<form method="POST" action="?/cancel" use:enhance>
								<input type="hidden" name="slotId" value={r.id} />
								<button
									type="submit"
									class="rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-300"
									onclick={(e) => {
										if (!confirm(m.bath_cancel_confirm())) e.preventDefault();
									}}>{m.bath_cancel()}</button
								>
							</form>
						{:else}
							<span class="text-xs text-stone-400">{m.bath_cancel_closed()}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-stone-500">{m.ci_bath_none()}</p>
		{/if}

		<form method="POST" action="?/reserve" use:enhance class="space-y-3 {groups.length || !mine.length ? 'mt-4 border-t border-stone-100 pt-4' : ''}">
			<input type="hidden" name="bathId" value={unit?.bath_id ?? ''} />
			{#if baths.length > 1}
				<label class="block">
					<span class="text-stone-600">{m.ci_bath_pick_bath()}</span>
					<select class={selectCls} value={unit?.bath_id ?? ''} onchange={(e) => (pickedBath = e.currentTarget.value)}>
						{#each baths as b (b.bath_id ?? '')}
							<option value={b.bath_id ?? ''}>{b.bath_name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<input type="hidden" name="date" value={pickedDate} />
			<input type="hidden" name="from" value={pickedFrom} />
			{#if groups.length === 0}
				{#if mine.length === 0}
					<p class="rounded-lg bg-stone-50 px-3 py-2 text-stone-600 ring-1 ring-stone-200">{m.ci_bath_no_slots()}</p>
				{/if}
			{:else}
				{#each groups as g (g.key)}
					<fieldset>
						<legend class="font-medium text-stone-700">{dayLabel(g.date, g.morning)}</legend>
						{#if g.slots.length === 0}
							<p class="mt-1 text-xs text-stone-500">{m.ci_bath_no_slots()}</p>
						{:else}
							<div class="mt-1.5 grid grid-cols-2 gap-2">
								{#each g.slots as s (s.from)}
									{@const v = `${g.date}|${s.from}`}
									{@const overlap = overlapsMeal(g.date, s.from, s.to, windows)}
									<label
										class="flex cursor-pointer flex-col rounded-lg px-3 py-2 ring-1 {picked === v
											? 'bg-stone-900 text-white ring-stone-900'
											: 'bg-white ring-stone-300'}"
									>
										<input type="radio" name="slot" value={v} bind:group={picked} class="sr-only" />
										<span class="font-medium">{s.from}–{s.to}</span>
										{#if overlap}
											<span class="text-[11px] {picked === v ? 'text-amber-200' : 'text-amber-700'}">{m.ci_bath_overlap()}</span>
										{/if}
									</label>
								{/each}
							</div>
						{/if}
					</fieldset>
				{/each}
				{#if (bc.price_yen ?? 0) > 0}
					<p class="text-xs text-stone-500">{m.ci_bath_price({ price: m.bath_price_per_booking({ price: (bc.price_yen ?? 0).toLocaleString('ja-JP') }) })}</p>
				{/if}
				{#if groups.some((g) => !g.done && g.slots.length)}
					<button type="submit" disabled={!picked} class="w-full rounded-xl bg-stone-900 py-3 text-sm font-medium text-white disabled:opacity-40">
						{m.ci_bath_submit()}
					</button>
				{/if}
			{/if}
		</form>
	{:else}
		<p class="mt-4 rounded-lg bg-stone-50 px-3 py-2 leading-relaxed text-stone-700 ring-1 ring-stone-200">
			{bath.state === 'not_answered'
				? m.ci_bath_not_answered()
				: bath.state === 'not_yet'
					? m.ci_bath_not_yet()
					: m.ci_bath_unavailable()}
		</p>
	{/if}
</section>

<div class="mt-4 flex gap-3">
	<a href={localizeHref('/ci/meals')} class="flex-1 rounded-xl bg-white py-3 text-center text-sm text-stone-700 ring-1 ring-stone-300">{m.ci_back()}</a>
	{#if bath.state !== 'not_answered'}
		<a href={localizeHref('/ci/done')} class="flex-[2] rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_next()}</a>
	{/if}
</div>
