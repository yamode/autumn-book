<script lang="ts">
	// ① ご予約内容。登録の内容を欄に入れてグレーで見せ（確認だけ）、違うときだけ「変更」を押してその欄を直す（2026-11-14）。
	// 連絡先に続けて、伺い書の項目（郵便番号・住所〈必須〉・生年月日〈必須〉・領収書宛名）も同じ形で出す。PMS の顧客マスタにあれば最初から入れる。
	// 登録の内容が無い欄は最初から入力欄（住所・生年月日は必須）。
	// 電話・メールは伏せた形で見せ、「変更」で空欄にして新しい内容を入れてもらう（伏せた値は直せないため）。
	// 直した欄だけ送る（disabled の欄はフォームに乗らない）。修正は book.precheckins.answers.contact に入り、PMS の顧客マスタは書き換えない。
	// 同伴人数・アレルギー・ご要望は聞かない。代わりに宿からの質問（施設ごと・book.precheckin_questions）に必ず答えてもらう（2026-11-14）。
	// 予約番号は OTA の番号（無ければ行ごと出さない）。泊数は PMS で連結した予約を通した数。部屋タイプは「ご宿泊」の次の行。
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate, type PcGuestInfo } from '$lib/precheckin';
	import type { FullAutoFill } from 'svelte/elements';

	let { data, form } = $props();
	const ctx = $derived(data.ctx!);
	const a = $derived(ctx.answers ?? {});
	// PMS の顧客マスタ（core.guests）の 郵便番号・住所・生年月日・領収書宛名（book.precheckin_guest_profile）
	const p = $derived<PcGuestInfo>(data.profile ?? {});
	type Key = 'name' | 'name_kana' | 'phone' | 'email' | 'zip' | 'address' | 'birthdate' | 'receipt_name';
	type Field = {
		key: Key;
		/** フォームの name（連絡先は contact_、伺い書の項目は guest_） */
		name: string;
		label: string;
		/** 欄に出す登録の内容 */
		shown: string;
		/** 「変更」で入力欄に最初から入れる値（伏せた電話・メールは空） */
		raw: string;
		type: string;
		auto: FullAutoFill;
		max: number;
		required?: boolean;
		placeholder?: string;
	};
	const fields = $derived<Field[]>([
		{ key: 'name', name: 'contact_name', label: m.ci_field_name(), shown: ctx.guest.name, raw: ctx.guest.name, type: 'text', auto: 'name', max: 100 },
		{ key: 'name_kana', name: 'contact_name_kana', label: m.ci_field_name_kana(), shown: ctx.guest.nameKana, raw: ctx.guest.nameKana, type: 'text', auto: 'off', max: 100 },
		{ key: 'phone', name: 'contact_phone', label: m.ci_field_phone(), shown: ctx.guest.phoneMasked, raw: '', type: 'tel', auto: 'tel', max: 100 },
		{ key: 'email', name: 'contact_email', label: m.ci_field_email(), shown: ctx.guest.emailMasked, raw: '', type: 'email', auto: 'email', max: 254 },
		{ key: 'zip', name: 'guest_zip', label: m.ci_guest_zip(), shown: p.zip ?? '', raw: p.zip ?? '', type: 'text', auto: 'postal-code', max: 20 },
		{ key: 'address', name: 'guest_address', label: m.ci_guest_address(), shown: p.address ?? '', raw: p.address ?? '', type: 'text', auto: 'street-address', max: 300, required: true },
		{ key: 'birthdate', name: 'guest_birthdate', label: m.ci_guest_birthdate(), shown: p.birthdate ? slashDate(p.birthdate) : '', raw: p.birthdate ?? '', type: 'date', auto: 'bday', max: 10, required: true },
		{ key: 'receipt_name', name: 'guest_receipt_name', label: m.ci_guest_receipt(), shown: p.receipt_name ?? '', raw: p.receipt_name ?? '', type: 'text', auto: 'off', max: 100, placeholder: m.ci_guest_receipt_placeholder() }
	]);
	const savedOf = (k: Key): string =>
		(k === 'name' || k === 'name_kana' || k === 'phone' || k === 'email' ? a.contact?.[k] : a.guest?.[k]) ?? '';
	// 変更中の欄。前に直して保存した欄と、登録の内容が無い欄は、最初から入力欄にする
	let editing = $state<Partial<Record<Key, boolean>>>({});
	let draft = $state<Partial<Record<Key, string>>>({});
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		seeded = true;
		for (const f of fields) {
			const saved = savedOf(f.key);
			if (saved) {
				editing[f.key] = true;
				draft[f.key] = saved;
			}
		}
	});
	/** 登録の内容が無い欄は「変更」を出さず、いつも入力欄 */
	const alwaysInput = (f: Field) => !f.shown;
	function startEdit(f: Field) {
		editing[f.key] = true;
		draft[f.key] = draft[f.key] ?? f.raw;
		queueMicrotask(() => document.getElementById(`ci-${f.key}`)?.focus());
	}
	function cancelEdit(key: Key) {
		editing[key] = false;
		draft[key] = undefined;
	}
	const questions = $derived(data.questions ?? []);
	const answerOf = (id: string) => a.questions?.find((x) => x.id === id)?.answer ?? '';
	const missingId = $derived(form?.error === 'question_required' ? (form.field ?? null) : null);
	const missingGuest = $derived(form?.error === 'guest_required' || form?.error === 'invalid_params' ? (form.field ?? null) : null);
	const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
	// 部屋タイプ（複数室は「和室・洋室」、同じタイプが続けば「和室 ×2」）
	const roomTypes = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const r of ctx.rooms) if (r.label) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
		return [...counts].map(([l, n]) => (n > 1 ? `${l} ×${n}` : l)).join('・');
	});
	const errorText = $derived(
		!form?.error
			? ''
			: form.error === 'closed'
				? m.ci_err_closed()
				: form.error === 'question_required'
					? m.ci_err_question()
					: form.error === 'guest_required'
						? m.ci_err_guest()
					: form.error === 'invalid_params'
						? m.ci_err_field()
						: m.ci_err_save()
	);
	const ro = $derived(!ctx.editable);
	const inputCls = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[16px] disabled:bg-stone-100';
	const fixedCls = 'w-full rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-[16px] text-stone-600';
