<script lang="ts">
	// 公開サイト（トップ・施設ページ上部・ヘッダー）の検索バー。見た目と操作は共通部品 StaySearchBar / StaySearchPanel
	// （取引先ページ・HP 配布の <yamado-search-bar> と同じもの）。
	// facility（slug）を渡すと日付パネルにその施設の空き日・最安料金・空室数を出す。無ければ全施設まとめ（最安は施設の中の最安・空室数は合計）。
	// 「検索」で action（既定 /search）へ checkin / nights / adults / rooms を付けて移動する。
	// facility を渡さないとき（トップ・/search のヘッダー）は先頭に「施設」の区画を出し、地域 → 施設の順に選んでもらう。
	// 施設を選んだら日付パネルへ進み、「検索」でその施設のプラン一覧へ移る。選ばずに検索したときは今までどおり全施設（action）。
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import StaySearchBar from '$lib/components/stay-search/StaySearchBar.svelte';
	import StaySearchPanel, { type StayDayView } from '$lib/components/stay-search/StaySearchPanel.svelte';
	import { STAY_SEARCH_LABELS } from '$lib/stay-search/labels';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { EMBED_FACILITIES, SEARCH_FACILITIES, LIMITS, MONTHS_AHEAD, calendarUrl, clampSearch, dayState, isIsoDate, normalizeLang, parseCalendar, shiftYm, todayJst, type StayCalendarData } from '$lib/stay-search/params';
	import { PARTNER_ACCENTS } from '$lib/partner-theme';

	let {
		checkin = '',
		nights = LIMITS.nights.def,
		adults = LIMITS.adults.def,
		rooms = LIMITS.rooms.def,
		action = '/search',
		meal = '',
		keepScroll = false,
		facility = ''
	}: { checkin?: string; nights?: number; adults?: number; rooms?: number; action?: string; facility?: string; meal?: string; keepScroll?: boolean } = $props();

	const lang = normalizeLang(getLocale()) || 'ja';
	const labels = STAY_SEARCH_LABELS[lang];
	const today = todayJst();
	const latestYm = shiftYm(today.slice(0, 7), MONTHS_AHEAD);
	// 施設の区画（facility を渡さないときだけ）
	// svelte-ignore state_referenced_locally
	const pickFacility = !facility;
	let chosen = $state('');
	const chosenFacility = $derived(SEARCH_FACILITIES.find((f) => f.slug === chosen));
	let region = $state<'' | 'iwate' | 'akita'>('');
	const regionFacilities = $derived(SEARCH_FACILITIES.filter((f) => f.region === region));
	const effectiveFacility = $derived(facility || chosen);
	const accent = $derived(EMBED_FACILITIES[effectiveFacility] ?? PARTNER_ACCENTS.yamado);
	function choose(slug: string) {
		chosen = slug;
		open = 'date'; // 施設が決まったら日付へ進む
	}

	// URL の値から始め、以降は検索バーの下書きとして編集する（「検索」で確定）
	// svelte-ignore state_referenced_locally
	const initial = clampSearch({ nights, adults, rooms });
	// svelte-ignore state_referenced_locally
	let date = $state(isIsoDate(checkin) ? checkin : '');
	let n = $state<number>(initial.nights);
	let guests = $state<number>(initial.adults);
	let r = $state<number>(initial.rooms);
	let open = $state<'' | 'date' | 'guests' | 'facility'>('');
	// 施設の区画を開いたら、選んである施設の地域を開いておく
	$effect(() => {
		if (open === 'facility' && chosenFacility) region = chosenFacility.region;
	});
	// URL（ヘッダーの検索バーが別ページへ移ったとき）が変わったら下書きも合わせる
	$effect(() => {
		const v = clampSearch({ nights, adults, rooms });
		date = isIsoDate(checkin) ? checkin : '';
		n = v.nights;
		guests = v.adults;
		r = v.rooms;
	});

	// 空き日（施設が無ければ全施設まとめ＝facility=all。泊数×人数ごとにキャッシュ。取れなくても日付は選べる）
	const calendarFacility = $derived(effectiveFacility || 'all');
	const cache = new Map<string, StayCalendarData>();
	let data = $state<StayCalendarData | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	$effect(() => {
		if (open !== 'date') return;
		const key = `${calendarFacility}|${n}|${guests}`;
		const hit = cache.get(key);
		if (hit) {
			data = hit;
			loading = false;
			failed = false;
			return;
		}
		const ctrl = new AbortController();
		data = null;
		loading = true;
		failed = false;
		fetch(calendarUrl(page.url.origin, calendarFacility, n, guests), { signal: ctrl.signal })
			.then((res) => (res.ok ? res.json() : Promise.reject(new Error(`http_${res.status}`))))
			.then((json) => {
				const parsed = parseCalendar(json);
				if (!parsed) throw new Error('bad_response');
				cache.set(key, parsed);
				if (!ctrl.signal.aborted) data = parsed;
			})
			.catch(() => {
				if (!ctrl.signal.aborted) failed = true;
			})
			.finally(() => {
				if (!ctrl.signal.aborted) loading = false;
			});
		return () => ctrl.abort();
	});

	function day(iso: string): StayDayView {
		const st = dayState(iso, today, data);
		return { price: st.price, rooms: st.rooms, disabled: st.disabled, mark: st.closed ? 'closed' : st.unavailable ? 'dash' : '' };
	}

	function search() {
		const q = new URLSearchParams({ nights: String(n), adults: String(guests) });
		if (r > 1) q.set('rooms', String(r));
		if (date) q.set('checkin', date);
		if (meal) q.set('meal', meal); // お食事の絞り込みは検索し直しても残す
		open = '';
		const to = chosenFacility ? `/${chosenFacility.brand}/${chosenFacility.slug}/plans` : action;
		void goto(localizeHref(`${to}?${q}`), keepScroll ? { noScroll: true, keepFocus: true } : {});
	}
