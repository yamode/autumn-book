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
  <p class="mt-1 text-sm text-stone-500">料金・空室は<a class="underline" href={`/p/${token}/calendar`}>料金カレンダー</a>でご確認ください。</p>

  {#if data.commonPerks.length}
    <!-- 全プラン共通の取引先特典（取引先専用ページからのご予約に付く） -->
    <section class="mt-5 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 sm:px-5">
      <p class="text-sm font-bold text-[var(--pt-accent)]">貴社限定特典（すべてのプラン）</p>
      <ul class="mt-1.5 grid gap-1.5">
        {#each data.commonPerks as k (k.id)}
          <li><span class="font-medium">{k.title}</span>{#if k.description}<span class="block whitespace-pre-wrap text-sm text-stone-600">{k.description}</span>{/if}</li>
        {/each}
      </ul>
      <p class="mt-1.5 text-xs text-stone-500">このページからご予約いただいた場合に付きます。</p>
    </section>
  {/if}

  {#if data.plans.length === 0}
    <p class="mt-8 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるプランの紹介はまだありません。</p>
  {:else}
    <div class="mt-6 space-y-8">
      {#each data.plans as p (p.anchor)}
        <article id={p.anchor} class="scroll-mt-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
          <header class="mb-4">
            <div class="flex flex-wrap items-center gap-1.5">
              {#if p.mealPlan}<span class="rounded-full bg-brand-900 px-2.5 py-0.5 text-xs text-white">{mealLabel(p.mealPlan)}</span>{/if}
              {#each p.tags as t (t)}<span class="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs text-accent-600">{t}</span>{/each}
              {#if p.perks.length}<span class="rounded-full bg-[var(--pt-accent)] px-2.5 py-0.5 text-xs font-bold text-white">貴社限定特典</span>{/if}
            </div>
            <h3 class="mt-2 text-xl font-bold leading-snug">{displayPlanName(p.planLabel)}</h3>
            {#if p.headline}<p class="mt-1 text-stone-500">{p.headline}</p>{/if}
            {#if p.perks.length}
              <div class="mt-3 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2.5">
                <p class="text-xs font-bold text-[var(--pt-accent)]">貴社限定特典</p>
                <ul class="mt-1 grid gap-1.5 text-sm">
                  {#each p.perks as k (k.id)}
                    <li><span class="font-medium">{k.title}</span>{#if k.description}<span class="block whitespace-pre-wrap text-stone-600">{k.description}</span>{/if}</li>
                  {/each}
                </ul>
              </div>
            {/if}
          </header>
          <PartnerContentBody photos={p.photos} description={p.description} specs={p.specs} sections={p.sections} detailLabel="お料理・プランの内容" />
          <p class="mt-4 text-right">
            <a href={`/p/${token}/calendar`} class="inline-block rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">料金カレンダーで料金・空室を見る</a>
          </p>
        </article>
      {/each}
    </div>
  {/if}
</main>
