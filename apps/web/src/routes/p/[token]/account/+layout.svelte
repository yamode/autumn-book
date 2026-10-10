<script lang="ts">
  // 取引先専用ページ: アカウント（2026-10-01「マイページ」から改名）。タブで 担当者情報／ご請求書／ユーザー管理（マスタのみ）。
  // タブの表示だけここで決める。ユーザー管理の読み書きはサーバ側（store.ts の requireMasterAccount）で毎回確かめる。
  import { page } from '$app/stores';
  import { accountTabs } from '$lib/partner-account-roles';

  let { children } = $props();
  const portal = $derived($page.data.portal as { loginId?: string | null; isMaster?: boolean } | undefined);
  const tabs = $derived(accountTabs(portal?.isMaster === true));
  const base = $derived(`/p/${$page.params.token}/account`);
  const current = $derived($page.url.pathname.replace(/\/+$/, '').slice(base.length).split('/')[1] ?? '');
</script>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <h2 class="text-2xl font-bold">アカウント</h2>
  {#if portal?.loginId}
    <p class="mt-1 text-sm text-stone-500">
      ログインID: <span class="font-mono text-brand-900">{portal.loginId}</span>
      <span class="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{portal.isMaster ? 'マスタユーザー' : 'ユーザー'}</span>
    </p>
  {/if}

  <!-- 下線は inset の影で描く（-mb-px で下へはみ出すと縦スクロールバーが出るため）。横にはみ出す幅ではスクロールできるが、バーは隠す -->
  <nav class="mt-5 flex gap-1 overflow-x-auto overflow-y-hidden text-sm shadow-[inset_0_-1px_0_var(--color-stone-200,#e7e5e4)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="アカウントのメニュー">
    {#each tabs as tab}
      {@const active = current === tab.path}
      <a
        href={tab.path ? `${base}/${tab.path}` : base}
        aria-current={active ? 'page' : undefined}
        class={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2 transition ${active ? 'border-[var(--pt-accent)] font-medium text-brand-900' : 'border-transparent text-stone-500 hover:text-brand-800'}`}
      >
        {tab.label}
      </a>
    {/each}
  </nav>

  <div class="mt-5">
    {@render children()}
  </div>
</main>
