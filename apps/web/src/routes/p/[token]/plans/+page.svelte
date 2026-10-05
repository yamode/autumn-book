<script lang="ts">
  // 取引先専用ページ: プランの紹介。文章・写真は公式サイト（autumn-book）と共通。
  // 出すのは、この取引先に料金を出しているプランのうち、紹介が登録されているものだけ。
  import { page } from '$app/stores';
  import PartnerContentSections from '$lib/components/PartnerContentSections.svelte';
  import PartnerPhotoGallery from '$lib/components/PartnerPhotoGallery.svelte';
  import PartnerPlanCalendar from '$lib/components/PartnerPlanCalendar.svelte';
  import PartnerTermsTable from '$lib/components/PartnerTermsTable.svelte';
  import PartnerPerkList from '$lib/components/PartnerPerkList.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';

  let { data } = $props();
  const token = $derived($page.params.token);
  const mealLabel = (m: string) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : m);
</script>

<svelte:head><title>プランのご紹介｜{data.portal.facilityName}</title></svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h2 class="text-2xl font-bold">プランのご紹介</h2>
  <p class="mt-1 text-sm text-stone-500">各プランの下で2か月分の料金・空室をご覧いただけます。全プランまとめては<a class="underline" href={`/p/${token}/calendar`}>料金カレンダー</a>へ。</p>

  {#if data.commonPerks.length}
    <!-- 全プラン共通の専用特典（取引先専用ページからのご予約に付く） -->
    <section class="mt-5 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 sm:px-5">
      <p class="text-sm font-bold text-[var(--pt-accent)]">専用特典（すべてのプラン）</p>
      <div class="mt-2"><PartnerPerkList perks={data.commonPerks} /></div>
      <p class="mt-1.5 text-xs text-stone-500">このページからご予約いただいた場合に付きます。</p>
    </section>
  {/if}

  {#if data.plans.length === 0}
    <p class="mt-8 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるプランの紹介はまだありません。</p>
  {:else}
    <div class="mt-6 space-y-8">
      {#each data.plans as p (p.anchor)}
        <!-- 1カラム: 見出し → 写真ギャラリー → プランの紹介（説明・表・専用特典・お料理）→ 料金カレンダー（2か月）→ キャンセルポリシー・お子様 -->
        <article id={p.anchor} class="scroll-mt-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
          <header class="mb-4">
            <div class="flex flex-wrap items-center gap-1.5">
              {#if p.mealPlan}<span class="rounded-full bg-brand-900 px-2.5 py-0.5 text-xs text-white">{mealLabel(p.mealPlan)}</span>{/if}
              {#each p.tags as t (t)}<span class="rounded-full bg-accent-500/10 px-2.5 py-0.5 text-xs text-accent-600">{t}</span>{/each}
              {#if p.perks.length}<span class="rounded-full bg-[var(--pt-accent)] px-2.5 py-0.5 text-xs font-bold text-white">専用特典</span>{/if}
            </div>
            <h3 class="mt-2 text-xl font-bold leading-snug sm:text-2xl">{p.displayName}</h3>
            {#if p.headline}<p class="mt-1 text-stone-500">{p.headline}</p>{/if}
          </header>

          <PartnerPhotoGallery photos={p.photos} wide />

          <div class="mt-6 space-y-8">
            {#if p.description || p.specs.length}
              <div class="space-y-4">
                {#if p.description}<p class="whitespace-pre-line leading-8">{p.description}</p>{/if}
                {#if p.specs.length}
                  <PartnerTermsTable title="" rows={p.specs.map((x) => ({ label: x.label, value: x.value }))} />
                {/if}
              </div>
            {/if}

            {#if p.perks.length}
              <div class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-3 sm:px-4">
                <p class="text-sm font-bold text-[var(--pt-accent)]">専用特典</p>
                <div class="mt-2"><PartnerPerkList perks={p.perks} /></div>
              </div>
            {/if}

            {#each p.officialPerks ?? [] as op (op.key)}
              <!-- 公式HP限定特典（取引先の設定で出すときだけ） -->
              <div class="rounded-lg border border-teal-600/30 bg-teal-50 px-3 py-3 sm:px-4">
                <p class="text-sm font-bold text-teal-800">{op.label}</p>
                <div class="mt-2"><MarkdownView source={op.body} /></div>
              </div>
            {/each}

            <PartnerContentSections sections={p.sections} heading="お料理・プランの内容" />

            <PartnerPlanCalendar token={token ?? ''} planCode={p.planCode} planName={p.planLabel} showInventory={data.showInventory} booking={data.booking} rooms={data.rooms} from={`/p/${token}/plans#${p.anchor}`} />

            {#if p.terms}
              <PartnerTermsTable title="キャンセルポリシー" rows={p.terms.cancellation} note={p.terms.cancellationNote} />
              <PartnerTermsTable title="お子様について" rows={p.terms.children} note={p.terms.childrenNote} />
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</main>