</script>

<div role="search" aria-label={labels.region} style={`--pt-accent:${accent.accent};--pt-accent-soft:${accent.accentSoft}`}>
	<StaySearchBar bind:date bind:nights={n} bind:guests bind:rooms={r} bind:open facilityPanel={pickFacility ? facilityPanel : undefined} facilityValue={chosenFacility?.name ?? ''} maxGuests={LIMITS.adults.max} maxRooms={LIMITS.rooms.max} {lang} {labels} mobileDateDialog onSearch={search}>
		{#snippet datePanel({ close, modal })}
			<StaySearchPanel bind:date bind:nights={n} {guests} rooms={r} maxNights={LIMITS.nights.max} {today} {latestYm} loading={loading && !data} {failed} {day} {lang} {labels} {modal} onApply={search} onClose={close} />
		{/snippet}
	</StaySearchBar>
</div>

{#snippet facilityPanel({ close }: { close: () => void })}
	<p class="text-base font-semibold text-brand-900">{labels.chooseRegion}</p>
	<div class="mt-3 grid grid-cols-2 gap-2">
		{#each ['iwate', 'akita'] as const as key (key)}
			<button
				type="button"
				aria-pressed={region === key}
				onclick={() => (region = key)}
				class={`rounded-full border px-4 py-2 text-base transition ${region === key ? 'border-brand-900 bg-brand-900 text-white' : 'border-stone-300 text-brand-900 hover:border-brand-900'}`}>{labels.regions[key]}</button
			>
		{/each}
	</div>
	<div class="mt-4 border-t border-stone-200 pt-3">
		{#if region}
			<ul class="space-y-1">
				{#each regionFacilities as f (f.slug)}
					<li>
						<button
							type="button"
							onclick={() => choose(f.slug)}
							class={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-stone-100 ${chosen === f.slug ? 'bg-stone-100' : ''}`}
						>
							<span class="flex flex-col">
								<span class="text-base font-semibold text-brand-900">{f.name}</span>
								<span class="text-sm text-stone-500">{labels.regions[f.region]} {f.area[lang]}</span>
							</span>
							{#if chosen === f.slug}<span aria-hidden="true" class="text-brand-900">✓</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="py-2 text-sm text-stone-500">{labels.pickRegionFirst}</p>
		{/if}
	</div>
	<button
		type="button"
		onclick={() => {
			chosen = '';
			region = '';
			close();
		}}
		class="mt-2 text-sm text-stone-600 underline underline-offset-2 hover:text-brand-900">{labels.allFacilities}</button
	>
{/snippet}
