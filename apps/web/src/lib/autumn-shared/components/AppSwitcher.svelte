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
   *
   * 範囲外クリック・Esc で閉じる。
   */
  import { ECOSYSTEM_APPS, getAppUrl, type AutumnAppId } from '../apps';
  import AppIcon from './AppIcon.svelte';

  interface Props {
    /** 現在表示中のアプリ。一覧内でハイライトされる。 */
    currentAppId: AutumnAppId;
    /** トリガーボタンの配色。'light'（既定）=明るいヘッダー用 / 'dark'=ダークヘッダー用。 */
    theme?: 'light' | 'dark';
  }

  let { currentAppId, theme = 'light' }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);

  const apps = ECOSYSTEM_APPS.filter((app) => app.inSwitcher);

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
      <p class="px-2 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">autumn アプリ</p>
      {#each apps as app (app.id)}
        {#if app.status === 'live'}
          <a
            href={getAppUrl(app)}
            class="flex items-center gap-3 rounded-md px-2 py-2 transition hover:bg-accent {app.id ===
            currentAppId
              ? 'bg-accent'
              : ''}"
          >
            <AppIcon colors={app.icon} label={app.name} class="size-8 shrink-0" />
            <span>
              <span class="block text-sm font-medium">
                {app.name}{#if app.id === currentAppId}<span class="ml-1 text-xs font-normal text-muted-foreground">（表示中）</span>{/if}
              </span>
              <span class="block text-xs text-muted-foreground">{app.description}</span>
            </span>
          </a>
        {:else}
          <div class="flex items-center gap-3 rounded-md px-2 py-2 opacity-50">
            <AppIcon colors={app.icon} label={app.name} class="size-8 shrink-0" />
            <span>
              <span class="flex items-center gap-1.5 text-sm font-medium">
                {app.name}<span class="rounded border border-border bg-muted px-1 text-[10px] font-normal text-muted-foreground">準備中</span>
              </span>
              <span class="block text-xs text-muted-foreground">{app.description}</span>
            </span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