</script>

<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
		{#if ctx.bookingCode}
			<dt class="text-stone-500">{m.ci_booking_code()}</dt>
			<dd class="font-medium">{ctx.bookingCode}</dd>
		{/if}
		<dt class="text-stone-500">{m.ci_stay()}</dt>
		<dd>{m.ci_stay_nights({ checkIn: slashDate(ctx.checkIn), nights: String(ctx.nights) })}</dd>
		{#if roomTypes}
			<dt class="text-stone-500">{m.ci_room_type()}</dt>
			<dd>{roomTypes}</dd>
		{/if}
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
				{@const open = (editing[f.key] || alwaysInput(f)) && !ro}
				<div>
					<div class="flex items-center justify-between gap-2">
						<label for="ci-{f.key}" class="font-medium">
							{f.label}
							{#if f.required && alwaysInput(f)}
								<span class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-normal text-red-700 ring-1 ring-red-200">{m.ci_required()}</span>
							{/if}
						</label>
						{#if !ro && !alwaysInput(f)}
							{#if editing[f.key]}
								<button type="button" onclick={() => cancelEdit(f.key)} class="text-xs text-stone-500 underline">{m.ci_edit_cancel()}</button>
							{:else}
								<button
									type="button"
									onclick={() => startEdit(f)}
									class="rounded-md bg-white px-2.5 py-1 text-xs text-stone-700 ring-1 ring-stone-300"
									aria-label={m.ci_edit_field({ field: f.label })}>{m.ci_edit()}</button
								>
							{/if}
						{/if}
					</div>
					{#if open}
						<input
							id="ci-{f.key}"
							name={f.name}
							type={f.type}
							autocomplete={f.auto}
							maxlength={f.max}
							min={f.type === 'date' ? '1900-01-01' : undefined}
							max={f.type === 'date' ? today : undefined}
							required={f.required && alwaysInput(f)}
							placeholder={f.placeholder ?? (f.raw === '' && f.shown ? m.ci_new_value_placeholder() : '')}
							bind:value={draft[f.key]}
							aria-invalid={missingGuest === f.key}
							class="{inputCls} {missingGuest === f.key ? 'border-red-400 ring-1 ring-red-300' : ''}"
						/>
						{#if f.raw === '' && f.shown}
							<p class="mt-1 text-xs text-stone-500">{m.ci_registered()}: {f.shown}</p>
						{/if}
					{:else}
						<input id="ci-{f.key}" type="text" value={f.shown || '—'} disabled class="mt-1 {fixedCls}" />
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
		<h2 class="font-semibold">{m.ci_section_arrival()}</h2>
		<label class="mt-3 block">
			<span class="text-stone-600">{m.ci_arrival()}</span>
			<input name="arrival_time" type="time" step="900" value={a.arrival_time ?? ''} disabled={ro} class={inputCls} />
		</label>
	</section>

	{#if questions.length}
		<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
			<h2 class="font-semibold">{m.ci_section_questions()}</h2>
			<div class="mt-3 space-y-4">
				{#each questions as q (q.id)}
					<label class="block">
						<span class="whitespace-pre-wrap leading-relaxed text-stone-800">{q.question}</span>
						<span class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 ring-1 ring-red-200">{m.ci_required()}</span>
						<textarea
							name="q|{q.id}"
							rows="2"
							maxlength="1000"
							required
							disabled={ro}
							aria-invalid={missingId === q.id}
							class="{inputCls} {missingId === q.id ? 'border-red-400 ring-1 ring-red-300' : ''}">{answerOf(q.id)}</textarea
						>
					</label>
				{/each}
			</div>
		</section>
	{/if}

	{#if errorText}
		<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200" role="alert">{errorText}</p>
	{/if}

	{#if ro}
		<a href={localizeHref('/ci/meals')} class="block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_step_meals()}</a>
	{:else}
		<button type="submit" class="w-full rounded-xl bg-stone-900 py-3 text-sm font-medium text-white">{m.ci_save_next()}</button>
	{/if}
</form>
