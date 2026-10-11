<script lang="ts">
  // 特別会員の専用ページ: ご予約の詳細（/p/<token>/bookings/<予約番号>・docs/vip-member-page.md §13.4.3b）。
  // 本体は公式マイページの予約詳細と同じ部品（lib/components/booking/ReservationDetail.svelte）。
  // 取消（全室・1 室ずつ）・日程変更（専用料金で計算し直す）・滞在アレンジの追加はここから（公式マイページは参照のみ）。
  // /p は URL に言語が無いので、部品の文言（paraglide）は日本語で出る。
  import { partnerTitle } from '$lib/partner-title';
  import ReservationDetail from '$lib/components/booking/ReservationDetail.svelte';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, `ご予約 ${data.booking.code}`)}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6">
  <nav class="mb-4 text-sm text-stone-500"><a href={data.hrefs.back} class="text-sky-700 hover:underline">ご予約一覧</a> / {data.booking.code}</nav>
  <ReservationDetail
    {data}
    {form}
    facility={{ name: data.facilityName || data.portal.facilityName }}
    hrefs={{ amend: data.hrefs.amend, options: data.hrefs.options }}
    canAmend={data.canAmend}
    memberPage={data.memberPage ? { pageName: data.memberPage.pageName, cancelMode: data.memberPage.cancelMode } : null}
  />
  {#if data.booking.status === 'reserved' && data.booking.payment !== 'onsite' && data.amend.canAmend}
    <p class="mt-4 text-xs leading-5 text-stone-500">事前決済（カード）のご予約は、この画面から日程を変更できません。お手数ですが宿へお問い合わせください。</p>
  {/if}
</main>
