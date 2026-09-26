<script lang="ts">
  // 取引先専用ページ: プランの紹介。文章・写真は公式サイト（autumn-book）と共通。
  // 出すのは、この取引先に料金を出しているプランのうち、紹介が登録されているものだけ。
  import { page } from '$app/stores';
  import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
  import { displayPlanName } from '$lib/partner-contents';

  let { data } = $props();
  const token = $derived($page.params.token);
  const mealLabel = (m: string) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : m);
</script>

<svelte:head><title>プランのご紹介｜{data.portal.facilityName}</title></svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h2 class="text-2xl font-bold">プランのご紹介</h2>
  <p class="mt-1 text-sm text-[var(--pt-muted)]">料金・空室は<a class="underline" href={`/p/${token}/calendar`}>料金カレンダー</a>でご確認ください。</p>

  {#if data.plans.length === 0}
    <p class="mt-8 rounded-xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 text-center text-[var(--pt-muted)]">ご案内できるプランの紹介はまだありません。</p>
  {:else}
    <div class="mt-6 space-y-8">
      {#each data.plans as p (p.anchor)}
        <article id={p.anchor} class="scroll-mt-4 rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-4 shadow-sm sm:p-6">
          <header class="mb-4">
            <div class="flex flex-wrap items-center gap-1.5">
              {#if p.mealPlan}<span class="rounded-full bg-[var(--pt-ink)] px-2.5 py-0.5 text-xs text-white">{mealLabel(p.mealPlan)}</span>{/if}
              {#each p.tags as t (t)}<span class="rounded-full bg-[var(--pt-gold-soft)] px-2.5 py-0.5 text-xs text-[var(--pt-gold-deep)]">{t}</span>{/each}
            </div>
            <h3 class="mt-2 text-xl font-bold leading-snug">{displayPlanName(p.planLabel)}</h3>
            {#if p.headline}<p class="mt-1 text-[var(--pt-muted)]">{p.headline}</p>{/if}
          </header>
          <PartnerContentBody photos={p.photos} description={p.description} specs={p.specs} sections={p.sections} detailLabel="お料理・プランの内容" />
          <p class="mt-4 text-right">
            <a href={`/p/${token}/calendar`} class="inline-block rounded-full bg-[var(--pt-accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90">料金カレンダーで料金・空室を見る</a>
          </p>
        </article>
      {/each}
    </div>
  {/if}
</main>
