# autumn-book HANDOFF

> **最終更新**: 2026-07-10（客室電子インフォメーション P8a 実装 v0.15.0 ＋ deep-link契約v1・/[brand]301・GA4受け皿 v0.16.0）

## 現在の状態

> ## ⛔ メンテナンスモードを解除してはいけない（2026-07-10 PROD 実査で確認）
>
> 本番 `wrangler.jsonc` は `DATA_SOURCE=supabase` だが、**Supabase 実データ経路に載っているルートは news / community / inroom の 11 ファイルだけ**で、**残り 53 ルート（検索・施設・プラン・客室・予約フロー・会員・ポイント・お気に入り）は本番でも `store.ts` のインメモリ・デモデータを配信している**。
> したがって今メンテを解除すると:
> 1. **デモの料金・客室・在庫が公開される**（`booking.rate_plans` / `daily_rates` / `availability` は PROD で **0 件**）
> 2. **ゲストが「予約完了」まで進めてしまい、その予約は Cloudflare Workers の isolate メモリに書かれて消える**（`booking.bookings` は 0 件のまま・予約番号も引けない・確定メールもない）
>
> **解除の前提** = ①rms に rate_plans / daily_rates / availability を投入 → ②検索・予約ルートを supabase-data.ts へ接続（アダプタは実装済み）→ ③実データで通し確認。

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

## 管理者認証 Phase 1（2026-06-13・v0.12.0・Supabase Auth 土台）

- **目的**：管理画面がデモ（ワンクリック・**素JSON cookie で誰でも admin になれる**）だった穴を塞ぐ。決定＝**Supabase Auth を使い、会員も含めP5本接続**だが、パスキーはドメイン依存のため段階化（下記）
- **方式は `AUTH_MODE=demo|supabase` フラグ**（既定 demo・`DATA_SOURCE` と同流儀）。**既定 demo なので現行の本番（demo）は無変更**で、Supabase設定後に本番で `supabase` へ切替
  - `demo`：従来のワンクリック（dev・移行前）
  - `supabase`：`@supabase/ssr` で管理ログインを **email+パスワード**化。`hooks.server.ts` は **admin/staff を Supabase の検証済みセッション（`auth.getUser()`）からのみ解決**し、demo cookie の admin/staff は無視（=偽造 cookie で admin になれない）。会員は Phase 1 ではデモ cookie のまま
  - ロール判定＝ユーザーの `app_metadata.role`（`admin`/`staff`）。`/admin/login` の email ログインは権限なしアカウントを 403 で拒否＋signOut。ログアウトは Supabase もsignOut
- **バグ修正**：`PUBLIC_*` は `$env/dynamic/private` に含まれない（SvelteKit が公開プレフィックスを分離）。`auth.ts` と既存 `supabase.ts`（P5データ経路の潜在バグ）を `$env/dynamic/public` 参照に修正
- **検証（`wrangler`不要・dev）**：demoモード=従来どおりログイン可。supabaseモード=メールフォーム表示・デモワンクリック無効・**偽造 admin cookie で /admin が 303 拒否**・未ログイン /admin は 303・公開サイト200・Supabase到達（誤認証は拒否）。build 成功
- **本番で有効化するための残作業（要ユーザー/Supabase設定）**：
  1. Supabase ダッシュボード Authentication：Email プロバイダ有効・**Redirect/Site URL** に `https://autumn-book.pages.dev`（と dev）を登録
  2. **管理者ユーザーを1名作成**（Authentication→Users→Add user・Auto Confirm）し、**`app_metadata` に `{"role":"admin"}`** を設定（SQL: `update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role','admin') where email=...` ＝DML で migration ルール非抵触）
  3. **本番 env（AUTH_MODE / PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY）は `apps/web/wrangler.jsonc` の `vars` に集約**（v0.12.4・いずれも publishable=公開値）。`pages deploy`（CI）が適用するためダッシュボード手入力は不要。ローカル dev は `.env`（既定 demo）が優先
     - ⚠ **教訓1**：`wrangler pages deploy` は config の `vars` で**ダッシュボード env を「置換」**する（追記でない）。ダッシュボードと config に同名があると `"Binding name already in use"` で失敗、config に一部だけ書くとダッシュボード側が消える → **本番 env は全部 wrangler.jsonc に集約**するのが正
     - ⚠ **教訓2**：PUBLIC_* を未設定のまま `AUTH_MODE=supabase` にすると全ページ500（demo 時は PUBLIC_* 未登録だった）。v0.12.1 で公開サイトは生存するよう堅牢化済み
  4. **本番で動作確認済み（v0.12.4）**：/admin/login がメールフォーム・誤認証で401（Supabase到達）・未ログイン/admin 303・偽造cookie 303拒否・公開ページ200
