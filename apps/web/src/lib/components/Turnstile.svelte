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
  import * as m from '$lib/paraglide/messages';

  // floating: フォームの流れと関係なく画面下に浮かべ、Cloudflare が操作を求めたときだけ出す
  // （プラン詳細の「客室を選ぶ」のように、1 つの部品を複数のフォームで共有して本文の途中に置き場が無いとき）
  let { action = undefined, floating = false }: { action?: string; floating?: boolean } = $props();
  let needsCheck = $state(false);

  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
  let el: HTMLDivElement | undefined = $state();
  let api: TurnstileApi | null = null;
  let widgetId: string | null = null;

  function show(on: boolean) {
    // floating は外枠ごと出し入れする（中の iframe は描いたまま。display:none にすると判定が止まるため）
    if (floating) needsCheck = on;
    else if (el) el.style.display = on ? '' : 'none';
  }

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
        // 判定を通ったら枠を畳み、操作が要るとき・失敗・期限切れのときだけ出す（「成功しました」を出しっぱなしにしない）
        callback: () => show(false),
        'before-interactive-callback': () => show(true),
        'expired-callback': () => show(true),
        'error-callback': () => show(true),
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

{#if siteKey && floating}
  <div
    class="fixed inset-x-0 top-24 z-50 flex justify-center px-4 transition {needsCheck ? 'opacity-100' : 'pointer-events-none opacity-0'}"
    aria-hidden={!needsCheck}
  >
    <div class="rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
      <p class="mb-2 text-xs text-stone-600">{m.turnstile_floating_note()}</p>
      <div bind:this={el}></div>
    </div>
  </div>
{:else if siteKey}
  <div bind:this={el}></div>
{/if}

