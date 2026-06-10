# autumn-book i18n 設計書 v1

作成: 2026-06-10。設計書 `autumn_book_design.md` §413（i18n方針）・§14 未決「多言語（EN/TW）の実装フェーズ」を確定させるもの。

## 0. 決定事項

| 項目 | 決定 |
|---|---|
| 対象言語 | `ja`（ベース・既定）/ `en` / `zh-TW`（繁体字中国語）。FileMaker 帳票の EN/TW 実績に整合 |
| ライブラリ | **Paraglide JS 2**（inlang）。コンパイル時メッセージ生成・tree-shaking・ランタイム依存なし → Cloudflare Pages（edge）で安全 |
| URL 戦略 | ja = プレフィックスなし（**現行URL無変更・301不要**）。en = `/en/...`、zh-TW = `/zh-TW/...` |
| ロケール判定 | URL > cookie（`PARAGLIDE_LOCALE`）> Accept-Language > baseLocale(ja) |
| 対象範囲 | 顧客向け16画面 + 共通コンポーネント。**/admin は日本語のまま**（スタッフ向け）。ただし翻訳編集タブを追加 |
| DBコンテンツ翻訳 | `book.content_translations` 汎用テーブル（autumn-shared migration・**PR #28 マージ後に適用**） |
| 通貨 | JPY のみ。表示は `Intl.NumberFormat(locale, {currency:'JPY'})`。換算表示はしない |
| メール多言語 | P3（Resend接続）時に実装。今回は `book.members.locale` と hold/confirm への locale 引き回しまで |

## 1. UI 文言（メッセージ）層

### 1.1 構成

```
apps/web/
  project.inlang/settings.json   # baseLocale: ja, locales: [ja, en, zh-TW]
  messages/ja.json               # 原文（SoT）
  messages/en.json
  messages/zh-TW.json
  src/lib/paraglide/             # 生成物（.gitignore に追加・vite plugin が生成）
```

- `vite.config.ts`: `paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide', strategy: ['url','cookie','preferredLanguage','baseLocale'] })`
- `src/hooks.ts`: `reroute` で `deLocalizeUrl` → 既存ルートがそのまま全ロケールで解決
- `src/hooks.server.ts`: `paraglideMiddleware` で resolve をラップし `%lang%` を置換
- `src/app.html`: `<html lang="%lang%">`

### 1.2 メッセージ規約

- キーは `画面_要素` のフラット snake_case（例 `search_no_results`, `booking_hold_expires_in`）。共通文言は `common_` プレフィックス（例 `common_nights`, `common_adults`）
- パラメータは Paraglide のプレースホルダ（例 `{count}`）。複数形は en のみ select/分岐が必要なら文言側で回避（"1 night" / "{n} nights" は `common_night_count` で `{n}` 埋め込み・en は "night(s)" 回避のため2キー化可）
- ja.json が SoT。en / zh-TW は初期値=機械翻訳ベース（観光・宿泊ドメインの語彙で人手レビュー前提。レビュー待ちであることを HANDOFF に記録）
- 法務文言（特商法・キャンセル規定等）の en/zh-TW は「参考訳＋日本語正文優先」の注記キーを必ず添える（`legal_translation_notice`）

### 1.3 日付・数値フォーマット（`src/lib/format.ts` 改修）

- `formatDateJa` / `formatDateLongJa` → `formatDate(date)` / `formatDateLong(date)` に置換し、内部で `getLocale()` + `Intl.DateTimeFormat`（weekday: 'short'）
- `formatYen` → 表示用は `formatPrice(amount)`（`Intl.NumberFormat(locale, {style:'currency', currency:'JPY', maximumFractionDigits:0})`）。ja は従来の `¥12,345` 表記を維持

## 2. コンテンツ（DB/デモストア）翻訳層

### 2.1 autumn-shared migration（`book.content_translations`）

