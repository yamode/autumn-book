# autumn-book HANDOFF

> **最終更新**: 2026-06-13（メンテナンスモード + KV 永続トグル。v0.11.0）

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

## 施設別テンプレート・お知らせ機能（2026-06-12 追加・v0.5.0）

- **施設サイトの完全分離（2026-06-12・v0.5.1）**：施設配下（HP・客室・プラン・お知らせ）は共通ヘッダーを使わず、**各サイト固有のヘッダー/フッター/タイポグラフィ**（`src/lib/site/*Shell.svelte`・`+layout@.svelte` でルートレイアウトへリセット）。共通UIに入るのは予約ボタン・会員ログイン・空室検索を押してから（/search・/account・/booking は従来の共通ヘッダー）
  - 西和賀シェル＝現行 www 実測値（固定白80%ヘッダー・ロゴ130px・ナビ16px・ご予約ボタン #e5e5e5→hover#4d4d4d・本文 游明朝16px lh1.6 #333・コンテナ980px・モバイル全面#4d4d4dメニュー）
  - 男鹿シェル＝現行 oga 実測値（Shippori Mincho B1 16px ls.05em lh1.75 palt #111・Cormorant Garamond/Inter・ロゴsvg+ハンバーガーのみの固定白ヘッダー＝トップはスクロール出現・右中央固定の縦書き「宿泊予約」・ドロワーContents・本文カラム600px）
  - プラン/客室ページには施設ヘッダー直下に検索条件バー（共通機能の入口）
- **実コード参照での再現度向上（2026-06-12・v0.8.0）**：ユーザーが `C:\Users\yamado\dev\hp-yamado`（WPテーマ一式）/ `hp-oga`（dist+ejs）に現行サイトのコードを配置 → 実マークアップ・実CSSを直接参照して両トップページを再構築
  - 西和賀＝front-page.php 準拠：KVスライダー／sec-introduction×2（「山人と名乗る宿」「ここに来る理由」原文全文）／sec-links（施設・客室・お料理＝ラベル画像+ホバー切替）／周辺観光バナー／Googleマップ埋込（原サイトと同じembed）／sec-address（ダーク帯+白ロゴ+SNS）
  - 男鹿＝index.ejs 準拠：左右2面KVスライダー+縦書きコピーSVG／詩的イントロ縦書き全文／ギャラリーコラージュ／01 NATURE・02 CUISINE・03 PURITY（実タイトルSVG+原文+パララックス背景）／ABOUT（温泉・イベント大カード+館内/アクティビティ/アクセス小カード）／NEWS
  - **画像アセットを `static/site-assets/` にローカル化（約16MB・70ファイル）— WPサーバーへのホットリンク解消済み**
- **下層コンテンツページ再現（2026-06-12・v0.6.0）**：原サイトと同じマルチページ構成を `/[brand]/[facility]/[page]` 動的ルート + `book.site_pages`（migration 20260612004000）で再現
  - 西和賀: /rooms /cuisine /facility /option /shiki /faq /access（原文リード・料金・実画像を移植）
  - 男鹿: /rooms /nature /cuisine /restaurant /onsen /guide /access（泉質・営業時間・コース名等も移植）
  - スクロールリビール（IntersectionObserver `use:reveal`・prefers-reduced-motion 対応）+ ヒーローズームイン。スマホは縦積み・42vhヒーロー
  - 文字サイズを底上げ（シェル基準 17px・小サイズユーティリティもスコープ内で +1〜2px）
  - 下層ページの管理画面編集（site_pages CRUD）は未実装 → 次タスク候補
- **施設別デザインテンプレート**：`facility.template`（standard / yamado-v1 / oga-v1）で施設HPのデザインを出し分け
  - `yamado-v1`（西和賀）= 現行 www の和モダン再現（明朝・深緑・縦書きキャッチ・「山人に来る理由」）
  - `oga-v1`（男鹿）= 現行 oga のミニマルモダン再現（サンセリフ・NATURE/CUISINE/STAY・ABOUTグリッド）
  - 実装: `src/lib/templates/`（共通セクションは `components/facility/`）。新施設は standard が既定
