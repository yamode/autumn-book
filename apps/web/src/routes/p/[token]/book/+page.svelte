<script lang="ts">
  // /p/<token>/book: 取引先の予約入力（PartnerBookInput）。
  // 特別会員の専用ページには確認画面が無い（2026-11-27〜）: GET は料金カレンダーのプラン詳細へ戻し（+page.server.ts）、
  // プラン詳細・かごの「予約へ進む」（POST）は仮押さえして公式の予約入力（/booking/hold）へ進む。
  import PartnerBookInput from './PartnerBookInput.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string } } = $props();
</script>

<PartnerBookInput {data} {form} />