- **v0.12.1 ホットフィックス**：`AUTH_MODE=supabase` だが本番に PUBLIC_SUPABASE_* 未設定で全ページ500になった事故への対処。`getSupabaseAdminUser` を try/catch（未ログイン扱い）、login action も未設定時503メッセージ。**Supabase 未設定/到達不可でも公開サイトは常に生存**する安全側設計に
- **Phase 2（後続・大）**：会員も Supabase Auth へ（`book.members ⇔ auth.users` 名寄せ・マイページ/予約/ポイント/お気に入り/掲示板の実ユーザー化・`.yamado.co.jp` 親ドメイン cookie）
- **Phase 3（ドメイン移行後）**：パスキー本登録。⚠ **RP ID は共有 Supabase 全体で1つ・後変更で既存パスキー全無効**のため、`yamado.co.jp` 本番稼働後に RP 設定（社内 `.yamado.app` 側と要調整）。`auth.experimental.passkey` + `registerPasskey`/`signInWithPasskey`

## 施設サイト UI 改善（2026-06-13・v0.12.0）

- **施設間移動・ブランドポータルの導線追加**：各施設シェル（Yamado/Oga/Standard）のヘッダー・フッター・モバイルメニュー/ドロワーに「山人ポータル(`/`)」と兄弟施設リンク（西和賀↔男鹿）を追加。データは `[brand]/[facility]/+layout.server.ts` が同ブランドの公開施設から算出（`ShellFacility.siblings`/`brandName`）
- **Yamado ヘッダーの本文かぶり修正**：ロゴ520×384pxを幅130px指定＝表示高96px→ヘッダー実高約124pxなのに `main` が `pt-[68px]` しかなく**約56px隠れていた**。ロゴを高さ基準（56px）に変更しヘッダー約88pxへ、施設トップは全画面ヒーロー＋透過ヘッダー（男鹿と同方式）、下層は `pt-[88px]`。実DOM計測で overlap 解消（content top 88px / header 82px）を確認

## 客室電子インフォメーション（モバイル）＋内線電話（2026-06-15 設計確定 → **P8a 実装済み 2026-07-10・v0.15.0**）

- **P8a（館内案内＋滞在トークン＋印刷スリップ）を実装・PROD migration 適用済み**。内線（P8c・Twilio）と PMS 連携（P8b）は未着手（下記の未決・依存のため）。
- **DB**: migration `20260710103006_book_inroom_phase1`（autumn-shared main 直 push → PROD 自動適用確認済み）。`book.house_guides` + `book.stay_access_tokens` + RPC 8本（ゲスト面 anon: stay_info / claim_stay_by_code / list_house_guides、管理面 authenticated+has_facility_access: issue/revoke/list_stay_tokens・house_guide_upsert/delete）。forum/otayori と同じ RPC-first・deny-all。発行/失効は admin_audit_logs 記帳。Advisor 新規指摘は既存パターンと同じ INFO/WARN のみ（意図的設計・修正不要）
- **ゲスト面 `/r`**（route group 外＝共通ヘッダーなしの専用シェル・noindex・ja/en/zh-TW）: `/r/c/<token>`（印刷スリップの QR）→ 検証 → **httpOnly Cookie `ab_stay`（3日）へ交換** → `/r` 302（以降 URL にトークン非表示）。`/r` = 滞在カード（部屋名・ゲスト名・チェックアウト・施設電話 tel:）＋館内案内（`<details>` アコーディオン・MarkdownView）。未 claim 時は 8桁コード入力（**IP 単位レート制限: 5回失敗で10分ロック**）。失効・期限切れは「ご滞在は終了しました」
- **管理面 `/admin/inroom`**（左ナビ「📱 客室案内」）: 2タブ。①館内案内 CRUD（admin のみ・MarkdownEditor・lang/並び順/公開）②客室スリップ（admin/staff 可）＝発行（部屋名・ゲスト名任意・チェックアウト日→当日11:00 JST失効）・一覧（有効/全件）・失効・**印刷ページ `/admin/inroom/slip/[id]`**（A6カード・QR=qrcode-generator の SVG・8桁コード・3言語案内・print CSS）
- **データ層**: store.ts（デモシード: 西和賀ガイド ja5+en2 / 男鹿 ja4、デモトークン `demo-stay-nishiwaga`=コード11112222・oga=33334444）と supabase-data.ts（sb* アダプタ）を対称実装
- **言語フォールバックは「言語単位」**: 指定言語のガイドが 0 件のときだけ ja 全件（RPC仕様）。en を部分的にしか作らないと en ゲストにはそれだけ表示される点に注意（セクション単位マージが必要なら RPC 改修＝新 migration）
- **データソースの組み合わせ**（重要）: ゲスト面は `DATA_SOURCE`、管理面は `DATA_SOURCE=supabase && AUTH_MODE=supabase` で切替。**現 .env（supabase+demo）では管理面=デモ store・ゲスト面=PROD（トークン0件）となり繋がらない** → /r のフルデモは `DATA_SOURCE=demo` で行う。本番（supabase+supabase）は全経路 PROD で一貫
- **本番利用の前提**: ✅ 本番 admin（Supabase Auth・`app_metadata.role=admin`）は **`core.memberships` に `tenant_admin`（tenant全体スコープ）を保有済み**を PROD で確認（2026-07-10）。発行/失効・ガイド CRUD の `has_facility_access` / `is_tenant_admin` は通るため**本番でそのまま動作する**。万一 membership を失った場合も管理面は黄バナー表示で 500 にはならない（v0.12.1 と同じ安全側）。残るは house_guides の実コンテンツ投入（`book.house_guides` は現在 0 件・`/admin/inroom` から入力可）
- 検証: dev（demo）で QR claim→滞在カード→ガイド／手入力コード／レート制限ロック／en フォールバック／admin CRUD／発行→claim→失効→終了表示／slip QR svg／build 成功

