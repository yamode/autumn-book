# autumn-book HANDOFF

最終更新: 2026-06-11

## 現在の状態

- **フェーズ：全25画面の UI 実装完了（デモデータ駆動）— Supabase 接続前**（v0.3.0）
- 正式設計書：`autumn_book_design.md`（v2・プラットフォーム統合版）
- 画面設計書：`autumn_book_ui_design.md`（v1）— 顧客向け16画面 + 管理画面9画面。実装増分は同書 §7
- モノレポ稼働：`pnpm install` → `pnpm dev`（apps/web・SvelteKit 2 + Svelte 5 + Tailwind 4）
  - 顧客向け：ポータル / 地図検索（MapLibre+OpenFreeMap）/ 施設HP / 部屋・プラン詳細（料金カレンダー）/ 予約4ステップ（hold 20分タイマー・現地払い/デモカード決済）/ 認証 / マイページ（予約・キャンセル・ポイント・グレード・お気に入り・プロフィール）
  - 管理（/admin）：ダッシュボード / 予約管理（施設都合キャンセル・監査ログ）/ 施設・部屋編集 / プラン作成（Markdownエディタ+ライブプレビュー）/ メルマガ3ステップウィザード / ステップメール / 会員管理（ポイント手動調整）/ FAQ
  - デモログイン：会員 demo@yamado.co.jp / demo、管理者はワンクリック（/admin/login）
- **データ層は `src/lib/server/store.ts`（インメモリ・デモ）**。関数シグネチャは設計書 §5.2 の RPC と対応させており、Supabase 接続時はこのモジュールを差し替える
- DEBUG フラグ実装済み（`src/lib/debug.ts`・画面右下 DBG パネル）
- **i18n 実装済み（2026-06-10・設計書 `autumn_book_i18n_design.md`）**：ja（プレフィックスなし・URL無変更）/ `/en` / `/zh-TW`。Paraglide JS 2（UI文言 約150キー抽出済み）+ コンテンツ翻訳層（デモストアにフィールド単位オーバーレイ・ja フォールバック・管理画面に翻訳セクション）。言語スイッチャ・hreflang 4本・`<html lang>` 連動・日付/通貨のロケール表示対応。DB 側は autumn-shared に `book.content_translations` + `book.members.locale` migration 作成済み（**PR #28 マージ後に適用可**・同一ブランチ）

## 実装済みの主な決定反映

- 写真ストレージ＝**Supabase Storage で決定（2026-06-11）**。管理画面のアップロード UI は Storage 接続時に有効化
- Markdown は原文保存・表示時サニタイズ（生HTML不許可）。プラン/施設紹介/FAQ/メール本文で共通
- staff ロールは閲覧のみ＋連絡先マスク、破壊的操作（キャンセル・ポイント調整・ランク変更）は理由必須＋監査ログ

## Supabase 接続フェーズの進捗（2026-06-11）

- ✅ **book スキーマ migration 6本を autumn-shared#28 に PR 済み**（https://github.com/yamode/autumn-shared/pull/28）
  - book_schema（コンテンツ層+ビュー+RLS）/ book_members / book_holds（pg_cron解放）/ book_rpc_search / book_rpc_booking / book_storage（book-photos バケット）
  - 実 PROD スキーマ実査済み（列名・CHECK制約・private ヘルパー・テナント/施設ID）。既存テーブルへの ALTER なし＝autumn-pms v0.1 の未コミット migration（20260610090xxx）と競合しない
  - confirm_booking は pms 拡張前のため core.stays + bookings のみ書く移行可能設計（設計書 §8-4）
  - **⚠ マージ＝PROD 自動適用。マージはユーザーがレビュー後に実施**
- ✅ アプリ側 Supabase 接続層：`src/lib/server/supabase.ts` + `supabase-data.ts`（RPC/ビューのアダプタ・カットオーバー手順はファイル冒頭コメント）。`.env` の `DATA_SOURCE=demo|supabase` で切替（既定 demo）
- ✅ adapter-cloudflare へ切替済み（ビルド成功・session cookie の Buffer 依存も除去済み）

## 残アクション（要ユーザー作業 or 後続セッション）

