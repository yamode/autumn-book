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
  // - appearance は interaction-only: 普段は見えず、Cloudflare が操作を求めたときだけ枠が出る（画面の見た目を変えない）
  // - トークンは 1 回限り。use:enhance の送信後（page.form が変わったとき）に作り直す（失敗して入れ直すときに古いトークンを送らない）
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { page } from '$app/state';

  let { action = undefined }: { action?: string } = $props();

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
        appearance: 'interaction-only',
        language: 'ja',
        ...(action ? { action } : {})
      });
    });
    return () => {
      disposed = true;
      if (api && widgetId) api.remove(widgetId);
      widgetId = null;
    };
  });

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

