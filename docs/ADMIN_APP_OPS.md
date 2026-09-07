# yamado-one 運用管理画面 設計書（ADMIN_APP_OPS）

- 対象: `apps/web/src/routes/admin/**`（増設）・`apps/web/src/lib/server/**`（アダプタ追加）・`autumn-shared/supabase/migrations/`（DB オブジェクト追加）
- 作成: 2026-09-07（設計担当）／実装は別エージェント
- 関連: `autumn_book_ui_design.md` §4（管理面の共通シェル）、`HANDOFF.md`（テストチェックリスト）、yamado-one `docs/DESIGN.md` §2（A1〜A5: device_tokens / notifications / cron / coupons / preferences）、yamado-one `src/lib/api/{notifications,preferences,booking}.ts`（アプリ側の読み方）
- Supabase: `opkocyapzmsjzhbwlguh`（book スキーマ。2026-09-07 の実測値を本書の根拠にしている）

---

## 0. 実装者が最初に読む要約

### 0.1 何を作るのか

YAMADO 公式アプリ（yamado-one）が表示・配信するものを運用するための **PC ブラウザ向け管理画面**を、既存 `autumn-book` の `/admin` に増設する。作るのは次の 3 種類。

| 種別 | 内容 | ルート |
|---|---|---|
| ① 管理画面が無い機能の新規実装 | クーポン（作成・配布・取消・状況）／アプリ通知（テスト送信・一斉配信・予約配信・履歴）／好み登録カタログ（項目編集） | `/admin/coupons`, `/admin/push`, `/admin/preferences` |
| ② アプリ運用ダッシュボード | 「公開プラン 2/42」「写真 0 枚」のような**気づけていない運用の穴**を 1 画面で見せる | `/admin/app` |
| ③ 管理メニューの再編 | 17 項目フラットのサイドバーを 4 グループに再編（新規 4 項目を足しても破綻しない構造） | `+layout.svelte` |

### 0.2 主要な設計判断（詳細は各章）

| # | 判断 | 章 |
|---|---|---|
| 1 | **autumn-book の `/admin` に同居**。別コンソールは作らない（同じ `book` スキーマを別 UI で触ると「どっちで直すのか」問題と認証・RLS・デプロイの二重化が起きる） | §1 |
| 2 | 既存画面と重複する画面は作らない。プラン公開は `/admin/plans`、お知らせは `/admin/news`。新規画面は**既存画面へ導線を張る**だけ | §1.3 |
| 3 | サイドバーは「**誰が・何をきっかけに操作するか**」でグループ化（宿泊・直販 ／ アプリ・会員 ／ サイト・コンテンツ ／ システム）。**1 項目は 1 箇所にしか置かない**。両属性の項目（お知らせ・会員・コミュニティ）は画面内の相互リンクで解決する | §2 |
| 4 | 新規画面は **実データ専用**（`store.ts` にデモ実装を作らない）。`DATA_SOURCE=demo` または `AUTH_MODE=demo` のときは画面全体を「この環境では利用できません」パネルにする（`/admin/community` のモデレーション無効化と同じ流儀） | §6 |
| 5 | 書き込みはすべて **`SECURITY DEFINER` RPC（`private.is_tenant_admin` ガード・監査ログ内蔵）**。**service_role キーを SvelteKit に持ち込まない**（現状 autumn-book に service_role は一切無く、Cloudflare Pages に秘密を増やさない） | §5 |
| 6 | 通知の一斉配信は「**テスト受信者へ送る → 宛先件数を確認 → 件数を入力して確定**」の三段。予約配信のみ取り消せる（即時配信は 2 分以内に drain されるため取り消し不可と明示） | §3.2 |
| 7 | 配信履歴のために `book.notification_campaigns` を新設し `notifications.campaign_id` で紐づける。cron の自動通知（reminder/thanks）は `campaign_id IS NULL` として別タブに出す | §3.2 / §5 |
| 8 | クーポンは配布済みになったら割引条件（種別・額・最低金額・施設・宿泊日）を変更不可。止めるときは「無効化」（`is_active=false`＝アプリ側 `isCouponUsableFor()` が即 false）、個別に剥がすときは「配布取消」（`status='revoked'`） | §3.1 |
| 9 | 好み登録カタログは **key 変更・削除を提供しない**（PK かつ `member_preferences.pref_key` の FK）。非表示（`is_active=false`）のみ。回答済みの `value_type` 変更・使用中の選択肢削除は RPC が拒否する | §3.3 |
| 10 | チャート類は**素の SVG**で描く。npm 依存は追加しない | §3.4 |

### 0.3 前提となる実測値（2026-09-07・設計の根拠）

| 項目 | yamado | oga | 備考 |
|---|---|---|---|
| `booking.rate_plans`（active・public_on_direct） | 29 | 13 | RMS 同期 |
| `book.plan_contents` | 29 | 13 | 全件 headline あり（RMS 同期が下書きで作る） |
| うち `is_published=true` | **1** | **1** | アプリ・直販に出るのはこの 2 件だけ |
| うち `photos` が 1 枚以上 | **0** | **0** | `book-photos` バケットも 0 オブジェクト |
| `book.room_type_contents`（公開／写真あり） | 7 / **0** | 8 / **0** | |
| `rate_plans.cancellation_policy` が `[]` | 29 / 29 | 13 / 13 | 全プラン個別規定なし。`book.rank_cancel_policies` は 4 ランクとも rules 投入済み（14日前10%…当日80%・無断100%）＝フォールバックは効いている |
| `book.option_items`（active） | 0 | 0 | seed 2 品が `is_active=false`・0 円 |
| `booking.daily_rates` / `availability` | 85,666 行 / 6,309 行 | | 料金・在庫は入っている |
| `book.members` | 1（withdrawn なし・guest_id あり） | | push_opt_in=true |
| `book.device_tokens` / `notifications` / `coupons` / `member_coupons` | **すべて 0** | | push 基盤は本稼働中だが未使用 |
| `book.preference_catalog` | 10 項目 seed 済 | | 回答 0 |
| `booking.bookings` | 0 | | |
| `/admin` にログインできるアカウント | `hikaru.s@yamado.co.jp` のみ（`app_metadata.role=admin` ＋ `core.memberships.role=tenant_admin`） | | 他の `shared_login` 会員は app_metadata.role が無く `/admin/login` で 403 |

### 0.4 既存の実装パターン（踏襲するもの）

- フォームは `method="POST" action="?/xxx"` ＋ `use:enhance`、サーバー側は `Actions` で `fail(4xx, { message })` ／ `{ saved: id }` を返す（`admin/options/+page.server.ts`）。
- 実データの管理操作は `createSupabaseServerClient(event)` で作った **cookie 束縛の authenticated クライアント**に `.schema('book')` を付けて呼ぶ（`admin/news/+page.server.ts`, `supabase-data.ts` の `listNewsAdmin`）。`supa()`（anon）は使わない。
- 本番系判定は `DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase'`（`admin/inroom/+page.server.ts` の `useSupabaseAdmin`）。本書ではこれを `auth.ts` に `ADMIN_SUPABASE` として昇格させる（§6）。
- RPC 例外は `e.message` に `forbidden` / `not_authenticated` / `invalid_params` 等が入るので `includes()` で日本語文言にマップする（`admin/community/+page.server.ts`）。
- 見た目: 地 `bg-stone-100`、サイドバー `bg-brand-900`、白カード `rounded-xl border border-stone-200 bg-white p-4`、主ボタン `bg-brand-800 text-white`、追加系 `bg-accent-600`、成功 `bg-emerald-50 text-emerald-800`、エラー `bg-red-50 text-red-700`、注意 `bg-amber-50 text-amber-800`。
- 二段確認の既存例: `admin/mail/new/+page.svelte`（`confirming` state で確認パネルを出す）。

---

## 1. 方針

### 1.1 なぜ autumn-book 内に置くのか

アプリが表示するもの（プラン・客室・お知らせ・クーポン・会員・掲示板・好み・通知）は**すべて同じ Supabase プロジェクトの `book` スキーマ**にあり、autumn-book の `/admin` が既にその大半（プラン・客室・お知らせ・会員・コミュニティ・おたより）を編集している。ここで別リポジトリの「アプリ管理コンソール」を立てると:

1. **「どっちで直すのか」が発生する** — お知らせを Web 用と App 用で別々に編集する運用は破綻する（実体は `book.news_posts` 1 テーブル）。
2. **認証・権限が二重化する** — `app_metadata.role` ＋ `core.memberships` ＋ RLS ＋ `private.is_tenant_admin` の組み合わせを 2 箇所で保守することになる。
3. **デプロイ・環境変数が二重化する** — Cloudflare Pages プロジェクト、`wrangler.jsonc` の vars、監査ログの出口が増える。

ユーザーの懸念「アプリ固有の運用をするのに autumn-book の管理画面は重いのではないか」は、**アーキテクチャではなくナビゲーションの問題**である。17 項目がフラットに並んでいるから重く見えるのであって、グループ化して「アプリ・会員」の塊を作れば、アプリ運用者はその塊だけを見ればよい（§2）。

### 1.2 責務境界（宿泊運用 vs アプリ運用）

| 責務 | 宿泊運用（既存） | アプリ運用（本書） |
|---|---|---|
| 何を売るか（プラン・料金・在庫・規定） | RMS ＋ `/admin/plans` `/admin/rooms` `/admin/cancel-policies` `/admin/options` | 触らない。**「公開されていない」ことに気づかせる**（`/admin/app`）だけ |
| 予約の処理 | `/admin/reservations` | 触らない。件数だけ見る |
| 会員に「届ける」（配信・特典） | メルマガ（`/admin/mail`）＝メール経路 | **アプリ通知（push）・クーポン**＝アプリ経路 |
| 会員そのもの | `/admin/members`（共通） | 同じ画面に「クーポン・通知・端末・好み」タブを足す |
| アプリ内の設問（好み登録） | — | `/admin/preferences` |
| コミュニティ | `/admin/community`（共通。モデレーションは Web でしかできない） | 同じ画面 |

原則: **データの SoT が 1 つなら画面も 1 つ**。アプリ用に既存画面の複製は作らず、(a) 既存画面へ導線を張る、(b) 既存画面に列やボタンを足す、のどちらかで解く。

### 1.3 既存画面との重複回避（やらないこと）

- アプリ用プラン編集画面は作らない → `/admin/app` の「公開プラン 2/42」カードから `/admin/plans` へ飛ばす。
- アプリ用お知らせ編集画面は作らない → `/admin/news` の各記事に「アプリに通知する →」ボタンを足し、`/admin/push/new?url=/news/<id>&title=...` にプリフィルして飛ばす。
- アプリ用会員一覧は作らない → `/admin/members` を実データ接続（§3.5）し、クーポン配布の「個別選択」もそこと同じ RPC を使う。
- 写真アップロード機能は本書の範囲外（`/admin/plans/[id]` の写真管理は別課題）。本書は「写真が 0 枚」を**可視化するまで**。

---

## 2. ナビゲーション再編

### 2.1 グルーピングの原則

1. **「誰が・何をきっかけに操作するか」で分ける**。「Web に出るか App に出るか」では分けない（同じテーブルを両方が読むため、その軸では必ず両属性になる）。
2. **1 項目は 1 箇所**。両属性の項目は、主たる操作者のグループに置き、もう一方からは画面内リンクで辿らせる。
3. **各グループの先頭はそのグループのダッシュボード**（宿泊 = `/admin`、アプリ = `/admin/app`）。
4. グループ見出しは折りたたまない（常時展開・21 項目 × 36px ≒ 760px で 1080px ビューポートに収まる）。項目が 30 を超えたら折りたたみを検討する。

### 2.2 新しいサイドバー構造

```
山人 管理
──────────────────────────
宿泊・直販
  📊 ダッシュボード          /admin
  📅 予約管理                /admin/reservations
  📝 プラン                  /admin/plans
  🛏 部屋編集                /admin/rooms
  🧺 オプション              /admin/options
  🚫 キャンセル規定          /admin/cancel-policies
  ♨️ 貸切風呂                /admin/bath
  📱 客室案内                /admin/inroom
──────────────────────────
アプリ・会員
  📲 アプリ運用              /admin/app          ← 新規
  🔔 アプリ通知              /admin/push         ← 新規
  🎫 クーポン                /admin/coupons      ← 新規
  🧩 好み登録項目            /admin/preferences  ← 新規
  👤 会員                    /admin/members
  💬 コミュニティ            /admin/community
  📨 おたより                /admin/otayori
──────────────────────────
サイト・コンテンツ
  🏠 施設ページ編集          /admin/facility
  📰 お知らせ                /admin/news
  ❓ FAQ                     /admin/faqs
  ✉ メルマガ                /admin/mail
  🔁 ステップメール          /admin/sequences
──────────────────────────
システム
  🛠 メンテナンス            /admin/maintenance
──────────────────────────
← 顧客サイトへ
```

### 2.3 両属性の項目の置き場所と根拠

| 項目 | 置き場所 | 根拠 | もう一方からの導線 |
|---|---|---|---|
| お知らせ | サイト・コンテンツ | 記事を「書く」行為はコンテンツ編集。アプリはそれを読むだけ（`book.news_posts` を `is_published` で取得）。アプリ固有なのは「push で知らせるか」であり、それは通知側の行為 | `/admin/news` の各記事に「アプリに通知する →」（`/admin/push/new` へプリフィル）。`/admin/app` の運用チェック表に「公開お知らせ n 件」 |
| 会員 | アプリ・会員 | 会員登録の主経路はアプリ（パスキー／Apple／Google／LINE）。Web 会員も同じ `book.members`。ポイント・ランク・クーポン・通知・端末・好みはすべて会員に紐づく＝会員は「アプリ・会員」の中心オブジェクト | `/admin/reservations/[code]` の予約者名から `/admin/members/[id]` へ（既存リンクがあればそのまま） |
| コミュニティ | アプリ・会員 | 投稿者は会員。モデレーション（pin/lock/ban）は会員管理の延長。Web でも読めるが「運用する人」は会員対応をする人 | `/admin/app` に未対応スレ数は出さない（P5 で admin RPC 未整備のため。整備後に追加） |
| おたより | アプリ・会員 | 会員からの投稿を承認してポイントを付与する＝会員対応 | — |
| キャンセル規定 | 宿泊・直販 | ランク別規定はテナント共通だが「売り方」の設定。アプリは `compute_cancel_fee` 経由で読むだけ | `/admin/app` の運用チェック表に「個別規定なし n/総数（グレード別規定を適用中）」 |