### 旧記録（2026-06-15 設計確定時点）

- **設計書：`autumn_book_inroom_design.md`**（§15.3 を実装方式まで具体化＋新要件「客室内線電話」「TV配信」を追加）。**26エージェントの敵対的レビュー（Web裏取り）を反映**。
- **実装は P3予約/P4決済の後**（収益コア優先）。設計のみ先行確定。migration は**下書き＝未適用**：`autumn-shared/supabase/migrations/20260615120000_book_inroom.sql`（house_guides / stay_access_tokens / facility_intercom / intercom_calls ＋ RPC・forum と同じ deny-all+RPC-first）。
- **主要決定**：
  - 提供形態＝ゲスト自身のスマホ。トークン配布＝**チェックイン時の印刷QRスリップ** → `/r/c/<token>` で**httpOnly セッションCookieへ交換**（claim後はURLにトークン非表示）・滞在中再claim可・**チェックアウト即時失効**（`revoke_stay_token`）。
  - **内線**：物理電話なし＝置換として正当。西和賀/男鹿は**弱電波で `tel:` 不発**のため、ゲスト発信は**Wi-Fiデータ通話（WebRTC）**を主とし、**Twilio で受電をPSTNブリッジ**。受電は**固定電話（ビジネスフォン）既定**（コスト約半減・有線堅牢）＋任意で iPhone simring。iOS脆弱性は **Screen Wake Lock＋「画面表示のまま」UX＋再接続**で手当。**ネイティブiOSアプリ不要**。
  - **TV（Bravia）配信は保留**：コンシューマBravia+キオスクAPKは焼き付き（Sony OLED保証対象外）・商用保証無効・MDM不在・番組占有で本番第一候補に不適。やるなら業務用Pro BRAVIA or 外付けプレーヤー+CMS。当面は印刷スリップで代替。
  - 録音は既定OFF。Twilio月額 ≈ ¥8,500（固定電話受電）。**JP番号は Regulatory Bundle（株式会社山人の登記書類）申請が関門**。
- **安全要件（Web外）**：050/WebRTCは110/119不可 → 客室に「非常時は非常ベル/スタッフへ」掲示、受付時間外導線、受電SLA定義を実装前に用意。
- **未決**：受電に simring iPhone を併用するか／Twilio採用の最終可否（Regulatory Bundle 申請）／印刷スリップ様式／house_guides 初期コンテンツ。詳細は設計書 §12。

## おたよりポイント Phase 1（2026-06-21 追加・v0.13.0）

