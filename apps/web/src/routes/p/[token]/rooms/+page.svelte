<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: お部屋（部屋タイプ）の紹介。文章・写真は公式サイト（autumn-book）と共通。
  // 各部屋の「この部屋の空室・料金を見る」で、その部屋だけの空室カレンダーを開き、日を選ぶと
  // 料金カレンダーへその日程で移って、その部屋のカードまでスクロールする。
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
  import PartnerRoomCalendarModal from '$lib/components/PartnerRoomCalendarModal.svelte';
  import { roomAnchor, roomParts } from '$lib/partner-contents';

  let { data } = $props();
  const token = $derived($page.params.token);

  // 部屋カレンダーの条件: 1泊・1室。人数は大人2名を定員の範囲に収めたもの（料金カレンダー側で変えられる）
  let calendarRoom = $state<{ code: string; name: string } | null>(null);
  let guests = $state(2);
  function openCalendar(r: (typeof data.rooms)[number]) {
    guests = Math.min(Math.max(2, r.capacityMin || 1), r.capacityMax || 6);
    calendarRoom = { code: r.code, name: r.name };
  }
  function pick(date: string) {
    const code = calendarRoom?.code;
    calendarRoom = null;
    const q = new URLSearchParams({ date, nights: '1', guests: String(guests), rooms: '1' });
    if (code) q.set('room', code);
    void goto(`/p/${token}/calendar?${q}`);
  }
</script>

<svelte:head><title>{partnerTitle(data.portal, 'お部屋のご紹介')}</title><meta name="robots" content="noindex, nofollow" /></svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h2 class="text-2xl font-bold">お部屋のご紹介</h2>
  <p class="mt-1 text-sm text-stone-500">料金・空室は<a class="underline" href={`/p/${token}/calendar`}>料金カレンダー</a>でご確認ください。</p>

  {#if data.portal.noFacilityMessage}
    <!-- オンの施設が1つも無い取引先（N9・2026-10-09）: 紹介は出さない（案内はヘッダーの下に出ている） -->
  {:else if data.rooms.length === 0}
    <p class="mt-8 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるお部屋の紹介はまだありません。</p>
  {:else}
    <nav class="mt-4 flex flex-wrap gap-1.5 text-sm" aria-label="お部屋の一覧">
      {#each data.rooms as r (r.code)}
        <a href={`#${roomAnchor(r.code)}`} class="rounded-full border border-stone-300 bg-white px-3 py-1 hover:border-brand-900">{r.shortName || roomParts(r.name).room}</a>
      {/each}
    </nav>

    <div class="mt-6 space-y-8">
      {#each data.rooms as r (r.code)}
        {@const parts = roomParts(r.name)}
        <article id={roomAnchor(r.code)} class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
          <header class="mb-4">
            {#if parts.building}<p class="text-xs tracking-wider text-stone-500">{parts.building}</p>{/if}
            <h3 class="text-xl font-bold leading-snug">{parts.room}</h3>
            <p class="mt-1 text-sm text-stone-500">
              {#if r.headline && r.headline !== r.name}{r.headline}・{/if}定員 {r.capacityMin === r.capacityMax ? r.capacityMax : `${r.capacityMin}〜${r.capacityMax}`}名
            </p>
          </header>
          <PartnerContentBody photos={r.photos} description={r.description} specs={r.specs} sections={r.sections} amenities={r.amenities} detailLabel="浴室・アメニティ・設備">
            {#snippet actions()}
              <button type="button" onclick={() => openCalendar(r)} class="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--pt-accent)] px-5 py-3 text-base font-bold text-white hover:opacity-90">
                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>
                この部屋の空室・料金を見る
              </button>
            {/snippet}
          </PartnerContentBody>
        </article>
      {/each}
    </div>
  {/if}
</main>

<PartnerRoomCalendarModal
  bind:room={calendarRoom}
  token={token ?? ''}
  {guests}
  nights={1}
  rooms={1}
  showInventory={data.showInventory}
  today={data.today}
  selected=""
  onPick={pick}
/>
