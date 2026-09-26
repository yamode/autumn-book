<script lang="ts">
  // 取引先専用ページ: お部屋（部屋タイプ）の紹介。文章・写真は公式サイト（autumn-book）と共通。
  import { page } from '$app/stores';
  import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
  import { roomAnchor, roomParts } from '$lib/partner-contents';

  let { data } = $props();
  const token = $derived($page.params.token);
</script>

<svelte:head><title>お部屋のご紹介｜{data.portal.facilityName}</title></svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h2 class="text-2xl font-bold">お部屋のご紹介</h2>
  <p class="mt-1 text-sm text-[var(--pt-muted)]">料金・空室は<a class="underline" href={`/p/${token}/calendar`}>料金カレンダー</a>でご確認ください。</p>

  {#if data.rooms.length === 0}
    <p class="mt-8 rounded-xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 text-center text-[var(--pt-muted)]">ご案内できるお部屋の紹介はまだありません。</p>
  {:else}
    <nav class="mt-4 flex flex-wrap gap-1.5 text-sm" aria-label="お部屋の一覧">
      {#each data.rooms as r (r.code)}
        <a href={`#${roomAnchor(r.code)}`} class="rounded-full border border-[var(--pt-line-strong)] bg-[var(--pt-surface)] px-3 py-1 hover:border-[var(--pt-ink)]">{r.shortName || roomParts(r.name).room}</a>
      {/each}
    </nav>

    <div class="mt-6 space-y-8">
      {#each data.rooms as r (r.code)}
        {@const parts = roomParts(r.name)}
        <article id={roomAnchor(r.code)} class="scroll-mt-4 rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-4 shadow-sm sm:p-6">
          <header class="mb-4">
            {#if parts.building}<p class="text-xs tracking-wider text-[var(--pt-muted)]">{parts.building}</p>{/if}
            <h3 class="text-xl font-bold leading-snug">{parts.room}</h3>
            <p class="mt-1 text-sm text-[var(--pt-muted)]">
              {#if r.headline && r.headline !== r.name}{r.headline}・{/if}定員 {r.capacityMin === r.capacityMax ? r.capacityMax : `${r.capacityMin}〜${r.capacityMax}`}名
            </p>
          </header>
          <PartnerContentBody photos={r.photos} description={r.description} specs={r.specs} sections={r.sections} amenities={r.amenities} detailLabel="浴室・アメニティ・設備" />
        </article>
      {/each}
    </div>
  {/if}
</main>
