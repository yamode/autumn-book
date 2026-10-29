<script lang="ts">
	// 公開サイト（トップ・施設ページ上部・ヘッダー）の検索バー。見た目と操作は共通部品 StaySearchBar / StaySearchPanel
	// （取引先ページ・HP 配布の <yamado-search-bar> と同じもの）。
	// facility（slug）を渡すと日付パネルにその施設の空き日と最安料金を出す。無ければ日付だけ選べる（トップ）。
	// 「検索」で action（既定 /search）へ checkin / nights / adults / rooms を付けて移動する。
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import StaySearchBar from '$lib/components/stay-search/StaySearchBar.svelte';
	import StaySearchPanel, { type StayDayView } from '$lib/components/stay-search/StaySearchPanel.svelte';
	import { STAY_SEARCH_LABELS } from '$lib/stay-search/labels';
	import { getLocale, localizeHref } from '$lib/paraglide/runtime';
	import { EMBED_FACILITIES, LIMITS, MONTHS_AHEAD, calendarUrl, clampSearch, dayState, isIsoDate, normalizeLang, parseCalendar, shiftYm, todayJst, type StayCalendarData } from '$lib/stay-search/params';
	import { PARTNER_ACCENTS } from '$lib/partner-theme';

	let {
		checkin = '',
		nights = LIMITS.nights.def,
		adults = LIMITS.adults.def,
		rooms = LIMITS.rooms.def,
		action = '/search',
		tag = '',
		keepScroll = false,
		facility = ''
	}: { checkin?: string; nights?: number; adults?: number; rooms?: number; action?: string; facility?: string; tag?: string; keepScroll?: boolean } = $props();

	const lang = normalizeLang(getLocale()) || 'ja';
	const labels = STAY_SEARCH_LABELS[lang];
	const today = todayJst();
	const latestYm = shiftYm(today.slice(0, 7), MONTHS_AHEAD);
	const accent = $derived(EMBED_FACILITIES[facility] ?? PARTNER_ACCENTS.yamado);

	// URL の値から始め、以降は検索バーの下書きとして編集する（「検索」で確定）
	// svelte-ignore state_referenced_locally
	const initial = clampSearch({ nights, adults, rooms });
	// svelte-ignore state_referenced_locally
	let date = $state(isIsoDate(checkin) ? checkin : '');
	let n = $state<number>(initial.nights);
	let guests = $state<number>(initial.adults);
	let r = $state<number>(initial.rooms);
	let open = $state<'' | 'date' | 'guests'>('');
	// URL（ヘッダーの検索バーが別ページへ移ったとき）が変わったら下書きも合わせる
	$effect(() => {
		const v = clampSearch({ nights, adults, rooms });
		date = isIsoDate(checkin) ? checkin : '';
		n = v.nights;
		guests = v.adults;
		r = v.rooms;
	});

	// 空き日（施設が分かるときだけ。泊数×人数ごとにキャッシュ。取れなくても日付は選べる）
	const cache = new Map<string, StayCalendarData>();
	let data = $state<StayCalendarData | null>(null);
	let loading = $state(false);
	let failed = $state(false);
	$effect(() => {
		if (open !== 'date' || !facility) return;
		const key = `${facility}|${n}|${guests}`;
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
		fetch(calendarUrl(page.url.origin, facility, n, guests), { signal: ctrl.signal })
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
		// 施設が無い（トップ）ときは過去日だけ押せなくする
		if (!facility) return { price: null, disabled: iso < today, mark: '' };
		const st = dayState(iso, today, data);
		return { price: st.price, disabled: st.disabled, mark: st.closed ? 'closed' : st.unavailable ? 'dash' : '' };
	}

	function search() {
		const q = new URLSearchParams({ nights: String(n), adults: String(guests) });
		if (r > 1) q.set('rooms', String(r));
		if (date) q.set('checkin', date);
		if (tag) q.set('tag', tag);
		open = '';
		void goto(localizeHref(`${action}?${q}`), keepScroll ? { noScroll: true, keepFocus: true } : {});
	}
</script>

<div role="search" aria-label={labels.region} style={`--pt-accent:${accent.accent};--pt-accent-soft:${accent.accentSoft}`}>
	<StaySearchBar bind:date bind:nights={n} bind:guests bind:rooms={r} bind:open maxGuests={LIMITS.adults.max} maxRooms={LIMITS.rooms.max} {lang} {labels} onSearch={search}>
		{#snippet datePanel({ close })}
			<StaySearchPanel bind:date bind:nights={n} {guests} rooms={r} maxNights={LIMITS.nights.max} {today} {latestYm} loading={loading && !data} {failed} {day} {lang} {labels} onApply={search} onClose={close} />
		{/snippet}
	</StaySearchBar>
</div>