- **通常の会員ポイント（1pt=1円）とは別建ての「おたよりポイント」（1pt=1,000円相当）** を管理。YouTube おたより投稿への進呈・既存保持者への手動付与に対応。設計書: `autumn_book_otayori_design.md`
- **アーキテクチャ＝専用テーブルで別建て**（既存 point_ledger に相乗りしない）。理由: 単位が1000倍違い、残高=SUM(delta) を共有すると取り違え事故が起きるため。既存の point_balance / 予約RPC / 会員UI は無改修。
- **付与は承認制**: `/otayori` フォーム投稿は `pending` → 運営が `/admin/otayori` で承認した投稿だけ +1pt（**承認＝admin限定**）。1投稿1回（otayori_ledger(source_post_id) 部分UNIQUE + on conflict で二重付与防止）。却下・一覧閲覧は staff 可。
- **フォーム**: `/otayori`（YouTube概要欄用の専用URL）。**会員のみ投稿可**（未ログインは登録CTA・staff/adminは投稿不可案内）。本文1〜2000字＋ラジオネーム任意。XSS安全（forum-format流用）。未審査(pending)5件まで。
- **既存保持者への会員別手動付与**: `/admin/members/[id]` の「📨 おたよりポイント手動付与」パネル（admin・正負可・理由必須・監査ログ）＝設計§9主導線。`/admin/otayori` 上部の会員検索付与も同等。
- **マイページ**: `/account/otayori`（残高・「1pt=1,000円分」・台帳・投稿status＝確認中/進呈済み/見送り）。会員メニュー・admin左ナビに導線追加。**有効期限なし（無期限）**。
- DB: `book.otayori_posts` + `book.otayori_ledger` + RPC8本（migration `autumn-shared/supabase/migrations/20260621120000_book_otayori.sql`）。**RPCファースト**＝2テーブル deny-all RLS・anon/authenticated GRANTなし・全 SECURITY DEFINER。承認/手動付与=admin、却下/一覧=staff、投稿/残高/自分サマリ=本人(auth.uid())。**PRODシードなし**。supabase-data.ts にアダプタ追記済み（authenticated限定＝P5 Auth後に有効、demoはstore.ts）。
- demo: store.ts に実装＋シード（m-demo=たろう: 投稿3件 approved/pending/rejected + 台帳で残高3pt）。**dev で全フロー実証済み**（未ログインCTA→会員投稿→pending生成→admin承認+1pt→会員別手動付与。通常ptと混ざらないことを会員詳細で確認）。build成功。
- **Phase 2（後続・P4 予約/決済 Supabase 本接続と同時）**: おたよりポイントの予約決済充当（1pt=1,000円・通常pt併用可）。設計§8 に確定済み。`confirm_booking`/`cancel_booking` は引数追加=drop+recreate のため P4 でまとめる。
- ✅ **PROD 適用済み（2026-06-21）**: autumn-shared main へ push → GitHub Integration が自動適用。`schema_migrations` に `20260621120000` 確認・`book.otayori_posts` / `book.otayori_ledger` 作成確認（RLS有効・0行・シードなし）。autumn-book も main push 済み（CI→Cloudflare Pages デプロイ）。

## ポータル整備: deep-link 契約 v1・/[brand] 301・GA4 受け皿（2026-07-10・v0.16.0）