- **お知らせ機能**（WP ニュース置換）：公開側 `/[brand]/[facility]/news`（一覧・詳細）+ 施設HPに最新3件、管理側 `/admin/news`（Markdown・下書き/公開）。現行サイトの実ニュース3件×2施設を移植済み
- **実コンテンツ移植**：コンセプト文（「山人=山の人」「あるがままに、還る」）・実客室名（雪椿/椈/靖山樓・山祇/迦具土/綿津見）・実写真を現行WPサイトから移植
  - ⚠ 写真は現行 WP サーバーへの**暫定ホットリンク**。WP 廃止前に Supabase Storage（book-photos）へ移設必須
- DB側: `book.news_posts` + `facility_contents.template` を migration 済み（20260612003000・PROD適用）。supabase-data.ts に listNews 追加済み

- **決済設定ロジック（2026-06-12・v0.7.0）**：プラン単位の決済設定 `payment: { onsite, prepay, prepayMethods('card'|'paypay'), prepayDiscountRate(≤20%) }`
  - **PayPay 追加**（事前決済手段としてカードと並列。決済画面に PayPay デモUI＝本実装は P4 で PayPay for Developers or Stripe 経由）
  - **事前決済＝予約時の即時決済**（宿泊後請求ではない）。確定時に paymentStatus='paid'
  - **事前決済割引**：0〜20%（上限バリデーション付き）。ゲストが予約フローで支払い方法を選択→事前決済選択で割引適用・打消線表示。booking.total は割引後最終額、ポイント付与も割引後基準
  - 管理画面 `/admin/plans/[id]` に「決済設定」セクション（現地/事前トグル・手段・割引率セレクタ）
  - ⚠ 本実装時はこの設定を `booking.rate_plans.metadata.prepay` に置き、book.quote / confirm_booking RPC に割引ロジックを追加する（rms と要連携・P4）

## コミュニティ掲示板（2026-06-12 追加・v0.9.0）

- **会員だけが書き込める公開掲示板**（閲覧は誰でも）。ファンコミュニティの可視化 → 会員登録（無料）・公式サイト/直販予約への誘導が目的
- 設計書: `autumn_book_forum_design.md`（元仕様 forum-spec.md をプロジェクト規約に適合。§1 の差分判断が正）
- **会員＝既存会員（book.members / デモ会員）そのもの**。掲示板専用の会員IDは作らない。DB 側は forum_set_nickname のプロフィール作成を「既存 book.members or 社内スタッフ（has_tenant_access・role 自動判定）」にゲート（それ以外は not_member）
- **ニックネーム制**: 表示は全員ニックネームのみ（実名・メール・userId 非露出）。staff/admin 投稿に「運営」バッジ。初回投稿前に `/community/settings` で設定（ユニーク・2〜20字）
- 公開側: `/community`（板一覧）→ `/community/[board]`（スレ一覧・ページネーション）→ `/community/threads/[id]`（投稿一覧＋返信）。未ログインは閲覧＋会員登録CTA。アンカーは `>>n`（スレ内連番）、本文は plain text（エスケープ→>>nリンク→URLリンク→改行。Markdown不採用＝XSS面積最小化）
- 管理側: `/admin/community`（板CRUD=adminのみ・スレpin/lock/削除・投稿削除・ban=staff可。全操作を form action 内で role 再チェック＋監査ログ記帳）
- デモシード: 板3（announce/travel/qa）・スレ5（pinned/locked 各1含む）・プロフィール5（たろう=会員 demo / やまびと事務局=staff / 山人支配人=admin ほか）
- DB: `book.forum_profiles / forum_boards / forum_threads / forum_posts` + RPC 12本（migration `20260612070000_book_forum.sql`）。**RPCファースト**＝テーブルは RLS deny-all・anon/authenticated への GRANT なし、読みは anon 可・書きは authenticated（P5 Auth 接続後に有効）。auth.users へのトリガーは作らない（共有 Supabase のため）。supabase-data.ts にアダプタ追記済み
- **PROD 適用済み（2026-06-12）**: `schema_migrations` に 20260612070000 を確認・板シード3件投入済み。Supabase Advisor の新規指摘は「forum_* テーブル RLS有効・ポリシーなし」INFO 4件（＝deny-all+RPCファーストの意図的設計）と forum RPC の SECURITY DEFINER WARN（読み=anon は公開閲覧、書き=authenticated は内部ガードありで意図的）。**修正不要**
- 後続: Realtime（P5後）/ Claude モデレーション / 画像添付 / 運営ロール付与オペ（設計書 §11）

