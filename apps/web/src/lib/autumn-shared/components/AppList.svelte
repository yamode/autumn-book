<!-- 写し元: autumn-shared 8b93a42 src/components/AppList.svelte（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す） -->
<script lang="ts">
  /**
   * autumn アプリの一覧（アイコン＋名前＋説明）。AppSwitcher のプルダウンと、
   * 統合ヘッダー（AppHeaderTabs）のスマホ幅の折りたたみの中身で共用する。
   *
   * 各行は通常のリンク（他アプリの本番 URL・同じウィンドウ）。onSelect を渡すと、クリック時に呼ぶ
   * （デスクトップのタブ型なら呼び元が preventDefault してタブ切替にする＝progressive enhancement）。
   * status !== 'live' は「準備中」としてディム表示（リンクなし）。
   *
   * 見た目は scoped CSS（CSS 変数＋既定値）で描く。Tailwind の semantic token（bg-popover 等）を
   * 持たないアプリ（Order・Book）でも同じに出すため。
   */
  import { ECOSYSTEM_APPS, getAppUrl, type AutumnApp, type AutumnAppId } from '../apps';
  import AppIcon from './AppIcon.svelte';

  interface Props {
    currentAppId: AutumnAppId;
    /** 並べるアプリ（既定は ECOSYSTEM_APPS の inSwitcher）。 */
    apps?: AutumnApp[];
    onSelect?: (app: AutumnApp, event: MouseEvent) => void;
  }

  let { currentAppId, apps = ECOSYSTEM_APPS.filter((app) => app.inSwitcher), onSelect }: Props = $props();
</script>

<div class="autumn-app-list">
  <p class="heading">autumn アプリ</p>
  {#each apps as app (app.id)}
    {#if app.status === 'live'}
      <a
        href={getAppUrl(app)}
        class="row"
        class:current={app.id === currentAppId}
        aria-current={app.id === currentAppId ? 'page' : undefined}
        onclick={(e) => onSelect?.(app, e)}
      >
        <AppIcon colors={app.icon} label={app.name} class="autumn-app-list-icon" />
        <span class="text">
          <span class="name">
            {app.name}{#if app.id === currentAppId}<span class="here">（表示中）</span>{/if}
          </span>
          <span class="desc">{app.description}</span>
        </span>
      </a>
    {:else}
      <div class="row planned">
        <AppIcon colors={app.icon} label={app.name} class="autumn-app-list-icon" />
        <span class="text">
          <span class="name">{app.name}<span class="badge">準備中</span></span>
          <span class="desc">{app.description}</span>
        </span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .autumn-app-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .heading {
    margin: 0;
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted-foreground, #5b6b80);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: 0.375rem;
    color: var(--popover-foreground, var(--foreground, #0b203d));
    text-decoration: none;
    transition: background-color 0.15s;
  }
  a.row:hover,
  .row.current {
    background: var(--accent, #f2f5f8);
  }
  a.row:focus-visible {
    outline: 3px solid color-mix(in srgb, var(--ring, #0b203d) 40%, transparent);
    outline-offset: 0;
  }
  .row.planned {
    opacity: 0.5;
  }
  .row :global(.autumn-app-list-icon) {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
  }
  .text {
    display: block;
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.35;
  }
  .here {
    margin-left: 0.125rem;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--muted-foreground, #5b6b80);
  }
  .badge {
    border: 1px solid var(--border, #dfe4ea);
    border-radius: 0.25rem;
    background: var(--muted, #f2f5f8);
    padding: 0 0.25rem;
    font-size: 10px;
    font-weight: 400;
    color: var(--muted-foreground, #5b6b80);
  }
  .desc {
    display: block;
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--muted-foreground, #5b6b80);
  }
</style>
