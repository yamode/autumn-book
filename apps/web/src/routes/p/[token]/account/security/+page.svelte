<script lang="ts">
  // 取引先専用ページ: アカウント → セキュリティ（ログイン中の端末・ログイン履歴・他端末ログアウト。docs/auth-hardening.md §4.4）
  import { partnerTitle } from '$lib/partner-title';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { passkeyRemoval } from '$lib/partner-passkey';
  import type { PageData } from './$types';

  let {
    data,
    form
  }: {
    data: PageData;
    form?: {
      message?: string;
      loggedOut?: number;
      emailMessage?: string;
      emailSaved?: string;
      email?: string;
      passkeyMessage?: string;
      passkeyError?: string;
      policyMessage?: string;
      policyError?: string;
    };
  } = $props();
  const token = $derived($page.params.token ?? '');

  // ---- パスキー（docs/auth-hardening.md §6.5・S6） ----
  let passkeySupported = $state(false);
  let adding = $state(false);
  let addMessage = $state('');
  let addDone = $state('');
  onMount(() => {
    if (!data.passkeys?.enabled) return;
    void import('$lib/partner-passkey-client').then(async (m) => (passkeySupported = await m.passkeySupported()));
  });
  async function addPasskey() {
    if (adding) return;
    adding = true;
    addMessage = '';
    addDone = '';
    try {
      const { registerPasskey } = await import('$lib/partner-passkey-client');
      const r = await registerPasskey(token, '');
      if (r.ok) {
        addDone = 'パスキーを登録しました。次回から「パスキーでログイン」・パスキーでの本人確認が使えます。';
        await invalidateAll();
      } else if (r.status === 403 && typeof r.data?.next === 'string') {
        // 本人確認がまだ → /mfa（済んだらこの画面へ戻る）
        location.href = r.data.next;
      } else {
        addMessage = r.message;
      }
    } finally {
      adding = false;
    }
  }
  const removeConfirm = (count: number) => {
    const rule = passkeyRemoval(data.policy?.value ?? 'step_up', count - 1);
    return rule.warn
      ? `${rule.message}削除してよろしいですか？`
      : 'このパスキーを削除します。よろしいですか？（端末側に残ったパスキーは、端末の設定から削除してください）';
  };
  let editingEmail = $state(false);

  let busy = $state(false);
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

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const others = $derived(data.sessions.filter((s) => !s.current).length);
  // 注意して見てほしい記録（失敗・制限・新しい環境）
  const warn = (action: string) =>
    action === 'login_failed' ||
    action === 'login_locked' ||
    action === 'login_rate_limited' ||
    action === 'login_new_device' ||
    action === 'mfa_failed' ||
    action === 'mfa_locked' ||
    action === 'email_change' ||
    action === 'passkey_registered' ||
    action === 'passkey_removed' ||
    action === 'passkey_failed' ||
    action === 'mfa_reset';
  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, 'セキュリティ')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section>
  {#if data.preview}
    <p class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">確認モードでは、ログイン中の端末とログイン履歴は表示しません。</p>
  {:else}
    <p class="text-sm leading-6 text-stone-600">
      このログインIDでログインしている端末と、ログインの記録です。心当たりのない端末や記録があれば「他の端末からログアウト」を押し、貴社のマスタユーザーまたは宿へパスワードの再設定をご依頼ください。
    </p>

    {#if form?.message}
      <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
    {:else if form?.loggedOut != null}
      <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm text-brand-900">
        {form.loggedOut > 0 ? `${form.loggedOut}台の端末をログアウトしました。` : 'ログアウトする端末はありませんでした。'}
      </p>
    {/if}
    {#if data.loadError}
      <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{data.loadError}</p>
    {/if}

    {#if data.mfa}
      <!-- 本人確認（docs/auth-hardening.md §6.4・S3）: 認証コードの送り先と、このブラウザの本人確認の状態 -->
      <h3 class="mt-6 text-lg font-bold">本人確認（メールの認証コード）</h3>
      <div class="mt-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <p class="text-stone-600">カードの登録・保存済みカードでのご予約・ユーザー管理などの前に、このメールアドレスへ届く認証コードで本人確認をお願いしています。</p>
        <dl class="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
          <dt class="text-stone-500">認証コードの送り先</dt>
          <dd>
            {#if data.mfa.hasEmail}
              <span class="font-mono">{data.mfa.maskedEmail}</span>
              {#if data.mfa.verified}<span class="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">確認済み</span>{:else}<span class="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">未確認</span>{/if}
            {:else}
              <span class="text-amber-800">未登録（本人確認ができません。登録してください）</span>
            {/if}
          </dd>
          <dt class="text-stone-500">このブラウザ</dt>
          <dd>
            {#if data.mfa.aal2}
              本人確認済み{#if data.mfa.aal2Until}（{fmt(data.mfa.aal2Until)} まで有効）{/if}
            {:else}
              未確認 {#if data.mfa.hasEmail}<a href={data.mfa.mfaHref} class="ml-2 underline">本人確認する</a>{/if}
            {/if}
          </dd>
        </dl>
        {#if form?.emailMessage}
          <p class="mt-3 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-rose-700" role="alert">{form.emailMessage}</p>
        {:else if form?.emailSaved}
          <p class="mt-3 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-brand-900" role="status">メールアドレスを {form.emailSaved} にしました。次の本人確認から、このアドレスに認証コードが届きます。</p>
        {/if}
        {#if editingEmail || !data.mfa.hasEmail || form?.emailMessage}
          <form method="POST" action="?/set_email" use:enhance={submit()} class="mt-4 space-y-3">
            <label class="block">
              <span class="mb-1 block font-medium">{data.mfa.hasEmail ? '新しいメールアドレス' : 'メールアドレス'}</span>
              <input name="email" type="email" required autocomplete="email" value={form?.email ?? ''} class={inputClass} />
            </label>
            {#if !data.mfa.hasEmail}
              <label class="block">
                <span class="mb-1 block font-medium">確認のため、いまのパスワード</span>
                <input name="password" type="password" required autocomplete="current-password" class={inputClass} />
              </label>
            {:else if !data.mfa.aal2}
              <p class="text-xs text-stone-500">変更の前に、いまのメールアドレスでの本人確認をお願いします（「変更する」を押すと確認の画面へ進みます）。</p>
            {/if}
            <div class="flex flex-wrap gap-2">
              <button type="submit" disabled={busy} class="rounded-md bg-accent-600 px-4 py-2 font-medium text-white hover:bg-accent-500 disabled:opacity-50">{data.mfa.hasEmail ? '変更する' : '登録する'}</button>
              {#if data.mfa.hasEmail}<button type="button" onclick={() => (editingEmail = false)} class="rounded-md border border-stone-300 px-4 py-2 hover:bg-stone-50">やめる</button>{/if}
            </div>
            <p class="text-xs leading-5 text-stone-500">変更すると、変更前のアドレス（無ければ貴社のマスタユーザー）へお知らせのメールが届きます。</p>
          </form>
        {:else}
          <button type="button" onclick={() => (editingEmail = true)} class="mt-4 rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50">メールアドレスを変更する</button>
        {/if}
      </div>
    {/if}

    {#if data.passkeys}
      <!-- パスキー（§6.5・S6） -->
      <h3 class="mt-8 text-lg font-bold">パスキー</h3>
      <div class="mt-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        <p class="text-stone-600">
          パスキーを登録すると、パスワード無しで「パスキーでログイン」できます。本人確認もパスキー（端末の生体認証・PIN）で行えます。偽のログイン画面（フィッシング）にも強い方法です。
        </p>
        {#if form?.passkeyError}
          <p class="mt-3 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-rose-700" role="alert">{form.passkeyError}</p>
        {:else if form?.passkeyMessage}
          <p class="mt-3 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-brand-900" role="status">{form.passkeyMessage}</p>
        {/if}
        {#if data.passkeys.error}<p class="mt-3 text-rose-700">{data.passkeys.error}</p>{/if}
        <ul class="mt-3 divide-y divide-stone-100">
          {#each data.passkeys.items as p (p.id)}
            <li class="flex flex-wrap items-start justify-between gap-3 py-3">
              <div class="min-w-0">
                <!-- 名前は登録した端末・ブラウザから自動で付く（利用者に名前を付けさせない・2026-10-10 指示） -->
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{p.name}</span>
                  {#if p.backedUp}<span class="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700" title="Apple / Google アカウント等で同期されるパスキー">同期済み</span>{/if}
                </p>
                <p class="mt-0.5 text-xs text-stone-500">登録: {fmt(p.createdAt)} ／ 最終使用: {fmt(p.lastUsedAt)}</p>
              </div>
              <form method="POST" action="?/passkey_remove" use:enhance={submit(removeConfirm(data.passkeys.items.length))}>
                <input type="hidden" name="passkey_id" value={p.id} />
                <button type="submit" disabled={busy} class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50">削除</button>
              </form>
            </li>
          {:else}
            <li class="py-3 text-stone-500">登録されたパスキーはありません。</li>
          {/each}
        </ul>
        {#if data.passkeys.enabled && passkeySupported}
          <div class="mt-3 space-y-2 border-t border-stone-100 pt-3">
            {#if addMessage}<p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-rose-700" role="alert">{addMessage}</p>{/if}
            {#if addDone}<p class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-brand-900" role="status">{addDone}</p>{/if}
            <div>
              <button type="button" onclick={() => void addPasskey()} disabled={adding} class="rounded-md bg-accent-600 px-4 py-2 font-medium text-white hover:bg-accent-500 disabled:opacity-50">
                {adding ? '登録しています…' : 'パスキーを追加'}
              </button>
            </div>
            {#if data.mfa && !data.mfa.aal2}<p class="text-xs text-stone-500">追加・削除の前に本人確認をお願いします（「パスキーを追加」を押すと確認の画面へ進みます）。</p>{/if}
          </div>
        {:else if !data.passkeys.enabled}
          <p class="mt-3 text-xs text-stone-500">このページのアドレスではパスキーを登録・使用できません（正式なアドレスでお使いください）。</p>
        {:else}
          <p class="mt-3 text-xs text-stone-500">このブラウザはパスキーに対応していません。</p>
        {/if}
        <p class="mt-3 text-xs leading-5 text-stone-500">{data.policy?.oneIdNotice}</p>
      </div>
    {/if}

    {#if data.policy}
      <!-- 本人確認の方針（§6.3・宿が設定。マスタは厳しくする方向だけ） -->
      <h3 class="mt-8 text-lg font-bold">本人確認の方針（貴社共通）</h3>
      <div class="mt-3 rounded-xl border border-stone-200 bg-white p-4 text-sm">
        {#if data.policy.value === 'passkey_only'}
          <p class="font-medium">{data.policy.label}</p>
          <p class="mt-1 text-stone-600">{data.policy.help}</p>
        {:else}
          <!-- オフ＝標準（重要な操作の前と新しい環境からのログインのときだけ確認）。オン＝ログインのたびに確認。マスタはオンにする方向だけ -->
          {@const on = data.policy.value === 'always'}
          <form
            method="POST"
            action="?/set_policy"
            use:enhance={submit('貴社の全ユーザーが、ログインのたびに本人確認を求められるようになります。オフに戻すときは宿へご依頼ください。よろしいですか？')}
            class="flex items-start justify-between gap-4"
          >
            <input type="hidden" name="policy" value="always" />
            <div class="min-w-0">
              <p class="font-medium">ログインのたびに本人確認を求める</p>
              <p class="mt-1 text-stone-600">
                {#if on}
                  オン：ログインのたびに本人確認（メールの認証コードまたはパスキー）を求めています。
                {:else}
                  オフ（標準）：いまは、カードの登録・保存済みカードでのご予約・ユーザー管理などの前と、新しい環境からのログインのときだけ本人確認を求めています。オンにすると、ログインのたびに本人確認を求めます。
                {/if}
              </p>
            </div>
            <button
              type="submit"
              role="switch"
              aria-checked={on}
              aria-label="ログインのたびに本人確認を求める"
              disabled={busy || on || !data.policy.canStrengthen}
              class={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed ${on ? 'bg-accent-600' : 'bg-stone-300'} ${!on && !data.policy.canStrengthen ? 'opacity-50' : ''}`}
            >
              <span class={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : 'translate-x-0.5'}`}></span>
            </button>
          </form>
        {/if}
        {#if form?.policyError}
          <p class="mt-3 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-rose-700" role="alert">{form.policyError}</p>
        {:else if form?.policyMessage}
          <p class="mt-3 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-brand-900" role="status">{form.policyMessage}</p>
        {/if}
        <p class="mt-3 text-xs text-stone-500">
          {#if data.policy.value === 'step_up' && !data.policy.canStrengthen}切り替えられるのはマスタユーザーだけです。{/if}
          オフに戻す・パスキーのみにする変更は、宿へご依頼ください。
        </p>
      </div>
    {/if}

    <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
      <h3 class="text-lg font-bold">ログイン中の端末</h3>
      <form method="POST" action="?/logout_others" use:enhance={submit('このブラウザ以外の端末をすべてログアウトします。よろしいですか？')}>
        <button type="submit" disabled={busy || others === 0} class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">
          他の端末からログアウト
        </button>
      </form>
    </div>
    <ul class="mt-3 space-y-2">
      {#each data.sessions as s (s.id)}
        <li class="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
          <div class="min-w-0 text-sm">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{s.browser}</span>
              {#if s.current}<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">このブラウザ</span>{/if}
            </p>
            <p class="mt-0.5 text-xs text-stone-500">
              ログイン: {fmt(s.createdAt)} ／ 最終アクセス: {fmt(s.lastSeenAt)}{#if s.ip}<span class="ml-1">／ IP: <span class="font-mono">{s.ip}</span></span>{/if}
            </p>
          </div>
          {#if !s.current}
            <form method="POST" action="?/logout_session" use:enhance={submit('この端末をログアウトします。よろしいですか？')}>
              <input type="hidden" name="session_id" value={s.id} />
              <button type="submit" disabled={busy} class="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">ログアウト</button>
            </form>
          {/if}
        </li>
      {:else}
        <li class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">ログイン中の端末はありません。</li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-stone-500">ログインは、最後の操作から24時間、またはログインから7日で切れます。</p>

    <h3 class="mt-8 text-lg font-bold">ログインの記録（直近30件）</h3>
    <div class="mt-3 overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-stone-50 text-left text-xs text-stone-500">
          <tr><th class="px-3 py-2 font-medium">日時</th><th class="px-3 py-2 font-medium">内容</th><th class="px-3 py-2 font-medium">IP</th></tr>
        </thead>
        <tbody>
          {#each data.logs as l (l.id)}
            <tr class="border-t border-stone-100">
              <td class="whitespace-nowrap px-3 py-2 text-stone-600">{fmt(l.at)}</td>
              <td class={`px-3 py-2 ${warn(l.action) ? 'text-rose-700' : ''}`}>
                {l.label}{#if l.notified === true}<span class="ml-1 text-xs text-stone-500">（通知メール送信済み）</span>{/if}
              </td>
              <td class="whitespace-nowrap px-3 py-2 font-mono text-xs text-stone-500">{l.ip ?? '—'}</td>
            </tr>
          {:else}
            <tr><td colspan="3" class="px-3 py-4 text-center text-stone-500">記録はありません。</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
