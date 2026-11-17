<script lang="ts" module>
  // Turnstile の読み込みは 1 ページに 1 回（部品が複数あっても共有する）
  type TurnstileApi = {
    render(el: HTMLElement, opts: Record<string, unknown>): string;
    reset(id: string): void;
    remove(id: string): void;
  };
  let loader: Promise<TurnstileApi | null> | null = null;
  function loadTurnstile(): Promise<TurnstileApi | null> {
    const w = window as unknown as { turnstile?: TurnstileApi };
    if (w.turnstile) return Promise.resolve(w.turnstile);
    loader ??= new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(w.turnstile ?? null);
      s.onerror = () => {
        loader = null; // 次の表示で読み直せるように
        resolve(null);
      };
      document.head.appendChild(s);
    });
    return loader;
  }
</script>

<script lang="ts">
  // Cloudflare Turnstile（docs/auth-hardening.md §4.2・S2）。フォームの中に置くと、トークンが hidden の
  // cf-turnstile-response に入って一緒に送られる（サーバは lib/server/turnstile.ts の checkTurnstile で確かめる）。
  //
  // - PUBLIC_TURNSTILE_SITE_KEY が未設定なら何も描かない（サーバも検証をスキップする）
  // - 既定では操作が必要なときだけ表示する。showSuccess を指定すると認証結果を表示し続ける。
  // - トークンは 1 回限り。use:enhance の送信後（page.form が変わったとき）に作り直す（失敗して入れ直すときに古いトークンを送らない）
  // - 判定が終わる前に送信ボタンを押されたら送らずに待ち、判定が通ったらそのまま送る（2026-11-18: 見えない判定が
  //   終わる前に「確認コードを送信」を押すと、トークン無しで送って失敗していた）。待つ間は押したボタンに回転の印。
  //   waitOnSubmit={false} で外す（予約入力のように、同じフォームを段の切り替えにも使う画面）
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/state';

  let { action, showSuccess = false, waitOnSubmit = true }: { action?: string; showSuccess?: boolean; waitOnSubmit?: boolean } = $props();

  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
  // ブラウザでは部品が作られた時点で読み込みを始める（onMount を待たない）
  if (siteKey && typeof window !== 'undefined') void loadTurnstile();
  let el: HTMLDivElement | undefined = $state();
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;
  /** 画面の JS が動き出したか。動き出す前は送信ボタンを押せなくする（下の style。押すと判定を待たずに素の送信になる） */
  let mounted = $state(false);
  /** 判定を通ったトークン（1 回限り。期限切れ・作り直しで空に戻す） */
  let token = '';
  /** 判定待ちで止めている送信（判定が通ったら、押したボタンで送り直す） */
  let held: { form: HTMLFormElement; submitter: HTMLElement | null } | null = null;
  function release(send: boolean) {
    const h = held;
    held = null;
    h?.submitter?.removeAttribute('data-pending');
    if (send && h) h.form.requestSubmit(h.submitter instanceof HTMLButtonElement || h.submitter instanceof HTMLInputElement ? h.submitter : undefined);
  }

  onMount(() => {
    mounted = true;
    if (!siteKey || !el) return;
    let disposed = false;
    const form = el.closest('form');
    // フォームの送信より先に（window の捕捉段階で）受け、判定前なら止める。use:enhance の処理にも届かない
    const onSubmit = (e: SubmitEvent) => {
      if (!waitOnSubmit || !form || e.target !== form || token) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const submitter = (e.submitter as HTMLElement | null) ?? null;
      held = { form, submitter };
      submitter?.setAttribute('data-pending', '');
    };
    if (form) window.addEventListener('submit', onSubmit, true);
    loadTurnstile().then((t) => {
      if (disposed || !t || !el) return;
      api = t;
      widgetId = t.render(el, {
        sitekey: siteKey,
        appearance: showSuccess ? 'always' : 'interaction-only',
        size: showSuccess && el.clientWidth < 300 ? 'compact' : 'normal',
        language: 'ja',
        // 成功表示を使わないフォームでは、判定を通ったら枠を畳む。
        callback: (t: string) => {
          token = t;
          if (el && !showSuccess) el.style.display = 'none';
          if (held) release(true);
        },
        'before-interactive-callback': () => { if (el) el.style.display = ''; },
        'expired-callback': () => { token = ''; if (el) el.style.display = ''; },
        // 判定に失敗したら待っていた送信をやめ、枠（エラーの表示・やり直し）を見せる
        'error-callback': () => { token = ''; release(false); if (el) el.style.display = ''; },
        ...(action ? { action } : {})
      });
    });
    return () => {
      disposed = true;
      if (form) window.removeEventListener('submit', onSubmit, true);
      release(false);
      if (api && widgetId) api.remove(widgetId);
      widgetId = null;
    };
  });

  /** トークンを取り直す。別ページの action を自分で送る部品（予約かご）が、失敗のあとに呼ぶ（page.form が変わらないため） */
  export function reset() {
    token = '';
    if (api && widgetId) api.reset(widgetId);
  }

  // フォームを送った結果が返ってきたら（失敗の表示など）新しいトークンを取り直す
  let lastForm: unknown = page.form;
  $effect(() => {
    const f = page.form;
    if (f === lastForm) return;
    lastForm = f;
    token = '';
    if (api && widgetId) api.reset(widgetId);
  });
</script>

<svelte:head>
  <!-- 判定の読み込みを早める（部品が描かれる前から Cloudflare への接続を始めておく） -->
  {#if siteKey}<link rel="preconnect" href="https://challenges.cloudflare.com" />{/if}
</svelte:head>

{#if siteKey}
  <div bind:this={el}></div>
  <!-- JS が動き出すまでの印。この印があるフォームの送信ボタンは押せない（読み込み直後に押すと、判定を待たずに送ってしまうため） -->
  {#if !mounted && waitOnSubmit}<span data-turnstile-booting hidden></span>{/if}
{/if}

<style>
  :global(form:has([data-turnstile-booting]) [type='submit']) {
    pointer-events: none;
    opacity: 0.6;
  }
</style>