- **deep-link URL 契約 v1 を確定**（ADR-0001 決めごと1・sitemap §7 の宿題）: **`autumn_book_deeplink_contract.md`** 新規作成。施設HP（hp-yamado/hp-oga 刷新版）の「ご予約」が叩く安定エントリ＝`/yamado/{nishiwaga|oga}?checkin=YYYY-MM-DD&nights=1..5&adults=1..4`（全部省略可・不正値は黙って既定へ丸め）。プラン/客室 ID 直行は P3 本接続まで保証外と明記。ヘッダー/施設シェル検索バーへのプリフィルとプラン詳細の見積り反映は既存実装で充足済みを確認し、**施設予約トップの料金カレンダー初期月を checkin に連動**する実装のみ追加（`[facility]/+page.server.ts`）
- **`/[brand]` → `/` 301 リダイレクト**（sitemap §6-1 決定の実装）: 実在ブランドのみ 301（ロケール保持・`localizeHref`）、不明 slug は 404。ブランドトップの `+page.svelte` は削除
- **GA4 受け皿 + Consent Mode v2**（設計書 §9・2026-06-10 決定分）: `PUBLIC_GA4_MEASUREMENT_ID` **未設定なら計測・バナーとも完全無効**（現状の本番は未設定＝無効のまま）。設定すると: gtag.js ロード（Consent Mode v2 default=denied・広告系は常時 denied）＋同意バナー（ja/en/zh-TW 自己完結文言・localStorage `ab_consent`）＋ SPA page_view（afterNavigate 手動送信）＋予約ファネル4イベント＝`search`（/search 条件変更ごと）/`view_item`（プラン詳細）/`begin_checkout`（hold）/`purchase`（完了・`transaction_id`=予約番号・`value`=支払額・sessionStorage でリロード再送抑止）。**/admin と /r は計測・バナーとも除外**（社内画面とトークン URL の漏洩防止）。実装: `lib/analytics.ts` + `lib/components/AnalyticsConsent.svelte`（root layout にマウント）
- **GA4 本番有効化の手順（ユーザー作業）**: GA4 プロパティ作成 → 測定 ID を `apps/web/wrangler.jsonc` の `vars` に `PUBLIC_GA4_MEASUREMENT_ID` として追記（⚠ vars はダッシュボード env を置換する教訓1に従い **wrangler.jsonc に集約**）→ main push。クロスドメイン計測（HP↔ポータル）は GA4 管理画面のドメイン設定で
- Sentry（§9 のもう一方）は **保留**: DSN 未取得＋Cloudflare Pages での SDK 検証コストのため。導入時は `@sentry/sveltekit`＋`@sentry/cloudflare` 構成
- 検証: /yamado→301 /（/en/yamado→/en/）・不明ブランド404・checkin付き施設URLでカレンダー該当月表示・GA未設定でバナー/gtagなし・G-TEST123設定でバナー表示→同意→gtagロード＋localStorage保存→リロードで再表示なし・build 成功

## rms 料金・在庫の接続（2026-07-10・設計書 `autumn_book_rms_pricing_design.md`）

- **PROD 実査で判明した最重要事実**: `booking.rate_plans / daily_rates / availability` は「空の器」で、**rms は一切書かない**（TL-リンカーンへ SOAP 直送しており booking.* を経由しない）。`rms_daily_rates` も 0 件（理論価格の実体化フローは PROD 未実行）。
- **価格の正 = TL 実売価格**（`rms_tl_lincoln_rate_cache.rows[].priceRanges[].pricePerPerson`）。単位が「N名利用時の1名単価・税込」で `booking.daily_rates.price_adult_N` と**定義が完全一致**するため変換不要。入湯税150円/人は含まれない（現地徴収）。
  - ⚠ **rms の理論式は使わない**：`prices_by_guest_count`（税込）を税抜として扱い ×1.1 するため**室料の消費税を二重計上**する。実測：メゾネット2名 rank E → 理論 79,200 / TL 実売 75,900（差 3,300 = 33,000×0.1）。
- **直販プラン判定** = `rms_plan_templates.is_active` かつ `sales_channels.channels.autumnBooking <> ''`（PROD: yamado 29 / oga 13 コード）
- **突合**：TL プラングループ名 `"a000桂■基本■2食■スタンダード(+17050円)"`(yamado) / `"e300■綿津見和洋室■県民■2食■県民限定(-10%)"`(oga) から、先頭4字=コード・部屋トークン・プランキーを抽出。部屋は `room_types.metadata.siteControllerName`（`│`除去）または `rms_base_room_rates.short_name` の `<` 前で解決（**1トークン→1部屋タイプを実査確認**）
- **migration `20260710150415_book_rms_rate_sync`（PROD 適用済み）**: `book.sync_rms_rates(days)`（service_role 限定）＋ pg_cron 2本
  - `book_sync_rms_rates` = 60日窓・3時間ごと（UTC `15 */3 * * *`）／ `book_sync_rms_rates_full` = 365日・日次（UTC `15 16`＝JST 01:15）
  - 生成量の実測見込み: 365日で **約74万行**（yamado 約131行/日・oga 約72行/日）
- **在庫は「差分適用」**：`available_rooms += (今回TL残室 − metadata.tl_remaining)` をクランプ。単純上書きすると `create_hold` / `confirm_booking` の減算が毎回消えるため。
- **プランは下書きで作られる**：`book.plan_contents` は `is_published=false` で自動生成。**管理画面で公開するまで顧客側に1件も出ない**（県民限定・日帰り・セール等が混在するため人が選ぶ）
- ⚠ **公開前に必須**：①直販予約の TL 書き戻しが無い＝**オーバーブッキングの窓**（暫定は `buffer_rooms>=1`）②キャンセル料が空配列＝無料 ③子供料金・事前決済は未モデル化