### 2.4 現状 17 項目からの差分表

| # | 現状（並び順） | 新構造 | 変更 |
|---|---|---|---|
| 1 | ダッシュボード | 宿泊・直販 1 | 位置のみ |
| 2 | 予約管理 | 宿泊・直販 2 | 位置のみ |
| 3 | 施設ページ編集 | サイト・コンテンツ 1 | 移動 |
| 4 | 部屋編集 | 宿泊・直販 4 | 位置のみ |
| 5 | プラン | 宿泊・直販 3 | 部屋編集より前へ（アプリ・直販で「売る単位」はプラン） |
| 6 | オプション | 宿泊・直販 5 | 位置のみ |
| 7 | キャンセル規定 | 宿泊・直販 6 | 位置のみ |
| 8 | お知らせ | サイト・コンテンツ 2 | 移動 |
| 9 | メルマガ | サイト・コンテンツ 4 | 移動 |
| 10 | ステップメール | サイト・コンテンツ 5 | 移動 |
| 11 | 会員 | アプリ・会員 5 | 移動 |
| 12 | FAQ | サイト・コンテンツ 3 | 移動 |
| 13 | コミュニティ | アプリ・会員 6 | 移動 |
| 14 | おたより | アプリ・会員 7 | 移動 |
| 15 | 客室案内 | 宿泊・直販 8 | 位置のみ |
| 16 | 貸切風呂 | 宿泊・直販 7 | 位置のみ |
| 17 | メンテナンス | システム 1 | 位置のみ |
| 新 | アプリ運用 | アプリ・会員 1 | **新規** `/admin/app` |
| 新 | アプリ通知 | アプリ・会員 2 | **新規** `/admin/push` |
| 新 | クーポン | アプリ・会員 3 | **新規** `/admin/coupons` |
| 新 | 好み登録項目 | アプリ・会員 4 | **新規** `/admin/preferences` |

合計 21 項目（17 ＋ 4）。URL は既存のものを一切変えない（ブックマーク・HANDOFF の記述を壊さない）。

### 2.5 `+layout.svelte` の書き換え方針

- `nav` 配列を `navGroups: { label: string; items: { href; label; icon; tenantWide?: boolean }[] }[]` に変える。`isActive()` はそのまま。
- サイドバー: グループごとに `<p class="mt-3 px-3 text-[10px] font-medium uppercase tracking-wider text-stone-500">{group.label}</p>` を出してから `{#each group.items}`。最初のグループは `mt-0`。
- モバイル用 `<select>` は `<optgroup label={group.label}>` で同じ構造にする。
- **施設切替の扱い**: `tenantWide: true` の項目（アプリ運用・アプリ通知・クーポン・好み登録項目・会員・コミュニティ・おたより・キャンセル規定・メンテナンス）がアクティブなときは、ヘッダーの施設セレクトを隠し、代わりに `<span class="text-sm text-stone-500">全施設共通</span>` を出す。判定は `$derived(navGroups.flatMap(g => g.items).find(i => isActive(i.href))?.tenantWide ?? false)`。
  - 理由: 通知・クーポン配布・好み項目は `facility_id` を持たない（クーポンは任意で持つ）。セレクトが見えていると「施設を切り替えたのに一覧が変わらない」混乱を生む。
  - `+layout.server.ts` は変更不要（`currentFacility` は引き続き全ページに渡す。クーポン新規作成フォームの施設初期値に使う）。
- `data.user.role` はそのまま表示。追加で、`/admin/app` 系のページで `forbidden` を受けたときの案内に使うため `+layout.server.ts` から `authMode: AUTH_MODE` と `dataSource: DATA_SOURCE` を返す（§6 の「利用できません」パネルが理由を表示するため）。

---

## 3. 画面ごとの詳細設計

共通事項:

- 幅: PC 1280px 想定。カードは `grid gap-4 lg:grid-cols-2` / `lg:grid-cols-4` で並べ、モバイルでは縦積み（既存 admin と同じ）。
- タイトル: `<svelte:head><title>○○ ｜ 山人管理</title></svelte:head>`、見出し `<h1 class="mb-1 text-lg font-bold text-stone-800">`、説明 `<p class="mb-4 text-xs text-stone-400">`。
- 権限: `admin` は全操作、`staff` は閲覧のみ（§7）。staff にはボタンを描画せず、サーバー action でも `fail(403)`。
- 環境ガード: `ADMIN_SUPABASE === false` のとき load は `{ unavailable: true, reason }` を返し、ページは §6.3 のパネルだけを描画する。action は `fail(400, { message: 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）' })`。
- DB 側権限エラーの文言（`mapRpcError(e)` ヘルパー・`admin-app-data.ts` に置く）:

| RPC 例外文字列 | 表示文言 |
|---|---|
| `not_authenticated` | `セッションが切れています。ログインし直してください。` |
| `forbidden` | `この操作には管理者権限（core.memberships の tenant_admin）が必要です。` |
| `invalid_params` | `入力内容に誤りがあります。` |
| `coupon_invalid` | `このクーポンは無効か期限切れのため配布できません。` |
| `coupon_issued` | `配布済みのクーポンは割引条件を変更できません。無効化して新しいクーポンを作成してください。` |
| `already_sent` | `この配信は既に送信処理に入っているため取り消せません。` |
| `type_in_use` | `回答が存在する項目の入力形式は変更できません。` |
| `option_in_use:<v>` | `選択肢「<v>」は回答で使われているため削除できません。` |
| `key_taken` | `その key は既に使われています。` |
| その他 | `処理に失敗しました: <message>` |

### 3.1 クーポン（`/admin/coupons`, `/admin/coupons/new`, `/admin/coupons/[id]`）

#### 目的・運用者の判断

- 「どんな割引を、誰に、いつまで使えるように配るか」を決め、配ったあと「どれだけ使われたか」「止めるべきか」を判断する。
- 判断材料: 有効／期限、配布数、使用数、使用率、直近の使用日時、未使用のまま期限切れになりそうな数。

#### ワイヤーフレーム — 一覧 `/admin/coupons`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ クーポン                                                 [＋ 新しいクーポン]  │
│ アプリの予約確認画面で会員が選べる割引券です。配布はクーポン詳細から行います。   │
├──────────────────────────────────────────────────────────────────────────────┤
│ [有効のみ ▾] [施設: すべて ▾]                                                 │
├────────────┬────────────┬──────────┬────────────┬──────┬──────┬──────┬────────┤
│ 名前        │ 割引        │ 施設      │ 利用期間    │ 配布 │ 使用 │ 使用率│ 状態   │
├────────────┼────────────┼──────────┼────────────┼──────┼──────┼──────┼────────┤
│ 秋の感謝券  │ 2,000円引き │ 全施設    │ 9/10〜11/30 │  120 │   18 │  15% │ ●有効  │
│ oga 開業1周年│ 10%引き    │ 山人-oga- │ 9/1〜9/30   │   40 │   40 │ 100% │ ●有効  │
│ 春キャンペーン│ 3,000円引き│ 全施設    │ 3/1〜5/31   │  200 │   61 │  31% │ ○無効  │
├────────────┴────────────┴──────────┴────────────┴──────┴──────┴──────┴────────┤
│ （0 件のとき）まだクーポンがありません。「＋ 新しいクーポン」から作成します。      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 行クリックで `/admin/coupons/[id]`。
- 「使用率」= used ÷ (issued + used)（revoked・expired は分母から除外）。
- 期限まで 7 日以内かつ未使用（issued）が 1 以上ある行は「利用期間」セルを `text-amber-700` にし `⚠ あと n 日` を添える。

#### ワイヤーフレーム — 新規 `/admin/coupons/new`（編集 `/admin/coupons/[id]` の上部も同じフォーム）

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 新しいクーポン                                                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ 名前 *        [秋の感謝券                                    ]（アプリに表示）  │
│ 説明          [会員の皆さまへ。秋の宿泊にご利用ください。      ]（任意・1行）   │
│                                                                              │
│ 割引 *   (●) 金額  [ 2000 ] 円    ( ) 割合 [   ] %      最低予約金額 [ 20000 ] 円 │
│ 対象施設      [全施設共通 ▾]  （山人-yamado- / 山人-oga-）                     │
│                                                                              │
│ 利用できる期間 *  [2026-09-10] 〜 [2026-11-30]   ← 会員が予約確定操作をできる日 │
│ 対象の宿泊日      [2026-10-01] 〜 [2026-12-20]   ← 空欄なら宿泊日の制限なし     │
│   ⓘ 「利用できる期間」は予約する日、「対象の宿泊日」は泊まる日です。別の軸です。 │
│                                                                              │
│ [✓] 有効（会員がすぐ使える状態にする）                                          │
│                                                                              │
│                                                  [キャンセル] [作成する]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

- バリデーション（クライアント `required` ＋ サーバー ＋ RPC の三重）: 名前必須・割引額 > 0・割合は 1〜100・`valid_until >= valid_from`・`stay_until >= stay_from`（両方入力時）・`min_total >= 0`。
- 編集画面で **配布数（issued+used+revoked+expired）> 0 のとき**: 割引種別・額・最低金額・施設・宿泊日の入力を `disabled` にし、脇に `配布済みのため変更できません。条件を変えるには無効化して新規作成してください。` を表示。名前・説明・利用期間終了日（延長のみ）・有効フラグは変更可。

#### ワイヤーフレーム — 詳細 `/admin/coupons/[id]`（下部）

