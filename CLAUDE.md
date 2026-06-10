# autumn-book プロジェクトルール

> グローバル `~/.claude/CLAUDE.md` を継承しつつ、本プロジェクト固有の運用を定める。
> 競合する場合は本ファイルが優先。

## Supabase migration 運用（開発期間中の確定ルール）

- **Supabase Branching は使わない。** 開発期間中、Preview Branch での検証は行わない。
- **明示的な指示がない限り、migration は autumn-shared の `main` に直接 push する。**
  - PR を切らず `main` 直 push でよい（GitHub Integration が main への push で PROD へ自動適用する）。
  - PR レビューや branching テストが必要なときだけ、ユーザーが明示的に指示する。
- migration の置き場所は従来どおり `autumn-shared/supabase/migrations/`（このリポに `supabase/` を作らない）。
- ファイル名規約：`YYYYMMDDHHMMSS_book_<description>.sql`。`book` スキーマ専用。
- 既存スキーマ（core / booking / pms）への ALTER は autumn-pms 等と競合しうるため、原則 `book` スキーマ内で完結させる。やむを得ず触る場合は事前に他リポの未適用 migration を確認する。

### 正しい流れ（既定）
1. `autumn-shared/supabase/migrations/` に SQL を作成
2. `autumn-shared` の `main` へ直接 push
3. GitHub Integration が PROD（Autumn Platform `opkocyapzmsjzhbwlguh`）へ自動適用
4. `supabase_migrations.schema_migrations` に version が載ったことを確認
5. autumn-book 側の型・RPC 参照を更新

## データソース切替

- `apps/web/.env` の `DATA_SOURCE`（`demo` | `supabase`）でアプリのデータ源を切替。既定は `demo`。
- Supabase 実接続のアダプタは `apps/web/src/lib/server/supabase-data.ts`。

## PostgREST 公開スキーマ

- `book` スキーマは Data API に公開済み（2026-06-11・ダッシュボード設定）。新スキーマを足したら同様に Exposed schemas へ追加すること。
