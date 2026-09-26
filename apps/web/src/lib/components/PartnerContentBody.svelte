<script lang="ts">
  // 取引先専用ページの紹介の本文（写真・説明・仕様の表・説明ブロック）。「お部屋」「プラン」で共通。
  // 配色は取引先ページのレイアウト（/p/[token]/+layout.svelte）の --pt-* を使う。
  import { groupSections, type ContentPhoto, type ContentSection, type ContentSpec } from '$lib/partner-contents';

  let {
    photos,
    description,
    specs,
    sections,
    amenities = [],
    detailLabel = '詳しく見る'
  }: {
    photos: ContentPhoto[];
    description: string;
    specs: ContentSpec[];
    sections: ContentSection[];
    amenities?: string[];
    detailLabel?: string;
  } = $props();

  let current = $state(0);
  const main = $derived(photos[Math.min(current, photos.length - 1)]);
  const groups = $derived(groupSections(sections));
</script>

<div class="grid gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
  <div class="min-w-0">
    {#if main}
      <figure class="overflow-hidden rounded-xl bg-[var(--pt-line)]">
        <img src={main.url} alt={main.caption} class="aspect-[3/2] w-full object-cover" loading="lazy" decoding="async" />
        {#if main.caption}<figcaption class="px-3 py-1.5 text-xs text-[var(--pt-muted)]">{main.caption}</figcaption>{/if}
      </figure>
      {#if photos.length > 1}
        <div class="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="写真">
          {#each photos as p, i (p.url)}
            <button
              type="button"
              class={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 transition ${i === current ? 'border-[var(--pt-accent)]' : 'border-transparent opacity-70 hover:opacity-100'}`}
              onclick={() => (current = i)}
              aria-label={`写真 ${i + 1}`}
              aria-pressed={i === current}
            >
              <img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="flex aspect-[3/2] items-center justify-center rounded-xl bg-[var(--pt-line)] text-sm text-[var(--pt-muted)]">写真は準備中です</div>
    {/if}
  </div>

  <div class="min-w-0 space-y-4">
    {#if description}<p class="whitespace-pre-line leading-7">{description}</p>{/if}
    {#if specs.length}
      <dl class="divide-y divide-[var(--pt-line)] rounded-xl border border-[var(--pt-line)] bg-[var(--pt-surface)] text-sm">
        {#each specs as s (s.label)}
          <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-3 py-2">
            <dt class="font-medium text-[var(--pt-muted)]">{s.label}</dt>
            <dd class="whitespace-pre-line">{s.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
    {#if amenities.length}
      <ul class="flex flex-wrap gap-1.5 text-xs" aria-label="設備">
        {#each amenities as a (a)}<li class="rounded-full bg-[var(--pt-accent-soft)] px-2.5 py-1 text-[var(--pt-accent)]">{a}</li>{/each}
      </ul>
    {/if}
  </div>
</div>

{#if groups.length}
  <details class="group mt-5 rounded-xl border border-[var(--pt-line)] bg-[var(--pt-surface)]">
    <summary class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-[var(--pt-accent)]">
      <span class="inline-block transition group-open:rotate-90">›</span> {detailLabel}
    </summary>
    <div class="space-y-6 border-t border-[var(--pt-line)] px-4 py-5">
      {#each groups as g, gi (gi)}
        <section>
          {#if g.group}<h4 class="mb-3 border-l-4 border-[var(--pt-gold)] pl-2 text-base font-bold">{g.group}</h4>{/if}
          <div class="space-y-4">
            {#each g.items as s, si (si)}
              <div class={`grid gap-3 ${s.photo ? 'sm:grid-cols-[12rem_minmax(0,1fr)]' : ''}`}>
                {#if s.photo}<img src={s.photo} alt={s.title} class="aspect-[3/2] w-full rounded-lg object-cover" loading="lazy" decoding="async" />{/if}
                <div class="min-w-0">
                  {#if s.title}<p class="font-bold">{s.title}</p>{/if}
                  {#if s.text}<p class="mt-1 whitespace-pre-line text-sm leading-7">{s.text}</p>{/if}
                  {#if s.note}<p class="mt-1 text-xs text-[var(--pt-muted)]">※ {s.note.replace(/^※\s*/, '')}</p>{/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </details>
{/if}
