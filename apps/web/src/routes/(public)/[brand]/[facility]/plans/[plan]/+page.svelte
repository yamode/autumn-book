<script lang="ts">
	import { roomCapacityText } from '$lib/room-capacity';
	import { enhance } from '$lib/enhance';
	import { afterNavigate, goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { fly } from 'svelte/transition';
	import PlanPhotoGallery from '$lib/components/PlanPhotoGallery.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import ContentBlocks from '$lib/components/ContentBlocks.svelte';
	import ScrollDatePicker from '$lib/components/ScrollDatePicker.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import RoomInfoModal from '$lib/components/RoomInfoModal.svelte';
	import PerkBanners from '$lib/components/PerkBanners.svelte';
	import PlanAccessBadge from '$lib/components/PlanAccessBadge.svelte';
	import PlanGateNotice from '$lib/components/PlanGateNotice.svelte';
	import PerkModal, { type PerkModalContent } from '$lib/components/PerkModal.svelte';
	import type { RoomType } from '$lib/types';
	import { formatDate, formatPrice, todayStr } from '$lib/format';
	import { gaEvent } from '$lib/analytics';
	import * as m from '$lib/paraglide/messages';
	import { percentText } from '$lib/early-prepay';
	import { searchQuery } from '$lib/components/guests';
	import { safeLocalPath, viaCrumb, viaStorageKey } from '$lib/booking-nav';
	import BookingCart from '$lib/components/BookingCart.svelte';
	import { canAddToCart, cartIsFull, MAX_ROOMS_PER_BOOKING, readCart, writeCart, type CartItem } from '$lib/multi-room';

	let { data, form } = $props();

	// 予約かご（複数室・docs/official-multi-room.md §8.1・M1）: sessionStorage に置き、在庫は押さえない。
	// 「＋ もう 1 室追加」で入れ、画面下のバーの「予約へ進む」で全室を一括で仮押さえする
	let cart = $state<CartItem[]>([]);
	let cartLoaded = $state(false);
	let cartMessage = $state('');
	$effect(() => {
		try {
			cart = readCart(sessionStorage);
		} catch {
			cart = [];
		}
		cartLoaded = true;
	});
	$effect(() => {
		// 読み込む前に空で上書きしない
		if (!cartLoaded) return;
		try {
			writeCart(sessionStorage, cart);
		} catch {
			/* 保存できない環境は画面の中だけで持つ */
		}
	});
	let cartFull = $derived(cartIsFull(cart));
	const fullNotice = () => m.cart_full_notice({ max: String(MAX_ROOMS_PER_BOOKING), next: String(MAX_ROOMS_PER_BOOKING + 1) });
	function addToCart(r: { room: RoomType; quote: { total: number } | null; remaining: number | null }) {
		if (!r.quote || !data.params.checkin) return;
		const item: CartItem = {
			key: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
			facilityId: data.facility.id,
			brandSlug: data.facility.brandSlug,
			facilitySlug: data.facility.slug,
			facilityName: data.facility.name,
			checkin: data.params.checkin,
			nights: data.params.nights,
			planId: data.plan.id,
			planSlug: data.plan.slug,
			planName: data.plan.name,
			roomTypeId: r.room.id,
			roomName: r.room.name,
			adults: data.params.adults,
			total: r.quote.total,
			pay: { onsite: data.plan.payment.onsite, prepay: data.plan.payment.prepay },
			remaining: r.remaining
		};
		let check = canAddToCart(cart, item);
		if (!check.ok && check.reason === 'other_stay') {
			// 別の施設・日程のかご: 空にしてから入れるか聞く（1 回のご予約は同じ施設・同じ日程だけ）
			if (!confirm(m.cart_other_stay_confirm())) return;
			cart = [];
			check = canAddToCart(cart, item);
		}
		if (!check.ok) {
			cartMessage =
				check.reason === 'full'
					? fullNotice()
					: check.reason === 'mixed_payment'
						? m.cart_mixed_payment()
						: m.cart_no_remaining({ n: String(r.remaining ?? 0) });
			return;
		}
		cart = [...cart, item];
		// 検索した部屋数まであと何部屋か／そろったかを出す（4 室ちょうどのときは上限の注意が出るので重ねない）
		const want = Math.max(data.params.rooms ?? 1, cart.length);
		cartMessage = cartIsFull(cart)
			? ''
			: cart.length < want
				? m.cart_progress_more({ rest: String(want - cart.length) })
				: m.cart_progress_done({ total: String(want) });
	}

	// GA4 予約ファネル: プラン閲覧（設計書 §9）
	$effect(() => {
		gaEvent('view_item', {
			currency: 'JPY',
			items: [{ item_id: data.plan.id, item_name: data.plan.name, item_brand: data.facility.name }]
		});
	});
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let selectedRoom = $derived(page.url.searchParams.get('room') ?? '');
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	let qs = $derived(
		data.params.checkin
			? `checkin=${data.params.checkin}&nights=${data.params.nights}&adults=${data.params.adults}${(data.params.rooms ?? 1) > 1 ? `&rooms=${data.params.rooms}` : ''}`
			: ''
	);

	// プランの写真が未登録なら「プラン専用画像掲載予定」の仮画像を 1 枚目に置く（施設の写真がプランの写真に見えないように）
	let planPhotos = $derived(
		data.plan.photos.length > 0 ? data.plan.photos : [{ url: '/site-assets/plan-photo-pending.svg', caption: '', category: 'exterior' as const }]
	);

	// 料金はプラン詳細では「1室の合計（税込）」を主、1名あたりを従で出す（2026-11-01・一休・自社 HP のプラン一覧と同じ）。
	// 1名あたりは泊数で割った 1名1泊。
	const perPersonNight = (total: number) => Math.round(total / Math.max(1, data.params.adults * data.params.nights));
	const totalSub = () => m.plan_price_total_sub({ adults: String(data.params.adults), nights: String(data.params.nights) });

	// お食事。コースは夕食に付くもの（夕食と別の項目ではない）ので「夕食付き（スタンダードコース）」の形にし、夕食 → 朝食の順に 1 行ずつ出す
	// （2026-11-01 指示）。meal_plan は rms の 2食 / 朝食 / 素泊 / 日帰り。
	// 朝食・夕食の有無はプラン設定の「お食事」（v_plans.includes_breakfast / has_dinner）。読めない取得元は meal_plan から
	let breakfast = $derived(data.plan.includesBreakfast ?? (data.plan.mealPlan === '2食' || data.plan.mealPlan === '朝食'));
	let dinner = $derived(data.plan.hasDinner ?? data.plan.mealPlan === '2食');
	const withCourse = (label: string) => (data.plan.dinnerCourse ? `${label}（${data.plan.dinnerCourse}）` : label);
	let meals = $derived.by(() => {
		if (data.plan.mealPlan === '日帰り') return [withCourse(m.plan_meal_lunch())];
		// 設定も無く、rms の食事区分（2食 / 朝食 / 素泊）でもない値（デモの「2食付」等）はそのまま出す
		const known = ['2食', '朝食', '素泊'].includes(data.plan.mealPlan);
		if (data.plan.includesBreakfast === undefined && data.plan.hasDinner === undefined && !known) return data.plan.mealPlan ? [data.plan.mealPlan] : [];
		const list = [dinner ? withCourse(m.plan_meal_dinner()) : '', breakfast ? m.plan_meal_breakfast() : ''].filter(Boolean);
		return list.length ? list : [m.plan_meal_none()];
	});
	let payText = $derived(
		[
			data.plan.payment.onsite ? m.pay_onsite() : '',
			// 予約時のカード決済は「事前カード決済」（チェックアウト日のカード決済と並べても区別できる名前）
			data.plan.payment.prepay ? (data.plan.payment.prepayMethods.includes('paypay') ? 'カード / PayPay' : m.plan_card_payment_card()) : '',
			// オンライン決済（チェックアウト日）。未設定のプランは従来どおり予約時のカード決済に含めて見せない
			data.plan.payment.checkout ? m.plan_card_payment_checkout() : ''
		]
			.filter(Boolean)
			.join(' ／ ')
	);

	// ファーストビュー用の料金サマリ: 日付指定時は予約できる客室の最安、未指定はプラン基準料金（〜）
	let cheapest = $derived.by(() => {
		let best: { total: number } | null = null;
		for (const r of data.rooms) {
			if (r.quote && (!best || r.quote.total < best.total)) best = { total: r.quote.total };
		}
		return best;
	});
	let soldOut = $derived(!!data.params.checkin && cheapest === null);
	// 日付・客室を選んで入ってきたとき（?checkin&room）: その客室を主役にし、ここで予約まで進める。
	// ほかの客室は畳んでおく（もう選んだのに「客室を選ぶ」から始めさせない）。選んだ客室が満室なら従来どおり一覧から選ぶ
	let chosen = $derived(data.params.checkin && selectedRoom ? data.rooms.find((r) => r.room.slug === selectedRoom && r.quote) : undefined);
	// 客室を選んで入ってきたが、日付が未指定（客室ページ・日付なしの一覧から）または満室のとき: 客室は選んだまま見せ、日付を選んでもらう
	// （以前は日付が無いと客室が未選択の画面になっていた・2026-11-01）
	let picked = $derived(
		chosen ??
			(selectedRoom ? data.rooms.find((r) => r.room.slug === selectedRoom) : undefined) ??
			(data.pickedRoom ? { room: data.pickedRoom, quote: null, remaining: null, fits: true } : undefined)
	);
	let otherRooms = $derived(picked ? data.rooms.filter((r) => r !== picked) : data.rooms);
	let showOthers = $state(false);
	// 複数室: 検索で 2 室以上を選んだときだけ「予約リストに追加」で部屋を集め、画面下のバーから全室まとめて予約する。
	// 1 室で検索したときは追加ボタンを出さない（そのまま「この部屋で予約へ進む」）。リストに部屋が入っていれば続きとして扱う
	let targetRooms = $derived(Math.max(data.params.rooms ?? 1, cart.length));
	let multiSearch = $derived(data.multiRoom && targetRooms > 1);
	let progressText = $derived(m.cart_progress({ total: String(targetRooms), n: String(Math.min(cart.length, targetRooms)) }));

	// 右カラムの追従位置: サイトのヘッダー（検索バー込み・画面幅で高さが変わる）のすぐ下にする
	let stickyTop = $state(0);
	$effect(() => {
		const header = document.querySelector<HTMLElement>('header.sticky');
		if (!header || typeof ResizeObserver === 'undefined') return;
		const update = () => (stickyTop = Math.round(header.getBoundingClientRect().height) + 16);
		update();
		const ro = new ResizeObserver(update);
		ro.observe(header);
		return () => ro.disconnect();
	});
	// 早期決済割・早期決済ポイントの最大率（withEarlyPrepayMax が入れる）。points は定率割引と並べて出す
	let earlyMax = $derived(data.plan.payment.prepay ? (data.plan.payment.earlyPrepayMaxRate ?? 0) : 0);
	let earlyPoints = $derived(earlyMax > 0 && data.plan.payment.earlyPrepayMode === 'points');
	let earlyMaxText = $derived(percentText(Math.round(earlyMax * 1000) / 10));

	// モバイルの下部固定バー: 客室セクションが画面に入ったら隠す（同じCTAが二重にならないように）
	let roomsInView = $state(false);
	let datePickerOpen = $state(false);
	let infoRoom = $state<RoomType | null>(null);
	// 公式HP限定特典など（紹介文テンプレートの「特典」）。予約ボタンの下にバナー、押すとモーダル
	let perkContent = $state<PerkModalContent | null>(null);
	const perkBanners = $derived((data.plan.perks ?? []).map((p) => ({ key: p.key, label: p.label, kind: 'official' as const })));
	function openPerk(key: string) {
		const p = data.plan.perks?.find((x) => x.key === key);
		if (p) perkContent = { label: p.label, body: p.body };
	}

	// 遷移経路: このプラン詳細の手前のページ（一覧・施設トップ・客室ページ…）を覚え、パンくずと予約入力画面の戻り先に使う。
	// 同じプラン内の日付変更や、予約入力画面から戻ってきたときは上書きしない。
	let via = $state('');
	afterNavigate(({ from, type }) => {
		const here = page.url.pathname;
		const key = viaStorageKey(here);
		let previous = '';
		if (type === 'enter') {
			try {
				const referrer = document.referrer ? new URL(document.referrer) : null;
				if (referrer && referrer.origin === location.origin) previous = referrer.pathname + referrer.search;
			} catch { /* 不正な referrer は無視 */ }
		} else if (from) {
			previous = from.url.pathname + from.url.search;
		}
		const previousPath = previous.split('?')[0];
		try {
			if (previous && previousPath !== here && !previousPath.startsWith('/booking') && !previousPath.startsWith('/auth')) {
				sessionStorage.setItem(key, previous);
			}
			via = safeLocalPath(sessionStorage.getItem(key));
		} catch {
			via = previousPath !== here ? safeLocalPath(previous) : via;
		}
	});
	let crumb = $derived(viaCrumb(via, data.facility));
	// 予約ボタンを押したこのページ（選んだ客室の位置まで）に戻れるようにする
	function backHref(roomSlug: string) {
		const query = new URLSearchParams(page.url.searchParams);
		query.set('room', roomSlug);
		return `${page.url.pathname}?${query}#room-${roomSlug}`;
	}
	function chooseDate(date: string, nights: number, adults = data.params.adults, rooms = data.params.rooms ?? 1) {
		const query = new URLSearchParams({ checkin: date, nights: String(nights), adults: String(adults) });
		if (rooms > 1) query.set('rooms', String(rooms));
		if (selectedRoom) query.set('room', selectedRoom);
		// 料金を取り直すあいだ、客室の欄を先に見せて読み込み中の表示（シマー）を出す（2026-11-02 指示）
		// カレンダーが閉じて画面のスクロール止め（overflow: hidden）が外れてから動かす
		setTimeout(() => document.getElementById('rooms')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
		void goto(`${base}/plans/${data.plan.slug}?${query}#${selectedRoom ? `room-${selectedRoom}` : 'rooms'}`, { noScroll: !selectedRoom });
	}
	// 同じプランのまま日付・人数を変えて料金を取り直している最中（客室の欄と右の料金をシマーにする）
	let loadingRooms = $derived(
		!!navigating.to && navigating.to.url.pathname === page.url.pathname && navigating.to.url.search !== page.url.search
	);
	// シマーの枚数は今の客室の数に合わせる（読み込み後に高さが大きく変わらないように）
	let skeletonCount = $derived(Math.min(Math.max(data.rooms.length, 2), 5));
	$effect(() => {
		const el = document.getElementById('rooms');
		if (!el || typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver((entries) => {
			roomsInView = entries.some((e) => e.isIntersecting);
		});
		io.observe(el);
		return () => io.disconnect();
	});
</script>

{#snippet holdForm(r: (typeof data.rooms)[number], size: 'lg' | 'md')}
	{#if multiSearch}
		<!-- 2 室以上で検索: 部屋を予約リストに集め、そろったら画面下のバーから全室まとめて予約する（4 室のあいだは押せない見た目・押しても同じ注意を出す） -->
		<button
			type="button"
			onclick={() => (cartFull ? (cartMessage = fullNotice()) : addToCart(r))}
			aria-disabled={cartFull}
			class="rounded-lg text-sm font-medium {size === 'lg' ? 'mt-3 block w-full py-2.5' : 'mt-2 px-5 py-2'} {cartFull ? 'cursor-not-allowed bg-stone-200 text-stone-400' : 'bg-accent-600 text-white hover:bg-accent-500'}"
		>
			{m.cart_add_to_list()}
		</button>
		<p class="mt-1 text-xs text-stone-500 {size === 'lg' ? 'text-center' : ''}">{progressText}</p>
	{:else}
	<form method="POST" action="?/hold" use:enhance class={size === 'lg' ? 'mt-3' : 'mt-2'}>
		<input type="hidden" name="planId" value={data.plan.id} />
		<input type="hidden" name="roomTypeId" value={r.room.id} />
		<input type="hidden" name="checkin" value={data.params.checkin} />
		<input type="hidden" name="nights" value={data.params.nights} />
		<input type="hidden" name="adults" value={data.params.adults} />
		<input type="hidden" name="back" value={backHref(r.room.slug)} />
		<input type="hidden" name="via" value={via} />
		<button type="submit" class="rounded-lg bg-accent-600 text-sm font-medium text-white hover:bg-accent-500 {size === 'lg' ? 'block w-full py-2.5' : 'px-5 py-2'}">
			{m.plan_detail_book()}
		</button>
	</form>
	{/if}
{/snippet}

{#snippet roomCard(r: (typeof data.rooms)[number])}
	<div id="room-{r.room.slug}" class="flex scroll-mt-28 flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center {selectedRoom === r.room.slug ? 'border-brand-800 ring-1 ring-brand-800' : 'border-stone-200'}">
		<!-- 写真・客室名からも紹介モーダルを開ける（予約の流れを離れずに部屋を確かめる） -->
		<button type="button" onclick={() => (infoRoom = r.room)} class="w-full shrink-0 sm:w-40" aria-label={`${r.room.name} ${m.room_info_show()}`}>
			<img src={r.room.photos[0]?.url} alt={r.room.name} class="h-24 w-full rounded-lg object-cover sm:w-40" />
		</button>
		<div class="flex-1">
			{#if data.favoriteRoomTypeIds.includes(r.room.id)}
				<!-- 会員のお気に入りの部屋がある部屋タイプ -->
				<span class="mb-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600" title={m.favorites_room_type_badge_title()}>♥ {m.favorites_room_type_badge()}</span>
			{/if}
			<h3 class="font-medium text-brand-900">{r.room.name}</h3>
			<p class="text-xs text-stone-500">{roomCapacityText(r.room)}</p>
			<button type="button" onclick={() => (infoRoom = r.room)} class="mt-1 text-xs font-medium text-brand-700 underline underline-offset-4 hover:text-brand-900">{m.room_info_show()}</button>
			{#if !r.fits}
				<p class="mt-1 text-xs text-red-600">{m.plan_detail_no_fit()}</p>
			{/if}
		</div>
		<div class="text-right">
			{#if r.quote}
				<p class="text-[11px] text-stone-500">{totalSub()}</p>
				<p class="text-lg font-bold text-brand-900">
					{formatPrice(r.quote.total)}<span class="ml-0.5 text-xs font-normal text-stone-500">{m.plan_price_tax_incl()}</span>
				</p>
				<p class="text-xs text-stone-500">{m.plan_price_pp_night({ price: formatPrice(perPersonNight(r.quote.total)) })}</p>
				{#if r.remaining !== null && r.remaining <= 2}
					<p class="text-xs font-medium text-red-600">{m.plan_detail_remaining({ n: String(r.remaining) })}</p>
				{/if}
				{@render holdForm(r, 'md')}
			{:else if data.params.checkin && r.fits}
				<p class="text-sm font-medium text-stone-400">{m.plan_detail_sold_out()}</p>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet planInfo()}
	<!-- お食事・お支払い（右カラムの料金枠の上段）。お食事は「夕食付き（○○コース）」「朝食付き」を 1 行ずつ -->
	<dl class="space-y-2 text-sm">
		{#if meals.length}
			<div class="flex gap-3">
				<dt class="w-16 shrink-0 pt-0.5 text-xs text-stone-500">{m.plan_detail_meal()}</dt>
				<dd class="min-w-0 space-y-0.5 text-stone-800">
					{#each meals as meal}<p>{meal}</p>{/each}
				</dd>
			</div>
		{/if}
		<div class="flex gap-3">
			<dt class="w-16 shrink-0 pt-0.5 text-xs text-stone-500">{m.plan_detail_payment()}</dt>
			<dd class="min-w-0">
				{payText}
				{#if earlyMax > 0 && !earlyPoints}
					<!-- 早期決済割（段階表の最大率が定率より大きいとき）。定率の表示とは重ねない -->
					<span class="ml-1 inline-block rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-600">{m.plan_early_max({ rate: earlyMaxText })}</span>
				{:else if data.plan.payment.prepay && data.plan.payment.prepayDiscountRate > 0}
					<span class="ml-1 inline-block rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-600">{m.pay_prepay_off({ rate: String(Math.round(data.plan.payment.prepayDiscountRate * 100)) })}</span>
				{/if}
				{#if earlyPoints}
					<!-- 早期決済ポイント（宿泊後に上乗せ付与）。定率割引とは別に付く -->
					<span class="ml-1 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">{m.plan_points_max({ rate: earlyMaxText })}</span>
				{/if}
				{#if data.memberOnsiteHint}
					<!-- 非会員は予約時決済のみのプラン。会員なら現地払いも選べる（控えめに案内） -->
					<p class="mt-0.5 text-xs text-stone-500">{m.pay_member_onsite_hint()}</p>
				{/if}
			</dd>
		</div>
	</dl>
{/snippet}

{#snippet conditions(wide: boolean)}
	<!-- ご宿泊の条件（日程・人数）。どちらを押しても同じ料金カレンダーが開き、人数もそこで変えられる（2026-11-02） -->
	<div class="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm {wide ? 'max-w-xl' : ''}">
		<button type="button" onclick={() => (datePickerOpen = true)} class="flex w-full items-center gap-3 px-3 text-left hover:bg-stone-50 {wide ? 'py-3.5' : 'py-2.5'}">
			<span class="w-12 shrink-0 text-xs text-stone-500">{m.plan_cond_dates()}</span>
			<span class="min-w-0 flex-1 font-medium {data.params.checkin ? 'text-brand-900' : 'text-accent-600'}">
				{data.params.checkin ? `${formatDate(data.params.checkin)} · ${m.searchbar_nights_option({ n: String(data.params.nights) })}` : m.plan_cond_pick_date()}
			</span>
			<span class="shrink-0 text-xs text-stone-400" aria-hidden="true">{data.params.checkin ? m.plan_cond_change() : '›'}</span>
		</button>
		<button type="button" onclick={() => (datePickerOpen = true)} class="flex w-full items-center gap-3 px-3 text-left hover:bg-stone-50 {wide ? 'py-3.5' : 'py-2.5'}">
			<span class="w-12 shrink-0 text-xs text-stone-500">{m.plan_cond_guests()}</span>
			<span class="min-w-0 flex-1 font-medium text-brand-900">{m.plan_cond_guests_val({ adults: String(data.params.adults), rooms: String(data.params.rooms ?? 1) })}</span>
			<span class="shrink-0 text-xs text-stone-400" aria-hidden="true">{m.plan_cond_change()}</span>
		</button>
	</div>
{/snippet}

{#snippet priceBlock()}
	{#if loadingRooms}
		<div class="space-y-2" aria-hidden="true">
			<div class="shimmer h-3 w-28 opacity-70"></div>
			<div class="shimmer h-7 w-40"></div>
			<div class="shimmer h-3 w-32 opacity-70"></div>
		</div>
	{:else if chosen?.quote}
		<!-- 選んで入ってきた客室の料金（最安ではなく、その部屋の額） -->
		<p class="text-xs text-stone-500">{m.plan_detail_chosen_room()}</p>
		<p class="font-medium text-brand-900">{chosen.room.name}</p>
		<p class="mt-1 text-xs text-stone-500">{formatDate(data.params.checkin)} · {m.searchbar_nights_option({ n: String(data.params.nights) })}</p>
		<p class="mt-2 text-xs text-stone-500">{totalSub()}</p>
		<p class="text-2xl font-bold text-brand-900">
			{formatPrice(chosen.quote.total)}<span class="ml-1 text-xs font-normal text-stone-500">{m.plan_price_tax_incl()}</span>
		</p>
		<p class="text-xs text-stone-500">{m.plan_price_pp_night({ price: formatPrice(perPersonNight(chosen.quote.total)) })}</p>
		{#if chosen.remaining !== null && chosen.remaining <= 2}
			<p class="text-xs font-medium text-red-600">{m.plan_detail_remaining({ n: String(chosen.remaining) })}</p>
		{/if}
	{:else if picked}
		<!-- 客室を選んで入ってきたが、日付が未指定・その日は満室: 客室は選んだまま見せる -->
		<p class="text-xs text-stone-500">{m.plan_detail_chosen_room()}</p>
		<p class="font-medium text-brand-900">{picked.room.name}</p>
		{#if data.params.checkin}
			<p class="mt-1 text-xs text-stone-500">{formatDate(data.params.checkin)} · {m.searchbar_nights_option({ n: String(data.params.nights) })}</p>
			<p class="mt-1 text-sm font-medium text-stone-500">{m.plan_detail_sold_out()}</p>
		{/if}
	{:else if cheapest}
		<p class="text-xs font-medium text-stone-600">{m.plan_price_dated_label()}</p>
		<p class="text-xs text-stone-500">{totalSub()}</p>
		<p class="text-2xl font-bold text-brand-900">
			{formatPrice(cheapest.total)}〜<span class="ml-1 text-xs font-normal text-stone-500">{m.plan_price_tax_incl()}</span>
		</p>
		<p class="text-xs text-stone-500">{m.plan_price_pp_night({ price: formatPrice(perPersonNight(cheapest.total)) })}〜</p>
	{:else if soldOut}
		<p class="text-sm font-medium text-stone-500">{m.plan_price_sold_out()}</p>
	{:else if data.plan.basePrice > 0}
		<p class="text-xs text-stone-500">{data.referenceMode ? m.plan_price_reference_label() : m.plan_price_base_label()}</p>
		<p class="text-2xl font-bold text-brand-900">
			{formatPrice(data.plan.basePrice)}<span class="text-xs font-normal text-stone-500">{m.plan_card_base_price()}</span>
		</p>
	{:else}
		<p class="text-sm text-stone-500">{m.plan_price_base_note()}</p>
	{/if}
{/snippet}

<svelte:head>
	<title>{m.plan_detail_title({ name: data.plan.name, facility: data.facility.name })}</title>
	<meta name="description" content={data.plan.headline} />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-8 {cart.length > 0 ? 'pb-44' : 'pb-24 md:pb-8'}">
	<nav class="mb-2 text-xs text-stone-400">
		<a href={facilitiesHref} class="hover:underline">{m.common_facility_list()}</a> /
		{#if crumb}
			<a href={crumb.href} class="hover:underline">{crumb.kind === 'plans' ? m.plan_detail_breadcrumb_plans() : crumb.kind === 'room' ? m.room_detail_breadcrumb() : data.facility.name}</a> / {data.plan.name}
		{:else}
			<a href="{base}/plans{qs ? '?' + qs : ''}" class="hover:underline">{m.plan_detail_breadcrumb_plans()}</a> / {data.plan.name}
		{/if}
	</nav>

	<!-- レイアウト（2026-11-01）: 左＝見出し・写真・本文・客室、右＝料金と予約ボタン（ページの最後まで追従）。
	     右カラムを全行にまたがらせ、本文以降も同じグリッドに入れることで追従が写真の高さで止まらないようにする。
	     スマホは 1 列で「見出し → 写真 → 料金・予約 → 本文」の順（DOM の順のまま） -->
	<div class="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:gap-x-8">
		<!-- プランの見出し（宿泊予約サイトと同じく写真の上に大きく） -->
		<header class="space-y-2 md:col-start-1">
			{#if data.preview}
				<p class="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">プレビュー（スタッフ用）。このプランは販売中ではありません。料金・空室は本物で、予約入力画面まで進めますが、予約は確定できません（仮押さえした部屋は期限まで在庫から減ります。終わったら「選び直す」で戻してください）。</p>
			{/if}
			{#if data.plan.highlightTags.length}
				<div class="flex flex-wrap gap-1.5">
					{#each data.plan.highlightTags as tag}
						<span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{tag}</span>
					{/each}
				</div>
			{/if}
			<PlanAccessBadge access={data.plan.access} />
			<h1 class="font-display text-2xl leading-snug text-brand-900 md:text-3xl">{data.plan.name}</h1>
			{#if data.plan.headline && data.plan.headline !== data.plan.name}
				<p class="text-sm text-stone-600 md:text-base">{data.plan.headline}</p>
			{/if}
		</header>

		<div class="md:col-start-1">
			<!-- 客室まで選んで入ってきたら、プランの写真のあとにその客室の写真を続ける（区切りとラベル付き） -->
			<PlanPhotoGallery photos={[...planPhotos, ...data.facility.photos.slice(0, 3)]} room={picked ? { name: picked.room.name, photos: picked.room.photos } : null} />
		</div>

		<!-- 右カラム: スクロールしても料金・予約ボタンが見えるよう追従させる（ヘッダー高さ分下げる） -->
		<aside class="space-y-3 md:sticky md:top-32 md:col-start-2 md:row-span-3 md:row-start-1 md:self-start lg:top-24" style={stickyTop ? `top: ${stickyTop}px` : undefined}>
			<!-- 追従中もどのプランの料金か分かるように、名前だけ小さく -->
			<p class="hidden text-sm font-medium leading-snug text-brand-900 md:block">{data.plan.name}</p>
			{#if data.gate !== 'ok'}
				<!-- 会員限定のシークレットプラン: 予約できない閲覧者には料金を出さず、お食事・お支払いとログイン・グレードの案内だけ -->
				<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">{@render planInfo()}</div>
				<PlanGateNotice gate={data.gate} access={data.plan.access} next={page.url.pathname + page.url.search} />
			{:else}
			<!-- 料金サマリ＋CTA（ファーストビューで料金と予約導線を見せる）。お食事・お支払いも同じ枠の上に入れる（一休と同じ並び） -->
			<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
				{@render planInfo()}
				<div class="mt-3 border-t border-stone-200 pt-3">
					<p class="mb-1.5 text-xs font-medium text-stone-600">{m.plan_cond_title()}</p>
					{@render conditions(false)}
				</div>
				<div class="mt-3">{@render priceBlock()}</div>
				{#if data.params.checkin && !soldOut}
					<p class="mt-2 text-xs text-emerald-700">
						{m.plan_detail_cancel()}: <CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.params.checkin} />
					</p>
				{:else if !data.params.checkin}
					<p class="mt-2 text-xs text-stone-500">{m.plan_price_base_note()}</p>
				{/if}
				<!-- 客室まで選んで入ってきたらここで予約へ。日付未指定・満室時は日付選択（料金カレンダー）へ、日付だけ指定済みなら客室選択へ -->
				{#if chosen}
					{#if form?.message}
						<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
					{/if}
					{@render holdForm(chosen, 'lg')}
					<a href="#rooms" onclick={() => (showOthers = true)} class="mt-2 block text-center text-xs text-stone-500 underline underline-offset-4 hover:text-stone-700">{m.plan_detail_other_rooms({ n: String(otherRooms.length) })}</a>
				{:else if cheapest}
					<a href="#rooms" class="mt-3 block rounded-lg bg-accent-600 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_rooms()}</a>
				{:else}
					<button type="button" onclick={() => (datePickerOpen = true)} class="mt-3 block w-full rounded-lg bg-accent-600 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_dates()}</button>
				{/if}
				{#if perkBanners.length}<div class="mt-3"><PerkBanners items={perkBanners} onopen={openPerk} /></div>{/if}
			</div>
			{/if}
		</aside>

	<!-- 左カラムの続き（本文・客室・キャンセルポリシー）。右カラムがここまで追従する -->
	<div class="min-w-0 md:col-start-1">
	<!-- プラン本文（A-05 で作成した Markdown） -->
	<!-- 改行は Markdown の breaks:true でそのまま改行になる -->
	{#if data.plan.description}
		<section class="mt-4 max-w-3xl md:mt-6">
			<MarkdownView source={data.plan.description} />
		</section>
	{/if}

	<!-- 仕様表・紹介ブロック（book.plan_contents.specs / sections） -->
	<ContentBlocks specs={data.plan.specs} sections={data.plan.sections} specsTitle={m.plan_detail_specs()} />

	{#if data.gate === 'ok'}
	<!-- 日付選択 -->
	<section class="mt-10 scroll-mt-16 md:scroll-mt-32 lg:scroll-mt-24" id="cal">
		<h2 class="font-display mb-1 text-xl text-brand-900">{m.plan_detail_price_calendar()}</h2>
		<p class="mb-3 text-sm text-stone-500">{m.plan_detail_calendar_sub()}</p>
		{@render conditions(true)}
	</section>
	<ScrollDatePicker bind:open={datePickerOpen} checkin={data.params.checkin} nights={data.params.nights} minDate={todayStr()} days={data.calendar} availableThrough={data.calendarThrough} closed={data.calendarClosed} source={{ facilityId: data.facility.id, planId: data.plan.id, adults: data.params.adults, months: 6, preview: data.preview }} guests={{ adults: data.params.adults, maxAdults: 6, rooms: data.params.rooms ?? 1, maxRooms: data.multiRoom ? MAX_ROOMS_PER_BOOKING : undefined }} onSelect={chooseDate} />

	<!-- 客室選択 -->
	<section class="mt-10 scroll-mt-16 md:scroll-mt-32 lg:scroll-mt-24" id="rooms">
		<h2 class="font-display mb-3 text-xl text-brand-900">{picked ? m.plan_detail_chosen_room() : m.plan_detail_select_room()}</h2>
		{#if form?.message}
			<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}
		{#if !data.params.checkin}
			<p class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.plan_detail_select_date()}</p>
		{/if}
		{#if loadingRooms}
			<!-- 料金を取り直している最中: 客室カードの形のシマー -->
			<div class="mt-3 space-y-3" aria-busy="true" aria-label={m.common_loading()}>
				{#each Array.from({ length: skeletonCount }, (_, i) => i) as i (i)}
					<div class="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center">
						<div class="shimmer-block h-24 w-full shrink-0 sm:w-40" aria-hidden="true"></div>
						<div class="flex-1 space-y-2">
							<div class="shimmer h-5 w-3/4"></div>
							<div class="shimmer h-3 w-1/3 opacity-70"></div>
							<div class="shimmer h-3 w-24 opacity-70"></div>
						</div>
						<div class="flex flex-col items-end gap-2">
							<div class="shimmer h-3 w-24 opacity-70"></div>
							<div class="shimmer h-6 w-28"></div>
							<div class="shimmer h-9 w-44"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
		{#if picked}
			<div class="mt-3" in:fly|global={{ y: 8, duration: 280 }}>{@render roomCard(picked)}</div>
			{#if otherRooms.length > 0}
				<button type="button" onclick={() => (showOthers = !showOthers)} aria-expanded={showOthers} class="mt-4 text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-900">
					{showOthers ? m.plan_detail_other_rooms_hide() : m.plan_detail_other_rooms({ n: String(otherRooms.length) })}
				</button>
			{/if}
		{/if}
		<!-- 選んだ客室がその日は満室なら、ほかの客室を最初から開いておく -->
		{#if !picked || showOthers || (data.params.checkin && !chosen)}
		<div class="mt-3 space-y-3">
			{#each otherRooms as r, i}
				<!-- 読み込みが済んだら上から順にふわっと出す -->
				<div in:fly|global={{ y: 8, duration: 280, delay: Math.min(i, 6) * 70 }}>{@render roomCard(r)}</div>
			{/each}
		</div>
		{/if}
		{/if}
	</section>
	{/if}

	<PerkModal bind:content={perkContent} />
	<RoomInfoModal bind:room={infoRoom} pageHref={(room) => `${base}/rooms/${room.slug}`} />

	<!-- キャンセルポリシー -->
	<section class="mt-10 max-w-3xl rounded-xl bg-stone-100 p-5 text-sm">
		<h2 class="mb-2 font-medium">{m.plan_detail_cancel_policy()}</h2>
		<p class="text-stone-600">{data.plan.cancellationPolicy.note}</p>
	</section>
	</div>
	</div>
</div>

<!-- モバイル: 下部固定の料金バー（客室セクション表示中は隠す） -->
{#if !roomsInView && cart.length === 0 && data.gate === 'ok'}
	<div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1 leading-tight">
				{#if chosen?.quote}
					<p class="truncate text-[11px] text-stone-500">{chosen.room.name}</p>
					<p class="text-lg font-bold text-brand-900">
						{formatPrice(chosen.quote.total)}<span class="ml-0.5 whitespace-nowrap text-[11px] font-normal text-stone-500">{m.plan_price_tax_incl()}</span>
					</p>
					<p class="truncate text-[11px] text-stone-500">{m.plan_price_pp_night({ price: formatPrice(perPersonNight(chosen.quote.total)) })}</p>
				{:else if cheapest}
					<p class="truncate text-[11px] text-stone-500">{totalSub()}</p>
					<p class="text-lg font-bold text-brand-900">
						{formatPrice(cheapest.total)}〜<span class="ml-0.5 whitespace-nowrap text-[11px] font-normal text-stone-500">{m.plan_price_tax_incl()}</span>
					</p>
					<p class="truncate text-[11px] text-stone-500">{m.plan_price_pp_night({ price: formatPrice(perPersonNight(cheapest.total)) })}〜</p>
				{:else if soldOut}
					<p class="text-xs text-stone-500">{m.plan_price_sold_out()}</p>
				{:else if data.plan.basePrice > 0}
					<p class="text-lg font-bold text-brand-900">
						{formatPrice(data.plan.basePrice)}<span class="text-[11px] font-normal text-stone-500">{m.plan_card_base_price()}</span>
					</p>
				{:else}
					<p class="text-xs text-stone-500">{m.plan_price_cta_dates()}</p>
				{/if}
			</div>
			{#if chosen && multiSearch}
				<!-- 2 室以上で検索: このバーから予約リストに追加（入れたあとはこのバーの代わりに予約リストのバーが出る） -->
				<button type="button" onclick={() => (cartFull ? (cartMessage = fullNotice()) : addToCart(chosen!))} class="shrink-0 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500">{m.cart_add_to_list()}</button>
			{:else if chosen}
				<!-- 選んだ客室はこのバーから予約へ進める -->
				<form method="POST" action="?/hold" use:enhance class="shrink-0">
					<input type="hidden" name="planId" value={data.plan.id} />
					<input type="hidden" name="roomTypeId" value={chosen.room.id} />
					<input type="hidden" name="checkin" value={data.params.checkin} />
					<input type="hidden" name="nights" value={data.params.nights} />
					<input type="hidden" name="adults" value={data.params.adults} />
					<input type="hidden" name="back" value={backHref(chosen.room.slug)} />
					<input type="hidden" name="via" value={via} />
					<button type="submit" class="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500">{m.plan_detail_book()}</button>
				</form>
			{:else if cheapest}
				<a href="#rooms" class="shrink-0 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_rooms()}</a>
			{:else}
				<!-- 日付が未指定・満室: その場で料金カレンダー（人数も選べる）を開く -->
				<button type="button" onclick={() => (datePickerOpen = true)} class="shrink-0 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_dates()}</button>
			{/if}
		</div>
	</div>
{/if}

<!-- 予約かご（複数室・M1）。かごに部屋があるときだけ画面下に出す（モバイルの料金バーの代わり） -->
<BookingCart bind:items={cart} bind:message={cartMessage} currentFacilityId={data.facility.id} back={page.url.pathname + page.url.search} {via} target={data.params.rooms} />
