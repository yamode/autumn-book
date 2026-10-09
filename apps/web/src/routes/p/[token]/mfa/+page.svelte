<script lang="ts">
  // 取引先ページの本人確認（ステップアップ・docs/auth-hardening.md §6.2〜6.4・S3）。
  // 確認が済んだら next（元の画面）へ戻る。初版はメールの認証コードのみ（パスキーは S6 で PartnerStepUp に足す）。
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { partnerTitle } from '$lib/partner-title';
  import PartnerStepUp from '$lib/components/PartnerStepUp.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const token = $derived($page.params.token ?? '');

  async function done() {
    await goto(data.next, { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '本人確認')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-10 sm:py-14">
  <div class="rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
    <h2 class="mb-2 text-2xl font-bold">本人確認</h2>
    <p class="mb-5 text-sm leading-6 text-stone-600">
      {#if data.gated}
        安全のため、続けてご利用いただく前に本人確認をお願いしています。
      {:else}
        この操作（カードの登録・保存済みカードでのご予約・ユーザー管理など）の前に、本人確認をお願いしています。確認は12時間有効です。
      {/if}
    </p>
    <PartnerStepUp
      {token}
      maskedEmail={data.maskedEmail}
      methods={data.methods}
      initialWaitSec={data.waitSec}
      initialOpen={data.open}
      securityHref={`/p/${token}/account/security`}
      onverified={done}
    />
    <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4 text-sm">
      {#if !data.gated}
        <a href={data.next} class="text-stone-500 underline">確認せずに戻る</a>
      {:else}
        <span></span>
      {/if}
      <form method="POST" action={`/p/${token}/logout`}>
        <button type="submit" class="text-stone-500 underline">ログアウト</button>
      </form>
    </div>
  </div>
</main>
