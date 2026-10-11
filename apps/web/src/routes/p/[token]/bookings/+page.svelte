<script lang="ts">
  // /p/<token>/bookings: 取引先の予約一覧（PartnerBookingList）と、特別会員の専用ページの「ご予約一覧」（MemberBookingList）の切替。
  // 特別会員のときの data は { portal, member } だけ（取引先の項目は無い・docs/vip-member-page.md §14.4・§14.7）。
  import PartnerBookingList from './PartnerBookingList.svelte';
  import MemberBookingList from './MemberBookingList.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; cancelled?: string } } = $props();
</script>

{#if data.portal.kind === 'member' && data.member}
  <MemberBookingList data={data.member} />
{:else}
  <PartnerBookingList {data} {form} />
{/if}