## メンテナンスモード（2026-06-13 追加・v0.10.0 → KV 永続トグル v0.11.0）

- **正式公開前・メンテナンス作業中に一般ユーザーへサイトを非公開にする**。`hooks.server.ts` で全リクエストを横断ガードし、メンテナンス有効かつバイパス対象外なら **HTTP 503**（`noindex` + `Retry-After`）の自己完結メンテナンスページを返す（外部アセット非依存・ja/en/zh-TW 対応・両施設の電話番号掲載）
- 制御は2系統（`src/lib/server/maintenance.ts`）:
  - **管理画面トグル**（`/admin/maintenance`・admin のみ・監査ログ `maintenance_toggle`）が通常の切替手段。**保存先は Cloudflare KV（`AB_CONFIG` バインド・namespace id `d03a529d29c649dc8401819089dbd155`）**で、全 edge に共有・永続する（数十秒以内に反映）。KV 未接続環境（vite dev / プレビュー）はプロセス内メモリにフォールバック
  - **環境変数 `MAINTENANCE_MODE=on`**：強制 ON のエスケープハッチ。on のときは KV/トグルに関わらずメンテ中になり、UI トグルでは解除不可
- **KV 配線**：`wrangler.jsonc` に `kv_namespaces`（`AB_CONFIG`）追加。`pages deploy`（CI）が本番デプロイにバインドを適用。型は `app.d.ts` に最小 `KVNamespace` / `App.Platform` を自前宣言。本番 KV は空＝**起動時は OFF（公開）**
- **バイパス（メンテ中もサイトを見られる）**：① `/admin` 配下（`/admin/login` でログイン→バイパス取得）② admin/staff ログイン中（公開サイトのプレビュー）③ プレビュートークン `?preview=<token>`（`MAINTENANCE_BYPASS_TOKEN` 一致で1日 cookie 発行・アカウント無しの関係者共有用）
- 任意の環境変数：`MAINTENANCE_BYPASS_TOKEN`（プレビュー共有）/ `MAINTENANCE_MESSAGE`（ページ本文差し替え）。`.env` / `.env.example` に既定 off で追記済み
- 管理画面：左ナビ「🛠 メンテナンス」+ 有効時はヘッダー下に黄色バナー。`/admin/maintenance` で状態表示（KV 接続/強制 ON の別）・即時トグル・プレビューリンクのコピーを提供
- CI：`deploy.yml` のヘルスチェックを **200 または 503 を許容**に変更（公開前 lockdown 期間中も deploy が失敗扱いにならない）
- 動作確認：`wrangler pages dev`（KV バインド local）で admin トグル ON→公開ページ503・admin到達200・OFF→200 を通しで実証。加えて 503ページ/バイパス/preview cookie 継続/`/en` 英語文言/既定 off=200 を確認
- ⚠ 本番で管理画面トグルが効くには KV バインドが本番デプロイに適用されていること。CI（`wrangler pages deploy`）が `wrangler.jsonc` を読んで適用するが、反映されない場合は Pages → Settings → Functions → KV namespace bindings で `AB_CONFIG` = `autumn_book_config` を設定

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
- ✅ **Supabase Advisor の ERROR 3件解消（2026-06-12・migration 20260612001000/001100）**：v_* ビュー3本を security_invoker=true 化＋下位テーブルへ「公開行のみ・必要列のみ」の anon GRANT/RLS（可視範囲は不変・email等の非公開列は遮断を実証）。book-photos の listing 露出 WARN も SELECT ポリシー削除で解消
  - 残 WARN のうち book の anon 実行可 SECURITY DEFINER RPC（create_hold 等）は**ゲスト予約導線として意図的**（設計書 §5.2）。pg_net / rms_log_activity は rms 由来で対象外
  - 「Leaked Password Protection Disabled」WARN は Auth 本接続（P5）時にダッシュボードで有効化推奨