```
├──────────────────────────────────────────────────────────────────────────────┤
│ 配布状況                                                                      │
│  配布 120 ／ 使用 18 ／ 取消 2 ／ 期限切れ 0        使用率 15%   最終使用 9/06  │
│                                                                              │
│ ▶ 配布する                                                                    │
│  対象  (●) 全会員   ( ) ランク指定 [ ]standard [ ]silver [✓]gold [✓]platinum   │
│        ( ) 宿泊実績  施設[すべて▾] 宿泊日 [2025-09-01]〜[2026-08-31]           │
│        ( ) 個別選択  [氏名・会員番号で検索      ][検索]  選択中: 3 名 [一覧▾]    │
│                                                   [対象を数える]              │
│  ┌ 対象 46 名（うち既に配布済み 12 名 → 新規配布 34 名）───────────────────┐   │
│  │ 山田 太郎 YM-000123 gold ／ 佐藤 花子 YM-000456 platinum ／ …（先頭 20 名）│   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│  [✓] 配布と同時にアプリ通知「クーポンが届きました」を送る（issue_coupon の仕様） │
│                                                  [34 名に配布する]            │
│                                                                              │
│ ▶ 配布先一覧（150 件）        [状態: すべて ▾] [検索        ]                   │
│  会員番号   氏名      ランク  状態    配布日     使用日   予約番号    操作         │
│  YM-000123  山田 太郎 gold    使用済  9/10 10:02 9/12    YB-2026…   —            │
│  YM-000456  佐藤 花子 platinum 配布済 9/10 10:02  —       —        [配布を取り消す]│
│  …                                                                            │
│                              [表示中の「配布済」全員の配布を取り消す]           │
├──────────────────────────────────────────────────────────────────────────────┤
│ 危険な操作                                                                    │
│  [このクーポンを無効化する]  会員のアプリで「ご利用可能」から消えます（配布データは残ります）│
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 表示するデータと取得元

| 表示 | 取得元 | 引数 |
|---|---|---|
| 一覧（統計付き） | RPC `book.admin_list_coupons(p_include_inactive boolean)` | — |
| 詳細本体 | 同上を `id` で filter（一覧 RPC を 1 件用にも使う。行数は高々数十件） | — |
| 配布先一覧 | RPC `book.admin_list_member_coupons(p_coupon_id uuid)` | coupon id |
| 対象を数える | RPC `book.admin_list_members(p_q, p_ranks, p_stayed_facility, p_stayed_from, p_stayed_until, p_limit=1000, p_offset=0)` → クライアント側で `already_issued` を除外して件数と先頭 20 名を表示 | フォーム値 |
| 施設名 | `core.facilities` は既存 `FACILITY_UUID` の逆引き `reverseFacilityUuid()` ＋ `store.facilities` の name（施設は 2 件固定のため DB 問い合わせ不要） | — |

#### 操作と裏で走る RPC

| 操作 | action 名 | RPC | 監査 action |
|---|---|---|---|
| 作成 | `?/create` | `book.admin_upsert_coupon(p_id := null, …)` → 返り値 id で `/admin/coupons/[id]` へ 303 | `coupon_create` |
| 編集 | `?/save` | `book.admin_upsert_coupon(p_id, …)` | `coupon_update` |
| 無効化／再有効化 | `?/setActive` | `book.admin_set_coupon_active(p_id, p_is_active)` | `coupon_deactivate` / `coupon_activate` |
| 配布 | `?/issue` | `book.issue_coupon(p_coupon_id, p_member_user_ids)`（**既存**。全会員は `null`、それ以外は uuid[]） | `issue_coupon`（既存 RPC 内） |
| 配布取消（1 名） | `?/revoke` | `book.admin_revoke_member_coupons(p_coupon_id, p_member_user_ids := array[uid], p_reason)` | `revoke_member_coupons` |
| 配布取消（一括） | `?/revokeAll` | 同上 `p_member_user_ids := null`（= その coupon の issued 全員） | 同上 |

#### 破壊的操作の確認フロー

- **配布**: 「対象を数える」を押さないと「配布する」ボタンは `disabled`。数えた結果を hidden input（`targetIds` を JSON、`targetCount`）で持ち回り、ボタン文言を `{n} 名に配布する` にする。押下で `confirming = true` → パネル `この操作は取り消せません（配布後の取り消しは 1 名ずつ「配布を取り消す」で行えます）。{n} 名に配布し、アプリ通知「クーポンが届きました」を送ります。` ＋ `[戻る] [配布を実行する]`。**全会員かつ n ≥ 50** のときは数値入力 `会員数 {n} を入力してください` が一致しないと実行ボタンを有効にしない。
- **配布取消**: 行内ボタン → `confirm('YM-000456 佐藤 花子 さんへの配布を取り消します。会員のアプリから消えます。よろしいですか？')`（ブラウザ標準 confirm で十分。理由は任意入力欄 `reason` を行内に置く）。一括は二段確認パネル ＋ 件数入力。
- **無効化**: 二段確認パネル `配布済み {issued} 名の会員がこのクーポンを使えなくなります。`。再有効化は確認なし。

#### 状態と文言

| 状態 | 表示 |
|---|---|
| loading | SvelteKit の SSR で load 完了後に描画するためスピナーは持たない（既存 admin と同じ）。action 実行中は `use:enhance` でボタンに `disabled` ＋ `送信中…` |
| 空 | `まだクーポンがありません。「＋ 新しいクーポン」から作成します。` ／ 配布先 0: `まだ誰にも配布していません。上の「配布する」から対象を選びます。` |
| エラー | `form.message` を赤帯で表示（既存流儀） |
| 権限不足（staff） | フォーム非表示、`クーポンの作成・配布は管理者のみ行えます（スタッフは閲覧のみ）。` |
| 環境不可 | §6.3 パネル |

### 3.2 アプリ通知（`/admin/push`, `/admin/push/new`, `/admin/push/[id]`）

#### 目的・運用者の判断

- 「何を・誰に・いつ届けるか」を決め、送ったあと「届いたか（sent/failed）」「読まれたか（read_at）」を確認する。
- 自動通知（予約リマインド／サンクス）が**毎日ちゃんと動いているか**を同じ画面で確認する。
- 誤配信は取り返しがつかない。**まずテスト受信者に送り、実機で見てから全会員へ**を UI で強制する。

#### 配信の仕組み（実装者が押さえる事実）

- `book.notifications` が outbox。`status: pending → processing → sent | failed`。`scheduled_at <= now()` の pending を pg_cron `book_notifications_drain`（**2 分毎**）が `claim_pending_notifications()` で拾い、Edge Function `send-push` が Expo Push API へ送る。
- `members.push_opt_in=false` の会員・端末 0 台の会員は **push は送られないが行は `sent` になる**（アプリ内通知センターには残る）。つまり `sent` ≠ push 到達。push の到達は `book.notification_deliveries`（Expo ticket 単位）で見る。
- `failed` になるのは「全端末が即時エラー」または Expo API が HTTP エラーのとき。`DeviceNotRegistered` の端末は自動で `is_active=false`。
- `enqueue_stay_notifications()` が毎日 JST 10:00（cron `0 1 * * *` UTC）に reminder（明日チェックイン）・thanks（昨日チェックアウト）を `dedupe_key` 付きで積む。processing のまま 10 分超の行を pending に戻す「スタック回収」もここで走る。
- `data.url` はアプリ内パス（`/news`, `/news/<id>`, `/me/coupons`, `/me/reservations`, `/book`, `/community`）。アプリは `/` 始まり以外を無視する。

#### ワイヤーフレーム — 一覧 `/admin/push`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ アプリ通知                                                  [＋ 新しい通知]   │
│ 会員のアプリへ push 通知を送ります。通知センターにも残ります。送信は取り消せません。│
├──────────────────────────────────────────────────────────────────────────────┤
│ 配信キュー  待機 0 ／ 処理中 0 ／ 直近1時間の失敗 0    最終送信 9/07 09:58     │
│ ●正常（drain cron は 2 分毎・最終 claim 9/07 09:58）                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ [手動配信] [自動通知（リマインド・サンクス）]                                    │
├──────────┬────────────────┬──────┬────────┬──────┬──────┬──────┬──────┬───────┤
│ 日時      │ タイトル        │ 種別 │ 宛先    │ 宛先数│ 送信 │ 失敗 │ 既読 │ 状態   │
├──────────┼────────────────┼──────┼────────┼──────┼──────┼──────┼──────┼───────┤
│ 9/07 10:00│ 秋のプラン公開  │ news │ 全会員  │  128 │  128 │    0 │   41 │ 完了   │
│ 9/06 18:30│ [テスト]秋の…   │ news │ テスト  │    2 │    2 │    0 │    2 │ 完了   │
│ 9/10 10:00│ 連休のご案内    │ custom│ gold+  │   36 │    0 │    0 │    0 │ 予約済 [取消]│
│ 9/01 12:00│ oga 1周年       │ coupon│ 全会員 │  120 │  118 │    2 │   70 │ 完了(失敗2)│
└──────────┴────────────────┴──────┴────────┴──────┴──────┴──────┴──────┴───────┘

（自動通知タブ）
│ 日付   │ リマインド（積/送/失/読）│ サンクス（積/送/失/読）│ 備考                     │
│ 9/07   │ 3 / 3 / 0 / 1          │ 2 / 2 / 0 / 0         │                          │
│ 9/06   │ 0 / 0 / 0 / 0          │ 1 / 1 / 0 / 1         │ 該当予約なし              │
│ …（直近 30 日）                                                                 │
│ ⓘ 毎日 JST 10:00 に enqueue。0 件が続くのは予約が無いだけの可能性があります。      │
│   会員に紐づく（members.guest_id）予約のみ対象です。                              │
```

#### ワイヤーフレーム — 新規 `/admin/push/new`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 新しい通知                                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ 種別 *    (●) お知らせ news   ( ) クーポン coupon   ( ) その他 custom           │
│ タイトル * [秋のプランを公開しました                    ]  22/60               │
│ 本文       [紅葉シーズンの新プランをアプリでご覧いただけます。 ]  31/200         │
│ タップ先   [お知らせ一覧 /news ▾]  または パス [/news/9f1a…         ]           │
│            ⓘ アプリ内のパスのみ（/ 始まり）。外部 URL は無視されます。            │
│                                                                              │
│ 宛先 *    (●) 全会員（128 名・うち push 受信可能 96 名）                          │
│           ( ) ランク指定 [ ]standard [ ]silver [ ]gold [ ]platinum               │
│           ( ) 個別選択 [検索        ]  選択中: 0 名                              │
│                                                                              │
│ 配信日時   (●) 今すぐ（2 分以内に送信・取り消し不可）                            │
│           ( ) 予約 [2026-09-10] [10:00]（JST）  ← 送信開始まで一覧から取り消せます │
│                                                                              │
│ ┌ プレビュー（iOS 通知バナー風・素の HTML/CSS）───────────────────────────┐    │
│ │ 🏔 YAMADO                                              いま           │    │
│ │ 秋のプランを公開しました                                               │    │
│ │ 紅葉シーズンの新プランをアプリでご覧いただけます。                       │    │
│ └────────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│ 1. テスト送信  宛先 [✓]山人 光（YM-000001） [✓]テスト用 (YM-000002) [＋追加]     │
│                [テスト受信者 2 名に送る]   ← 実機で表示・タップ先を確認する        │
│    ✔ 9/07 09:55 にテスト送信済み（campaign 8c1…）                             │
│                                                                              │
│ 2. 本番送信    [内容を確認する]（テスト送信が済むまで押せません）                 │
└──────────────────────────────────────────────────────────────────────────────┘

（「内容を確認する」押下後）
│ ┌ 確認 ───────────────────────────────────────────────────────────────────┐   │
│ │ 全会員 128 名に「秋のプランを公開しました」を 今すぐ 送信します。          │   │
│ │ 送信後の取り消しはできません。                                            │   │
│ │ 宛先数を入力して確定してください: [ 128 ]                                 │   │
│ │ [戻る]                                             [128 名に送信する]     │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
```

#### ワイヤーフレーム — 詳細 `/admin/push/[id]`

```
│ 秋のプランを公開しました（news）  9/07 10:00 送信  宛先: 全会員 128 名  実行者: 山人 光 │
│ 本文: 紅葉シーズンの… ／ タップ先: /news                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ 通知行   待機 0 ／ 処理中 0 ／ 送信済 128 ／ 失敗 0 ／ 既読 41（32%）              │
│ push     端末 96 台へ送出 ／ Expo 受理 95 ／ エラー 1（DeviceNotRegistered 1）     │
│          ⓘ 送信済 ≠ push 到達。opt-out・端末なしの会員も「送信済」になります。      │
├──────────────────────────────────────────────────────────────────────────────┤
│ 失敗した会員（0 件） ／ 端末エラー（1 件: YM-000078 iOS "iPhone" DeviceNotRegistered）│
│ [予約配信のときのみ] [この配信を取り消す]（待機 36 件を削除）                      │
```

#### 表示するデータと取得元

| 表示 | 取得元 | 引数 |
|---|---|---|
| 配信キュー状態 | RPC `book.admin_notification_queue_status()` → `{pending, processing, failed_1h, last_sent_at, last_claimed_at, stuck}` | — |
| 手動配信一覧 | RPC `book.admin_list_campaigns(p_limit int, p_offset int)`（統計付き） | 50, page |
| 自動通知タブ | RPC `book.admin_auto_notification_stats(p_days int)` | 30 |
| 詳細 | `admin_list_campaigns` を id で 1 件 ＋ RPC `book.admin_campaign_detail(p_campaign_id)` → `{counts, failed_members[], device_errors[]}` | id |
| 宛先数 | RPC `book.admin_list_members(...)` の件数（ランク条件）。全会員は `admin_app_dashboard()` の `members.active` と `members.push_capable` | — |
| テスト受信者候補 | `admin_list_members(p_q := '@yamado.co.jp')`（email は tenant_admin のみ返る。§5.4） | — |
| タップ先プリセット | 定数配列 `DEEP_LINK_PRESETS = [{label:'お知らせ一覧', url:'/news'}, {label:'クーポン', url:'/me/coupons'}, {label:'ご予約', url:'/me/reservations'}, {label:'予約する', url:'/book'}, {label:'コミュニティ', url:'/community'}]`（yamado-one の `app/(tabs)` 構成に合わせる。追加は定数編集のみ） | — |

#### 操作と裏で走る RPC

| 操作 | action | RPC | 監査 |
|---|---|---|---|
| テスト送信 | `?/test` | `book.admin_send_notification(p_type, p_title, p_body, p_data, p_member_user_ids := <テスト受信者>, p_scheduled_at := now(), p_target := '{"mode":"test"}')` | `send_notification`（RPC 内） |
| 本番送信（今すぐ） | `?/send` | 同 RPC。`p_member_user_ids := null`（全会員）または uuid[]、`p_target := {"mode":"all"|"rank"|"members", ...}` | 同上 |
| 予約配信 | `?/send` | 同 RPC。`p_scheduled_at := <JST 入力を +09:00 で ISO 化>` | 同上 |
| 予約取消 | `?/cancel` | `book.admin_cancel_campaign(p_campaign_id)` → 削除件数 | `cancel_campaign` |

- **既存 `book.broadcast_notification` は残す**（SQL からのテスト・HANDOFF の M5 手順が参照）が、管理画面は `admin_send_notification` のみ呼ぶ（campaign 紐づけ・宛先指定・予約配信・dedupe が必要なため）。
- `?/send` は `campaignId` を返し `/admin/push/[id]` へ 303。
- 二重送信防止: フォームの hidden `clientToken`（uuid）を `p_target.client_token` として渡し、RPC が `notification_campaigns.client_token` unique で弾く（`unique violation` → `already_sent` にマップ）。

#### 破壊的操作の確認フロー（本書で最も重要）

1. **テスト送信を先に強制**: 「内容を確認する」は `tested === true`（同一フォーム内で `?/test` 成功後に `form.tested` が返る）になるまで `disabled`。文言 `テスト送信が済むまで本番送信はできません。`。タイトル・本文・タップ先を変更したら `tested` を false に戻す（`$state` で入力値のハッシュを比較）。
2. **宛先件数の明示**: 宛先ラジオの横に常に件数（`全会員（128 名・うち push 受信可能 96 名）`）。
3. **二段確認 ＋ 件数入力**: 確認パネルで宛先数を入力させ、一致時のみ実行ボタン有効。テスト送信は件数入力なし（受信者は明示的に選んでいる）。
4. **即時配信は取り消し不可を明記**: ラジオの説明文 `2 分以内に送信・取り消し不可`。予約配信は一覧の `[取消]` で `admin_cancel_campaign`（pending かつ `scheduled_at > now()` の行だけ削除。既に claim された分があれば `already_sent`）。
5. **タイトル空・本文 200 字超・不正パス**はクライアントとサーバーで拒否（RPC も `invalid_params`）。
6. **本番会員が増えた後の全会員テストは禁止**（§9 の手順に明記）。

#### 状態と文言

| 状態 | 表示 |
|---|---|
| 空（手動） | `まだ通知を送っていません。「＋ 新しい通知」から作成し、まずテスト受信者に送ります。` |
| 空（自動） | `直近 30 日に自動通知はありません。会員に紐づく予約（members.guest_id）が無い間は 0 件です。` |
| キュー異常 | `stuck=true`（pending が 10 分超滞留 or processing が 10 分超）: 赤帯 `配信が滞留しています（{n} 件）。pg_cron book_notifications_drain または Edge Function send-push を確認してください。` |
| 失敗あり | 一覧セルを `text-red-700`、詳細に会員一覧 |
| 権限不足（staff） | 新規ボタン・取消ボタン非表示。`通知の送信は管理者のみ行えます。` |

### 3.3 好み登録項目（`/admin/preferences`）

#### 目的・運用者の判断

- アプリの「ご滞在の好み」で会員に何を聞くかを決める。PMS スタッフが接客に使う（`member_preferences_staff_select`）。
- 既に回答がある項目を壊さない（key・型・使用中の選択肢は守る）。

#### ワイヤーフレーム

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 好み登録項目                                                                  │
│ アプリのマイページ「ご滞在の好み」に表示される設問です。回答は PMS のスタッフ画面で閲覧できます。│
├──────────────────────────────────────────────────────────────────────────────┤
│ お食事 (meal)                                                                 │
│ ┌ [1] アレルギー  key: allergy  自由記述  回答 12 件            [✓]表示 [保存] ┐│
│ │  ラベル [アレルギー          ]  グループ [お食事▾]  形式 [自由記述▾](回答ありのため変更不可)│
│ │  表示順 [1]                                                                ││
│ └────────────────────────────────────────────────────────────────────────────┘│
│ ┌ [3] お食事の量  key: meal_volume  択一  回答 9 件              [✓]表示 [保存] ┐│
│ │  ラベル [お食事の量          ]  グループ [お食事▾]  形式 [択一▾]              ││
│ │  選択肢  value      ラベル        回答                                        ││
│ │          [light  ] [少なめ    ]   2   [×]                                    ││
│ │          [normal ] [普通      ]   6   [×](使用中・削除不可)                   ││
│ │          [large  ] [多め      ]   1   [×](使用中・削除不可)                   ││
│ │          [＋ 選択肢を追加]                                                   ││
│ └────────────────────────────────────────────────────────────────────────────┘│
│ お部屋 (room) … ／ その他 (personal) …                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ＋ 新しい項目                                                                  │
│  key * [           ] （半角小文字・数字・_ 。作成後は変更できません）             │
│  ラベル * [           ]  グループ [お食事▾]  形式 [択一▾]  表示順 [11]           │
│  選択肢 … (択一・複数のときのみ表示)                                            │
│  [✓] すぐに表示する                                          [追加する]        │
└──────────────────────────────────────────────────────────────────────────────┘
```

