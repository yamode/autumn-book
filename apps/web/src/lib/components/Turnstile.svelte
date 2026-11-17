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
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/state';

  let { action, showSuccess = false }: { action?: string; showSuccess?: boolean } = $props();

  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
  let el: HTMLDivElement | undefined = $state();
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;

  onMount(() => {
    if (!siteKey || !el) return;
    let disposed = false;
    loadTurnstile().then((t) => {
      if (disposed || !t || !el) return;
      api = t;
      widgetId = t.render(el, {
        sitekey: siteKey,
        appearance: showSuccess ? 'always' : 'interaction-only',
        size: showSuccess && el.clientWidth < 300 ? 'compact' : 'normal',
        language: 'ja',
        // 成功表示を使わないフォームでは、判定を通ったら枠を畳む。
        callback: () => { if (el && !showSuccess) el.style.display = 'none'; },
        'before-interactive-callback': () => { if (el) el.style.display = ''; },
        'expired-callback': () => { if (el) el.style.display = ''; },
        'error-callback': () => { if (el) el.style.display = ''; },
        ...(action ? { action } : {})
      });
    });
    return () => {
      disposed = true;
      if (api && widgetId) api.remove(widgetId);
      widgetId = null;
    };
  });

  /** トークンを取り直す。別ページの action を自分で送る部品（予約かご）が、失敗のあとに呼ぶ（page.form が変わらないため） */
  export function reset() {
    if (api && widgetId) api.reset(widgetId);
  }

  // フォームを送った結果が返ってきたら（失敗の表示など）新しいトークンを取り直す
  let lastForm: unknown = page.form;
  $effect(() => {
    const f = page.form;
    if (f === lastForm) return;
    lastForm = f;
    if (api && widgetId) api.reset(widgetId);
  });
</script>

{#if siteKey}
  <div bind:this={el}></div>
{/if}