## 残アクション（要ユーザー作業 or 後続セッション）

0. ~~autumn-shared#28 マージ~~ → **✅ 2026-06-11 マージ・PROD 適用確認済み**（schema_migrations に 20260611100100〜100600 の6本、autumn_booking チャネル・pg_cron 登録済み、anon での RPC/ビュー実行も権限エラーなしを確認）
1. ~~Supabase ダッシュボードで `book` スキーマを API 公開~~ → **✅ 2026-06-11 追加済み**（Exposed schemas に `book`）
   - migration 運用ルールを `CLAUDE.md` に明文化（開発期間中は Supabase Branching 不使用・明示指示なき限り autumn-shared main へ直接 push＝GitHub Integration 自動適用）
2. **rms 側でデータ投入**：rate_plans / daily_rates / availability が現在 **0件**（room_types は15件あり）。プラン・料金・在庫が入らないと検索 RPC は空を返す
3. **book 公開コンテンツ投入**：facility_contents / plan_contents / photos。PROD への直接 INSERT は権限ポリシーで不可のため、(a) `DATA_SOURCE=supabase` 切替後に管理画面 `/admin` から入力（Auth 接続が前提）、(b) seed 用 migration を autumn-shared に追加、(c) ユーザー立ち会いで SQL 実行、のいずれか
4. 1〜3 が揃ったら `.env` の `DATA_SOURCE=supabase` 切替（手順: supabase-data.ts 冒頭）
2. ~~Cloudflare Pages デプロイ~~ → **✅ 2026-06-11 デプロイ済み（demo モード）**：https://autumn-book.pages.dev（全ルート200確認・ja/en/zh-TW）
   - Pages プロジェクト名 `autumn-book`・production branch `main`。`apps/web/wrangler.jsonc` に `nodejs_compat` フラグ（Paraglide の async_hooks 用・必須）
   - 再デプロイ手順：`cd apps/web && pnpm build && pnpm dlx wrangler pages deploy`
   - **CI/CD（2026-06-12）**：`.github/workflows/deploy.yml` — main push で build → deploy → ヘルスチェック（5パス200確認）。CF Git接続は使わない方針（Direct Upload + Actions。品質ゲートを組めるため本番運用に採用）。**有効化には GitHub Secrets の登録が必要**：`CLOUDFLARE_API_TOKEN`（Pages編集権限）/ `CLOUDFLARE_ACCOUNT_ID`（=6aa45d1081c1e08d7f1ce6d5aba5c3b7）
   - `DATA_SOURCE=supabase` 等の本番環境変数は Pages の Settings → Environment variables で設定（demo の現状は環境変数不要）
   - カスタムドメイン（www / oga / stay）割当は DNS 移管後（§4.0.1・oga の MX 明示追加が前提）
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

### メンテナンスモード
- [ ] `MAINTENANCE_MODE=on` で起動すると公開ページ（/・/search・施設HP）が 503 メンテナンスページになる
- [ ] メンテ中でも /admin/login にアクセスでき、管理者ログイン後は公開サイトも閲覧できる（バイパス）
- [ ] `MAINTENANCE_BYPASS_TOKEN` 設定時、`?preview=<token>` で公開サイトが見られ、以後 cookie で継続する
- [ ] /en・/zh-TW でメンテナンスページの文言と `<html lang>` が切り替わる
- [ ] 管理画面 `/admin/maintenance` で即時トグルでき、有効時はヘッダー下に黄色バナーが出る（環境変数強制 ON 時はトグル不可表示）
- [ ] 本番（KV 接続）で admin トグル ON → 別端末/ログアウト状態の公開ページが 503 になる（数十秒で反映）
- [ ] 既定（off）では従来どおり全ページが公開される