- `value_type` と入力 UI の対応（アプリ側 `preferences.ts` / M8 画面と一致させる）:

| value_type | 表示名 | options | 回答 `value` の形（RPC の「使用中」判定に使う） |
|---|---|---|---|
| `single` | 択一 | 必須（1 件以上） | `"light"`（jsonb 文字列） |
| `multi` | 複数選択 | 必須（1 件以上） | `["a","b"]`（jsonb 配列） |
| `text` | 自由記述 | `[]` 固定（編集 UI 非表示） | `"…"` |
| `boolean` | はい／いいえ | `[]` 固定 | `true/false` |
| `date` | 日付 | `[]` 固定 | `"2026-09-07"` |

- 形式を `single/multi` から `text` 等に変えると options 編集 UI が消え、保存時に `options := '[]'` を送る。
- `key` は新規作成時のみ入力。正規表現 `^[a-z][a-z0-9_]{1,31}$`。既存行では表示のみ。
- **削除ボタンは無い**。「表示」チェックを外して保存 = `is_active=false`。説明 `非表示にしてもこれまでの回答は保持されます。`。
- 回答件数・選択肢ごとの件数は RPC `admin_preference_usage()` から。

#### データ・操作

| 表示／操作 | 取得元・RPC |
|---|---|
| 一覧（非表示含む） | authenticated client で `book.preference_catalog` select（staff 用 select policy を追加・§5.5）＋ `admin_preference_usage()` |
| 追加・保存 | `book.admin_upsert_preference_item(p_key, p_label, p_group_name, p_value_type, p_options, p_sort_order, p_is_active)` |
| 例外 | `key_taken` / `type_in_use` / `option_in_use:<value>` / `invalid_params` → §3 冒頭の表 |

確認フロー: 非表示化のみ `confirm('「お食事の量」をアプリから非表示にします。回答は保持されます。')`。それ以外は確認なし（可逆）。

### 3.4 共通 UI 部品（新規・`src/lib/components/admin/`）

| 部品 | 用途 | 実装 |
|---|---|---|
| `StatCard.svelte` | KPI カード（label / value / sub / level） | 既存 `/admin` のカードと同じクラス。`level: 'ok'|'warn'|'error'` で左ボーダー色 `border-l-4 border-emerald-500 / amber-500 / red-500` |
| `Sparkline.svelte` | 30 日推移 | `<svg viewBox="0 0 120 32">` に `<polyline>`。props `values: number[]`。依存なし |
| `ConfirmPanel.svelte` | 二段確認 | props `message`, `requireCount?: number`, `confirmLabel`; `onconfirm` コールバック。`requireCount` があれば数値入力一致で有効化 |
| `MemberPicker.svelte` | 個別選択 | 検索 input → `fetch('/admin/api/members?q=')`（`+server.ts`・同じ RPC）→ チェックボックス一覧。選択は hidden input `memberIds`（JSON） |

### 3.5 既存画面への追記（新設ではない）

| 画面 | 追記 | 条件 |
|---|---|---|
| `/admin/news` | 各記事の編集フォーム脇に `アプリに通知する →`（`/admin/push/new?type=news&title=<記事タイトル>&url=/news/<id>`）。`isPublished=false` の記事では非表示（未公開記事にリンクさせない） | `ADMIN_SUPABASE` のとき |
| `/admin/members` | `ADMIN_SUPABASE` のとき一覧を `admin_list_members(p_q)` の実データにする（現状は本番でも demo 会員を表示している）。列: 会員番号・氏名・ランク・push 受信（端末数）・登録日・メルマガ | 実装順序 §8 ステップ 6 |
| `/admin/members/[id]` | タブ「クーポン」「通知」「端末」「好み」を追加。データは `admin_list_member_coupons`（member 絞り込み版 `p_member_user_id`）・`notifications` select・`admin_member_devices(p_member_user_id)`・`member_preferences` select（staff policy あり） | 同上 |
| `/admin/plans` | 見出し脇に `公開 {n}/{total}` バッジ（`ADMIN_SUPABASE` のとき `plan_contents` を count） | 任意 |

---

## 4. アプリ運用ダッシュボード（`/admin/app`）

### 4.1 目的

「今アプリがどういう状態か」を 1 画面で把握し、**気づけていない運用の穴**（公開プラン 2/42・写真 0 枚・オプション 0・端末 0 台・配信滞留）を**具体的な数字と、直しに行く導線**で見せる。宿泊寄りの `/admin`（本日のチェックイン・hold）とは別物。

### 4.2 ワイヤーフレーム

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ アプリ運用                                        最終更新 9/07 10:12（再読込）│
├──────────────┬──────────────┬──────────────┬──────────────────────────────────┤
│ 会員          │ push 受信可能  │ アプリ予約 30日│ 通知配信 7日                     │
│ 128 名        │ 96 名 / 112 台 │ 14 件 ¥812,000 │ 送信 384 ／ 失敗 2 ／ 既読率 31%   │
│ 今月 +9       │ opt-in 91%    │ ▁▂▃▅▂▁▃▇▅▂    │ ▁▁▃▁▁▇▁                          │
├──────────────┴──────────────┴──────────────┴──────────────────────────────────┤
│ ⚠ 要対応（4）                                                                 │
│  ● 公開中のプランが 1/29 件です（山人-yamado-）。下書き 28 件はアプリに表示されません。 → プラン │
│  ● 公開中のプランが 1/13 件です（山人-oga-）。                                → プラン │
│  ● 写真のあるプランが 0/42 件・客室 0/15 件です。アプリはプレースホルダー画像を表示しています。 → プラン／部屋編集 │
│  ● push を受け取れる端末が 0 台です（会員 1 名）。通知は通知センターにのみ届きます。 → アプリ通知 │
│  ○ プラン個別のキャンセル規定がありません（42/42 件）。グレード別規定（standard: 14日前10%…）を適用中です。 → キャンセル規定 │
│  ○ 公開中のオプションが 0 件です（seed 2 品は非公開・0 円）。                    → オプション │
├──────────────────────────────────────────────────────────────────────────────┤
│ 運用チェック（施設別）                                                          │
│  施設        公開プラン  写真ありプラン  公開客室  写真あり客室  個別規定  公開オプション  公開お知らせ │
│  山人-yamado-  1/29 🔴    0/29 🔴        7/7 🟢    0/7 🔴       0/29 ⚪    0 ⚪         33 🟢   │
│  山人-oga-     1/13 🔴    0/13 🔴        8/8 🟢    0/8 🔴       0/13 ⚪    0 ⚪         0 🟡    │
│  （セルクリックで施設を切り替えて該当画面へ: /admin/switch?f=<id>&back=/admin/plans）│
├────────────────────────────────────┬─────────────────────────────────────────┤
│ 配信キュー                          │ クーポン                                 │
│  待機 0 ／ 処理中 0 ／ 失敗(1h) 0   │  有効 2 件 ／ 配布 160 ／ 使用 58（36%）  │
│  最終送信 9/07 09:58  ●正常         │  期限 7 日以内で未使用あり: 1 件 → クーポン│
│  自動通知 本日: リマインド 3 サンクス 2│                                         │
├────────────────────────────────────┴─────────────────────────────────────────┤
│ 最近の管理操作（admin_audit_logs 直近 10 件）                                    │
│  9/07 10:00  send_notification   秋のプランを公開しました（128 名）   山人 光      │
│  9/06 18:30  issue_coupon        秋の感謝券（34 名）                  山人 光      │
│  9/01 15:04  stay_token_issue    堅香子                               山人 光      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 データ取得

1 回の RPC `book.admin_app_dashboard()`（SECURITY DEFINER・`has_tenant_access` ガード・jsonb 返却）にまとめる。理由: `device_tokens` にはスタッフ用 select policy を作らない（トークン文字列を管理画面に流さない）ため集計は DB 側で行う必要があり、`booking.*` / `core.*` の staff 権限も画面ごとに確認するより RPC 内で完結させる方が安全。SQL 全文は §5.6。

戻り値の形（TypeScript 側の型 `AppDashboard`）:

```ts
interface AppDashboard {
  generated_at: string;
  members: { total: number; active: number; joined_this_month: number; push_opt_in: number; push_capable: number; devices_active: number };
  bookings: { last30_count: number; last30_amount: number; daily: { d: string; c: number }[] };
  notifications: { last7_sent: number; last7_failed: number; last7_read_rate: number; daily: { d: string; c: number }[];
                   queue: { pending: number; processing: number; failed_1h: number; last_sent_at: string | null; last_claimed_at: string | null; stuck: boolean };
                   today_auto: { reminder: number; thanks: number } };
  coupons: { active: number; issued: number; used: number; expiring_7d_unused: number };
  facilities: { facility_id: string; slug: string; name: string;
                plans_total: number; plans_published: number; plans_with_photos: number;
                rooms_total: number; rooms_published: number; rooms_with_photos: number;
                plans_no_policy: number; options_active: number; news_published: number }[];
  rank_policy_ok: boolean;   // standard の rules が 1 件以上
  audit: { created_at: string; action: string; detail: Record<string, unknown>; actor_name: string | null }[];
}
```

アラートは **サーバー側（`+page.server.ts`）で `AppDashboard` から生成**する（DB に文言を持たせない）。

### 4.4 アラートのしきい値と文言（確定値）

| # | 条件 | level | 文言（`{}` は埋め込み） | 導線 |
|---|---|---|---|---|
| A1 | 施設ごとに `plans_published = 0` | error | `公開中のプランがありません（{name}）。アプリの予約画面にプランが 1 件も出ません。` | `/admin/switch?f={demoId}&back=/admin/plans` |
| A2 | `plans_published / plans_total < 0.3` または `plans_published < 3`（A1 でない） | warn | `公開中のプランが {pub}/{total} 件です（{name}）。下書き {total-pub} 件はアプリに表示されません。` | 同上 |
| A3 | 全施設合計で `plans_with_photos = 0` | error | `写真のあるプランが 0/{total} 件・客室 0/{rooms} 件です。アプリはプレースホルダー画像を表示しています。` | `/admin/plans`・`/admin/rooms` |
| A4 | A3 でなく `plans_with_photos / plans_published < 0.5` | warn | `公開プランのうち写真があるのは {n}/{pub} 件です（{name}）。` | `/admin/plans` |
| A5 | `rooms_published < rooms_total` | warn | `非公開の客室が {total-pub} 件あります（{name}）。` | `/admin/rooms` |
| A6 | `members.active > 0` かつ `devices_active = 0` | warn | `push を受け取れる端末が 0 台です（会員 {n} 名）。通知は通知センターにのみ届きます。` | `/admin/push` |
| A7 | `push_opt_in / active < 0.5`（active ≥ 10 のとき） | info | `push 受信を許可している会員は {rate}% です。` | — |
| A8 | `queue.stuck = true` | error | `通知配信が滞留しています（待機 {pending} 件・処理中 {processing} 件）。pg_cron book_notifications_drain / Edge Function send-push を確認してください。` | `/admin/push` |
| A9 | `last7_failed > 0` | warn | `直近 7 日で {n} 件の通知が失敗しています。` | `/admin/push` |
| A10 | `rank_policy_ok = false` | error | `グレード別キャンセル規定（standard）が空です。全予約がキャンセル料無料になります。` | `/admin/cancel-policies` |
| A11 | `plans_no_policy = plans_total`（rank_policy_ok のとき） | info | `プラン個別のキャンセル規定がありません（{n}/{total} 件・{name}）。グレード別規定を適用中です。` | `/admin/cancel-policies` |
| A12 | `options_active = 0`（全施設） | info | `公開中のオプションが 0 件です（seed 2 品は非公開・0 円）。使わないなら対応不要です。` | `/admin/options` |
| A13 | `coupons.expiring_7d_unused > 0` | info | `期限まで 7 日以内で未使用の配布があるクーポンが {n} 件あります。` | `/admin/coupons` |
| A14 | 施設ごとに `news_published = 0` | info | `公開中のお知らせがありません（{name}）。アプリのお知らせタブが空になります。` | `/admin/switch?f=…&back=/admin/news` |

表示順: error → warn → info。見出しは `⚠ 要対応（{error+warn 件数}）`、info は `○` で薄く。0 件のとき `未対応の項目はありません。`。

運用チェック表のセル色: 🔴 = 0 or 割合 < 30%、🟡 = 30〜99%、🟢 = 100%、⚪ = 情報のみ（個別規定・オプション）。

### 4.5 各指標の SQL（動作確認用・RPC 内でも同じ式を使う）

