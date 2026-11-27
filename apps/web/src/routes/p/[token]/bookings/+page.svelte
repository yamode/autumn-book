<script lang="ts">
  // /p/<token>/bookings: 取引先の予約一覧（PartnerBookingList）。
  // 特別会員の専用ページは管理者の確認モードだけここへ来る（会員さまはマイページへ転送・v0.355.0）。そのときの data は { portal, member } だけ。
  import PartnerBookingList from './PartnerBookingList.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; cancelled?: string } } = $props();
</script>

{#if data.portal.kind === 'member' && data.member}
  <main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
    <h2 class="text-xl font-bold text-brand-900">ご予約一覧</h2>
    <p class="mt-4 rounded-xl border border-stone-200 bg-white p-6 text-base leading-7 text-stone-600" role="status">{data.member.message}</p>
  </main>
{:else}
  <PartnerBookingList {data} {form} />
{/if}
