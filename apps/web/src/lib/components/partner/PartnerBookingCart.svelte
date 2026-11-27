<script lang="ts">
  // 特別会員の専用ページのかごバー（docs/vip-member-page.md §13.4.3）。公式の BookingCart.svelte をそのまま使う。
  //   特別料金のかごとして、送り先（POST /p/<token>/book・rooms は memberCart.payload()・facility_id を足す）・
  //   上限（min(4, 最大室数)）・注記（金額は目安）・保存（memberCart＝sessionStorage の ab_member_cart_v1）を props で渡す。
  //   「N部屋中 M部屋 選択済み」は URL の rooms（検索した室数。stay-page.ts と同じ丸め）から出す。Turnstile は付けない（Q4）。
  import { page } from '$app/stores';
  import BookingCart from '$lib/components/BookingCart.svelte';
  import { memberCart } from '$lib/member-cart.svelte';
  import type { MemberCartItem } from '$lib/partner-member-page';
  import * as m from '$lib/paraglide/messages';

  let {
    token,
    limit,
    currentFacilityId,
    preview = false
  }: {
    token: string;
    /** 1 回の予約の室数の上限（min(4, 最大室数)） */
    limit: number;
    /** いま見ている施設（かごが別の施設なら一言添える） */
    currentFacilityId: string;
    /** 管理画面の確認モード（送信を止める） */
    preview?: boolean;
  } = $props();

  // 検索した室数（料金カレンダー等の ?rooms=。無いページは 1＝かごの室数だけで判断）
  const target = $derived(Math.min(limit, Math.max(1, Math.round(Number($page.url.searchParams.get('rooms') ?? 1)) || 1)));
  const first = $derived(memberCart.items[0]);
</script>

<BookingCart
  items={memberCart.items}
  bind:message={memberCart.message}
  {currentFacilityId}
  {target}
  {limit}
  action={`/p/${token}/book`}
  payload={memberCart.payload()}
  fields={first ? { facility_id: first.facilityId } : {}}
  groupKey={(c: MemberCartItem) => `${c.planCode}■${c.planName}`}
  planLabel={(c: MemberCartItem) => c.displayName || c.planName}
  note={m.cart_estimate_note()}
  otherFacilityNotice={m.cart_other_facility()}
  blocked={preview ? m.cart_preview_blocked() : ''}
  onremove={(key) => memberCart.remove(key)}
  onclear={() => memberCart.clear()}
  containerClass="max-w-6xl px-4 sm:px-6"
/>