```sql
-- 会員
select count(*) filter (where withdrawn_at is null)                                   as active,
       count(*) filter (where withdrawn_at is null and joined_at >= date_trunc('month', now() at time zone 'Asia/Tokyo')) as joined_this_month,
       count(*) filter (where withdrawn_at is null and push_opt_in)                    as push_opt_in,
       count(distinct dt.member_user_id) filter (where dt.is_active and m.push_opt_in) as push_capable
from book.members m left join book.device_tokens dt on dt.member_user_id = m.user_id;

-- 端末台数
select count(*) from book.device_tokens where is_active;

-- アプリ（直販）予約 30 日
select count(*), coalesce(sum(b.total_amount),0)
from booking.bookings b join booking.channels c on c.id = b.channel_id
where c.code = 'autumn_booking' and b.created_at >= now() - interval '30 days' and b.status <> 'cancelled';

-- 通知 7 日
select count(*) filter (where status='sent')   as sent,
       count(*) filter (where status='failed') as failed,
       round(100.0 * count(*) filter (where read_at is not null) / nullif(count(*) filter (where status='sent'),0)) as read_rate
from book.notifications where created_at >= now() - interval '7 days';

-- キュー
select count(*) filter (where status='pending')                                            as pending,
       count(*) filter (where status='processing')                                         as processing,
       count(*) filter (where status='failed' and created_at >= now() - interval '1 hour') as failed_1h,
       max(sent_at) as last_sent_at, max(claimed_at) as last_claimed_at,
       bool_or(status='pending' and scheduled_at < now() - interval '10 minutes')
         or bool_or(status='processing' and claimed_at < now() - interval '10 minutes')     as stuck
from book.notifications;

-- 施設別 運用チェック（本書 §0.3 の表そのもの）
select f.id, f.slug, f.name,
  (select count(*) from book.plan_contents pc where pc.facility_id=f.id)                                          as plans_total,
  (select count(*) from book.plan_contents pc where pc.facility_id=f.id and pc.is_published)                      as plans_published,
  (select count(*) from book.plan_contents pc where pc.facility_id=f.id and jsonb_array_length(coalesce(pc.photos,'[]'))>0) as plans_with_photos,
  (select count(*) from book.room_type_contents rc where rc.facility_id=f.id)                                     as rooms_total,
  (select count(*) from book.room_type_contents rc where rc.facility_id=f.id and rc.is_published)                 as rooms_published,
  (select count(*) from book.room_type_contents rc where rc.facility_id=f.id and jsonb_array_length(coalesce(rc.photos,'[]'))>0) as rooms_with_photos,
  (select count(*) from booking.rate_plans rp where rp.facility_id=f.id and rp.is_active
     and (rp.cancellation_policy is null or rp.cancellation_policy::text in ('[]','{}','{"rules": []}')))          as plans_no_policy,
  (select count(*) from book.option_items oi where oi.facility_id=f.id and oi.is_active)                          as options_active,
  (select count(*) from book.news_posts n where n.facility_id=f.id and n.is_published)                            as news_published
from core.facilities f where f.is_active order by f.slug;
-- 2026-09-07 実行結果: yamado 29/1/0 7/7/0 29 0 33 ／ oga 13/1/0 8/8/0 13 0 0

-- グレード別規定の有効性
select jsonb_array_length(coalesce(rules,'[]')) > 0 from book.rank_cancel_policies where rank_code='standard';

-- クーポン
select count(*) filter (where c.is_active and c.valid_until >= current_date) as active,
       count(mc.*) filter (where mc.status in ('issued','used'))            as issued,
       count(mc.*) filter (where mc.status='used')                           as used,
       count(distinct c.id) filter (where c.is_active and c.valid_until between current_date and current_date + 7 and mc.status='issued') as expiring_7d_unused
from book.coupons c left join book.member_coupons mc on mc.coupon_id = c.id;

-- 監査ログ直近 10 件（actor 名は auth.users.raw_user_meta_data->>'name'）
select l.created_at, l.action, l.detail, u.raw_user_meta_data->>'name' as actor_name
from book.admin_audit_logs l left join auth.users u on u.id = l.actor
order by l.created_at desc limit 10;
```

---

## 5. 追加が必要な DB オブジェクト（autumn-shared に作る）

### 5.1 方針: RPC か service_role 直操作か

**すべて `SECURITY DEFINER` RPC ＋ authenticated クライアント**で行う。service_role は使わない。

| 観点 | RPC（採用） | service_role 直操作（不採用） |
|---|---|---|
| 秘密の置き場所 | 不要（cookie の JWT で `auth.uid()` が立つ） | `SUPABASE_SERVICE_ROLE_KEY` を Cloudflare Pages に置く必要がある。現状 autumn-book には service_role が 1 箇所も無く、増やすとサーバー側コードのどこからでも全テーブルを触れてしまう |
| 権限判定 | RPC 内で `private.is_tenant_admin(tenant)` ／ `has_tenant_access` を評価。**DB が最終防衛線** | アプリ側 `locals.user.role` だけが防衛線になる（`AUTH_MODE=demo` の偽造 cookie で突破される設計上の後退） |
| 監査 | RPC 内で `admin_audit_logs` に `actor = auth.uid()` を記帳（既存 `issue_coupon` / `forum_upsert_board` と同じ） | アプリ側で別途 insert する必要があり漏れる |
| 既存との整合 | `issue_coupon` / `broadcast_notification` / `forum_*` / `otayori_*` / inroom 系がすべてこの形 | 前例なし |
| 制約 | RPC を足す migration が要る（本章） | migration 不要 |

読み取りは、staff 向け select policy が既にあるテーブル（`members`, `member_preferences`, `admin_audit_logs`）は authenticated クライアントで直接 select、無いもの（`member_coupons`, `notifications`, `preference_catalog` の非公開行）は本章で policy を足す。`device_tokens` / `notification_deliveries` は policy を足さず RPC の集計だけ返す（トークン・ticket を管理画面に流さない）。

### 5.2 `book.coupons` の write policy を絞る（推奨・同 migration 内）

現状 `coupons_staff_write`（`for all … has_tenant_access`）は `shared_login` 会員（`info@yamado.co.jp` 等）でも監査なしにクーポンを直接 insert/update/delete できる。yamado-one は読むだけ、autumn-book にクーポンを書くコードは無いので、**RPC 経由に一本化**して policy を select のみに絞る。

```sql
drop policy if exists coupons_staff_write on book.coupons;
revoke insert, update, delete on book.coupons from authenticated;
create policy coupons_staff_select on book.coupons
  for select to authenticated using (private.has_tenant_access(tenant_id));   -- 非 active も staff は見える
```

### 5.3 migration ファイル

1 本にまとめる（作成は必ずヘルパー経由・実 UTC 秒）:

```bash
bash ~/.claude/new-migration.sh autumn-shared book_admin_app_ops
# → autumn-shared/supabase/migrations/<UTC秒>_book_admin_app_ops.sql
```

適用: autumn-shared main への push で自動適用（GitHub 連携・yamado-one HANDOFF 2026-07-02 の知見）。適用後 `supabase migration list --linked` で version を確認。

### 5.4 一覧

| 種別 | 名前 | 用途 | ガード |
|---|---|---|---|
| table | `book.notification_campaigns` | 手動配信の単位（履歴・宛先・予約日時・取消） | RLS: staff select |
| column | `book.notifications.campaign_id uuid` | campaign 紐づけ（自動通知は NULL） | — |
| policy | `notifications_staff_select` | 履歴・到達状況の閲覧 | `has_tenant_access(tenant_id)` |
| policy | `member_coupons_staff_select` | 配布先一覧の閲覧 | 同上 |
| policy | `coupons_staff_select`（＋ `coupons_staff_write` 削除） | §5.2 | 同上 |
| policy | `preference_catalog_staff_select` | 非表示項目の閲覧 | `exists(memberships where user_id=auth.uid())` |
| rpc | `admin_upsert_coupon` | 作成・編集 | `is_tenant_admin` |
| rpc | `admin_set_coupon_active` | 無効化・再有効化 | 同上 |
| rpc | `admin_revoke_member_coupons` | 配布取消（個別・一括） | 同上 |
| rpc | `admin_list_coupons` | 一覧＋統計 | `has_tenant_access` |
| rpc | `admin_list_member_coupons` | 配布先一覧（coupon または member で絞る） | 同上 |
| rpc | `admin_list_members` | 会員検索・宛先抽出（email は tenant_admin のみ） | 同上 |
| rpc | `admin_member_devices` | 会員詳細の端末タブ（platform / device_name / last_seen のみ・トークン非返却） | 同上 |
| rpc | `admin_send_notification` | テスト・一斉・予約配信 | `is_tenant_admin` |
| rpc | `admin_cancel_campaign` | 予約配信の取消 | 同上 |
| rpc | `admin_list_campaigns` | 手動配信一覧＋統計 | `has_tenant_access` |
| rpc | `admin_campaign_detail` | 失敗会員・端末エラー | 同上 |
| rpc | `admin_auto_notification_stats` | reminder/thanks 日別 | 同上 |
| rpc | `admin_notification_queue_status` | キュー状態 | 同上 |
| rpc | `admin_upsert_preference_item` | 好み項目の追加・編集 | `is_tenant_admin` |
| rpc | `admin_preference_usage` | 回答件数・選択肢別件数 | `has_tenant_access` |
| rpc | `admin_app_dashboard` | ダッシュボード集計 | 同上 |

すべて `language plpgsql security definer set search_path = ''`、`revoke execute … from public, anon; grant execute … to authenticated, service_role;`（既存規約）。テナントは現状シングルテナントのため `select id from core.tenants order by created_at limit 1`（`broadcast_notification` と同じ流儀）で解決するヘルパー `book._admin_tenant()` を最初に定義する。

### 5.5 SQL 骨子

