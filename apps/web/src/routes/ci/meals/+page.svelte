<script lang="ts">
	// ② 夕食・朝食の時間。連泊は泊ごと、複数室は部屋ごとに選ぶ。混み合っている時間（PMS で満席にした・受付上限）は「（選択不可）」で選べない（今の時間は残す）。
	// 部屋名は出さない（部屋タイプは ① に出す）。複数室のときだけ「1室目」の見出し。次は ③ 貸切風呂なので、ボタンは「保存して次へ」（2026-11-14）。
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { hasAnyMeal, slashDate, slotSelectable, type PcMealType } from '$lib/precheckin';

	let { data, form } = $props();
	const ctx = $derived(data.ctx!);
	const ro = $derived(!ctx.editable);
	const anyMeal = $derived(hasAnyMeal(ctx.rooms));
	const types: PcMealType[] = ['dinner', 'breakfast'];
	const typeLabel = (t: PcMealType) => (t === 'dinner' ? m.ci_dinner() : m.ci_breakfast());
	const errorText = $derived(
		!form?.error
			? ''
			: form.error === 'slot_full'
				? m.ci_err_slot_full({ time: form.time ?? '' })
				: form.error === 'invalid_meal'
					? m.ci_err_invalid_meal()
					: form.error === 'closed'
						? m.ci_err_closed()
						: m.ci_err_save()
	);
	const selectCls = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[16px] disabled:bg-stone-100';
</script>

<form method="POST" action="?/save" use:enhance class="space-y-4">
	<p class="text-sm leading-relaxed">{anyMeal ? m.ci_meals_lead() : m.ci_no_meals()}</p>

	{#each ctx.rooms as room (room.stayId)}
		<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
			{#if ctx.rooms.length > 1}
				<h2 class="font-semibold">{m.ci_room_n({ n: String(room.index) })}</h2>
			{/if}
			{#each room.nights as night (night.nightDate + night.stayId)}
				<div class="mt-3 border-t border-stone-100 pt-3 first:mt-1 first:border-0 first:pt-0">
					<p class="text-xs text-stone-500">{m.ci_night_of({ date: slashDate(night.nightDate) })}</p>
					<!-- 夕食・朝食は 1 行ずつ（左に見出し、右に時間）。2 列だと狭い画面で日付と時間が窮屈になる -->
					<div class="mt-2 space-y-2">
						{#each types as t (t)}
							{@const cell = night[t]}
							<label class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
								<span class="leading-tight text-stone-700">{typeLabel(t)}<span class="block text-xs text-stone-400">{slashDate(cell.date)}</span></span>
								{#if cell.offered}
									<select name="meal|{night.stayId}|{t}|{cell.date}" disabled={ro} class={selectCls}>
										<option value="" selected={!cell.time}>{m.ci_meal_unset()}</option>
										{#each ctx.slots[t]?.[cell.date] ?? [] as slot (slot.time)}
											<option value={slot.time} selected={cell.time === slot.time} disabled={!slotSelectable(slot, cell.time)}>
												{slot.time}{slotSelectable(slot, cell.time) ? '' : `（${m.ci_meal_unselectable()}）`}
											</option>
										{/each}
										{#if cell.time && !(ctx.slots[t]?.[cell.date] ?? []).some((s) => s.time === cell.time)}
											<!-- 宿が決めた時間が時間枠に無いとき（PMS で個別に入れた等）も、今の時間として出す -->
											<option value={cell.time} selected>{cell.time}</option>
										{/if}
									</select>
								{:else}
									<p class="rounded-lg bg-stone-50 px-3 py-2 text-stone-500">{m.ci_meal_none()}</p>
								{/if}
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</section>
	{/each}

	{#if errorText}
		<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200" role="alert">{errorText}</p>
	{/if}

	<div class="flex gap-3">
		<a href={localizeHref('/ci')} class="flex-1 rounded-xl bg-white py-3 text-center text-sm text-stone-700 ring-1 ring-stone-300">{m.ci_back()}</a>
		{#if ro}
			<a href={localizeHref('/ci/bath')} class="flex-[2] rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_next()}</a>
		{:else}
			<button type="submit" class="flex-[2] rounded-xl bg-stone-900 py-3 text-sm font-medium text-white">{m.ci_save_next()}</button>
		{/if}
	</div>
</form>
