<script lang="ts">
  // /p/<token>/book: 取引先の予約入力（PartnerBookInput）と、特別会員の専用ページの確認画面（MemberBookConfirm）の切替。
  // 特別会員のときの data は { portal, member } だけ（取引先の項目は無い・docs/vip-member-page.md §14.4・§14.7）。
  import PartnerBookInput from './PartnerBookInput.svelte';
  import MemberBookConfirm from './MemberBookConfirm.svelte';
  import type { PageData } from './$types';

  type MemberForm = { message?: string; code?: string; soldOut?: { roomTypeId: string; roomName: string }[] };
  let { data, form }: { data: PageData; form?: { message?: string } & MemberForm } = $props();
</script>

{#if data.portal.kind === 'member' && data.member}
  <MemberBookConfirm data={data.member} {form} />
{:else}
  <PartnerBookInput {data} {form} />
{/if}