```sql
-- =============================================================================
-- book 管理画面（アプリ運用）: クーポン CRUD／通知配信／好みカタログ／ダッシュボード
-- 設計書: autumn-book/docs/ADMIN_APP_OPS.md §5
-- =============================================================================

-- ---- 共通: テナント解決 ＋ 権限ヘルパー -------------------------------------
create or replace function book._admin_tenant() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from core.tenants order by created_at limit 1
$$;
revoke execute on function book._admin_tenant() from public, anon, authenticated;

create or replace function book._require_admin(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not (private.is_tenant_admin(p_tenant) or private.is_superadmin()) then raise exception 'forbidden'; end if;
end $$;

create or replace function book._require_staff(p_tenant uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not private.has_tenant_access(p_tenant) then raise exception 'forbidden'; end if;
end $$;
revoke execute on function book._require_admin(uuid), book._require_staff(uuid) from public, anon, authenticated;

-- ---- 1. クーポン -------------------------------------------------------------
drop policy if exists coupons_staff_write on book.coupons;
revoke insert, update, delete on book.coupons from authenticated;
create policy coupons_staff_select on book.coupons
  for select to authenticated using (private.has_tenant_access(tenant_id));
create policy member_coupons_staff_select on book.member_coupons
  for select to authenticated using (private.has_tenant_access(tenant_id));

create or replace function book.admin_upsert_coupon(
  p_id uuid, p_name text, p_description text,
  p_discount_type text, p_discount_value integer, p_min_total integer,
  p_valid_from date, p_valid_until date, p_stay_from date, p_stay_until date,
  p_facility_id uuid, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_old book.coupons; v_issued integer; v_id uuid;
begin
  perform book._require_admin(v_tenant);
  if coalesce(trim(p_name),'') = '' or p_discount_type not in ('fixed','percent')
     or p_discount_value is null or p_discount_value <= 0
     or (p_discount_type = 'percent' and p_discount_value > 100)
     or coalesce(p_min_total,0) < 0 or p_valid_until < p_valid_from
     or (p_stay_from is not null and p_stay_until is not null and p_stay_until < p_stay_from)
     or (p_facility_id is not null and not exists (select 1 from core.facilities f where f.id = p_facility_id and f.tenant_id = v_tenant))
  then raise exception 'invalid_params'; end if;

  if p_id is null then
    insert into book.coupons (tenant_id, facility_id, name, description, discount_type, discount_value, min_total,
                              valid_from, valid_until, stay_from, stay_until, is_active)
    values (v_tenant, p_facility_id, p_name, p_description, p_discount_type, p_discount_value, coalesce(p_min_total,0),
            p_valid_from, p_valid_until, p_stay_from, p_stay_until, coalesce(p_is_active,true))
    returning id into v_id;
    insert into book.admin_audit_logs (tenant_id, facility_id, actor, action, detail)
    values (v_tenant, p_facility_id, auth.uid(), 'coupon_create', jsonb_build_object('coupon_id', v_id, 'name', p_name));
    return v_id;
  end if;

  select * into v_old from book.coupons where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'not_found'; end if;
  select count(*) into v_issued from book.member_coupons where coupon_id = p_id;
  -- 配布済みは割引条件を凍結（名前・説明・利用期間終了の延長・有効フラグのみ可）
  if v_issued > 0 and (
       v_old.discount_type <> p_discount_type or v_old.discount_value <> p_discount_value
    or v_old.min_total <> coalesce(p_min_total,0) or v_old.facility_id is distinct from p_facility_id
    or v_old.stay_from is distinct from p_stay_from or v_old.stay_until is distinct from p_stay_until
    or v_old.valid_from <> p_valid_from or p_valid_until < v_old.valid_until)
  then raise exception 'coupon_issued'; end if;

  update book.coupons set name = p_name, description = p_description, discount_type = p_discount_type,
    discount_value = p_discount_value, min_total = coalesce(p_min_total,0), valid_from = p_valid_from,
    valid_until = p_valid_until, stay_from = p_stay_from, stay_until = p_stay_until,
    facility_id = p_facility_id, is_active = coalesce(p_is_active, is_active)
  where id = p_id;
  insert into book.admin_audit_logs (tenant_id, facility_id, actor, action, detail)
  values (v_tenant, p_facility_id, auth.uid(), 'coupon_update', jsonb_build_object('coupon_id', p_id, 'name', p_name, 'issued', v_issued));
  return p_id;
end $$;

create or replace function book.admin_set_coupon_active(p_id uuid, p_is_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_admin(v_tenant);
  update book.coupons set is_active = p_is_active where id = p_id and tenant_id = v_tenant;
  if not found then raise exception 'not_found'; end if;
  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid(), case when p_is_active then 'coupon_activate' else 'coupon_deactivate' end,
          jsonb_build_object('coupon_id', p_id));
end $$;

create or replace function book.admin_revoke_member_coupons(p_coupon_id uuid, p_member_user_ids uuid[], p_reason text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_n integer;
begin
  perform book._require_admin(v_tenant);
  update book.member_coupons set status = 'revoked'
   where coupon_id = p_coupon_id and tenant_id = v_tenant and status = 'issued'
     and (p_member_user_ids is null or member_user_id = any (p_member_user_ids));
  get diagnostics v_n = row_count;
  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid(), 'revoke_member_coupons',
          jsonb_build_object('coupon_id', p_coupon_id, 'count', v_n, 'all', p_member_user_ids is null, 'reason', p_reason));
  return v_n;
end $$;

create or replace function book.admin_list_coupons(p_include_inactive boolean default true)
returns table (id uuid, facility_id uuid, name text, description text, discount_type text, discount_value integer,
               min_total integer, valid_from date, valid_until date, stay_from date, stay_until date,
               is_active boolean, created_at timestamptz,
               issued integer, used integer, revoked integer, expired integer, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query
  select c.id, c.facility_id, c.name, c.description, c.discount_type, c.discount_value, c.min_total,
         c.valid_from, c.valid_until, c.stay_from, c.stay_until, c.is_active, c.created_at,
         count(mc.*) filter (where mc.status='issued')::int, count(mc.*) filter (where mc.status='used')::int,
         count(mc.*) filter (where mc.status='revoked')::int, count(mc.*) filter (where mc.status='expired')::int,
         max(mc.used_at)
  from book.coupons c left join book.member_coupons mc on mc.coupon_id = c.id
  where c.tenant_id = v_tenant and (p_include_inactive or c.is_active)
  group by c.id order by c.created_at desc;
end $$;

create or replace function book.admin_list_member_coupons(p_coupon_id uuid default null, p_member_user_id uuid default null)
returns table (id uuid, coupon_id uuid, coupon_name text, member_user_id uuid, member_code text, member_name text,
               rank_code text, status text, issued_at timestamptz, used_at timestamptz, booking_code text)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  if p_coupon_id is null and p_member_user_id is null then raise exception 'invalid_params'; end if;
  return query
  select mc.id, mc.coupon_id, c.name, mc.member_user_id, m.member_code, g.name, m.rank_code, mc.status,
         mc.issued_at, mc.used_at, b.metadata->>'booking_code'     -- booking_code の格納先は confirm_booking の実装に合わせて実装時に確認
  from book.member_coupons mc
  join book.coupons c on c.id = mc.coupon_id
  join book.members m on m.user_id = mc.member_user_id
  left join core.guests g on g.id = m.guest_id
  left join booking.bookings b on b.id = mc.booking_id
  where mc.tenant_id = v_tenant
    and (p_coupon_id is null or mc.coupon_id = p_coupon_id)
    and (p_member_user_id is null or mc.member_user_id = p_member_user_id)
  order by mc.issued_at desc;
end $$;

-- ---- 2. 会員検索（宛先抽出・会員一覧共用） ------------------------------------
create or replace function book.admin_list_members(
  p_q text default null, p_ranks text[] default null,
  p_stayed_facility uuid default null, p_stayed_from date default null, p_stayed_until date default null,
  p_include_withdrawn boolean default false, p_limit integer default 200, p_offset integer default 0
) returns table (user_id uuid, member_code text, name text, email text, rank_code text, push_opt_in boolean,
                 device_count integer, joined_at timestamptz, withdrawn_at timestamptz, last_stay date)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_is_admin boolean;
begin
  perform book._require_staff(v_tenant);
  v_is_admin := private.is_tenant_admin(v_tenant) or private.is_superadmin();
  return query
  select m.user_id, m.member_code, g.name,
         case when v_is_admin then u.email else null end,           -- staff にはメールを返さない（既存の連絡先マスクと整合）
         m.rank_code, m.push_opt_in,
         (select count(*) from book.device_tokens dt where dt.member_user_id = m.user_id and dt.is_active)::int,
         m.joined_at, m.withdrawn_at,
         (select max(s.check_in_date) from core.stays s where s.guest_id = m.guest_id)
  from book.members m
  left join core.guests g on g.id = m.guest_id
  left join auth.users u on u.id = m.user_id
  where m.tenant_id = v_tenant
    and (p_include_withdrawn or m.withdrawn_at is null)
    and (p_ranks is null or m.rank_code = any (p_ranks))
    and (p_q is null or p_q = '' or g.name ilike '%'||p_q||'%' or g.name_kana ilike '%'||p_q||'%'
         or m.member_code ilike '%'||p_q||'%' or (v_is_admin and u.email ilike '%'||p_q||'%'))
    and (p_stayed_facility is null and p_stayed_from is null and p_stayed_until is null
         or exists (select 1 from core.stays s where s.guest_id = m.guest_id
                      and (p_stayed_facility is null or s.facility_id = p_stayed_facility)
                      and (p_stayed_from is null or s.check_in_date >= p_stayed_from)
                      and (p_stayed_until is null or s.check_in_date <= p_stayed_until)
                      and s.status in ('reserved','checked_in','checked_out')))
  order by m.joined_at desc limit least(p_limit, 1000) offset p_offset;
end $$;

create or replace function book.admin_member_devices(p_member_user_id uuid)
returns table (id uuid, platform text, device_name text, is_active boolean, last_seen_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query select dt.id, dt.platform, dt.device_name, dt.is_active, dt.last_seen_at, dt.created_at
  from book.device_tokens dt join book.members m on m.user_id = dt.member_user_id
  where dt.member_user_id = p_member_user_id and m.tenant_id = v_tenant order by dt.last_seen_at desc;
end $$;

-- ---- 3. 通知配信 -------------------------------------------------------------
create table book.notification_campaigns (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references core.tenants(id),
  client_token    uuid unique,                                  -- 二重送信防止
  type            text not null check (type in ('news','coupon','custom')),
  title           text not null,
  body            text,
  data            jsonb not null default '{}'::jsonb,
  target          jsonb not null default '{"mode":"all"}'::jsonb,  -- {"mode":"all"|"rank"|"members"|"test", "ranks":[…]}
  recipient_count integer not null default 0,
  scheduled_at    timestamptz not null default now(),
  cancelled_at    timestamptz,
  actor           uuid,
  created_at      timestamptz not null default now()
);
alter table book.notification_campaigns enable row level security;
grant select on book.notification_campaigns to authenticated;
grant all on book.notification_campaigns to service_role;
create policy notification_campaigns_staff_select on book.notification_campaigns
  for select to authenticated using (private.has_tenant_access(tenant_id));

alter table book.notifications add column campaign_id uuid references book.notification_campaigns(id);
create index notifications_campaign_idx on book.notifications (campaign_id) where campaign_id is not null;
create policy notifications_staff_select on book.notifications
  for select to authenticated using (private.has_tenant_access(tenant_id));

create or replace function book.admin_send_notification(
  p_type text, p_title text, p_body text, p_data jsonb,
  p_member_user_ids uuid[] default null, p_scheduled_at timestamptz default now(),
  p_target jsonb default '{"mode":"all"}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_id uuid; v_n integer; v_url text;
begin
  perform book._require_admin(v_tenant);
  if p_type not in ('news','coupon','custom') then raise exception 'invalid_params'; end if;
  if coalesce(trim(p_title),'') = '' or length(p_title) > 60 or length(coalesce(p_body,'')) > 200 then raise exception 'invalid_params'; end if;
  v_url := p_data->>'url';
  if v_url is not null and v_url !~ '^/[A-Za-z0-9_./?=&%-]*$' then raise exception 'invalid_params'; end if;   -- アプリ内パスのみ
  if p_scheduled_at < now() - interval '1 minute' or p_scheduled_at > now() + interval '90 days' then raise exception 'invalid_params'; end if;
  if p_member_user_ids is not null and cardinality(p_member_user_ids) = 0 then raise exception 'invalid_params'; end if;

  insert into book.notification_campaigns (tenant_id, client_token, type, title, body, data, target, scheduled_at, actor)
  values (v_tenant, nullif(p_target->>'client_token','')::uuid, p_type, p_title, p_body, coalesce(p_data,'{}'::jsonb),
          coalesce(p_target,'{"mode":"all"}'::jsonb) - 'client_token', greatest(p_scheduled_at, now()), auth.uid())
  returning id into v_id;

  insert into book.notifications (tenant_id, member_user_id, type, title, body, data, dedupe_key, scheduled_at, campaign_id)
  select v_tenant, m.user_id, p_type, p_title, p_body, coalesce(p_data,'{}'::jsonb),
         'campaign:' || v_id || ':' || m.user_id, greatest(p_scheduled_at, now()), v_id
  from book.members m
  where m.tenant_id = v_tenant and m.withdrawn_at is null
    and (p_member_user_ids is null or m.user_id = any (p_member_user_ids));
  get diagnostics v_n = row_count;
  update book.notification_campaigns set recipient_count = v_n where id = v_id;

  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid(), 'send_notification',
          jsonb_build_object('campaign_id', v_id, 'type', p_type, 'title', p_title, 'count', v_n,
                             'mode', p_target->>'mode', 'scheduled_at', greatest(p_scheduled_at, now())));
  return jsonb_build_object('campaign_id', v_id, 'count', v_n);
exception when unique_violation then raise exception 'already_sent';
end $$;

create or replace function book.admin_cancel_campaign(p_campaign_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_n integer;
begin
  perform book._require_admin(v_tenant);
  if not exists (select 1 from book.notification_campaigns where id = p_campaign_id and tenant_id = v_tenant) then raise exception 'not_found'; end if;
  delete from book.notifications where campaign_id = p_campaign_id and status = 'pending' and scheduled_at > now();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'already_sent'; end if;
  update book.notification_campaigns set cancelled_at = now() where id = p_campaign_id;
  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid(), 'cancel_campaign', jsonb_build_object('campaign_id', p_campaign_id, 'deleted', v_n));
  return v_n;
end $$;

create or replace function book.admin_list_campaigns(p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, type text, title text, body text, data jsonb, target jsonb, recipient_count integer,
               scheduled_at timestamptz, cancelled_at timestamptz, created_at timestamptz, actor_name text,
               pending integer, processing integer, sent integer, failed integer, read integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query
  select c.id, c.type, c.title, c.body, c.data, c.target, c.recipient_count, c.scheduled_at, c.cancelled_at, c.created_at,
         u.raw_user_meta_data->>'name',
         count(n.*) filter (where n.status='pending')::int, count(n.*) filter (where n.status='processing')::int,
         count(n.*) filter (where n.status='sent')::int, count(n.*) filter (where n.status='failed')::int,
         count(n.*) filter (where n.read_at is not null)::int
  from book.notification_campaigns c
  left join auth.users u on u.id = c.actor
  left join book.notifications n on n.campaign_id = c.id
  where c.tenant_id = v_tenant
  group by c.id, u.raw_user_meta_data order by c.created_at desc limit p_limit offset p_offset;
end $$;

create or replace function book.admin_campaign_detail(p_campaign_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return jsonb_build_object(
    'failed_members', (select coalesce(jsonb_agg(jsonb_build_object('member_code', m.member_code, 'name', g.name)), '[]'::jsonb)
                       from book.notifications n join book.members m on m.user_id = n.member_user_id
                       left join core.guests g on g.id = m.guest_id
                       where n.campaign_id = p_campaign_id and n.status = 'failed'),
    'devices_pushed', (select count(*) from book.notification_deliveries d join book.notifications n on n.id = d.notification_id where n.campaign_id = p_campaign_id),
    'devices_ok',     (select count(*) from book.notification_deliveries d join book.notifications n on n.id = d.notification_id where n.campaign_id = p_campaign_id and d.status in ('queued','ok')),
    'device_errors',  (select coalesce(jsonb_agg(jsonb_build_object('member_code', m.member_code, 'platform', dt.platform, 'device_name', dt.device_name, 'error_code', d.error_code)), '[]'::jsonb)
                       from book.notification_deliveries d
                       join book.notifications n on n.id = d.notification_id
                       join book.device_tokens dt on dt.id = d.device_token_id
                       join book.members m on m.user_id = dt.member_user_id
                       where n.campaign_id = p_campaign_id and d.status = 'error')
  );
end $$;

create or replace function book.admin_auto_notification_stats(p_days integer default 30)
returns table (day date, type text, queued integer, sent integer, failed integer, read integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query
  select (n.created_at at time zone 'Asia/Tokyo')::date, n.type, count(*)::int,
         count(*) filter (where n.status='sent')::int, count(*) filter (where n.status='failed')::int,
         count(*) filter (where n.read_at is not null)::int
  from book.notifications n
  where n.tenant_id = v_tenant and n.campaign_id is null and n.type in ('reminder','thanks')
    and n.created_at >= now() - make_interval(days => p_days)
  group by 1, 2 order by 1 desc, 2;
end $$;

create or replace function book.admin_notification_queue_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return (select jsonb_build_object(
    'pending',    count(*) filter (where status='pending'),
    'processing', count(*) filter (where status='processing'),
    'failed_1h',  count(*) filter (where status='failed' and created_at >= now() - interval '1 hour'),
    'last_sent_at', max(sent_at), 'last_claimed_at', max(claimed_at),
    'stuck', coalesce(bool_or(status='pending' and scheduled_at < now() - interval '10 minutes'), false)
          or coalesce(bool_or(status='processing' and claimed_at < now() - interval '10 minutes'), false))
  from book.notifications where tenant_id = v_tenant);
end $$;

-- ---- 4. 好みカタログ --------------------------------------------------------
create policy preference_catalog_staff_select on book.preference_catalog
  for select to authenticated
  using (exists (select 1 from core.memberships ms where ms.user_id = auth.uid()));

create or replace function book.admin_upsert_preference_item(
  p_key text, p_label text, p_group_name text, p_value_type text, p_options jsonb, p_sort_order integer, p_is_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_old book.preference_catalog; v_answers integer; v_opt jsonb; v_val text;
begin
  perform book._require_admin(v_tenant);
  if p_key !~ '^[a-z][a-z0-9_]{1,31}$' or coalesce(trim(p_label),'') = ''
     or p_group_name not in ('meal','room','personal')
     or p_value_type not in ('single','multi','text','boolean','date') then raise exception 'invalid_params'; end if;
  v_opt := case when p_value_type in ('single','multi') then coalesce(p_options,'[]'::jsonb) else '[]'::jsonb end;
  if p_value_type in ('single','multi') then
    if jsonb_typeof(v_opt) <> 'array' or jsonb_array_length(v_opt) = 0 then raise exception 'invalid_params'; end if;
    if (select count(distinct o->>'value') from jsonb_array_elements(v_opt) o) <> jsonb_array_length(v_opt)
       or exists (select 1 from jsonb_array_elements(v_opt) o where coalesce(o->>'value','') = '' or coalesce(o->>'label','') = '')
    then raise exception 'invalid_params'; end if;
  end if;

  select * into v_old from book.preference_catalog where key = p_key;
  if not found then
    insert into book.preference_catalog (key, label, group_name, value_type, options, sort_order, is_active)
    values (p_key, p_label, p_group_name, p_value_type, v_opt, coalesce(p_sort_order,0), coalesce(p_is_active,true));
    insert into book.admin_audit_logs (tenant_id, actor, action, detail)
    values (v_tenant, auth.uid(), 'preference_create', jsonb_build_object('key', p_key, 'label', p_label));
    return;
  end if;

  select count(*) into v_answers from book.member_preferences where pref_key = p_key;
  if v_answers > 0 and v_old.value_type <> p_value_type then raise exception 'type_in_use'; end if;
  -- 使用中の選択肢を落とそうとしていないか（single: value = "v" / multi: value ? "v"）
  if v_answers > 0 and p_value_type in ('single','multi') then
    for v_val in select o->>'value' from jsonb_array_elements(v_old.options) o
                 where not exists (select 1 from jsonb_array_elements(v_opt) n where n->>'value' = o->>'value') loop
      if exists (select 1 from book.member_preferences mp where mp.pref_key = p_key
                   and ((p_value_type = 'single' and mp.value = to_jsonb(v_val)) or (p_value_type = 'multi' and mp.value ? v_val)))
      then raise exception 'option_in_use:%', v_val; end if;
    end loop;
  end if;

  update book.preference_catalog set label = p_label, group_name = p_group_name, value_type = p_value_type,
    options = v_opt, sort_order = coalesce(p_sort_order, sort_order), is_active = coalesce(p_is_active, is_active)
  where key = p_key;
  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid(), case when coalesce(p_is_active,true) then 'preference_update' else 'preference_deactivate' end,
          jsonb_build_object('key', p_key, 'label', p_label, 'answers', v_answers));
end $$;

create or replace function book.admin_preference_usage()
returns table (key text, answers integer, option_counts jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query
  select c.key, count(mp.*)::int,
         coalesce((select jsonb_object_agg(o->>'value',
                     (select count(*) from book.member_preferences x where x.pref_key = c.key
                        and ((c.value_type='single' and x.value = to_jsonb(o->>'value')) or (c.value_type='multi' and x.value ? (o->>'value')))))
                   from jsonb_array_elements(c.options) o), '{}'::jsonb)
  from book.preference_catalog c left join book.member_preferences mp on mp.pref_key = c.key
  group by c.key, c.value_type, c.options;
end $$;

-- ---- 5. ダッシュボード --------------------------------------------------------
create or replace function book.admin_app_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_direct uuid;
begin
  perform book._require_staff(v_tenant);
  select id into v_direct from booking.channels where tenant_id = v_tenant and code = 'autumn_booking';
  return jsonb_build_object(
    'generated_at', now(),
    'members', (select jsonb_build_object(
        'total', count(*), 'active', count(*) filter (where withdrawn_at is null),
        'joined_this_month', count(*) filter (where withdrawn_at is null and joined_at >= date_trunc('month', now() at time zone 'Asia/Tokyo')),
        'push_opt_in', count(*) filter (where withdrawn_at is null and push_opt_in),
        'push_capable', (select count(distinct dt.member_user_id) from book.device_tokens dt join book.members mm on mm.user_id = dt.member_user_id
                         where dt.is_active and mm.push_opt_in and mm.withdrawn_at is null),
        'devices_active', (select count(*) from book.device_tokens where is_active))
      from book.members where tenant_id = v_tenant),
    'bookings', (select jsonb_build_object(
        'last30_count', count(*), 'last30_amount', coalesce(sum(total_amount),0),
        'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
                  from (select (b.created_at at time zone 'Asia/Tokyo')::date d, count(*) c from booking.bookings b
                        where b.channel_id = v_direct and b.created_at >= now() - interval '30 days' group by 1) x))
      from booking.bookings b where b.channel_id = v_direct and b.created_at >= now() - interval '30 days' and b.status <> 'cancelled'),
    'notifications', (select jsonb_build_object(
        'last7_sent', count(*) filter (where status='sent'), 'last7_failed', count(*) filter (where status='failed'),
        'last7_read_rate', coalesce(round(100.0 * count(*) filter (where read_at is not null) / nullif(count(*) filter (where status='sent'),0)),0),
        'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
                  from (select (created_at at time zone 'Asia/Tokyo')::date d, count(*) c from book.notifications
                        where created_at >= now() - interval '30 days' group by 1) x),
        'queue', book.admin_notification_queue_status(),
        'today_auto', (select jsonb_build_object('reminder', count(*) filter (where type='reminder'), 'thanks', count(*) filter (where type='thanks'))
                       from book.notifications where campaign_id is null and (created_at at time zone 'Asia/Tokyo')::date = (now() at time zone 'Asia/Tokyo')::date))
      from book.notifications where created_at >= now() - interval '7 days'),
    'coupons', (select jsonb_build_object(
        'active', count(distinct c.id) filter (where c.is_active and c.valid_until >= current_date),
        'issued', count(mc.*) filter (where mc.status in ('issued','used')), 'used', count(mc.*) filter (where mc.status='used'),
        'expiring_7d_unused', count(distinct c.id) filter (where c.is_active and c.valid_until between current_date and current_date + 7 and mc.status='issued'))
      from book.coupons c left join book.member_coupons mc on mc.coupon_id = c.id where c.tenant_id = v_tenant),
    'facilities', (select coalesce(jsonb_agg(jsonb_build_object(
        'facility_id', f.id, 'slug', f.slug, 'name', f.name,
        'plans_total',       (select count(*) from book.plan_contents pc where pc.facility_id=f.id),
        'plans_published',   (select count(*) from book.plan_contents pc where pc.facility_id=f.id and pc.is_published),
        'plans_with_photos', (select count(*) from book.plan_contents pc where pc.facility_id=f.id and jsonb_array_length(coalesce(pc.photos,'[]'::jsonb))>0),
        'rooms_total',       (select count(*) from book.room_type_contents rc where rc.facility_id=f.id),
        'rooms_published',   (select count(*) from book.room_type_contents rc where rc.facility_id=f.id and rc.is_published),
        'rooms_with_photos', (select count(*) from book.room_type_contents rc where rc.facility_id=f.id and jsonb_array_length(coalesce(rc.photos,'[]'::jsonb))>0),
        'plans_no_policy',   (select count(*) from booking.rate_plans rp where rp.facility_id=f.id and rp.is_active
                                and (rp.cancellation_policy is null or rp.cancellation_policy::text in ('[]','{}','{"rules": []}'))),
        'options_active',    (select count(*) from book.option_items oi where oi.facility_id=f.id and oi.is_active),
        'news_published',    (select count(*) from book.news_posts n where n.facility_id=f.id and n.is_published)
      ) order by f.slug), '[]'::jsonb) from core.facilities f where f.tenant_id = v_tenant and f.is_active),
    'rank_policy_ok', (select jsonb_array_length(coalesce(rules,'[]'::jsonb)) > 0 from book.rank_cancel_policies where rank_code='standard'),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('created_at', l.created_at, 'action', l.action, 'detail', l.detail,
                                                           'actor_name', u.raw_user_meta_data->>'name') order by l.created_at desc), '[]'::jsonb)
              from (select * from book.admin_audit_logs where tenant_id = v_tenant order by created_at desc limit 10) l
              left join auth.users u on u.id = l.actor)
  );
end $$;

-- ---- GRANT（全 RPC 共通） ------------------------------------------------------
do $$ declare r record; begin
  for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'book' and p.proname like 'admin\_%' loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
```

