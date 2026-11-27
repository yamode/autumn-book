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
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';

	let {
		checkin = '',
		nights = LIMITS.nights.def,
		adults = LIMITS.adults.def,
		rooms = LIMITS.rooms.def,
		action = '/search',
		meal = '',
		specialOnly = false,
		keepScroll = false,
		facility = ''
	}: { checkin?: string; nights?: number; adults?: number; rooms?: number; action?: string; facility?: string; meal?: string; specialOnly?: boolean; keepScroll?: boolean } = $props();

	const lang = normalizeLang(getLocale()) || 'ja';
	const labels = STAY_SEARCH_LABELS[lang];
	const today = todayJst();
	const latestYm = shiftYm(today.slice(0, 7), MONTHS_AHEAD);
	// 施設の区画（facility を渡さないときだけ）
	// svelte-ignore state_referenced_locally
	const pickFacility = !facility;
	let chosen = $state('');
	const chosenFacility = $derived(SEARCH_FACILITIES.find((f) => f.slug === chosen));
	// 左の地域（一休のエリア選択）。'' はすべてのエリア
	let region = $state<'' | 'iwate' | 'akita'>('');
	const regionFacilities = $derived(region ? SEARCH_FACILITIES.filter((f) => f.region === region) : SEARCH_FACILITIES);
	const regionCount = (key: 'iwate' | 'akita') => SEARCH_FACILITIES.filter((f) => f.region === key).length;
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
		if (meal) q.set('meal', meal);
		if (specialOnly) q.set('specialOnly', '1');
		open = '';
		const to = chosenFacility ? `/${chosenFacility.brand}/${chosenFacility.slug}/plans` : action;
		void goto(localizeHref(`${to}?${q}`), keepScroll ? { noScroll: true, keepFocus: true } : {});
	}
</script>

<div role="search" aria-label={labels.region} style={`--pt-accent:${accent.accent};--pt-accent-soft:${accent.accentSoft}`}>
	<StaySearchBar bind:date bind:nights={n} bind:guests bind:rooms={r} bind:open facilityPanel={pickFacility ? facilityPanel : undefined} facilityValue={chosenFacility?.name ?? ''} maxGuests={LIMITS.adults.max} maxRooms={LIMITS.rooms.max} {lang} {labels} mobileDateDialog onSearch={search}>
		{#snippet datePanel({ close, modal, next })}
			<!-- スマホの検索モーダルでは、日付は 2 ステップ目（下段のボタンは「次へ」で人数・室数へ進む） -->
			<StaySearchPanel bind:date bind:nights={n} {guests} rooms={r} maxNights={LIMITS.nights.max} {today} {latestYm} loading={loading && !data} {failed} {day} {lang} {labels} {modal} bare={!!next} applyLabel={next ? labels.nextStep : undefined} onApply={next ?? search} onClose={close} />
		{/snippet}
	</StaySearchBar>
</div>

{#snippet facilityPanel(_panel: { close: () => void })}
	<!-- 一休.com のエリア選択（左に地域・右にその地域の宿）と Airbnb の行（写真＋名前＋地域）を合わせた形。スマホは地域を横並びのボタンにする -->
	<div class="@container">
		<div class="flex flex-col gap-4 @min-[480px]:flex-row @min-[480px]:gap-0">
			<nav aria-label={labels.facility} class="shrink-0 @min-[480px]:w-40 @min-[480px]:border-r @min-[480px]:border-stone-200 @min-[480px]:pr-3">
				<div class="flex gap-1.5 overflow-x-auto [scrollbar-width:none] @min-[480px]:flex-col @min-[480px]:gap-0.5">
					{#each [{ key: '' as const, label: labels.allAreas, count: SEARCH_FACILITIES.length }, ...(['iwate', 'akita'] as const).map((k) => ({ key: k, label: labels.regions[k], count: regionCount(k) }))] as item (item.key)}
						{#if item.key === 'iwate'}
							<p class="mt-3 mb-1 hidden px-3 text-xs font-bold tracking-wide text-stone-500 @min-[480px]:block">{labels.areaGroup}</p>
						{/if}
						<button
							type="button"
							aria-pressed={region === item.key}
							onclick={() => (region = item.key)}
							class={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition @min-[480px]:rounded-lg @min-[480px]:border-transparent @min-[480px]:px-3 @min-[480px]:py-2.5 ${region === item.key ? 'border-brand-900 bg-brand-900 text-white @min-[480px]:bg-stone-100 @min-[480px]:font-semibold @min-[480px]:text-brand-900' : 'border-stone-300 text-brand-900 hover:bg-stone-100'}`}
						>
							<span>{item.label}</span>
							<span class={`hidden text-xs @min-[480px]:inline ${region === item.key ? 'text-brand-900' : 'text-stone-400'}`}>{item.count}</span>
						</button>
					{/each}
				</div>
			</nav>
			<ul class="min-w-0 flex-1 space-y-1 @min-[480px]:pl-3">
				{#if !region}
					<li>
						<button
							type="button"
							onclick={() => {
								chosen = '';
								open = 'date';
							}}
							class={`flex w-full items-center gap-4 rounded-2xl p-2 text-left transition hover:bg-stone-100 ${!chosen ? 'bg-stone-50' : ''}`}
						>
							<span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-brand-900" aria-hidden="true">
								<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" stroke-linecap="round" /></svg>
							</span>
							<span class="flex min-w-0 flex-col">
								<span class="text-base font-semibold text-brand-900">{labels.allFacilities}</span>
								<span class="text-sm text-stone-500">{labels.allFacilitiesSub}</span>
							</span>
						</button>
					</li>
				{/if}
				{#each regionFacilities as f (f.slug)}
					<li>
						<button
							type="button"
							onclick={() => choose(f.slug)}
							aria-pressed={chosen === f.slug}
							class={`flex w-full items-center gap-4 rounded-2xl p-2 text-left transition hover:bg-stone-100 ${chosen === f.slug ? 'bg-stone-100' : ''}`}
						>
							<img src={facilityThumbnailUrl(f.slug, '')} alt="" loading="lazy" class="h-14 w-14 shrink-0 rounded-xl bg-stone-200 object-cover" />
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate text-base font-semibold text-brand-900">{f.name}</span>
								<span class="text-sm text-stone-500">{labels.regions[f.region]} {f.area[lang]}</span>
							</span>
							{#if chosen === f.slug}
								<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5 shrink-0 text-brand-900" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	</div>
{/snippet}
