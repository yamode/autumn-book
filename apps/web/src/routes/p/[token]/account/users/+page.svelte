<script lang="ts">
  // 取引先専用ページ: アカウント → ユーザー管理（マスタユーザーだけ）。子ユーザーの作成・停止/再開・削除・設定リンクの再送。
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { ACCOUNT_STATUS_LABELS } from '$lib/partner-account-roles';
  import type { PageData } from './$types';

  type Issued = { loginId: string; email: string | null; emailSent: boolean; setupUrl: string | null; emailReason: string | null };
  let {
    data,
    form
  }: {
    data: PageData;
    form?: {
      message?: string;
      values?: { login_id: string; display_name: string; email: string };
      created?: Issued;
      resent?: Issued;
      updated?: { loginId: string; active: boolean };
      deleted?: { loginId: string };
    };
  } = $props();

  let busy = $state(false);
  // confirmMessage があれば送信前に確認する（キャンセルなら送らない）
  const submit =
    (confirmMessage?: string): SubmitFunction =>
    ({ cancel }) => {
      if (confirmMessage && !confirm(confirmMessage)) {
        cancel();
        return;
      }
      busy = true;
      return async ({ update }) => {
        busy = false;
        await update({ reset: false });
      };
    };
  const createSubmit: SubmitFunction = () => {
    busy = true;
    return async ({ result, update }) => {
      busy = false;
      // 作成できたらフォームを空にする（失敗時は入力を残す）
      await update({ reset: result.type === 'success' });
    };
  };
  // ブラウザの pattern は v フラグで解釈されるので - はエスケープする
  const LOGIN_ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9._\\-]{3,63}';

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const statusClass: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700',
    disabled: 'bg-stone-100 text-stone-500',
    pending: 'bg-amber-50 text-amber-700'
  };
  const issued = $derived(form?.created ?? form?.resent ?? null);
  const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
  const label = 'mb-1 block text-sm font-medium';
</script>

<svelte:head>
  <title>ユーザー管理 | アカウント | {data.portal.facilityName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section>
  <p class="text-sm leading-6 text-stone-600">
    貴社内でこのページを使う方のログインID（ユーザー）を作れます。作成したユーザーは、ユーザー管理以外のすべて（予約・予約一覧・覚書・請求書・ご自身の担当者情報）を使えます。
    マスタユーザーの追加・停止は宿へご依頼ください。
  </p>

  {#if form?.message}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
  {/if}
  {#if issued}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm leading-6 text-brand-900">
      <p class="font-medium">
        {form?.created ? `ユーザー「${issued.loginId}」を作成しました。` : `「${issued.loginId}」のパスワード設定リンクを発行し直しました。`}
      </p>
      {#if issued.emailSent}
        <p>{issued.email} 宛てにパスワード設定のご案内をお送りしました（リンクの有効期限は7日です）。</p>
      {:else}
        <p class="text-rose-700">メールを送れませんでした{issued.emailReason ? `（${issued.emailReason}）` : ''}。下のリンクをご本人へお伝えください（有効期限7日・ご本人専用）。</p>
        {#if issued.setupUrl}
          <input readonly value={issued.setupUrl} class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1 font-mono text-xs" onfocus={(e) => e.currentTarget.select()} />
        {/if}
      {/if}
    </div>
  {:else if form?.updated}
    <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm text-brand-900">
      「{form.updated.loginId}」を{form.updated.active ? '再開' : '停止'}しました。
    </p>
  {:else if form?.deleted}
    <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm text-brand-900">「{form.deleted.loginId}」を削除しました。</p>
  {/if}

  <!-- ユーザー一覧 -->
  <h3 class="mt-6 text-lg font-bold">ユーザー一覧</h3>
  <ul class="mt-3 space-y-3">
    {#each data.users as u (u.id)}
      <li class="rounded-xl border border-stone-200 bg-white p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-brand-900">{u.loginId}</span>
              <span class={`rounded px-1.5 py-0.5 text-xs ${statusClass[u.status]}`}>{ACCOUNT_STATUS_LABELS[u.status]}</span>
              <span class="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-600">{u.isMaster ? 'マスタ' : '子ユーザー'}</span>
              {#if u.isSelf}<span class="text-xs text-stone-500">（あなた）</span>{/if}
              {#if u.lockedUntil}<span class="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">ロック中</span>{/if}
            </p>
            <p class="mt-1 text-sm">{u.displayName ?? '（お名前未設定）'}{#if u.email}<span class="ml-2 text-stone-500">{u.email}</span>{/if}</p>
            <p class="mt-0.5 text-xs text-stone-500">最終ログイン: {fmt(u.lastLoginAt)}</p>
          </div>
          {#if !u.isMaster}
            <div class="flex flex-wrap gap-2 text-sm">
              {#if u.status !== 'disabled'}
                <form method="POST" action="?/resend" use:enhance={submit()}>
                  <input type="hidden" name="account_id" value={u.id} />
                  <button type="submit" disabled={busy} class="rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50">
                    {u.status === 'pending' ? '設定リンクを再送' : 'パスワード再設定リンクを送る'}
                  </button>
                </form>
              {/if}
              <form method="POST" action="?/toggle" use:enhance={submit(u.status === 'disabled' ? undefined : `「${u.loginId}」を停止します。ログイン中でもすぐに使えなくなります。よろしいですか？`)}>
                <input type="hidden" name="account_id" value={u.id} />
                <input type="hidden" name="op" value={u.status === 'disabled' ? 'enable' : 'disable'} />
                <button type="submit" disabled={busy} class="rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50">
                  {u.status === 'disabled' ? '再開する' : '停止する'}
                </button>
              </form>
              <form method="POST" action="?/delete" use:enhance={submit(`「${u.loginId}」を削除します。元に戻せません。よろしいですか？`)}>
                <input type="hidden" name="account_id" value={u.id} />
                <button type="submit" disabled={busy} class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50">削除</button>
              </form>
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <!-- 子ユーザーの作成 -->
  <form method="POST" action="?/create" use:enhance={createSubmit} class="mt-8 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
    <h3 class="text-lg font-bold">ユーザーを追加する</h3>
    <p class="mt-1 text-sm leading-6 text-stone-600">入力したメールアドレスへ、パスワード設定のご案内（有効期限7日）をお送りします。</p>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="block"><span class={label}>お名前 <em class="req">必須</em></span><input name="display_name" value={form?.values?.display_name ?? ''} required maxlength="80" class={input} /></label>
      <label class="block"><span class={label}>メールアドレス <em class="req">必須</em></span><input name="email" type="email" value={form?.values?.email ?? ''} required maxlength="254" autocomplete="off" class={input} /></label>
      <label class="block sm:col-span-2">
        <span class={label}>ログインID</span>
        <input name="login_id" value={form?.values?.login_id ?? ''} maxlength="64" pattern={LOGIN_ID_PATTERN} autocomplete="off" placeholder="空欄なら自動で決めます" class={`${input} font-mono`} />
        <span class="mt-1 block text-xs text-stone-500">英数字と . _ - で4〜64文字（先頭は英数字）。大文字・小文字は区別しません。</span>
      </label>
    </div>
    <button type="submit" disabled={busy} class="mt-5 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
      {busy ? '処理しています…' : 'ユーザーを作成してメールを送る'}
    </button>
  </form>
</section>

<style>
  .req {
    margin-left: 0.25rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--color-rose-700, #be123c) 12%, transparent);
    padding: 0 0.3rem;
    font-size: 0.7rem;
    font-style: normal;
    color: var(--color-rose-700, #be123c);
  }
</style>