```sql
create table book.content_translations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references core.tenants(id),
  facility_id  uuid references core.facilities(id),  -- brand/legal は null 可
  entity_type  text not null check (entity_type in
                 ('brand','facility','room_type','plan','faq','photo','legal')),
  entity_id    uuid not null,
  locale       text not null check (locale in ('en','zh-TW')),
  fields       jsonb not null default '{}'::jsonb,   -- 翻訳するフィールドのみ部分上書き
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (entity_type, entity_id, locale)
);
```

- RLS: 公開読み（`is_published`）を anon/authenticated に、書き込みは `private.has_facility_access`（facility_id null 行は `has_tenant_access`）。GRANT を忘れない（実装規約）
- `book.members` に `locale text not null default 'ja'` を追加（確定メール多言語の布石）
- `create_hold` / `confirm_booking` に `p_locale text default 'ja'` を追加し members.locale を更新
- **タイムスタンプは `20260612...`（PR #28 の `20260611100500` より後）。PR #28 マージ後でないと適用不可** — PR 説明に明記

### 2.2 フォールバック規約（アプリ側で実施）

- 取得: 表示対象 entity の翻訳行を locale で一括取得 → `merged = { ...baseJa, ...translation.fields }` の**フィールド単位**マージ
- ja は常に完全。en/zh-TW の欠落フィールドは ja 原文を表示（空文字は欠落扱い）
- amenities / access / photos の jsonb はキー単位でなく**丸ごと置換**（部分マージの複雑化を避ける）

### 2.3 デモストア（`src/lib/server/store.ts`）

- 同じ形の `translations: Record<entityKey, Record<locale, fields>>` を持ち、`getFacility(slug, locale)` 等のシグネチャに locale を追加して同じマージ規約で返す
- supabase-data.ts も同一シグネチャで `content_translations` を読む（カットオーバー対称性維持）
- デモデータ: 2施設・全部屋・全プラン・FAQ・法務ページに en / zh-TW のデモ翻訳を投入（サイトが実際に翻訳表示されることを確認可能に）

### 2.4 管理画面（/admin・日本語のまま）

- 施設編集 / プラン編集 / FAQ に「翻訳」タブを追加: ロケール切替（en / zh-TW）+ 対象フィールドの入力欄 + 公開チェック
- 翻訳タブの保存はデモストアの translations を更新（Supabase 接続時は content_translations upsert に差し替え）

## 3. SEO / UX

- `(public)/+layout.svelte` の `<svelte:head>` に hreflang alternates（ja / en / zh-TW / x-default=ja）を全ページで出力（`localizeHref` 利用）
- ヘッダーに言語スイッチャ（地球儀アイコン + JA / EN / 繁體中文）。現在ページの localized URL へ遷移（`localizeHref($page.url.pathname)`）。cookie が追従
- OGP: `og:locale` をロケール連動
- 検索エンジン向け: ロケール間で canonical は各言語の自己URL（hreflang相互参照のみ。canonical 統合はしない）

## 4. 実装フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| i18n-1 | Paraglide 基盤 + 顧客16画面の文言抽出 + en/zh-TW 翻訳 + 言語スイッチャ + hreflang + format 改修 | 今回 |
| i18n-2 | コンテンツ翻訳（デモストア + アダプタ + 管理「翻訳」タブ + autumn-shared migration） | 今回 |
| i18n-3 | 確定メール・ステップメールの多言語（P3 Resend 接続時） | 後続 |
| i18n-4 | en/zh-TW 文言の人手レビュー（特に法務・キャンセル規定） | 後続・要ユーザー |

## 5. 検証チェックリスト

- [ ] `pnpm build` 成功（adapter-cloudflare）・`pnpm check` エラーなし
- [ ] `/` `/en` `/zh-TW` でポータルが各言語表示・`<html lang>` 連動
- [ ] 言語スイッチャで現在ページ維持のまま切替・cookie 永続
- [ ] 予約4ステップを en で通し完走（hold タイマー・確認画面・完了画面）
- [ ] 翻訳のない施設フィールドは ja にフォールバック
- [ ] hreflang が ja/en/zh-TW/x-default の4本出る
- [ ] /admin は従来どおり日本語・翻訳タブから en 入力→公開→顧客面に反映
