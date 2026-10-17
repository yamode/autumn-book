#!/usr/bin/env bash
# 実行: bash apps/web/scripts/sync-autumn-shared-switcher.sh   （autumn-book のルートから・ローカルに ~/dev/autumn-shared がある前提）
#
# autumn-shared のアプリスイッチャー（AppSwitcher.svelte・AppIcon.svelte・apps.ts）を Book に写す（2026-10-17）。
# PMS / RMS は preinstall で autumn-shared を丸ごと clone しているが、Book の Cloudflare のビルドには
# GitHub のトークン（GH_PAT）が無く clone できないため、必要な3ファイルだけを写してコミットする。
# autumn-shared 側でアプリの一覧（apps.ts）やスイッチャーを変えたら、このスクリプトを流してコミットし直すこと。
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"          # apps/web
SRC="${AUTUMN_SHARED_DIR:-$HERE/../../../autumn-shared}/src"
DEST="$HERE/src/lib/autumn-shared"

if [ ! -f "$SRC/apps.ts" ]; then
  echo "[sync] autumn-shared が見つかりません: $SRC （AUTUMN_SHARED_DIR で場所を指定できます）" >&2
  exit 1
fi

mkdir -p "$DEST/components"
cp "$SRC/apps.ts" "$DEST/apps.ts"
cp "$SRC/components/AppSwitcher.svelte" "$DEST/components/AppSwitcher.svelte"
cp "$SRC/components/AppIcon.svelte" "$DEST/components/AppIcon.svelte"
echo "[sync] 写しました（autumn-shared $(git -C "$SRC/.." rev-parse --short HEAD 2>/dev/null || echo '?')）→ $DEST"
