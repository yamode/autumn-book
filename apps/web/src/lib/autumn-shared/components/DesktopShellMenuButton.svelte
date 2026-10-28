<!-- 写し元: autumn-shared 8b93a42 src/components/DesktopShellMenuButton.svelte（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す） -->
<script lang="ts">
  /**
   * 統合ヘッダー右端の「⋯」（デスクトップのシェルメニュー）。設計: integrated-header-design.md §5.3
   * デスクトップのタブ型（v0.21.0〜・tabs.state() が非 null）で headerMode='auto' のときだけ描く。
   * ブラウザ・旧シェル・従来表示・headerMode='shell' では**何も描かない**。
   *
   * 押すとシェルのネイティブメニュー（再起動して更新／このタブを再読み込み／閉じる／表示設定／
   * ログアウト（全アプリ）／版）が出る。実行はメニューのクリックで起きる（ページに特権を持たせない）。
   * 更新のダウンロードが済んでいれば赤い点を出す。
   */
  import { onMount } from 'svelte';
  import { getDesktopTabsBridge, watchDesktopTabs, type DesktopTabsState } from '../desktop-tabs';

  interface Props {
    class?: string;
  }

  let { class: klass = '' }: Props = $props();

  let desk = $state<DesktopTabsState | null>(null);
  const show = $derived(!!desk && desk.headerMode === 'auto');
  const updateReady = $derived(desk?.update?.state === 'downloaded');
  const label = $derived.by(() => {
    if (!desk) return '';
    const v = `Autumn デスクトップ v${desk.version}`;
    return updateReady ? `${v}（更新の準備ができました${desk.update.version ? `: v${desk.update.version}` : ''}）` : v;
  });

  function openMenu() {
    const bridge = getDesktopTabsBridge();
    if (!bridge) return;
    bridge.menu({ kind: 'shell' }).catch(() => {
      /* noop */
    });
  }

  onMount(() => watchDesktopTabs((s) => (desk = s)));
</script>

{#if show}
  <button type="button" class="autumn-shell-menu {klass}" aria-label="デスクトップのメニュー" title={label} onclick={openMenu}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="13" cy="8" r="1.5" fill="currentColor" />
    </svg>
    {#if updateReady}<span class="dot" aria-hidden="true"></span>{/if}
  </button>
{/if}

<style>
  .autumn-shell-menu {
    position: relative;
    display: grid;
    width: var(--app-header-tab-h, 2.25rem);
    height: var(--app-header-tab-h, 2.25rem);
    flex-shrink: 0;
    place-items: center;
    border: 1px solid var(--input, var(--border, #dfe4ea));
    border-radius: 0.375rem;
    background: var(--background, #ffffff);
    color: var(--muted-foreground, #5b6b80);
    transition: background-color 0.15s;
  }
  .autumn-shell-menu:hover {
    background: var(--accent, #f2f5f8);
    color: var(--foreground, #0b203d);
  }
  .autumn-shell-menu:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--ring, #0b203d) 40%, transparent);
    outline-offset: 1px;
  }
  svg {
    width: 1rem;
    height: 1rem;
  }
  .dot {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: #c62828;
    box-shadow: 0 0 0 2px var(--background, #ffffff);
  }
</style>
