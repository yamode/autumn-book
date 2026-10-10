<script lang="ts">
  // 取引先ページの本人確認（ステップアップ・docs/auth-hardening.md §6.2〜6.5・S3／S6）。
  // 確認が済んだら next（元の画面）へ戻る。方法はパスキーとメールの認証コード（PartnerStepUp）。
  // passkey_only でパスキーが 0 のアカウントは、パスワード設定リンクから入った直後だけ、ここで最初のパスキーを登録 → そのまま確認する。
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { partnerTitle } from '$lib/partner-title';
  import PartnerStepUp from '$lib/components/PartnerStepUp.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const token = $derived($page.params.token ?? '');

  async function done() {
    await goto(data.next, { invalidateAll: true });
  }

  // ---- passkey_only の初回登録（§6.8） ----
  let regBusy = $state(false);
  let regMessage = $state('');
  async function registerAndVerify() {
    if (regBusy) return;
    regBusy = true;
    regMessage = '';
    try {
      const { registerPasskey, stepUpWithPasskey } = await import('$lib/partner-passkey-client');
      const r = await registerPasskey(token, '');
      if (!r.ok) {
        regMessage = r.message;
        return;
      }
      // 登録したパスキーで、続けて本人確認する（登録だけでは本人確認済みにしない）
      const v = await stepUpWithPasskey(token);
      if (v.ok) await done();
      else {
        // 画面を読み直すと、登録したパスキーでの確認ボタンに切り替わる
        await invalidateAll();
      }
    } finally {
      regBusy = false;
    }
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
    {#if data.bootstrap}
      <div class="space-y-3">
        <p class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2.5 text-sm leading-6 text-brand-900">
          この取引先では、ログインのたびにパスキーでの本人確認が必要です。まず、この端末にパスキーを登録してください（端末の生体認証・PIN を使います）。
        </p>
        {#if regMessage}<p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{regMessage}</p>{/if}
        <button type="button" onclick={() => void registerAndVerify()} disabled={regBusy} class="w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
          {regBusy ? '登録しています…' : 'パスキーを登録して続ける'}
        </button>
        <p class="text-xs leading-5 text-stone-500">{data.oneIdNotice}</p>
      </div>
    {:else}
      <PartnerStepUp
        {token}
        maskedEmail={data.maskedEmail}
        methods={data.methods}
        initialWaitSec={data.waitSec}
        initialOpen={data.open}
        securityHref={`/p/${token}/account/security`}
        passkeyOnly={data.policy === 'passkey_only'}
        onverified={done}
      />
    {/if}
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