### 付随して PROD に入れた migration（2026-07-10・すべて適用済み）

| version | 内容 |
|---|---|
| `20260710150415_book_rms_rate_sync` | 同期関数 `book.sync_rms_rates(days)` + pg_cron 2本 |
| `20260710152005_book_update_my_profile` | 会員の `my_profile()` / `update_my_profile()`（`core.guests` は会員に権限が無いため必要） |
| `20260710152624_book_rms_sync_room_contents` | 同期が `book.room_type_contents` も自動生成（**is_published=true**）。無いと「泊まれる部屋が0」になる |
| `20260710153135_book_plan_offers` | `book.plan_offers(facility, checkin, nights, adults, plan?)` — プラン×客室の販売可否と料金を単一クエリで |
| `20260710153430_book_seed_facility_contents` | 施設プロフィールの実値 seed（lat/lng・住所）＋**西和賀の slug を `yamado`→`nishiwaga`** に是正 |

- ⚠ **施設 slug の出所は `book.facility_contents.slug`**（`core.facilities.slug` ではない）。PROD は西和賀が `yamado` で URL が `/yamado/yamado` になっていたため、未公開のうちに `nishiwaga` へ変更した（deep-link 契約 v1 と一致）。
- `book.plan_offers` は**デモの `plan.roomTypeIds` に相当する関係が実データに無い**ために新設。可否は `booking.daily_rates` に `(plan, room, date)` 行があり価格が入っているかで決まる。

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

## 会員 Supabase Auth Phase 2 実装済み（2026-07-10・v0.17.0）

- **`MEMBER_SUPABASE = (DATA_SOURCE==='supabase' && AUTH_MODE==='supabase')` のときだけ**会員系を実データ化。demo 系（現本番 `AUTH_MODE=demo`）は挙動不変（回帰確認済み）
- **方式 = 6桁メール OTP**（yamado-one と同一）: `/auth/login`・`/auth/register` が「email 入力 → 6桁コード」の2段。`signInWithOtp({shouldCreateUser:true})` → `verifyOtp({type:'email'})`。60秒再送クールダウン。パスワード/マジックリンクは不使用
- **hooks.server.ts**: supabase モードでは admin/staff/member をすべて Supabase 検証済みセッション（`auth.getUser()`）のみで解決。**demo cookie は一切信用しない**（偽造 `ab_session` で会員になれない）。OTP 済み・未登録は `locals.pendingAuthUser` に載せ `/auth/register` のプロフィール入力へ
- **会員行の作成は必ず `register_member` RPC 経由**（member_code 採番・email 名寄せ・入会500pt を一元化）。verify 後に `my_profile()` が通れば会員、通らなければ登録へ。登録成功で `updateUser({name, member:true})` を同期（yamado-one 経由の会員も救済）。「member フラグはあるが book.members 行が無い」異常系はフラグ解除で無限ループ防止（`account/+layout.server.ts`）
- **実データアダプタ**（`supabase-data.ts`・authenticated client 受け取り）: `sbMyProfile` / `sbUpdateMyProfile` / `sbRegisterMember` / `sbPointBalance` / `sbPointLedger` / `sbMyReservations` / `sbCancelBookingAsMember` / `sbListFavorites` / `sbAddFavorite` / `sbRemoveFavorite`。掲示板書き込み4関数＋`submitOtayori`＋`getOtayoriMySummary` も client 引数化し、supabase 本接続で**書き込みゲートを解除**（`forum-write-enabled.ts`）
- 会員判定 = `user_metadata.member===true`。`book.members` の RLS/GRANT は不変（rank_code 自己昇格・IDOR を防ぐ列レベル GRANT を維持）
- ⚠ **本番で会員ログインを有効化するには `AUTH_MODE=demo → supabase` への切替が必要**。ただしその瞬間に予約もデモから実データに変わるため、rms 同期でデータが入り予約導線の接続（下記残タスク）が済むまで切り替えないこと
- 検証: build 成功・demo 回帰なし（デモログイン→マイページ→おたより投稿）・supabase モードで偽造cookie拒否/未ログイン303/公開200/OTP が Supabase 到達

## Supabase ダッシュボード設定（会員 Auth Phase 2 の前提・要ユーザー作業）