実装時の確認事項（migration を書く人へ）:

- `booking.bookings` に予約番号（`YB-…`）列は無い。`admin_list_member_coupons` の `booking_code` は `confirm_booking` が `metadata` に入れているキー名を `pg_get_functiondef` で確認して合わせる（無ければ `external_booking_id` か `id` 短縮）。
- `core.stays.status` の値（`reserved` / `checked_in` / `checked_out`）は `enqueue_stay_notifications` と同じ前提。PMS 側の実値を `select distinct status from core.stays` で確認。
- `auth.users` を SECURITY DEFINER から参照するのは既存 `register_member` 等と同じ。関数 owner が `postgres` であること（migration は postgres で流れるので通常問題なし）。

---

## 6. データ層の扱い（demo / supabase 二本立てへの乗せ方）

### 6.1 判断: 新規画面は実データ専用にする

| 選択肢 | 評価 |
|---|---|
| A. `store.ts` にクーポン／通知／好みのデモ実装も作る | 不採用。デモ会員は `user_id` も `device_tokens` も持たず、通知は「送った体」にしかならない。**この画面群の目的は実アプリの運用状態を見ることであり、デモで動いても価値が無い**。`store.ts`（1,933 行）と `supabase-data.ts`（2,263 行）をさらに太らせる |
| B. 実データ専用。非本番環境ではパネル表示 | **採用**。`/admin/community` のモデレーション無効化・`/admin/inroom` の `useSupabaseAdmin` と同じ既存流儀。ローカルで実データを触りたいときは `.env` を `DATA_SOURCE=supabase` `AUTH_MODE=supabase` にして実管理者でログインする（本番 wrangler.jsonc は既に両方 supabase） |

### 6.2 実装

- `auth.ts` に追加:
  ```ts
  // 管理面を Supabase 実データ＋実認証で動かすか。新規のアプリ運用画面（/admin/app, push, coupons, preferences）はこれが false のとき無効化する。
  export const ADMIN_SUPABASE: boolean = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';
  ```
  `admin/inroom/+page.server.ts` の `useSupabaseAdmin` は据え置きでよい（置換は任意）。
- 新モジュール `src/lib/server/admin-app-data.ts`（`supabase-data.ts` には足さない）:
  - `bookAdmin(event)` = `createSupabaseServerClient(event).schema('book')` を返すヘルパー。
  - 各 RPC の薄いラッパ（`adminListCoupons(client)`, `adminUpsertCoupon(client, input)`, `adminSendNotification(client, input)`, `adminAppDashboard(client)` …）。RPC の snake_case 行をそのまま `*Row` 型で返し、camelCase 変換は route 側（forum/otayori と同じ流儀）。
  - `mapRpcError(e: unknown): string`（§3 冒頭の表）。
  - `buildAppAlerts(d: AppDashboard): Alert[]`（§4.4）。
- 各 `+page.server.ts` の冒頭:
  ```ts
  export const load: PageServerLoad = async (event) => {
    const { currentFacility } = await event.parent();
    if (!ADMIN_SUPABASE) return { unavailable: true as const, authMode: AUTH_MODE, dataSource: DATA_SOURCE };
    const client = bookAdmin(event);
    …
  };
  ```
  action も同様に最初で `if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）' });`。

### 6.3 `DATA_SOURCE=demo` のときの画面

