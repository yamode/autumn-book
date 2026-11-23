<script lang="ts">
	import { enhance } from '$lib/enhance';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { CHEF_STATUS_LABEL, chefOpenSlotsOnDayOff, type ChefStatus } from '$lib/chef';

	let { data, form } = $props();

	const slotOf = (chefId: string, date: string) => data.slots.find((s) => s.chef_staff_id === chefId && s.date === date);
	const weekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
	const dayLabel = (date: string) => `${Number(date.slice(8))}日（${'日月火水木金土'[weekday(date)]}）`;
	const monthLabel = $derived(`${data.month.slice(0, 4)}年${Number(data.month.slice(5))}月`);
	const openCount = $derived(data.slots.filter((s) => s.status === 'open').length);
	// 開いている枠とシフトの「休み」が重なっている枠（あとからシフトで休みにされたもの）。赤で目立たせ、上に件数を出す
	const offConflicts = $derived(data.taskulError ? [] : chefOpenSlotsOnDayOff(data.slots, data.shifts, data.today));
	const conflictIds = $derived(new Set(offConflicts.map((s) => s.id)));
</script>

<svelte:head><title>出張シェフ・受付枠 ｜ 山人管理</title></svelte:head>

<PageHeader
	title="出張シェフ・受付枠"
	facility="山人-yamado-（西和賀）"
	description="シェフごとに、受け付ける日を開けます。開けた日はお客さまの予約カレンダーに出ます（申し込みは利用日の7日前まで）。taskul のシフトで休みの日は開けられません。予約が入っている枠は、予約をお断り・取消するまで閉じられません。"
>
	{#snippet actions()}
		<a href="/admin/chef/reservations" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">予約一覧 →</a>
	{/snippet}
</PageHeader>

{#if data.unavailable}
	<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{data.unavailable}</p>
{:else}
	{#if data.taskulError}<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{data.taskulError}</p>{/if}
	{#if offConflicts.length}
		<p class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
			受付中の枠のうち {offConflicts.length}件 が、taskul のシフトで休みになっています（赤い枠）。閉じるか、シフトを直してください。
		</p>
	{/if}
	{#if form?.message && !form?.key}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

	<div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
		<a href="?month={data.prev}" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50" aria-label="前の月">←</a>
		<span class="font-medium text-stone-800">{monthLabel}</span>
		<a href="?month={data.next}" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50" aria-label="次の月">→</a>
		<span class="text-xs text-stone-500">受付中の枠 {openCount}件</span>
	</div>

	{#if data.chefs.length === 0}
		<p class="rounded-lg border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-500">対応できるシェフがいません。</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
			<table class="w-full min-w-[640px] text-sm">
				<thead class="bg-stone-50 text-xs text-stone-500">
					<tr>
						<th class="w-28 px-3 py-2 text-left font-normal">日付</th>
						{#each data.chefs as chef (chef.id)}<th class="px-3 py-2 text-left font-normal">{chef.name}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each data.days as date (date)}
						{@const past = date < data.today}
						<tr class="border-t border-stone-100 align-top {past ? 'bg-stone-50/60 text-stone-400' : ''}">
							<td class="px-3 py-2 whitespace-nowrap {weekday(date) === 0 ? 'text-red-600' : weekday(date) === 6 ? 'text-sky-700' : ''}">
								{dayLabel(date)}{#if date === data.today}<span class="ml-1 text-xs text-emerald-700">今日</span>{/if}
							</td>
							{#each data.chefs as chef (chef.id)}
								{@const key = `${chef.id}|${date}`}
								{@const slot = slotOf(chef.id, date)}
								{@const booked = slot ? data.booked[slot.id] : undefined}
								{@const shift = data.shifts[key]}
								{@const off = shift?.kind === 'off'}
								{@const conflict = !!slot && conflictIds.has(slot.id)}
								<td class="px-3 py-2 {conflict ? 'bg-red-50 ring-2 ring-red-400 ring-inset' : ''}">
									<div class="flex flex-wrap items-center gap-1.5 text-xs">
										{#if slot?.status === 'open'}
											<span class="rounded px-1.5 py-0.5 {conflict ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'}">受付中{conflict ? '（休みと重複）' : ''}</span>
										{:else if slot}
											<span class="rounded bg-stone-100 px-1.5 py-0.5 text-stone-500">閉じた</span>
										{/if}
										{#if !data.taskulError}
											{#if off}
												<span class="rounded bg-red-50 px-1.5 py-0.5 text-red-700">休み：{shift.label}</span>
											{:else if shift?.kind === 'work'}
												<span class="text-stone-500">出勤{shift.label ? `（${shift.label}）` : ''}</span>
											{:else if !past}
												<span class="text-amber-700">シフト未作成</span>
											{/if}
										{/if}
									</div>
									{#if booked}
										<a href="/admin/chef/reservations/{booked.id}" class="mt-1 block text-xs text-brand-800 underline">
											予約あり：{booked.name} 様（{CHEF_STATUS_LABEL[booked.status as ChefStatus] ?? booked.status}）
										</a>
									{/if}
									{#if !past || slot}
										<form method="POST" action="?/slot" use:enhance class="mt-1.5 flex flex-wrap items-center gap-1.5">
											<input type="hidden" name="date" value={date} />
											<input type="hidden" name="chefId" value={chef.id} />
											<input
												name="note"
												value={slot?.note ?? ''}
												maxlength="1000"
												placeholder="メモ"
												aria-label="{dayLabel(date)} {chef.name} のメモ"
												class="w-28 min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 text-xs"
											/>
											{#if slot?.status === 'open'}
												{#if !past}<button name="status" value="open" class="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">メモ保存</button>{/if}
												<button name="status" value="closed" class="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50">閉じる</button>
											{:else if !past}
												{#if slot}<button name="status" value="closed" class="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">メモ保存</button>{/if}
												<button
													name="status"
													value="open"
													disabled={off || !!data.taskulError}
													title={off ? '休みの日は開けられません' : data.taskulError ? 'taskul に接続できないため開けられません' : ''}
													class="rounded bg-brand-800 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-stone-300"
												>開ける</button>
											{/if}
										</form>
									{/if}
									{#if form?.key === key}
										<p class="mt-1 text-xs {'ok' in form && form.ok ? (form.warning ? 'text-amber-700' : 'text-emerald-700') : 'text-red-700'}">
											{form.message}{#if 'warning' in form && form.warning}<br />{form.warning}{/if}
										</p>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}