1. **autumn-shared#28 をレビュー → マージ**（PROD 適用）。その後 rms で daily_rates / availability 整備 + book.facility_contents / plan_contents に公開データ投入 → `DATA_SOURCE=supabase` 切替（手順: supabase-data.ts 冒頭）
2. **Cloudflare Pages デプロイ**：`wrangler login` が未認証（ブラウザ認証が必要）。ログイン後 `pnpm dlx wrangler pages project create autumn-book` → `pages deploy`
3. Supabase Auth 本接続（P5・@supabase/ssr）— デモ session を置換。LINE ログインは §14-5 決定後
4. Stripe 本接続（P4・APIキー要）・Resend 接続（P3 確定メール→P7 メルマガ。APIキー・送信ドメイン SPF/DKIM 設定要 §14-4）
5. メルマガ/ステップメールの DB 化（mail_campaigns / email_sequences migration は設計書 §11 の P6 以降分）
- 旧仕様 `autumn_book_spec.md` / `autumn_book_full_spec.md` / `autumn_book_erd.md` は設計書 §12 で置き換え済み（参照用に残置）
- 前提：autumn-pms/docs/02-architecture.md（クラウドPMS設計・2026-06-10）と整合済み。予約の着地形（stay_groups → stays → stay_nights）は PMS 設計に従う
- コミット未実施（設計書・HANDOFF とも working tree のみ）

## 決定済み事項

- 技術スタック：SvelteKit 2 + Svelte 5 + Tailwind 4 + Cloudflare Pages（rms/order と同一）
- DB：Supabase「Autumn Platform」共有。migration SoT = autumn-shared（GitHub Integration 自動適用）
- ドメイン戦略：yamado.co.jp 一本継続。www=西和賀 / oga=男鹿 を autumn-book で置換、corporate は WP のまま（§4.0）
- DNS：案A（zone を Cloudflare へ移管・メールは Xserver のまま）で実施可能と確認済み。ランブック §4.0.1
  - ⚠ oga.yamado.co.jp は MX なし（A レコード暗黙配送）。**Web 切替前に明示 MX 追加が必須**
- Stripe 導入決定（2026-06-10）
- アナリティクス = Google Analytics 4（全ホスト単一プロパティ + クロスドメイン計測・予約ファネル計測）、エラートラッキング = Sentry（SvelteKit + Edge Functions、PII マスク）— 2026-06-10 決定（設計書 §9）
- 追加要件6件を §15 に設計済み：チャットボットQ&A / オプションサービス予約（貸切風呂等）/ 客室電子インフォメーション / Stripe / メルマガ / ステップメール

## 未決事項（要ユーザー判断・詳細は設計書 §14）

### ドメイン関連
- [ ] DNS 移管の実施タイミング（手順は確定済み。Xserver 全レコード棚卸しから）
- [ ] ポータルのホスト名（stay / book / go / member …）
- [ ] 旧 WP の切替順序（男鹿先行か同時か）・301 マップ・現予約導線の確認
- [ ] 送信メールドメイン（Resend の SPF/DKIM を Xserver SPF と共存設定）

### 事業・UX 関連
- [ ] LINE ログイン導入（LINE Developers チャネル開設要）
- [ ] Stripe アカウント構成（施設別 or 単一）※導入自体は決定済み
- [ ] buffer_rooms 運用値（0〜1 想定）
- [ ] 写真素材の調達・リサイズフロー
- [ ] 料金パリティ方針（直販ベストレート保証の打ち出し）
- [ ] ポイント原資・付与率（ランク別還元率）
- [ ] 子供料金の直販での受け方（child a〜e 区分は未使用）
- [x] 多言語（EN/TW）→ **実装済み（2026-06-10・ja/en/zh-TW、`autumn_book_i18n_design.md`）**。残: en/zh-TW 文言の人手レビュー（特に法務・キャンセル規定 = i18n-4）と確定メール多言語（P3 Resend 接続時 = i18n-3）

### 新規サブシステム関連（§15）
- [ ] メルマガ配信基盤（Resend 統一推奨 vs Benchmark 継続）
- [ ] チャットボットの応答範囲・エスカレーション先
- [ ] 電子インフォメーションの提供形態（スマホQR前提 vs 客室タブレット）
- [ ] オプション予約の販売条件（貸切風呂の枠数・開始タイミング・キャンセル規定・料金）
- [ ] ステップメールの文面・タイミングの現場確認（既定案：7日前/3日前/前日/翌日）