```
┌ この画面は本番データ専用です ──────────────────────────────────────────────┐
│ アプリ運用（クーポン・通知・好み登録項目・ダッシュボード）は Supabase の実データと │
│ 実認証が必要です。現在: DATA_SOURCE=demo / AUTH_MODE=demo                     │
│ ローカルで使うには .env を DATA_SOURCE=supabase / AUTH_MODE=supabase にして、     │
│ 管理者アカウント（app_metadata.role=admin ＋ core.memberships tenant_admin）で     │
│ ログインし直してください。                                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

`bg-amber-50 border-amber-200 text-amber-800` のカード 1 枚。サイドバーの項目自体は隠さない（存在を知らせる）。

### 6.4 既存 demo 画面との整合

- `/admin/news` の「アプリに通知する」リンクは `ADMIN_SUPABASE` のときだけ描画。
- `/admin/members` の実データ化（§3.5）は `ADMIN_SUPABASE ? RPC : store` の分岐（news と同じ二本立て）。**これだけは既存画面なので二本立てを維持**する。

---

## 7. 権限と監査

### 7.1 二層の権限

| 層 | 判定 | admin | staff |
|---|---|---|---|
| アプリ（`locals.user.role`・`app_metadata.role`） | 画面のボタン表示・action の入口 | 全操作 | 閲覧のみ（一覧・統計・履歴・カタログ）。書き込み action は `fail(403)` |
| DB（`core.memberships`） | RPC 内 `_require_admin` = `is_tenant_admin or is_superadmin` ／ `_require_staff` = `has_tenant_access` | `tenant_admin` 行が必要 | `shared_login` 等どの role でも可（読み取り RPC） |

現状 `/admin` にログインできるのは `hikaru.s@yamado.co.jp` のみで、両方の条件を満たしている。**新しい管理者を増やすときは両方を設定する**（`app_metadata.role='admin'` を Supabase Dashboard で、`core.memberships (user_id, tenant_id, facility_id=null, role='tenant_admin')` を SQL で）。片方だけだと「ボタンは押せるが `forbidden`」になるので、`mapRpcError` の文言で memberships の不足を明示する（§3 表）。

### 7.2 staff に許さないもの（確定）

| 操作 | staff |
|---|---|
| 通知のテスト送信・一斉配信・予約取消 | ❌（テスト送信も不可。全会員送信と同じ RPC を使うため、宛先の取り違えを防ぐ） |
| クーポン作成・編集・無効化・配布・配布取消 | ❌ |
| 好み項目の追加・編集・非表示 | ❌ |
| 上記すべての閲覧・統計・履歴・ダッシュボード | ✅ |
| 会員一覧のメールアドレス | ❌（RPC が null を返す。既存の連絡先マスクと同じ） |

### 7.3 監査ログ（`book.admin_audit_logs`）

- **書き込み RPC は必ず内部で記帳**する（アプリ側で別途 insert しない）。`actor = auth.uid()`。`facility_id` はクーポン作成時のみ入れる（他はテナント横断で null）。
- action 一覧（新規）: `coupon_create` / `coupon_update` / `coupon_activate` / `coupon_deactivate` / `revoke_member_coupons` / `send_notification` / `cancel_campaign` / `preference_create` / `preference_update` / `preference_deactivate`。既存: `issue_coupon`。
- `detail` には**件数と識別子**を入れ、本文全文は入れない（title は入れる・body は入れない）。
- 閲覧: `/admin/app` の「最近の管理操作」（直近 10 件）。全件閲覧画面は作らない（Supabase Studio で足りる）。
- 読み取り RPC は記帳しない（既存の news/faqs と同じ）。

---

## 8. 実装順序（各ステップで動く状態になる）

| Step | 内容 | 動く状態 | 版 |
|---|---|---|---|
| 0 | autumn-shared に §5 の migration を作成 → main push → `supabase migration list --linked` で確認。Studio の SQL Editor で `select book.admin_app_dashboard();` を管理者で実行し jsonb が返ることを確認 | DB 側完成 | autumn-shared |
| 1 | `auth.ts` に `ADMIN_SUPABASE`、`admin-app-data.ts` の骨格（`bookAdmin` / `mapRpcError` / 型）、`+layout.svelte` のグループ化と `tenantWide` 施設セレクト非表示、4 ルートに §6.3 パネルだけの stub を置く | サイドバー再編済み・新規 4 項目は「準備中」パネル | v0.10.0 |
| 2 | `/admin/app`（読み取りのみ）: `admin_app_dashboard` → KPI カード・アラート・運用チェック表・監査 tail・Sparkline | 「公開プラン 1/29」等が本番で見える | v0.10.1 |
| 3 | `/admin/preferences`: 一覧・追加・保存・非表示（最も小さい CRUD で RPC 呼び出し・エラーマップ・staff 制御の型を確立） | 好み項目を管理画面から編集できる | v0.11.0 |
| 4 | `/admin/coupons`: 一覧 → 新規・編集 → 無効化 → 配布（対象抽出・二段確認）→ 配布先一覧・取消 | クーポン運用が一通り回る | v0.12.0 |
| 5 | `/admin/push`: キュー状態・一覧・自動通知タブ → 新規（テスト送信 → 本番送信）→ 詳細 → 予約配信・取消 | 通知運用が一通り回る | v0.13.0 |
| 6 | 既存画面追記: `/admin/news` の「アプリに通知する」、`/admin/members` 実データ化＋詳細タブ、`/admin/plans` の公開バッジ | 画面間の導線が閉じる | v0.13.1 |
| 7 | `HANDOFF.md` に §9 のチェックリストを追記、作業ログ、`package.json` version bump、コミット `feat: アプリ運用管理画面（/admin/app・push・coupons・preferences）とメニュー再編 (v0.13.1)` | リリース可能 | — |

各ステップの `svelte-check`（`pnpm --filter @autumn-book/web check`）をグリーンで進める。Step 2 が終わった時点で一度デプロイし、本番で実測値（§0.3）と一致することを確認してから Step 3 以降へ進む（ダッシュボードの数字が合わなければ RPC の集計式を先に直す）。

### 8.1 触るファイル一覧

```
autumn-shared/supabase/migrations/<UTC秒>_book_admin_app_ops.sql        新規（§5）
apps/web/src/lib/server/auth.ts                                          ADMIN_SUPABASE 追加
apps/web/src/lib/server/admin-app-data.ts                                新規
apps/web/src/lib/components/admin/{StatCard,Sparkline,ConfirmPanel,MemberPicker}.svelte  新規
apps/web/src/routes/admin/+layout.svelte                                 nav グループ化・施設セレクト制御
apps/web/src/routes/admin/+layout.server.ts                              authMode / dataSource を返す
apps/web/src/routes/admin/app/+page.server.ts, +page.svelte              新規
apps/web/src/routes/admin/push/+page.server.ts, +page.svelte             新規
apps/web/src/routes/admin/push/new/+page.server.ts, +page.svelte         新規
apps/web/src/routes/admin/push/[id]/+page.server.ts, +page.svelte        新規
apps/web/src/routes/admin/coupons/+page.server.ts, +page.svelte          新規
apps/web/src/routes/admin/coupons/new/+page.server.ts, +page.svelte      新規
apps/web/src/routes/admin/coupons/[id]/+page.server.ts, +page.svelte     新規
apps/web/src/routes/admin/preferences/+page.server.ts, +page.svelte      新規
apps/web/src/routes/admin/api/members/+server.ts                         新規（MemberPicker 用 GET・admin_list_members）
apps/web/src/routes/admin/news/+page.svelte                              「アプリに通知する」リンク
apps/web/src/routes/admin/members/+page.server.ts, [id]/+page.server.ts, [id]/+page.svelte  実データ化・タブ
HANDOFF.md, apps/web/package.json                                        チェックリスト・版
```

---

## 9. 手動テストチェックリスト（HANDOFF.md へ転記する）

```markdown
### アプリ運用管理画面（/admin/app・push・coupons・preferences）

※前提: 本番（DATA_SOURCE=supabase / AUTH_MODE=supabase）に管理者でログイン。
※**本番会員に誤送信しないための手順（必ず守る）**
  1. 通知・クーポン配布のテストは、必ず「テスト送信」または「個別選択」で **@yamado.co.jp の社内会員のみ**を宛先にする
  2. 「全会員」宛の送信テストは、/admin/app の会員数が**社内アカウントのみ**（2026-09-07 時点 1 名）であることを確認した上で 1 回だけ行う。一般会員が 1 名でも登録された後は全会員宛のテストを行わない
  3. 予約配信のテストは scheduled_at を 10 分以上先にし、送信前に「取消」して待機件数が 0 になることを確認する（取消できない即時配信でテストしない）
  4. テストで作った campaign（target.mode='test'）は削除せず履歴に残してよい
  5. テストで作ったクーポンはテスト後に「無効化」する（削除機能は無い）

#### ナビゲーション
- [ ] サイドバーが 4 グループ（宿泊・直販／アプリ・会員／サイト・コンテンツ／システム）に分かれ、既存 17 ルートの URL が変わっていない
- [ ] モバイル幅の select に optgroup で同じ構造が出る
- [ ] アプリ運用・アプリ通知・クーポン・好み登録項目・会員・コミュニティ・おたより・キャンセル規定・メンテナンスを開くと施設セレクトが「全施設共通」表示になり、プラン等に戻すとセレクトが戻る
- [ ] ローカル demo（DATA_SOURCE=demo）で新規 4 画面が「本番データ専用」パネルになりエラーにならない

#### アプリ運用ダッシュボード（/admin/app）
- [ ] 会員数・push 受信可能・アプリ予約 30 日・通知 7 日の 4 カードが表示され、値が Studio の SQL（設計書 §4.5）と一致する
- [ ] 運用チェック表に施設 2 行が出て、公開プラン「1/29」「1/13」・写真「0/29」「0/13」が赤で表示される（2026-09-07 時点）
- [ ] アラートが error → warn → info の順で並び、各行のリンクで該当画面（施設切替込み）に飛べる
- [ ] プランを 1 件公開して戻ると公開数が増える
- [ ] 端末 0 台のとき「push を受け取れる端末が 0 台」の warn が出る
- [ ] 最近の管理操作に issue_coupon / send_notification 等が実行者名付きで出る
- [ ] スタッフロールでも閲覧できる

#### 好み登録項目（/admin/preferences）
- [ ] 10 項目がグループ別に表示され、回答件数が出る
- [ ] 新規項目（key: test_item・択一・選択肢 2 つ）を追加 → アプリの好み登録画面に表示される
- [ ] key に大文字・記号を入れると拒否される／既存 key と重複すると「既に使われています」
- [ ] 回答がある項目の形式 select が disabled で「回答ありのため変更不可」が出る
- [ ] 回答で使われている選択肢の [×] が押せず、使われていない選択肢は削除して保存できる
- [ ] 「表示」を外して保存 → アプリから消える／再度チェック → 戻る。回答は消えていない
- [ ] スタッフロールではフォームが表示されず閲覧のみ

#### クーポン（/admin/coupons）
- [ ] 新規作成（金額 1,000 円・全施設・利用期間 今日〜30 日後）→ 詳細へ遷移し一覧に「有効」で出る
- [ ] 割合 101%／valid_until < valid_from／stay_until < stay_from が拒否される
- [ ] 「個別選択」で社内会員 1 名を選び「対象を数える」→ 件数と氏名が出る → 二段確認 → 配布 → アプリのクーポン一覧に「ご利用可能」で出て通知「クーポンが届きました」が届く
- [ ] 同じ会員にもう一度配布しても新規配布 0 名（重複しない）
- [ ] 配布後、編集画面で割引額・施設・宿泊日が disabled になり「配布済みのため変更できません」が出る。名前・利用期間延長は保存できる
- [ ] 配布先一覧で「配布を取り消す」→ 状態が「取消」になりアプリから消える
- [ ] アプリで予約確定にクーポンを使う → 配布先一覧が「使用済」・予約番号付きになり、使用率が更新される
- [ ] 「無効化」→ 二段確認 → アプリの「ご利用可能」から消える。再有効化で戻る
- [ ] 全会員かつ 50 名以上のときは件数入力が一致しないと配布ボタンが有効にならない（会員 50 名未満の間は該当なし・実装をコードレビューで確認）
- [ ] 期限 7 日以内で未使用があるクーポンが一覧で ⚠ 表示される
- [ ] スタッフロールでは作成・配布・取消のボタンが出ない

#### アプリ通知（/admin/push）
- [ ] 配信キューが「待機 0／処理中 0／正常」で、最終送信時刻が出る
- [ ] 新規: タイトル空・本文 201 字・タップ先「https://…」がクライアントとサーバーで拒否される
- [ ] テスト送信前は「内容を確認する」が押せない
- [ ] 社内会員をテスト受信者に選んでテスト送信 → 2 分以内に実機に push が届き、タップで data.url の画面が開く。一覧に「[テスト]」行が出る
- [ ] テスト送信後にタイトルを変えると再度テスト送信が必要になる
- [ ] 全会員（社内アカウントのみのとき・手順 2 に従う）で「内容を確認する」→ 件数入力が一致するまで送信ボタンが無効 → 送信 → 詳細で送信済件数＝宛先数、push 端末数が出る
- [ ] push_opt_in=false の会員宛は「送信済」だが端末送出数に含まれず、アプリの通知センターには載る
- [ ] 予約配信（10 分後）を作成 → 一覧に「予約済」＋[取消] → 取消 → 待機 0 件・状態「取消」。取消後にアプリへ届かない
- [ ] 予約配信の時刻を過ぎて送信された後に取消を押すと「既に送信処理に入っている」エラーになる
- [ ] 自動通知タブに reminder / thanks の日別集計が出る（実予約があれば JST 10 時台に件数が増える）
- [ ] /admin/news の公開記事から「アプリに通知する」→ 種別 news・タイトル・タップ先 /news/<id> がプリフィルされる
- [ ] 同じフォームを二重送信（ダブルクリック）しても campaign が 1 件しか作られない
- [ ] スタッフロールではテスト送信も本番送信もできない
- [ ] pg_cron を一時停止した状態（ユーザー立会いのみ）で 10 分経つとキューが「滞留」赤帯になる

#### 会員（既存画面の追記）
- [ ] /admin/members が本番で実会員を表示する（demo 会員が出ない）
- [ ] 会員詳細に「クーポン」「通知」「端末」「好み」タブが出て、それぞれ配布状況・通知履歴・端末（platform／device_name・トークン非表示）・回答が見える
- [ ] スタッフロールではメールアドレスが表示されない

#### DB・権限
- [ ] app_metadata.role=admin だが core.memberships に tenant_admin が無いアカウントで書き込みを試すと「管理者権限（core.memberships の tenant_admin）が必要です」が出る
- [ ] 上記操作がすべて book.admin_audit_logs に actor 付きで記録される
- [ ] `select * from book.coupons` を shared_login 会員の JWT で実行すると select はでき、insert は permission denied になる（policy 絞り込みの確認）
```

---

## 10. 未決事項（実装中にユーザー判断が必要になり得るもの）

1. **クーポン配布時の通知文言**: 既存 `issue_coupon` が固定文言「クーポンが届きました」＋ coupon.name を積む。文言を変えたいなら RPC 改修（本書の範囲外・現状維持を推奨）。
2. **予約番号の格納先**: `booking.bookings` に `YB-` コード列が無い。`confirm_booking` の実装を見て `admin_list_member_coupons` の JOIN を決める（§5.5 末尾）。
3. **好み登録の `group_name` 追加**: 現状 check 制約で `meal/room/personal` 固定。増やすなら制約変更の migration（アプリ側の見出しも固定文字列）。本書では固定のまま。
4. **通知の宛先セグメントの拡張**（宿泊実績・施設別）: `admin_list_members` は対応済みだが `/admin/push/new` の UI には「全会員／ランク／個別」のみ載せた。必要になったらクーポン画面の「宿泊実績」ラジオを移植する。
5. **多言語通知**: `members.locale` があるが本書は日本語固定（アプリも v1 日本語のみ）。
