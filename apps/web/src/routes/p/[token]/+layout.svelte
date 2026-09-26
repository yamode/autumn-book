<script lang="ts">
  import { page } from '$app/stores';

  // 取引先向けページの枠（autumn-rms から移設・2026-09-26）。Book の公開サイト共通ヘッダー/フッターは出さない
  // （/p は (public) グループの外に置いているので、上位は root layout だけ。解析・デバッグは root 側で /p を除外）。
  // 配色は autumn-book（予約エンジン）に合わせる: 生成りの地・墨の文字・金茶のアクセント。文字は読みやすさ優先のゴシック。
  // 施設ごとの差し色は autumn-book の施設テンプレートに寄せる（yamado = 森の緑 / oga = 夜の海）。
  let { children } = $props();
  const portal = $derived(
    $page.data.portal as
      | { partnerName: string; facilityName: string; facilitySlug?: string; loginId?: string | null; bookingEnabled?: boolean }
      | undefined
  );
  const ACCENTS: Record<string, { accent: string; accentSoft: string }> = {
    yamado: { accent: '#4a6b52', accentSoft: '#e7eee8' },
    oga: { accent: '#2d4a5a', accentSoft: '#e4ecf0' }
  };
  // メニューの現在地（予約入力 /book は「料金カレンダー」側に含める。/bookings とは区別する）
  const isActive = (path: string) => {
    const base = `/p/${$page.params.token}/`;
    const rest = $page.url.pathname.startsWith(base) ? $page.url.pathname.slice(base.length) : '';
    const head = rest.split('/')[0];
    return path === 'calendar' ? head === 'calendar' || head === 'book' : head === path;
  };
  const theme = $derived(ACCENTS[portal?.facilitySlug ?? ''] ?? { accent: '#44402f', accentSoft: '#e9e6dc' });
</script>

<svelte:head>
  <!-- ホーム画面に追加したときの名前は施設名にする。 -->
  <meta name="apple-mobile-web-app-title" content={portal?.facilityName ?? ''} />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
</svelte:head>

<div class="portal partner-portal min-h-screen" style={`--pt-accent:${theme.accent};--pt-accent-soft:${theme.accentSoft}`}>
  <div class="h-1 bg-[var(--pt-gold)]"></div>
  <header class="border-b border-[var(--pt-line)] bg-[var(--pt-surface)]/90 backdrop-blur">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <div class="min-w-0">
        {#if portal?.partnerName}
          <p class="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--pt-accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--pt-accent)]">
            <span class="h-1.5 w-1.5 rounded-full bg-[var(--pt-accent)]"></span>
            {portal.partnerName} 様 専用料金
          </p>
        {/if}
        <h1 class="truncate text-xl font-bold tracking-wide sm:text-2xl">{portal?.facilityName ?? ''}</h1>
      </div>
      {#if portal?.loginId}
        <!-- お部屋・プランの紹介はログインした取引先すべてに見せる。予約一覧は予約を受け付けている取引先だけ。 -->
        <nav class="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto" aria-label="取引先メニュー">
          {#each [['calendar', '料金カレンダー'], ['rooms', 'お部屋'], ['plans', 'プラン'], ...(portal.bookingEnabled ? [['bookings', '予約一覧']] : [])] as [path, lbl]}
            {@const active = isActive(path)}
            <a href={`/p/${$page.params.token}/${path}`} class={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 transition ${active ? 'bg-[var(--pt-ink)] text-white' : 'text-[var(--pt-muted)] hover:text-[var(--pt-ink)]'}`}>{lbl}</a>
          {/each}
        </nav>
      {/if}
      {#if portal?.loginId}
        <form method="POST" action={`/p/${$page.params.token}/logout`} class="flex items-center gap-3 text-base">
          <span class="hidden text-[var(--pt-muted)] sm:inline">{portal.loginId}</span>
          <button type="submit" class="rounded-full border border-[var(--pt-line-strong)] px-4 py-1.5 text-sm text-[var(--pt-muted)] transition hover:border-[var(--pt-ink)] hover:text-[var(--pt-ink)]">
            ログアウト
          </button>
        </form>
      {/if}
    </div>
  </header>
  {@render children()}
  <footer class="mx-auto max-w-6xl px-4 pb-10 pt-6 text-center text-sm leading-6 text-[var(--pt-muted)] sm:px-6">
    このページは貴社専用です。URL・ログイン情報は社外へ共有しないでください。
  </footer>
</div>

<style>
  .portal {
    --pt-bg: #f6f5f1;
    --pt-surface: #ffffff;
    --pt-ink: #1f1d15;
    --pt-muted: #6f6a5c;
    --pt-line: #e9e6dc;
    --pt-line-strong: #d6d1c2;
    --pt-gold: #b08d3e;
    --pt-gold-deep: #95742c;
    --pt-gold-soft: #f6efdd;
    --pt-sun: #b4432f;
    --pt-sat: #3b5b8c;
    --pt-warn: #b4532a;
    background: var(--pt-bg);
    color: var(--pt-ink);
    /* 可読性重視のゴシック。数字は等幅にして料金の桁を揃えやすくする。 */
    font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    font-feature-settings: 'palt';
    color-scheme: light;
  }
</style>
