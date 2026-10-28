<script lang="ts">
	// ① ご予約内容。登録の連絡先は伏せて表示し、修正の欄は空にして上書き入力にする（docs/pre-checkin.md §4）。
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate } from '$lib/precheckin';

	let { data, form } = $props();
	const ctx = $derived(data.ctx!);
	const a = $derived(ctx.answers ?? {});
	const fields = $derived([
		{ key: 'name', label: m.ci_field_name(), value: ctx.guest.name, type: 'text', auto: 'name' },
		{ key: 'name_kana', label: m.ci_field_name_kana(), value: ctx.guest.nameKana, type: 'text', auto: 'off' },
		{ key: 'phone', label: m.ci_field_phone(), value: ctx.guest.phoneMasked, type: 'tel', auto: 'tel' },
		{ key: 'email', label: m.ci_field_email(), value: ctx.guest.emailMasked, type: 'email', auto: 'email' }
	] as const);
	const errorText = $derived(
		!form?.error ? '' : form.error === 'closed' ? m.ci_err_closed() : form.error === 'invalid_params' ? m.ci_err_field() : m.ci_err_save()
	);
	const ro = $derived(!ctx.editable);
	const inputCls = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[16px] disabled:bg-stone-100';
</script>

<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
		<dt class="text-stone-500">{m.ci_booking_code()}</dt>
		<dd class="font-medium">{ctx.bookingCode}</dd>
		<dt class="text-stone-500">{m.ci_stay()}</dt>
		<dd>{m.ci_stay_value({ checkIn: slashDate(ctx.checkIn), nights: String(ctx.nights), checkOut: slashDate(ctx.checkOut) })}</dd>
		<dt class="text-stone-500">{m.ci_guests()}</dt>
		<dd>{m.ci_guests_value({ adults: String(ctx.adults), children: String(ctx.children), rooms: String(ctx.roomCount) })}</dd>
	</dl>
</section>

<form method="POST" action="?/save" use:enhance class="mt-4 space-y-4">
	<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
		<p class="leading-relaxed">{m.ci_basic_lead()}</p>
		<p class="mt-1 text-xs text-stone-500">{m.ci_masked_note()}</p>
		<div class="mt-3 space-y-4">
			{#each fields as f (f.key)}
				<div>
					<div class="flex items-baseline justify-between gap-2">
						<span class="font-medium">{f.label}</span>
						<span class="truncate text-xs text-stone-500">{m.ci_registered()}: {f.value || '—'}</span>
					</div>
					<input
						name="contact_{f.key}"
						type={f.type}
						autocomplete={f.auto}
						maxlength={f.key === 'email' ? 254 : 100}
						placeholder={m.ci_correction_placeholder()}
						value={a.contact?.[f.key] ?? ''}
						disabled={ro}
						class={inputCls}
						aria-label={f.label}
					/>
				</div>
			{/each}
		</div>
	</section>

	<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
		<h2 class="font-semibold">{m.ci_section_arrival()}</h2>
		<div class="mt-3 grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-stone-600">{m.ci_arrival()}</span>
				<input name="arrival_time" type="time" step="900" value={a.arrival_time ?? ''} disabled={ro} class={inputCls} />
			</label>
			<label class="block">
				<span class="text-stone-600">{m.ci_companions()}</span>
				<input name="companions" type="number" min="0" max="50" inputmode="numeric" value={a.companions ?? ''} disabled={ro} class={inputCls} />
			</label>
		</div>
		<label class="mt-3 block">
			<span class="text-stone-600">{m.ci_allergies()}</span>
			<textarea name="allergies" rows="2" maxlength="1000" disabled={ro} class={inputCls}>{a.allergies ?? ''}</textarea>
		</label>
		<label class="mt-3 block">
			<span class="text-stone-600">{m.ci_requests()}</span>
			<textarea name="requests" rows="3" maxlength="1000" disabled={ro} class={inputCls}>{a.requests ?? ''}</textarea>
		</label>
	</section>

	{#if errorText}
		<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200" role="alert">{errorText}</p>
	{/if}

	{#if ro}
		<a href={localizeHref('/ci/meals')} class="block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_step_meals()}</a>
	{:else}
		<button type="submit" class="w-full rounded-xl bg-stone-900 py-3 text-sm font-medium text-white">{m.ci_save_next()}</button>
	{/if}
</form>