会員認証は **yamado-one（モバイル）と同じ「6桁メール OTP」方式**に揃える（パスワード・マジックリンクは使わない）。理由: ポータルのホスト名が未確定でリダイレクト URL に依存できず、共有プロジェクトのメールテンプレートを壊さないため。

- [ ] Authentication → Providers → **Email 有効**・サインアップ許可（`shouldCreateUser:true` を使うため）
- [ ] Email テンプレート（Magic Link）に **`{{ .Token }}`（6桁コード）** が含まれること ※モバイルが既に依存
- [ ] Leaked Password Protection を有効化（Advisor の WARN）
- 管理者は従来どおり email+パスワード（`app_metadata.role=admin`）。会員とは別フロー

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
- [x] 電子インフォメーションの提供形態 → **決定（2026-06-15）：ゲスト自身のスマホ（チェックイン時の印刷QRスリップ）。TV配信は保留。設計＝`autumn_book_inroom_design.md`**
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

### 管理者認証（Phase 1）
- [ ] AUTH_MODE=demo（既定）でワンクリックのデモ管理ログインが従来どおり動く
- [ ] AUTH_MODE=supabase で /admin/login が email+パスワードフォームになる
- [ ] AUTH_MODE=supabase でデモワンクリック・偽造 `{role:'admin'}` cookie では /admin に入れない（login へ 303）
- [ ] AUTH_MODE=supabase で正規の管理者（app_metadata.role=admin）がログインでき、権限なしアカウントは 403
- [ ] ログアウトで Supabase セッションも破棄される

### 施設間ナビ
- [ ] 各施設サイトのヘッダー/フッター/メニューに「山人ポータル」と他施設へのリンクが出る
- [ ] Yamado（西和賀）下層ページでヘッダーが本文に被らない／トップはヒーロー全画面に透過ヘッダー

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


### おたよりポイント
- [ ] /otayori に未ログインで入ると会員登録CTAが出る（投稿フォームは出ない）
- [ ] 会員ログイン中は本文＋ラジオネームを入力して投稿でき、サンクス文が出る
- [ ] 投稿直後はポイントが増えない（pending・/account/otayori で「確認中」表示）
- [ ] 本文空・2000字超・ラジオネーム40字超はエラーになる
- [ ] 未審査5件を超えると投稿が拒否される
- [ ] /admin/otayori 申請中タブに投稿が並び、会員番号・氏名・本文が見える
- [ ] admin が承認するとおたよりpt残高が+1され、台帳に「YouTubeおたより投稿」が載る
- [ ] 同じ投稿を再承認しても二重付与されない
- [ ] staff は却下はできるが承認（付与）ボタンが出ない／実行で権限エラー
- [ ] /admin/members/[id] のおたよりポイントパネルから手動付与でき、残高と監査ログに反映
- [ ] /account/otayori に残高・「1pt=1,000円分」・台帳・投稿状況が表示される
- [ ] 通常ポイント残高はおたよりポイントの増減に影響されない（単位が混ざらない）
- [ ] /en /zh-TW で UI 文言が翻訳される（本文・ラジオネームは原文のまま）
- [ ] スマホ幅で投稿フォーム・管理レビュー・マイページが崩れない
- [ ] （Phase 2・P4同時）予約でおたよりpt利用＝1ptにつき1,000円減額（通常pt併用可）／キャンセルで返還

### 客室電子インフォメーション（P8a）
※フルデモは `DATA_SOURCE=demo` で行う（supabase では /r が PROD トークンを参照するため）

- [ ] /r に未 claim で入ると8桁コード入力フォームが出る
- [ ] /r/c/demo-stay-nishiwaga で滞在カード（雪椿・山田 太郎・チェックアウト・施設電話）が出る
- [ ] 館内案内がアコーディオンで開閉でき、Markdown（表・リスト）が正しく表示される
- [ ] /en/r で UI が英語になり en ガイドが出る。/zh-TW/r は ja ガイドへフォールバック
- [ ] 手入力コード 11112222 で開ける。でたらめ8桁を6回入れると10分ロックされる
- [ ] /r/c/不正トークン →「QRコードが無効です」
- [ ] /admin/inroom 館内案内タブでガイドの追加・編集・公開切替・削除ができる（admin のみ）
- [ ] 客室スリップタブで発行（部屋名・チェックアウト日）→ 8桁コードが表示される（staff も可）
- [ ] スリップ印刷ページに QR と手入力コードが出て、印刷プレビューで A6 カードになる
- [ ] 発行トークンで /r が開ける → 失効 → 同トークンが「ご滞在は終了しました」になる
- [ ] 発行・失効が監査ログに載る
- [ ] スマホ幅で滞在カード・館内案内・スリップ印刷が崩れない