### コミュニティ掲示板
- [ ] 未ログインで /community〜スレ詳細まで閲覧でき、投稿フォームの代わりに会員登録CTAが出る
- [ ] 会員ログイン後、ニックネーム未設定だと投稿前に設定を求められ、設定後に投稿できる
- [ ] ニックネームの重複・2文字未満・21文字以上はエラーになる
- [ ] スレ作成→板一覧の先頭（pinned の下）に出る。返信で件数・最終投稿が更新される
- [ ] >>2 と書くと該当投稿へのページ内リンクになる
- [ ] 本文に <script> を書いてもそのまま文字として表示される（XSS不可）
- [ ] 自分の投稿を削除でき、「この投稿は削除されました」のプレースホルダになる
- [ ] ロックされたスレ（春の感謝企画）には返信フォームが出ない
- [ ] 運営（staff/admin）の投稿に「運営」バッジが付き、実名・メールはどこにも出ない
- [ ] /admin/community でスレの pin/lock/削除・投稿削除・ban ができ、監査ログに残る
- [ ] ban した会員（たろう）でログインすると投稿がエラーになる
- [ ] 板をアーカイブすると新規スレ作成ボタンが消える（閲覧は可能）
- [ ] /en /zh-TW で UI 文言が翻訳される（投稿本文・板名は日本語のまま）
- [ ] スマホ幅でスレ一覧・投稿一覧・フォームが崩れない


## 作業ログ

---

### 2026-06-13（メンテナンス: KV 永続トグル）

**実施内容:**
- 管理画面トグルの保存先を「プロセス内メモリ」→「Cloudflare KV（`AB_CONFIG`）」に変更。本番でも admin の `/admin/maintenance` トグルが全 edge に効く・永続するようにした
- KV namespace `autumn_book_config`（id `d03a529d29c649dc8401819089dbd155`）を作成・`wrangler.jsonc` にバインド追加。`app.d.ts` に最小 `KVNamespace`/`App.Platform` 型
- `maintenance.ts` の状態関数を async + platform 受け取りに（KV あれば KV・無ければメモリ）。`hooks.server.ts`・admin layout・maintenance ページを await 化
- 環境変数 `MAINTENANCE_MODE=on` は強制 ON のエスケープハッチとして維持
- `wrangler pages dev`（KV local バインド）で admin トグル経由の ON/OFF→公開ページ 503/200 を通しで実証。本番 KV は空＝起動時 OFF（公開）

**バージョン:** `v0.11.0`

---

### 2026-06-13（メンテナンスモード）

**実施内容:**
- 正式公開前・メンテ作業中に一般非公開にするメンテナンスモードを実装（`src/lib/server/maintenance.ts` + `hooks.server.ts` で全リクエスト横断ガード→503）
- 制御2系統（環境変数 `MAINTENANCE_MODE` 強制 ON / 管理画面トグル）+ バイパス3経路（/admin 配下・運営ログイン・プレビュートークン+cookie）
- 管理画面 `/admin/maintenance`（状態表示・即時トグル・プレビューリンク・本番設定手順）+ 左ナビ追加 + 有効時ヘッダーバナー。トグルは監査ログ記帳
- メンテページは自己完結 HTML（ja/en/zh-TW・noindex・Retry-After・両施設の電話番号）。`MAINTENANCE_MESSAGE` で本文差し替え可
- `.env`/`.env.example` に既定 off で追記。`deploy.yml` ヘルスチェックを 200/503 許容に
- build 成功・dev で 503/バイパス/トークン継続/ロケール/既定 off を実証