### 画面設計関連（autumn_book_ui_design.md §8）
- [x] 写真ストレージ → **Supabase Storage で決定（2026-06-11）**
- [ ] 管理画面の置き場所（autumn-book 内 `/admin` で実装済み。rms 同居に変える場合は要指示）
- [ ] 管理面への Cloudflare Access 追加保護の要否
- [ ] OTA 予約を管理画面に閲覧表示するか（現実装：閲覧のみ表示）
- [ ] rate_plans 新規作成を book 管理画面に取り込むか（現実装：rms 残置・読み取り専用表示）

## 次のアクション候補

1. 上記未決事項のうち「ポータルホスト名」「DNS 移管タイミング」を決める（P1 公開の前提）
2. P0 着手：リポ初期化（pnpm workspace + SvelteKit）+ `book` スキーマ migration を autumn-shared に PR
   - ⚠ 着手前に autumn-pms v0.1 の migration 進捗を確認（core.guests / rate_plans の ALTER 競合回避。設計書 §11）
3. DNS 事前修正（oga の明示 MX + SPF 追加）は移管前にいつでも実施可能・無リスク

## テストチェックリスト

※デモデータ環境（`pnpm dev`）。Supabase 接続後も同じ項目を流す。

### 検索・施設HP
- [ ] トップの地図に2施設のピンと参考料金が出る
- [ ] /search で日付・人数を変えるとピンの料金・残室が更新される
- [ ] 満室条件でピンが灰色「満室」になり、カードに電話案内が出る
- [ ] 施設HP（西和賀・男鹿）の写真タブ・空室カレンダー・アクセス・FAQが表示される
- [ ] プラン一覧のタグ絞り込みチップが機能する

### 予約フロー
- [ ] プラン詳細の料金カレンダーで日付を選ぶと客室料金が更新される
- [ ] 「この客室で予約する」→ hold 作成・20分タイマーが表示される
- [ ] 必須項目を空にするとインラインエラーが出る
- [ ] 現地払いプランは決済をスキップして完了画面に進む
- [ ] 事前決済プラン（記念日プラン）は決済画面を経由する
- [ ] 完了画面に予約番号・付与予定ポイントが出る（PC・iPhone両方）
- [ ] タイマー失効後に送信すると失効エラーが出る

### 会員・マイページ
- [ ] demo@yamado.co.jp / demo でログインできる
- [ ] 新規登録 → 入会ボーナス500pt が付与される
- [ ] ログイン状態で予約するとゲスト情報がプリフィルされる
- [ ] ポイント利用額を入れると支払額が再計算される
- [ ] 予約詳細で「本日キャンセルのキャンセル料」が表示され、キャンセルできる
- [ ] キャンセルで利用ptが返還・付与予定ptが取消される（ポイント履歴で確認）
- [ ] お気に入りの追加・削除ができる
- [ ] プロフィール編集・メルマガON/OFFが保存される

### 管理画面（/admin）
- [ ] 管理者デモログイン → ダッシュボードに件数が出る
- [ ] 施設切替セレクタで全画面の対象施設が切り替わる
- [ ] 予約管理の絞り込み（ステータス・チャネル・氏名検索）が機能する
- [ ] 施設都合キャンセル（料金免除＋理由必須）が実行でき、監査ログに残る
- [ ] スタッフロールでは連絡先がマスクされ操作ボタンが出ない
- [ ] プラン編集：Markdown を書くと右プレビューが即時更新される
- [ ] プラン編集：写真挿入ボタンで画像記法が挿入される
- [ ] プランを下書きにすると顧客側プラン一覧から消える
- [ ] メルマガ：対象者カウント → 二段確認 → 配信で一覧に「配信済」が出る
- [ ] ステップメールのステップ編集・稼働/停止トグルが保存される
- [ ] 会員詳細でポイント手動調整（理由必須）ができ、台帳に記帳される
- [ ] FAQ追加（下書き）→ 公開で施設HPに表示される

### 共通
- [ ] DBG パネル（右下）が開閉できる（リリース時 DEBUG=false で非表示化）
- [ ] スマホ幅で検索バー・地図・予約フローが崩れない