### deep-link / ブランドリダイレクト
- [ ] /yamado が / へ 301（/en/yamado は /en/ へ）。存在しないブランド slug は 404
- [ ] /yamado/nishiwaga?checkin=翌月日付&nights=2&adults=3 で施設シェル検索バーにプリフィルされ、料金カレンダーが該当月で開く
- [ ] 同クエリでプラン詳細に入ると日程・人数が見積りに反映される

### GA4・同意バナー（PUBLIC_GA4_MEASUREMENT_ID 設定時のみ）
- [ ] 未設定ではバナーも gtag も一切出ない
- [ ] 設定時: 初回訪問でバナーが出る。「同意する」→ 消えて以後再表示されない
- [ ] 「同意しない」でも gtag はロードされるが analytics_storage は denied のまま
- [ ] /admin と /r ではバナー・page_view とも出ない
- [ ] 予約完了で purchase（予約番号・支払額）が送られ、リロードで再送されない

## 作業ログ

---

### 2026-07-10（客室電子インフォ P8a + ポータル整備）

**実施内容:**
- 設計済み・未実装の棚卸し → 実装可能な4件を実装。**保留判断**: 内線 P8c（Twilio Regulatory Bundle 未決 §12）・オプション予約（PMS テーブル依存＋販売条件未決 §14-16）・おたより Phase 2（P4 と同時に確定済み）・メルマガ/ステップメール DB 化（配信基盤未決 §14-13）・site_pages 管理エディタ（ADR-0001 の施設HP外部化で価値低下）・Sentry（DSN 未取得・Pages 検証コスト）
- **inroom P8a**: migration `20260710103006_book_inroom_phase1` を autumn-shared main 直 push（PROD 適用・Advisor 新規指摘は意図的設計のみ）。/r ゲスト面（QR claim→httpOnly Cookie・滞在カード・館内案内・手入力コード+レート制限）＋ /admin/inroom（ガイドCRUD・スリップ発行/失効/印刷QR=qrcode-generator 追加）＋ store/supabase-data 対称実装＋ i18n 16キー（実装=Opus エージェント並行・レビュー/コミット=親）
- 本番安全化: /admin/inroom load を try/catch（admin の core.memberships 未登録でも 500 にせず黄バナー表示）
- **deep-link 契約 v1**（`autumn_book_deeplink_contract.md`）＋施設トップのカレンダー月連動、**/[brand]→/ 301**、**GA4 受け皿+Consent Mode v2**（未設定時完全無効・ファネル4イベント・/admin と /r 除外）
- 検証: dev（demo）で全フロー curl + preview ブラウザで UI/同意フロー実証。`pnpm build` 成功

**バージョン:** `v0.15.0`（inroom P8a）→ `v0.16.0`（ポータル整備）

**本番前の残作業**: 本番 admin（Supabase Auth）へ core.memberships 登録（発行 RPC の施設アクセス権）／house_guides 実コンテンツ投入（/admin/inroom から）／GA4 測定 ID 取得→wrangler.jsonc vars 設定

---

### 2026-06-13（管理者認証Phase1 + 施設UI）

**実施内容:**
- 施設サイトに施設間移動＋ブランドポータル導線を追加（全シェルのヘッダー/フッター/メニュー、`ShellFacility.siblings`/`brandName`）
- Yamado ヘッダーの本文かぶりを修正（ロゴ高さ基準化でヘッダー124→88px、トップ全画面ヒーロー＋下層pt-88。実DOMで overlap 解消を確認）
- 管理者認証 Phase 1：`AUTH_MODE` フラグ＋`@supabase/ssr`。supabaseモードで管理ログインを Supabase Auth(email+pass)化し、フックは admin/staff を検証済みセッションのみで解決（偽造cookie無効化）。デモは既定で温存
- `PUBLIC_*` を `$env/dynamic/public` から読む修正（auth.ts/supabase.ts の潜在バグ）
- 検証：demoモード無変更・supabaseモードで偽造admin cookieが /admin 拒否・公開サイト無影響。build成功

**バージョン:** `v0.12.0`

**本番有効化の残作業（Supabase設定）:** Email有効化＋Redirect URL登録／管理者1名作成(app_metadata.role=admin)／Pages env に AUTH_MODE=supabase

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