**バージョン:** `v0.10.0`

---

### 2026-06-12（コミュニティ掲示板）

**実施内容:**
- 掲示板仕様書（forum-spec.md）を受領 → `autumn_book_forum_design.md` として設計（book スキーマ・RPCファースト・auth.users トリガー不採用・>>n アンカー・plain text 本文に適合）
- 公開5画面（板一覧/スレ一覧/スレ作成/スレ詳細/ニックネーム設定）+ `/admin/community` + 共通ヘッダー/admin/account 導線 + i18n（ja/en/zh-TW forum_* キー）
- store.ts にデモ実装（プロフィール5・板3・スレ5・投稿群シード）。supabase-data.ts に RPC アダプタ
- migration `20260612070000_book_forum.sql`（テーブル4 + RPC12 + 板シード3）を autumn-shared へ
- レビューで2点修正: /admin/community の form action に role 再チェック追加（会員POSTで403を確認）・URL自動リンクがエスケープ済みエンティティ（&gt;等）を巻き込む問題
- 動作確認: build 成功・dev サーバーで閲覧/CTA/投稿/XSSエスケープ/>>nリンク/URLリンク/ロック拒否/403 を実証

**バージョン:** `v0.9.0`

---

### 2026-06-11〜12

**実施内容:**
- 画面設計書 v1（25画面）作成 → 全25画面を実装（デモデータ駆動・v0.3.0）
- book スキーマ migration 一式を autumn-shared へ（#28 マージ・PROD適用確認）。Advisor ERROR 3件解消
- `book` を Data API 公開・Supabase接続層（supabase-data.ts / DATA_SOURCE切替）・adapter-cloudflare
- Cloudflare Pages デプロイ（https://autumn-book.pages.dev）+ GitHub Actions 自動デプロイ（build→deploy→ヘルスチェック）
- 施設サイトを現行デザイン踏襲に再構築：施設別シェル（固有ヘッダー/フッター/実測タイポグラフィ）・共通レイアウト分離・下層14ページ（実コンテンツ移植）・アニメーション・文字サイズ17px
- hp-yamado / hp-oga の実コード参照でトップページを実マークアップ準拠に再現。画像70点をローカル化（ホットリンク解消）
- PayPay 対応＋事前決済（即時決済）割引ロジック（プラン単位設定・上限20%・管理画面エディタ）
- i18n（ja/en/zh-TW・Paraglide）は並行セッションで実装済み
- プロジェクトルール確定（CLAUDE.md）：Supabase Branching 不使用・autumn-shared main 直 push

**バージョン:** `v0.8.0`

**主要コミット:**
- `c50aaee` 全25画面実装 (v0.3.0) / `5b38570` Supabase接続層 (v0.4.0)
- `2a2e5b7` Pages デプロイ (v0.4.3) / `489d7ca` CI/CD (v0.6.1)
- `44b1ce6` 施設サイト忠実再現 (v0.5.1) / `9b9fdcc` 下層マルチページ (v0.6.0)
- `e8d15cc` PayPay+事前決済割引 (v0.7.0) / `ab9b9d3` 実コード参照で再現度向上 (v0.8.0)

**残作業（次セッション候補）:**
- rms 側のデータ投入（rate_plans / daily_rates / availability が0件）→ `DATA_SOURCE=supabase` 切替
- book 公開コンテンツの PROD 投入（facility_contents / plan_contents / site_pages / news_posts。写真は Supabase Storage へ）
- Supabase Auth 本接続（P5・@supabase/ssr）— デモ session 置換。Leaked Password Protection 有効化
- Stripe / PayPay / Resend 本接続（P3-P4・APIキー要。決済設定は rate_plans.metadata.prepay へ移す）
- 下層ページ（site_pages）の管理画面エディタ
- 原サイトJS演出の細部（Swiperイージング・blur-in・Lenis・男鹿ローディング画面）
- カスタムドメイン割当（DNS移管後。oga の明示MX追加が先決）
