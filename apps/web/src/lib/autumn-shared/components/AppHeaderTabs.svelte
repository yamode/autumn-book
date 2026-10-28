<!-- 写し元: autumn-shared 2451512 src/components/AppHeaderTabs.svelte（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す） -->
<script lang="ts">
  /**
   * 統合ヘッダーの左クラスタ（ロゴ＋アプリ切替タブ）— ブラウザ・デスクトップ共通。
   * 設計: autumn-pms/desktop/docs/integrated-header-design.md §1・§6.1・§7
   *
   *   [◆] [PMS][RMS][Order][Book]   ← 幅 40rem 以上
   *   [◆▾]                          ← それ未満（押すと AppList の一覧）
   *
   * ◆ は表示中のアプリの AppIcon（各アプリの favicon.svg と同じ図形・色）。押すとそのアプリのホーム（homeHref）。
   * タブの並びは TAB_ORDER（PMS → RMS → Order → Book・デスクトップの Ctrl+1〜4 と同じ）。
   *
   * progressive enhancement:
   *   - ブラウザ・旧シェル・従来表示 … 他アプリのタブは本番 URL への普通のリンク（同じウィンドウ。Ctrl+クリックで別タブ）
   *   - デスクトップのタブ型（v0.21.0〜・tabs.state() が非 null）… クリックを tabs.activate に差し替えて View を切り替える
   *     （入力途中・スクロールが残る）。読み込み中・失敗・未読バッジ・通知も出し、右クリックでタブのメニュー。
   *     さらに onMount で claimHeader() を宣言し、シェルは Electron のタブバーを畳む（2 段 → 1 段）。
   *
   * ★各アプリのルートレイアウト（ログイン後にだけ描かれる場所）に 1 つだけ置くこと。
   *   ページ単位に置くと遷移のたびに宣言の取り下げ → 再宣言が走り、デスクトップのタブバーがちらつく。
   *
   * 見た目は scoped CSS（CSS 変数＋既定値）。Tailwind の semantic token を持たないアプリ（Order・Book）でも同じに出す。
   * タブの高さは CSS 変数 --app-header-tab-h（既定 2.25rem）で各アプリが合わせられる。
   */
  import { onMount } from 'svelte';
  import { getAppById, getAppUrl, getTabApps, type AutumnApp, type AutumnAppId } from '../apps';
  import {
    claimDesktopHeader,
    getDesktopOpen,
    getDesktopTabsBridge,
    watchDesktopTabs,
    type DesktopTabInfo,
    type DesktopTabsState
  } from '../desktop-tabs';
  import AppIcon from './AppIcon.svelte';
  import AppList from './AppList.svelte';

  interface Props {
    /** 表示中のアプリ。 */
    currentAppId: AutumnAppId;
    /** ロゴ（と自分のタブ）の行き先。同じ origin の相対パス（例: '/'・Book は '/admin'）。 */
    homeHref?: string;
    /** 'light'（既定）= 明るいヘッダー／'dark' = 暗いヘッダー。 */
    theme?: 'light' | 'dark';
    /** タブの中にも小さなアイコンを出す（既定は出さない・左のロゴが「いまのアプリ」）。 */
    showIcons?: boolean;
    class?: string;
  }

  let { currentAppId, homeHref = '/', theme = 'light', showIcons = false, class: klass = '' }: Props = $props();

  const current = $derived(getAppById(currentAppId));
  /** デスクトップのタブ型のときだけ値（ブラウザでは null のまま）。 */
  let desk = $state<DesktopTabsState | null>(null);
  let open = $state(false);
  let collapseEl = $state<HTMLElement | null>(null);

  /** 並べるタブ。デスクトップでは端末設定で無効にしたタブを出さない（表示中のアプリは必ず出す）。 */
  const tabs = $derived.by(() => {
    const all = getTabApps();
    if (!desk) return all;
    const ids = new Set(desk.tabs.map((t) => t.id));
    return all.filter((a) => a.id === currentAppId || ids.has(a.id));
  });

  function infoOf(id: AutumnAppId): DesktopTabInfo | null {
    return desk ? (desk.tabs.find((t) => t.id === id) ?? null) : null;
  }

  function hrefOf(app: AutumnApp): string {
    // 自分のタブは同じ origin のホーム（ローカルSSR端末・開発環境でも本番へ飛ばない）
    return app.id === currentAppId ? homeHref : getAppUrl(app);
  }

  function plainClick(e: MouseEvent): boolean {
    return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  }

  /** デスクトップのタブ型なら View を切り替える（無効なタブ等で切り替えられなければシェルの open に任せる）。 */
  async function switchTo(app: AutumnApp) {
    const bridge = getDesktopTabsBridge();
    if (!bridge) return;
    try {
      if (await bridge.activate(app.id)) return;
    } catch {
      /* 下へ */
    }
    const o = getDesktopOpen();
    if (o) void o(app.id, app.defaultPath);
  }

  function onTabClick(app: AutumnApp, e: MouseEvent) {
    open = false;
    if (!desk || app.id === currentAppId || !plainClick(e)) return; // ブラウザ・自分のタブは普通のリンク
    e.preventDefault();
    void switchTo(app);
  }

  function onTabContextMenu(app: AutumnApp, e: MouseEvent) {
    const bridge = getDesktopTabsBridge();
    if (!desk || !bridge) return; // ブラウザは通常のリンクの右クリック
    e.preventDefault();
    bridge.menu({ kind: 'tab', appId: app.id }).catch(() => {
      /* noop */
    });
  }

  function onListSelect(app: AutumnApp, e: MouseEvent) {
    onTabClick(app, e);
  }

  function handleWindowClick(event: MouseEvent) {
    if (!open) return;
    if (collapseEl && !collapseEl.contains(event.target as Node)) open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false;
  }

  onMount(() => {
    const unwatch = watchDesktopTabs((s) => {
      desk = s;
    });
    const release = claimDesktopHeader();
    return () => {
      release();
      unwatch();
    };
  });
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="autumn-header-tabs app-header-tabs {klass}" data-theme={theme}>
  <!-- 幅が広いとき: ロゴ＋タブ列 -->
  <a href={homeHref} class="logo wide" aria-label={current ? `${current.name} のホーム` : 'ホーム'}>
    {#if current}<AppIcon colors={current.icon} label={current.name} class="autumn-header-tabs-logo" />{/if}
  </a>
  <div class="tablist wide" role="tablist" aria-label="autumn アプリ">
    {#each tabs as app (app.id)}
      {@const info = infoOf(app.id)}
      {@const selected = app.id === currentAppId}
      {#if app.status === 'live'}
        <a
          role="tab"
          href={hrefOf(app)}
          class="tab"
          class:selected
          aria-selected={selected}
          title={info && info.title ? info.title : app.name}
          onclick={(e) => onTabClick(app, e)}
          oncontextmenu={(e) => onTabContextMenu(app, e)}
        >
          {#if showIcons}<AppIcon colors={app.icon} label="" class="autumn-header-tabs-mini" />{/if}
          <span class="label">{app.shortName}</span>
          {#if info?.loading}<span class="spinner" aria-label="読み込み中"></span>{/if}
          {#if info?.error}<span class="error-dot" aria-label="読み込みに失敗しました"></span>{/if}
          {#if info?.badge}<span class="badge">{info.badge > 99 ? '99+' : info.badge}</span>{/if}
        </a>
      {:else}
        <span role="tab" class="tab planned" aria-selected="false" aria-disabled="true" title="{app.name}（準備中）">
          <span class="label">{app.shortName}</span>
        </span>
      {/if}
    {/each}
  </div>
  {#if desk?.notice}
    <span class="notice wide" title={desk.notice}>{desk.notice}</span>
  {/if}

  <!-- 幅が狭いとき: ロゴ＋▾ に畳み、押すとアプリ一覧（PMS mobile.css の data-header-menu* の規則が効く） -->
  <div class="collapse narrow" data-header-menu-anchor bind:this={collapseEl}>
    <button
      type="button"
      class="switcher app-header-switcher"
      aria-label="アプリ切替"
      aria-haspopup="true"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      {#if current}<AppIcon colors={current.icon} label={current.name} class="autumn-header-tabs-logo" />{/if}
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    {#if open}
      <div class="menu" data-header-menu>
        <AppList {currentAppId} apps={tabs} onSelect={onListSelect} />
      </div>
    {/if}
  </div>
</div>

<style>
  .autumn-header-tabs {
    --aht-fg: var(--foreground, #0b203d);
    --aht-muted: var(--muted-foreground, #5b6b80);
    --aht-hover: var(--accent, #f2f5f8);
    --aht-line: var(--border, #dfe4ea);
    --aht-indicator: var(--aht-fg);
    /* 寸法の単位。アプリごとの root font-size（PMS 17px・RMS/Order 16px・Book 17px）に引きずられず、
       どのアプリでも PMS と同じ実寸で描く（2026-10-28 指摘: Order だけ小さく見えた）。 */
    --aht-u: var(--app-header-unit, 17px);
    --aht-tab-h: var(--app-header-tab-h, calc(2.25 * var(--aht-u)));
    /* フォントも各アプリの継承に任せない（Order は Segoe UI、Book は別の指定だった） */
    font-family: var(--aht-font, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic UI', Meiryo, 'Noto Sans CJK JP', 'Noto Sans JP', IPAexGothic, IPAGothic, sans-serif);
    font-weight: 400;
    letter-spacing: normal;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: calc(0.5 * var(--aht-u));
  }
  .autumn-header-tabs[data-theme='dark'] {
    --aht-fg: #ffffff;
    --aht-muted: rgba(255, 255, 255, 0.72);
    --aht-hover: rgba(255, 255, 255, 0.14);
    --aht-line: rgba(255, 255, 255, 0.2);
  }

  .wide {
    display: none;
  }
  .narrow {
    display: block;
  }
  @media (min-width: 40rem) {
    .wide {
      display: flex;
    }
    .narrow {
      display: none;
    }
  }

  .logo {
    flex-shrink: 0;
    place-items: center;
    border-radius: calc(0.5 * var(--aht-u));
  }
  @media (min-width: 40rem) {
    .logo {
      display: grid;
    }
  }
  .logo:focus-visible,
  .tab:focus-visible,
  .switcher:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--ring, #0b203d) 40%, transparent);
    outline-offset: 1px;
  }
  .autumn-header-tabs :global(.autumn-header-tabs-logo) {
    width: calc(2 * var(--aht-u));
    height: calc(2 * var(--aht-u));
    flex-shrink: 0;
  }
  .autumn-header-tabs :global(.autumn-header-tabs-mini) {
    width: calc(1 * var(--aht-u));
    height: calc(1 * var(--aht-u));
    flex-shrink: 0;
  }

  .tablist {
    min-width: 0;
    align-items: center;
    gap: calc(0.125 * var(--aht-u));
  }
  .tab {
    position: relative;
    display: inline-flex;
    height: var(--aht-tab-h);
    min-width: 0;
    flex-shrink: 1;
    align-items: center;
    gap: calc(0.375 * var(--aht-u));
    border-radius: calc(0.375 * var(--aht-u));
    padding: 0 calc(0.75 * var(--aht-u));
    font-size: calc(0.875 * var(--aht-u));
    line-height: 1;
    font-weight: 500;
    white-space: nowrap;
    color: var(--aht-muted);
    text-decoration: none;
    transition:
      background-color 0.15s,
      color 0.15s;
  }
  a.tab:hover {
    background: var(--aht-hover);
    color: var(--aht-fg);
  }
  .tab.selected {
    color: var(--aht-fg);
    font-weight: 700;
  }
  .tab.selected::after {
    content: '';
    position: absolute;
    left: calc(0.625 * var(--aht-u));
    right: calc(0.625 * var(--aht-u));
    bottom: calc(0.125 * var(--aht-u));
    height: 2px;
    border-radius: 1px;
    background: var(--aht-indicator);
  }
  .tab.planned {
    cursor: default;
    opacity: 0.45;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spinner {
    width: calc(0.75 * var(--aht-u));
    height: calc(0.75 * var(--aht-u));
    flex-shrink: 0;
    border-radius: 9999px;
    border: 2px solid var(--aht-line);
    border-top-color: var(--aht-fg);
    animation: aht-spin 0.8s linear infinite;
  }
  @keyframes aht-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
  .error-dot {
    width: calc(0.5 * var(--aht-u));
    height: calc(0.5 * var(--aht-u));
    flex-shrink: 0;
    border-radius: 9999px;
    background: #c62828;
  }
  .badge {
    min-width: calc(1.125 * var(--aht-u));
    border-radius: 9999px;
    background: #c62828;
    padding: calc(0.125 * var(--aht-u)) calc(0.3 * var(--aht-u));
    font-size: calc(0.6875 * var(--aht-u));
    font-weight: 700;
    line-height: 1;
    text-align: center;
    color: #ffffff;
  }
  .notice {
    min-width: 0;
    max-width: calc(24 * var(--aht-u));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 9999px;
    background: #fff6e0;
    padding: calc(0.25 * var(--aht-u)) calc(0.625 * var(--aht-u));
    font-size: calc(0.75 * var(--aht-u));
    color: #6b4a00;
  }

  .collapse {
    position: relative;
    flex-shrink: 0;
  }
  .switcher {
    display: flex;
    height: var(--aht-tab-h);
    align-items: center;
    gap: calc(0.125 * var(--aht-u));
    border: 1px solid var(--aht-line);
    border-radius: calc(0.375 * var(--aht-u));
    background: transparent;
    padding: 0 calc(0.25 * var(--aht-u)) 0 calc(0.125 * var(--aht-u));
    color: var(--aht-muted);
  }
  .switcher:hover {
    background: var(--aht-hover);
    color: var(--aht-fg);
  }
  .switcher :global(.autumn-header-tabs-logo) {
    width: calc(1.75 * var(--aht-u));
    height: calc(1.75 * var(--aht-u));
  }
  .chevron {
    width: calc(0.875 * var(--aht-u));
    height: calc(0.875 * var(--aht-u));
  }
  .menu {
    position: absolute;
    left: 0;
    z-index: 30;
    margin-top: calc(0.5 * var(--aht-u));
    width: calc(18 * var(--aht-u));
    max-width: calc(100vw - calc(1 * var(--aht-u)));
    overflow: hidden;
    border: 1px solid var(--border, #dfe4ea);
    border-radius: calc(0.5 * var(--aht-u));
    background: var(--popover, #ffffff);
    color: var(--popover-foreground, #0b203d);
    padding: calc(0.375 * var(--aht-u));
    box-shadow:
      0 10px 15px -3px rgb(0 0 0 / 0.1),
      0 4px 6px -4px rgb(0 0 0 / 0.1);
  }
</style>
