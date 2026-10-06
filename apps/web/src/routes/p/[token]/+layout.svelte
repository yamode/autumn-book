<script lang="ts">
  import { page } from '$app/stores';
  import { partnerAccent } from '$lib/partner-theme';

  // 取引先向けページの枠（autumn-rms から移設・2026-09-26）。Book の公開サイト共通ヘッダー/フッターは出さない
  // （/p は (public) グループの外に置いているので、上位は root layout だけ。解析・デバッグは root 側で /p を除外）。
  // 見た目は Book の公開予約フロー（/booking）と同じトークン・部品に揃える（2026-09-26）:
  //   地 stone-50・カード白＋stone-200 の枠・文字 brand-900・予約ボタン accent-600・文字は Book 全体のゴシック（app.css の html）。
  // 施設ごとの差し色（--pt-accent / --pt-accent-soft）だけは取引先ページ独自に残す（yamado = 森の緑 / oga = 夜の海）。
  let { children } = $props();
  const portal = $derived(
    $page.data.portal as
      | { partnerName: string; facilityName: string; facilitySlug?: string; loginId?: string | null; bookingEnabled?: boolean }
      | undefined
  );
  // メニューの現在地（予約入力 /book は「料金カレンダー」側に含める。/bookings とは区別する）
  const isActive = (path: string) => {
    const base = `/p/${$page.params.token}/`;
    const rest = $page.url.pathname.startsWith(base) ? $page.url.pathname.slice(base.length) : '';
    const head = rest.split('/')[0];
    return path === 'calendar' ? head === 'calendar' || head === 'book' : head === path;
  };
  // 差し色の定義は lib/partner-theme.ts（決済部品にも同じ色を渡す）
  const theme = $derived(partnerAccent(portal?.facilitySlug));

  // 固定ヘッダーの実際の高さ（画面幅でメニューが折り返すと変わる）を --portal-header-h に入れる（2026-10-06）。
  // 右欄の追従（sticky）の位置と、ページ内移動（scrollIntoView）の止まる位置を、ヘッダーの下にそろえるため。
  let headerEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!headerEl) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--portal-header-h', `${headerEl!.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(headerEl);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--portal-header-h');
    };
  });
</script>

<svelte:head>
  <!-- ホーム画面に追加したときの名前は施設名にする。 -->
  <meta name="apple-mobile-web-app-title" content={portal?.facilityName ?? ''} />
  <!--
    取引先ページの文字を全体に一回り大きく（2026-10-06 指示「まだ全体的に文字が小さい」）。基準 16px → 18px。
    Tailwind v4 の文字・余白は rem なので同じ比率で大きくなる。px で直に指定した小さな文字も rem に読み替えて一緒に大きくする。
    head に置くので取引先ページにいる間だけ効く（公式サイト・管理画面は変わらない）。
  -->
  <style>
    html { font-size: 112.5%; scroll-padding-top: calc(var(--portal-header-h, 6rem) + 1rem); }
    .text-\[10px\] { font-size: 0.6875rem; }
    .text-\[11px\] { font-size: 0.75rem; }
    .text-\[15px\] { font-size: 0.9375rem; }
    .text-\[17px\] { font-size: 1.0625rem; }
  </style>
</svelte:head>

<div class="partner-portal min-h-screen overflow-x-clip bg-stone-50 text-brand-900" style={`--pt-accent:${theme.accent};--pt-accent-soft:${theme.accentSoft}`}>
  <header bind:this={headerEl} class="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <div class="min-w-0">
        {#if portal?.partnerName}
          <p class="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--pt-accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--pt-accent)]">
            <span class="h-1.5 w-1.5 rounded-full bg-[var(--pt-accent)]"></span>
            {portal.partnerName} 様 専用料金
          </p>
        {/if}
        <h1 class="truncate font-display text-xl tracking-wide text-brand-900 sm:text-2xl">{portal?.facilityName ?? ''}</h1>
      </div>
      {#if portal?.loginId}
        <!-- お部屋・プランの紹介・覚書・アカウントはログインした取引先すべてに見せる。予約一覧は予約を受け付けている取引先だけ。
             項目が増えてもスマホでは1行の横スクロールのまま（折り返さない）。 -->
        <nav class="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto" aria-label="取引先メニュー">
          {#each [['calendar', '料金カレンダー'], ['rooms', 'お部屋'], ['plans', 'プラン'], ...(portal.bookingEnabled ? [['bookings', '予約一覧']] : []), ['memorandum', '覚書'], ['account', 'アカウント']] as [path, lbl]}
            {@const active = isActive(path)}
            <a href={`/p/${$page.params.token}/${path}`} class={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 transition ${active ? 'bg-brand-800 text-white' : 'text-stone-600 hover:bg-stone-50 hover:text-brand-800'}`}>{lbl}</a>
          {/each}
        </nav>
      {/if}
      {#if portal?.loginId}
        <form method="POST" action={`/p/${$page.params.token}/logout`} class="flex items-center gap-3 text-base">
          <span class="hidden text-stone-500 sm:inline">{portal.loginId}</span>
          <button type="submit" class="rounded-lg border border-stone-300 px-4 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50">
            ログアウト
          </button>
        </form>
      {/if}
    </div>
  </header>
  {@render children()}
  <footer class="mx-auto max-w-6xl px-4 pb-10 pt-6 text-center text-sm leading-6 text-stone-500 sm:px-6">
    このページは貴社専用です。URL・ログイン情報は社外へ共有しないでください。
    <nav class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      <a href="/legal/tokushoho" target="_blank" rel="noopener" class="underline hover:text-stone-700">特定商取引法に基づく表記</a>
      <a href="/legal/privacy" target="_blank" rel="noopener" class="underline hover:text-stone-700">プライバシーポリシー</a>
      <a href="/legal/yakkan" target="_blank" rel="noopener" class="underline hover:text-stone-700">宿泊約款</a>
    </nav>
  </footer>
</div>
