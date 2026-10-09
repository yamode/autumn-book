<script lang="ts">
  // 取引先ページの本人確認（ステップアップ・docs/auth-hardening.md §6.2〜6.4・S3）。
  // /p/<token>/mfa の画面と、予約画面の「保存済みのカードを使う」の両方で使う（同じ画面のまま確認できるように）。
  // 方法は methods の順（パスキーがあれば先に・S6）。パスキーは本番ドメインとローカルでだけ methods に入る（サーバの stepUpState）。
  // API: POST /p/<token>/mfa/email/send → { ok, to, waitSec } ／ POST /p/<token>/mfa/email/verify { code } → { ok }
  //      POST /p/<token>/mfa/passkey/options → { challengeId, options } ／ POST /p/<token>/mfa/passkey/verify → { ok }
  import { onDestroy, untrack } from 'svelte';
  import type { MfaMethod } from '$lib/partner-mfa';

  let {
    token,
    maskedEmail,
    methods,
    initialWaitSec = 0,
    initialOpen = false,
    securityHref,
    compact = false,
    passkeyOnly = false,
    onverified
  }: {
    token: string;
    /** 送り先（伏せたもの）。メール未登録なら空 */
    maskedEmail: string;
    methods: MfaMethod[];
    initialWaitSec?: number;
    /** 入力を受け付けているコードが既にある（送り直さずに入力できる） */
    initialOpen?: boolean;
    /** メール未登録のときの登録先（アカウント → セキュリティ） */
    securityHref: string;
    /** 予約画面などに埋め込むときの詰めた表示 */
    compact?: boolean;
    /** 取引先の方針が passkey_only（メールに落とさない）。方法が無いときの案内を変える */
    passkeyOnly?: boolean;
    onverified: () => void | Promise<void>;
  } = $props();

  // 初期値は最初の表示時だけ使う（以後は送信の結果で動かす）
  let sent = $state(untrack(() => initialOpen));
  let wait = $state(untrack(() => initialWaitSec));
  let to = $state(untrack(() => maskedEmail));
  let code = $state('');
  let busy = $state(false);
  let message = $state('');
  let info = $state('');
  let timer: ReturnType<typeof setInterval> | null = null;
  let passkeyMessage = $state('');
  const hasPasskey = $derived(methods.includes('passkey'));
  const hasEmail = $derived(methods.includes('email'));

  // パスキーで確認する（S6）
  async function verifyPasskey() {
    if (busy) return;
    busy = true;
    passkeyMessage = '';
    try {
      const { stepUpWithPasskey } = await import('$lib/partner-passkey-client');
      const r = await stepUpWithPasskey(token);
      if (r.ok) {
        info = '本人確認ができました。';
        await onverified();
      } else if (r.status === 401) {
        location.href = `/p/${token}`;
      } else {
        passkeyMessage = r.message;
      }
    } finally {
      busy = false;
    }
  }

  function tick() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      wait = Math.max(0, wait - 1);
      if (wait === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    }, 1000);
  }
  $effect(() => {
    if (wait > 0 && !timer) tick();
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  async function post(path: string, body: unknown) {
    const res = await fetch(`/p/${token}/mfa/email/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 401) {
      location.href = `/p/${token}`;
      throw new Error('ログインの有効期限が切れました。');
    }
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  }

  async function send() {
    if (busy || wait > 0) return;
    busy = true;
    message = '';
    info = '';
    try {
      const j = await post('send', {});
      if (j?.ok) {
        sent = true;
        to = String(j.to ?? to);
        wait = Number(j.waitSec ?? 60);
        info = `${to} に認証コードを送りました。メールに書かれた6桁の数字を入力してください。`;
        tick();
      } else {
        message = String(j?.message ?? '認証コードを送れませんでした。時間をおいてお試しください。');
        if (typeof j?.waitSec === 'number') {
          wait = j.waitSec;
          tick();
        }
      }
    } catch (e) {
      message = e instanceof Error ? e.message : '認証コードを送れませんでした。';
    } finally {
      busy = false;
    }
  }

  // <form> は使わない（予約画面のフォームの中に置くため。入れ子の form は HTML で無効になり、Enter で予約のフォームが送られてしまう）
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void verify();
  }

  async function verify() {
    if (busy || !code.trim()) return;
    busy = true;
    message = '';
    try {
      const j = await post('verify', { code });
      if (j?.ok) {
        info = '本人確認ができました。';
        await onverified();
      } else {
        message = String(j?.message ?? '認証コードが正しくありません。');
        if (j?.code === 'locked' || j?.code === 'expired') code = '';
      }
    } catch (err) {
      message = err instanceof Error ? err.message : '確認できませんでした。';
    } finally {
      busy = false;
    }
  }

  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
</script>

<div class={compact ? 'space-y-3' : 'space-y-4'}>
  {#if hasPasskey}
    <div class="space-y-2">
      <p class="text-sm leading-6 text-stone-600">登録済みのパスキー（端末の生体認証・PIN）で確認できます。</p>
      {#if passkeyMessage}<p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{passkeyMessage}</p>{/if}
      {#if info && !hasEmail}<p class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-sm text-brand-900" role="status">{info}</p>{/if}
      <button type="button" onclick={() => void verifyPasskey()} disabled={busy} class="w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
        {busy ? '確認しています…' : 'パスキーで確認する'}
      </button>
    </div>
    {#if hasEmail}
      <div class="flex items-center gap-3 text-xs text-stone-400"><span class="h-px flex-1 bg-stone-200"></span>または、メールの認証コードで確認<span class="h-px flex-1 bg-stone-200"></span></div>
    {/if}
  {/if}
  {#if hasPasskey && !hasEmail}
    <!-- パスキーだけ（passkey_only・またはメール未登録） -->
  {:else if !hasEmail}
    {#if passkeyOnly}
      <p class="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900">
        この取引先では、パスキーでの本人確認が必要です（メールの認証コードは使えません）。このログインIDにはパスキーが登録されていないか、このページのアドレスではパスキーを使えません。貴社のマスタユーザーまたは宿に、第2要素のリセット（パスワード設定リンクの再発行）をご依頼ください。
      </p>
    {:else if !maskedEmail}
      <p class="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900">
        本人確認には、ログインIDのメールアドレス（認証コードの送り先）が必要です。<a href={securityHref} class="font-medium underline">「アカウント」→「セキュリティ」</a>から登録してください。
      </p>
    {:else}
      <p class="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900">
        この取引先では、メールの認証コードでの確認を使えません。宿へお問い合わせください。
      </p>
    {/if}
  {:else}
    <p class="text-sm leading-6 text-stone-600">
      ご本人の確認のため、{to || 'ご登録のメールアドレス'} に6桁の認証コードを送ります（有効期限10分）。
    </p>
    {#if info}<p class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-sm text-brand-900" role="status">{info}</p>{/if}
    {#if message}<p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{message}</p>{/if}
    {#if sent}
      <div class="space-y-3">
        <label class="block">
          <span class="mb-1 block text-sm font-medium">認証コード（6桁）</span>
          <input
            bind:value={code}
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="8"
            onkeydown={onKey}
            class={inputClass}
          />
        </label>
        <button type="button" onclick={() => void verify()} disabled={busy || !code.trim()} class="w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
          {busy ? '確認しています…' : '確認する'}
        </button>
      </div>
      <button type="button" onclick={send} disabled={busy || wait > 0} class="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50 disabled:opacity-50">
        {wait > 0 ? `コードを送り直す（${wait}秒後）` : 'コードを送り直す'}
      </button>
      <p class="text-xs leading-5 text-stone-500">メールが届かないときは、迷惑メールのフォルダもご確認ください。このコードを宿や第三者に伝えないでください。</p>
    {:else}
      <button type="button" onclick={send} disabled={busy || wait > 0} class="w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
        {busy ? '送っています…' : wait > 0 ? `認証コードを送る（${wait}秒後）` : '認証コードをメールで送る'}
      </button>
    {/if}
  {/if}
</div>
