<script lang="ts">
  // 取引先専用ページ: 紹介の説明ブロック（お料理など）を見出しごとのカードで見せる（2026-10-03）。
  // 見出し（夕食・朝食など）→ 区切り線 → 写真（左）と タイトル・説明・注意事項（右）。スマホは写真の下に文章。
  import { groupSections, type ContentSection } from '$lib/partner-contents';

  let { sections, heading = '' }: { sections: ContentSection[]; heading?: string } = $props();
  const groups = $derived(groupSections(sections));
</script>

{#if groups.length}
  <section>
    {#if heading}<h4 class="mb-3 text-lg font-bold">{heading}</h4>{/if}
    <div class="space-y-4">
      {#each groups as g, gi (gi)}
        <div class="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
          {#if g.group}
            <p class="text-base font-bold">{g.group}</p>
            <hr class="mb-4 mt-3 border-stone-200" />
          {/if}
          <div class="space-y-6">
            {#each g.items as s, si (si)}
              <div class={`grid gap-4 ${s.photo ? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6' : ''}`}>
                {#if s.photo}<img src={s.photo} alt={s.title} class="aspect-[4/3] w-full rounded-lg object-cover" loading="lazy" decoding="async" />{/if}
                <div class="min-w-0">
                  {#if s.title}<p class="text-lg font-bold leading-snug">{s.title}</p>{/if}
                  {#if s.text}<p class="mt-3 whitespace-pre-line text-sm leading-7 text-stone-700">{s.text}</p>{/if}
                  {#if s.note}
                    <p class="mt-4 text-sm font-medium text-rose-600">注意事項</p>
                    <p class="mt-1 whitespace-pre-line text-sm leading-7 text-stone-700">{s.note.replace(/^※\s*/, '')}</p>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}
