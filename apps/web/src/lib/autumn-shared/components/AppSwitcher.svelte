<!-- 写し元: autumn-shared 8b93a42 src/components/AppSwitcher.svelte（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す） -->
<script lang="ts">
  /**
   * 共通アプリスイッチャー (AppSwitcher) — Autumn エコシステム共通コンポーネント
   * Svelte 5 / Runes 準拠
   *
   * アプリ一覧は ECOSYSTEM_APPS（../apps）が SoT。`inSwitcher` で表示対象を絞り、
   * `status === 'live'` のアプリだけリンク化、それ以外は「準備中」としてディム表示する。
   * （autumn には taskul のような appAccess / v_my_app_access ビューが無いため、可視判定は status のみ）
   *
   * 配色は consuming アプリ側の app.css が定義する semantic token クラス
   * （bg-popover / border-border / text-muted-foreground / bg-accent 等）を使う。
   * autumn 系アプリは shadcn-svelte ベースで同一トークンを共有する前提。
   *
   * 一覧の各行には各アプリのロゴ（AppIcon・brand の app-icon と同じ形と色）を出す（2026-10-17 に絵文字から置き換え）。
   * 一覧の中身は AppList.svelte（統合ヘッダー AppHeaderTabs のスマホ幅の折りたたみと共用・2026-10-28）。
   *
   * 範囲外クリック・Esc で閉じる。
   */
  import type { AutumnApp, AutumnAppId } from '../apps';
  import { getDesktopOpen, getDesktopTabsBridge } from '../desktop-tabs';
  import AppList from './AppList.svelte';

  interface Props {
    /** 現在表示中のアプリ。一覧内でハイライトされる。 */
    currentAppId: AutumnAppId;
    /** トリガーボタンの配色。'light'（既定）=明るいヘッダー用 / 'dark'=ダークヘッダー用。 */
    theme?: 'light' | 'dark';
  }

  let { currentAppId, theme = 'light' }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);

  /**
   * デスクトップでは、他アプリへのリンクをシェルに渡す（2026-10-28・統合ヘッダー設計 §6.1）。
   *   v0.21.0〜 のタブ型（tabs.state() が非 null）… activate でタブ切替（状態が残る）
   *   v0.20.x の tabs.open だけある版 …………… open（タブ型ならそのタブ・従来表示なら既定ブラウザ）
   *   ブラウザ ………………………………………… 普通のリンクのまま（同じウィンドウで移動）
   * 自分のアプリの行は常に普通のリンク（ホームへ戻る）。
   */
  async function onSelect(app: AutumnApp, event: MouseEvent) {
    if (app.id === currentAppId) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const bridge = getDesktopTabsBridge();
    if (bridge) {
      event.preventDefault();
      open = false;
      try {
        const st = await bridge.state();
        if (st && st.tabs.some((t) => t.id === app.id) && (await bridge.activate(app.id))) return;
      } catch {
        /* 下の open／リンクへ */
      }
      const o = getDesktopOpen();
      if (o) {
        void o(app.id, app.defaultPath);
        return;
      }
      location.href = (event.currentTarget as HTMLAnchorElement).href;
      return;
    }
    const o = getDesktopOpen();
    if (o) {
      event.preventDefault();
      open = false;
      void o(app.id, app.defaultPath);
    }
  }

  function handleWindowClick(event: MouseEvent) {
    if (!open) return;
    if (rootEl && !rootEl.contains(event.target as Node)) open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open = false;
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleKeydown} />

<div class="relative" bind:this={rootEl}>
  <button
    type="button"
    aria-label="アプリ切替"
    aria-expanded={open}
    onclick={() => (open = !open)}
    class="grid size-9 place-items-center rounded-md border transition focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 {theme ===
    'dark'
      ? 'border-white/20 bg-white/5 text-white/85 hover:bg-white/20 hover:text-white'
      : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:border-ring'}"
  >
    <span class="grid grid-cols-3 gap-[3px]">
      {#each Array.from({ length: 9 }) as _, i (i)}
        <span class="block size-[3px] rounded-full bg-current"></span>
      {/each}
    </span>
  </button>

  {#if open}
    <div class="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1.5 shadow-lg">
      <AppList {currentAppId} {onSelect} />
    </div>
  {/if}
</div>
