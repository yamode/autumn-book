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
	import { getLocale } from '$lib/paraglide/runtime';
	import { arrivalOptions, birthParts, daysInMonth, eraYear, joinBirth, slashDate, snapArrival, splitName, type PcProfile } from '$lib/precheckin';
	import type { FullAutoFill } from 'svelte/elements';

	let { data, form } = $props();
	const ctx = $derived(data.ctx!);
	const a = $derived(ctx.answers ?? {});
	// PMS の顧客マスタ（core.guests）の 郵便番号・住所・生年月日・領収書宛名（book.precheckin_guest_profile）
	const p = $derived<PcProfile>(data.profile ?? {});
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
		birth = birthParts(draft.birthdate);
		for (const k of PAIR_KEYS) {
			// 前に直して保存してあれば入力欄で開く。登録の内容が無い欄は最初から入力欄なので、そのまま
			if (a.contact?.[k] || a.contact?.[PAIR[k].fam]) editing[k] = true;
			pair[k] = pairInitial(k);
		}
	});
	// 氏名・フリガナは 姓 と 名 の 2 欄（2026-11-15）。顧客マスタが 姓名を分けて持つので、切れ目が分かる形で受け取る。
	// 最初に入れる値: 前に保存した修正 → 顧客マスタの分けた欄 → つなげた氏名を最初の空白で分けたもの
	type PairKey = 'name' | 'name_kana';
	const PAIR_KEYS: PairKey[] = ['name', 'name_kana'];
	const PAIR = {
		name: { fam: 'family_name', giv: 'given_name' },
		name_kana: { fam: 'family_name_kana', giv: 'given_name_kana' }
	} as const;
	const isPair = (k: Key): k is PairKey => k === 'name' || k === 'name_kana';
	let pair = $state<Record<PairKey, { a: string; b: string }>>({ name: { a: '', b: '' }, name_kana: { a: '', b: '' } });
	function pairInitial(k: PairKey): { a: string; b: string } {
		const { fam, giv } = PAIR[k];
		const c = a.contact ?? {};
		if (c[fam] || c[giv]) return { a: c[fam] ?? '', b: c[giv] ?? '' };
		if (c[k]) {
			const s = splitName(c[k]);
			return { a: s.family, b: s.given };
		}
		if (p[fam] || p[giv]) return { a: p[fam] ?? '', b: p[giv] ?? '' };
		const s = splitName(k === 'name' ? ctx.guest.name : ctx.guest.nameKana);
		return { a: s.family, b: s.given };
	}
	// 生年月日は 年・月・日 の選択欄（2026-11-15）。日付の入力欄（type=date）は iPhone で枠からはみ出し、
	// 年をさかのぼるのに手間がかかるため。送るのは隠し欄の 'YYYY-MM-DD'（3 つそろったときだけ）
	let birth = $state({ y: '', m: '', d: '' });
	const thisYear = Number(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 4));
	const birthYears = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => thisYear - i);
	const birthDays = $derived(daysInMonth(birth.y, birth.m));
	const withEra = getLocale() === 'ja';
	$effect(() => {
		// 月・年を変えて無い日になったら、日を選び直してもらう
		if (Number(birth.d) > birthDays) birth.d = '';
	});
	$effect(() => {
		draft.birthdate = joinBirth(birth.y, birth.m, birth.d);
	});
	// 到着予定時刻は 15:00 以降・30 分単位の選択欄。前に答えた時刻 → PMS の予約の到着予定時刻（選択肢に寄せる）
	const arrivals = arrivalOptions();
	const arrival0 = $derived(snapArrival(a.arrival_time ?? p.arrival_time));
	/** 登録の内容が無い欄は「変更」を出さず、いつも入力欄 */
	const alwaysInput = (f: Field) => !f.shown;
	function startEdit(f: Field) {
		editing[f.key] = true;
		draft[f.key] = draft[f.key] ?? f.raw;
		if (isPair(f.key)) pair[f.key] = pairInitial(f.key);
		if (f.key === 'birthdate') {
			draft.birthdate = draft.birthdate || f.raw;
			birth = birthParts(draft.birthdate);
		}
		queueMicrotask(() => document.getElementById(`ci-${f.key}`)?.focus());
	}
	function cancelEdit(key: Key) {
		editing[key] = false;
		draft[key] = undefined;
		if (key === 'birthdate') birth = { y: '', m: '', d: '' };
		if (isPair(key)) pair[key] = pairInitial(key);
	}
	const questions = $derived(data.questions ?? []);
	const answerOf = (id: string) => a.questions?.find((x) => x.id === id)?.answer ?? '';
	const missingId = $derived(form?.error === 'question_required' ? (form.field ?? null) : null);
	const missingGuest = $derived(form?.error === 'guest_required' || form?.error === 'invalid_params' ? (form.field ?? null) : null);
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
	// 選択欄。min-w-0 で、狭い画面でも枠の中に収める
	const selectCls = 'mt-1 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-[16px] disabled:bg-stone-100';
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
					{#if open && f.key === 'birthdate'}
						{@const bad = missingGuest === 'birthdate' ? 'border-red-400 ring-1 ring-red-300' : ''}
						<input type="hidden" name={f.name} value={draft.birthdate ?? ''} />
						<div class="mt-1 grid grid-cols-[2fr_1fr_1fr] gap-2">
							<select id="ci-birthdate" bind:value={birth.y} required autocomplete="bday-year" aria-label={m.ci_bd_year()} class="{selectCls} {bad}">
								<option value="">{m.ci_bd_year()}</option>
								{#each birthYears as y (y)}
									<option value={String(y)}>{y}{withEra ? `（${eraYear(y)}）` : ''}</option>
								{/each}
							</select>
							<select bind:value={birth.m} required autocomplete="bday-month" aria-label={m.ci_bd_month()} class="{selectCls} {bad}">
								<option value="">{m.ci_bd_month()}</option>
								{#each Array.from({ length: 12 }, (_, i) => i + 1) as mo (mo)}
									<option value={String(mo)}>{mo}</option>
								{/each}
							</select>
							<select bind:value={birth.d} required autocomplete="bday-day" aria-label={m.ci_bd_day()} class="{selectCls} {bad}">
								<option value="">{m.ci_bd_day()}</option>
								{#each Array.from({ length: birthDays }, (_, i) => i + 1) as d (d)}
									<option value={String(d)}>{d}</option>
								{/each}
							</select>
						</div>
					{:else if open && isPair(f.key)}
						{@const kana = f.key === 'name_kana'}
						<div class="mt-1 grid grid-cols-2 gap-2">
							<input
								id="ci-{f.key}"
								name="contact_{PAIR[f.key].fam}"
								type="text"
								autocomplete={kana ? 'off' : 'family-name'}
								maxlength="50"
								required={!alwaysInput(f)}
								placeholder={kana ? m.ci_family_kana() : m.ci_family_name()}
								aria-label={kana ? m.ci_family_kana() : m.ci_family_name()}
								bind:value={pair[f.key].a}
								class="{inputCls} min-w-0"
							/>
							<input
								name="contact_{PAIR[f.key].giv}"
								type="text"
								autocomplete={kana ? 'off' : 'given-name'}
								maxlength="50"
								placeholder={kana ? m.ci_given_kana() : m.ci_given_name()}
								aria-label={kana ? m.ci_given_kana() : m.ci_given_name()}
								bind:value={pair[f.key].b}
								class="{inputCls} min-w-0"
							/>
						</div>
					{:else if open}
						<input
							id="ci-{f.key}"
							name={f.name}
							type={f.type}
							autocomplete={f.auto}
							maxlength={f.max}
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
			<select name="arrival_time" value={arrival0} disabled={ro} class={selectCls}>
				<option value="">{m.ci_arrival_unset()}</option>
				{#each arrivals as t (t)}
					<option value={t}>{t}</option>
				{/each}
			</select>
		</label>
		<p class="mt-1 text-xs text-stone-500">{m.ci_arrival_note()}</p>
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

	<!-- 備考（任意・自由入力）。宿からの質問のあと（2026-11-15） -->
	<section class="rounded-2xl bg-white p-4 text-sm shadow-sm">
		<label class="block">
			<span class="font-semibold">{m.ci_section_note()}</span>
			<span class="ml-1 text-xs text-stone-500">{m.ci_optional()}</span>
			<textarea name="note" rows="3" maxlength="1000" disabled={ro} placeholder={m.ci_note_placeholder()} class={inputCls}>{a.note ?? ''}</textarea>
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
