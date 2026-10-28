<script lang="ts">
  // 取引先専用ページ「お部屋とプラン」の検索バーから開く日付パネル。見た目と操作は共通部品 StaySearchPanel
  // （HP 配布の <yamado-search-bar> と同じもの）。ここでは取引先の料金（token 付きの月データ）を読み、日ごとの表示を渡す。
  // 泊数を変えると、どこかの部屋・プランで全泊空いている日だけに料金（1名1泊の最安）を出す。
  // 日付を押しても閉じず、「この日程で検索」で確定する。
  // プラン詳細（日付未定）から開くときは filter で部屋・プランを絞り、日付を押したらその日の料金（offer）を onPick で返す
  // （プラン詳細をその日の料金で表示し直す）。
  // 見出しの「日付指定なし」で日付を外せる（検索バーでは日付なしで検索、プラン詳細では onUndated で日付未定に戻す）。
  import StaySearchPanel, { type StayDayView } from './stay-search/StaySearchPanel.svelte';
  import { partnerStayOffers, type PartnerStayOffer } from '$lib/partner-stay';
  import { fetchPortalMonth, type PortalMonthJson } from '$lib/partner-month-client';
  import { shiftYm } from '$lib/stay-search/params';

  let {
    token,
    date = $bindable(''),
    nights = $bindable(1),
    guests,
    rooms = 1,
    maxNights,
    showInventory,
    today,
    filter = null,
    pickApplies = false,
    isBookable,
    onApply,
    onPick,
    onUndated,
    onClose
  }: {
    token: string;
    date: string;
    nights: number;
    guests: number;
    /** 室数（残室を見せる取引先は、残室が足りない日を除く） */
    rooms?: number;
    maxNights: number;
    showInventory: boolean;
    today: string;
    /** 部屋・プランを絞る（プラン詳細から開いたとき）。null ならすべての部屋・プランの最安 */
    filter?: { roomCode: string; planCode: string; planName: string } | null;
    /** 日付を押したらすぐ onPick する（「この日程で検索」ボタンを出さない） */
    pickApplies?: boolean;
    /** pickApplies のとき: 押した日・泊数・その日のいちばん安い料金 */
    onPick?: (date: string, nights: number, offer: PartnerStayOffer) => void;
    /** pickApplies のとき:「日付指定なし」に戻した */
    onUndated?: () => void;
    /** 予約を受け付ける日か（受付締切を過ぎた日は押せなくする）。省略時はすべて */
    isBookable?: (iso: string) => boolean;
    onApply: () => void;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let leftYm = $state((date || today).slice(0, 7));
  let months = $state<PortalMonthJson[]>([]);
  let loading = $state(false);
  let failed = $state(false);

  // 表示する2か月＋連泊の判定用に次の月
  $effect(() => {
    const yms = [leftYm, shiftYm(leftYm, 1), shiftYm(leftYm, 2)];
    const g = guests;
    let cancelled = false;
    loading = true;
    failed = false;
    Promise.all(yms.map((ym) => fetchPortalMonth(token, ym, g).catch(() => null)))
      .then((ms) => {
        if (cancelled) return;
        months = ms.filter((m): m is PortalMonthJson => !!m);
        failed = !ms[0];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  const bounds = $derived(months[0]?.bounds ?? null);
  const index = $derived(new Map(months.flatMap((m) => m.days.map((d) => [d.date, d] as const))));
  const latestYm = $derived(bounds ? bounds.latest.slice(0, 7) : shiftYm(today.slice(0, 7), 12));

  const inRange = (iso: string) => !!bounds && iso >= bounds.earliest && iso <= bounds.latest;
  /** その日に泊まれるいちばん安い部屋・プラン（無ければ null） */
  function offerOf(iso: string): PartnerStayOffer | null {
    if (!inRange(iso) || (isBookable && !isBookable(iso))) return null;
    const offers = partnerStayOffers((x) => index.get(x), iso, nights, guests, { showInventory, rooms, roomCode: filter?.roomCode, planCode: filter?.planCode, planName: filter?.planName });
    return offers?.[0] ?? null;
  }
  function day(iso: string): StayDayView {
    const offer = offerOf(iso);
    const mark = !inRange(iso) ? '' : index.get(iso)?.closed === true ? 'closed' : iso >= today ? 'dash' : '';
    return { price: offer ? offer.perPerson : null, disabled: !offer, mark: offer ? '' : mark };
  }
</script>

<StaySearchPanel
  bind:date
  bind:nights
  bind:leftYm
  {guests}
  {rooms}
  {maxNights}
  {today}
  {latestYm}
  {loading}
  {failed}
  {day}
  {pickApplies}
  onPick={(iso) => {
    const offer = offerOf(iso);
    if (offer) onPick?.(iso, nights, offer);
  }}
  {onUndated}
  {onApply}
  {onClose}
  onEscape={() => {
    if (!document.querySelector('[data-room-info]')) onClose();
  }}
/>
