<!-- 写し元: autumn-shared 8b93a42 src/components/AppIcon.svelte（Book は vendored しないので手で写す。直すときは autumn-shared を先に直して写し直す） -->
<script lang="ts">
  /**
   * autumn 各アプリのアプリアイコン（角丸の地＋共通の A＋斜線アクセント）。
   * 形は brand/autumn/logos/app-icon-*.svg と同じ（viewBox 1024・A は 0.7733 倍で中央に置く）。
   * 色はアプリ一覧（../apps の icon）から渡す。SVG ファイルを読み込まないのは、
   * vendored で取り込む各アプリに静的ファイルを配らずに済ませるため。
   */
  import type { AutumnAppIconColors } from '../apps';

  interface Props {
    colors: AutumnAppIconColors;
    /** 読み上げ用の名前（例: 'Autumn PMS'）。 */
    label: string;
    class?: string;
  }

  let { colors, label, class: klass = 'size-8' }: Props = $props();
</script>

<svg class={klass} viewBox="0 0 1024 1024" role="img" aria-label={label}>
  <!-- 明るい地（PMS・Book）は白い背景に溶けるので、細い縁を付けて形を見せる。 -->
  <rect width="1024" height="1024" rx="230" fill={colors.bg} stroke="rgba(11,32,61,0.14)" stroke-width="16" />
  <g transform="translate(115.68 125.74) scale(0.77330)">
    <polygon
      fill={colors.a}
      points="405.5,145.0 102.0,854.0 287.5,854.0 512.5,353.0 620.3,593.0 680.0,596.0 647.7,654.0 737.5,854.0 923.0,854.0 619.5,145.0"
    />
    <polygon fill={colors.accent} points="464.0,600.0 613.0,600.0 491.0,854.0 342.0,854.0" />
  </g>
</svg>
