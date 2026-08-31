# 貸切風呂 予約システム 設計（アプリ3）

> **ステータス**: 設計レビュー済み・未決事項あり（2026-08-31）
> **位置づけ**: `autumn_book_design.md` §15.2「オプションサービス予約」のうち **時間枠型（貸切風呂）** を実装方式まで具体化したもの。
> `autumn_book_post_booking_design.md` が「時間枠予約はスコープ外（アプリ3・貸切風呂予約システムの領域）」と切り出した、その本体。
> **本書はレビュー結果であり、未決事項（§3）が埋まるまで着手しない。**

---

## 0. 要件（オーナー指示・2026-08-31）

1. PMS と連動し、**PMS での設定を SoT** とする。
2. **公開 URL に予約者を特定する一意のパラメータ**を付ける。
3. 公開 URL は **PMS が部屋ごとに出力する館内図に QR コードで印字**し、お客様がスキャンして開く。
   パラメータ付きなので、**枠を選んで確定するだけでどの部屋の予約か決まる**。
4. **再度同じ QR をスキャンすると、予約した時間を確認できる。**
5. **1部屋につき1時間帯1枠など、取得できる枠数に制限をかけられる。**
6. **PMS の貸切風呂メニューから、部屋ごとのその日の予約を確認できる。**
7. 男鹿は**公式サイト以外の予約は有料**のため、**予約を確認したら PMS の該当予約に利用料の明細を自動追加する。**
8. 会員マイページの予約詳細・事前チェックインフォームからも入力できるようにする（後段）。
9. **まず公開 URL だけで単体運用できるようにしたい。**

---

## 1. 総評

設計案は**成立する**。ただし要件9「PMS 連携なしの単体運用」は要件3「館内図 QR が配布経路」と**論理的に両立しない** ──
館内図は PMS が日付 × 部屋で刷る紙であり、QR に載せるトークンの発行は PMS の印刷時に起きるしかない。

**単体運用の定義を置き直す**:

> 段階1 ＝ **PMS の関与は「トークンの発行」「館内図への QR 印字」「閲覧画面」の3つだけ**。
> 会員・事前チェックイン・自動課金・自動失効なしで回す。

この切り方なら、段階1で作る RPC・列・画面が段階2/3 の土台になり、**捨てるものが無い**。

変えるべき前提は3つ:

1. ゲスト予約の書き込みは**最初から `pms.private_bath_slots` へ**（book 側に台帳を作らない）。
2. 現行の read-then-insert（`savePrivateBath`）は公開に耐えないので **RPC 化**する。
3. `bath_id` null 混在と、販売条件（締切・料金・休止日）の欠如を**先に潰す**。

トークンは**既存 `/r/c/[token]` → httpOnly Cookie 交換方式の再利用が正解**。新方式は作らない。

---

## 2. 重大な指摘

### Blocker

#### B1. read-then-insert は公開導線に耐えない。RPC（SECURITY DEFINER・単一トランザクション）必須

- 先約確認（`autumn-pms/sveltekit/src/routes/reservations/[id]/+page.server.ts:2208-2233`）と
  `perRoomPerRange` の上限判定（同 `:2235-2252`）は**アプリ層の読み→書き**で、トランザクションも行ロックも無い。
- さらに **`time_from` が生成枠に含まれるかの検証が無い**（同 `:2196-2201` は日付の正規表現と from 非空しか見ない）。
  滞在期間内かの検証も無い。**公開経路では任意の時刻文字列で台帳を汚せる。**
- スタッフ2人の競合は、同一枠なら一意インデックス
  `private_bath_slots_natural_key`（`autumn-shared/supabase/migrations/20260731011401_pms_fm_extras_idempotency_keys.sql:44-45`）が最後に止める。
  だが **`perRoomPerRange` の上限はインデックスでは守れない**（行の一意性ではなく集計条件のため）。
  ゲストが直接叩く経路では、二重タップ・家族の複数端末・悪意の再送で普通に破れる。
- **結論: RPC 化する。** 同型の前例が既にある ── `book.add_booking_options`
  （`autumn-shared/supabase/migrations/20260711070733_book_option_items.sql:162-`）は SECURITY DEFINER で
  `core.stays` / `booking.bookings` を `for update` でロックし、締切・在庫・本人性を1トランザクションで検証している。
  貸切風呂はこれに **`pg_advisory_xact_lock`（施設 × 日 × 浴室）** を足し、
  枠の妥当性・滞在期間内か・上限・締切を検証してから insert、**一意インデックスを最終防衛線**にする。

#### B2. `bath_id` の null 混在で一意制約が実質効いていない（現行でも二重予約が通る）

本番 DB 実測:

| 項目 | 値 |
|---|---|
| `pms.private_bath_slots` 総行数 | **2,050**（男鹿 1,575 / 西和賀 475） |
| `bath_id` が null | **2,048** |
| `stay_id` が null | **2,048** |
| `pms.facility_baths` | 西和賀「一寸」1件 / **男鹿 0件** |

自然キーは `(facility_id, bath_date, time_from, bath_id) NULLS NOT DISTINCT` だが、
**null と「一寸」の id は別の値**なので、同じ日・同じ時刻に
「`bath_id=null` の行（FM 取込・旧運用）」と「`bath_id=一寸` の行（モーダル経由）」が**併存できる**。
アプリ層の先約確認も同じ比較（`+page.server.ts:2225-2229` の `(r.bath_id ?? null) === bathId`）なので止めない。
モーダルは浴室未選択なら null で保存する（`PrivateBathModal.svelte` の `bathId = $state('')`）。

**公開販売の前提作業**: 男鹿の浴室マスタ登録 → 既存行の `bath_id` バックフィル → 以後 RPC は必ず正規の `bath_id` で書く。
これをやらないと、**ゲストの空き表示とフロントの台帳が同じ時刻で食い違う。**

#### B3. 台帳を book 側に新設してはならない

`pms.private_bath_slots` はカレンダーの機能パネル（`autumn-pms/sveltekit/src/routes/api/calendar-panels/+server.ts:223-`）・
予約詳細・印刷帳票が読む**現場の台帳**。ゲスト予約を book 側の別テーブルに書くと、**フロントから見えない予約**が発生する。
`autumn_book_design.md` §15.2 も「PMS 実テーブルを在庫の正とする（二重管理しない）」と明記済み。

**ゲスト予約 RPC は book スキーマに置くが、書き込み先は最初から `pms.private_bath_slots`。**
これが「単体運用フェーズで作ったものを捨てない」ための最重要決定。

#### B4. 販売条件の概念が設定モデルに無い

現行設定は `ranges / slotMin / intervalMin / perRoomPerRange` のみ
（`autumn-pms/sveltekit/src/lib/bath-slots.ts:35-49`、保存先は
`pms.facility_billing_settings.metadata.private_bath` ＝ `autumn-pms/sveltekit/src/lib/server/bath-settings.ts:29-45`）。

欠けているもの:

| 概念 | 現状 |
|---|---|
| 受付開始（予約確定後すぐ / N日前から） | 無い。`autumn_book_design.md:509` でも未決のまま |
| 締切（当日何時まで・何分前まで） | 無い |
| 休止日・点検日 | `pms.private_bath_days.is_open` が DDL 上存在（`20260610090500_pms_operations.sql:148-159`）するが、**PMS コードから一切参照されず本番 0 行**の死んだ定義 |
| 料金 | **`private_bath_slots` に価格列が無い** |
| 販売可否（この浴室を公開販売するか） | 無い |
| キャンセル規定 | 無い |
| 多言語 | pms マスタに i18n 無し |

とくに**料金**が深刻。男鹿には「**公式サイト予約なら無料 / それ以外 2,200円**」を館内図裏面で刷り分ける運用が既にある
（`autumn-pms/sveltekit/src/lib/facility-map-channel.test.ts:6` のコメント、`MapChannelMode` ＝
`autumn-pms/sveltekit/src/lib/facility-map-template.ts:117-`、判定は `core.stays.channel_code`）。
**ゲストが自分で枠を取れるようになった瞬間、有料のお客様に金額を提示せず予約させることになる**。
フロントが課金対象と知る手段も台帳に無いので請求漏れも起きる。

---

### Major

#### M1. 8桁コードのレート制限が Workers の isolate メモリで、本番では実質機能しない

`claim` のロックは `autumn-book/apps/web/src/lib/server/store.ts:2910-2935` のプロセス内 `Map`。
Cloudflare Workers では isolate ごと・揮発（HANDOFF.md が同じ理由で「hold が isolate メモリに消える」と明記している環境）。
RPC `book.claim_stay_by_code` 自体は無制限（migration コメント「試行レート制限はアプリ層で実施」）。
**公開前に KV（既存 `AB_CONFIG` バインドの前例あり）か DB 側での計数に置き換える。**
なお 64hex トークン側の列挙耐性は十分。

#### M2. autumn-book はメンテナンスモードで `/r` も 503 になる

バイパスは `/admin` 配下と admin/staff ロールのみ（`autumn-book/apps/web/src/lib/server/maintenance.ts:93-99`）。
ポータル本体は未公開（HANDOFF.md 冒頭「メンテナンスモード解除の残条件」）。
貸切風呂を先行公開するなら **`/r` 配下のメンテ除外**が前提作業。

#### M3. `book.issue_stay_token` は毎回新規発行で、「刷り直しても同じ QR」が成立しない

`autumn-shared/supabase/migrations/20260710103006_book_inroom_phase1.sql` の `issue_stay_token` は常に insert。
館内図は前日・当日に何度も刷り直す紙なので、素直に呼ぶと**同一滞在に有効トークンが乱立**し、
部屋に残った旧紙と新紙で別トークンになる。

→ **stay_id 単位の get-or-create**（既存の未失効・期限内トークンを返し、無ければ発行）を追加する。

なお本番の `book.stay_access_tokens` は **0 行** ＝ インルームスリップ運用は未開始。
発行導線は book の `/admin/inroom` にあるが、実 adapter は `DATA_SOURCE=supabase && AUTH_MODE=supabase` の両立が条件
（`autumn-book/apps/web/src/routes/admin/inroom/+page.server.ts:26-29`、現状 AUTH_MODE=demo）。
**PMS 側から発行する導線を作るのが正**（`autumn_book_inroom_design.md` §9 P8b「issue_stay_token を PMS チェックインが呼ぶ」と同方針）。
PMS スタッフのセッションは同一 Supabase の authenticated なので、RPC 内の `has_facility_access` ガードをそのまま通る。

#### M4. PMS に「貸切風呂メニュー」に相当する一覧画面が無い（要件6）

実在するのは:

- カレンダーの機能パネル（読み取り専用の日別表。**部屋列が無い** ── 時刻 / 区分 / 利用者 / メモのみ。
  `autumn-pms/sveltekit/src/routes/calendar/+page.svelte:3724-3737`）
- 予約詳細モーダル

`/operations` は「準備中」のプレースホルダだが、**冒頭コメントに「席割・夕朝食の時間・清掃・貸切風呂・日誌・ミーティング・宿直をここにまとめる予定」と書かれている**
（`autumn-pms/sveltekit/src/routes/operations/+page.server.ts:1-4`）＝ **要件6の置き場所はここ**。

日別 × 浴室 × 枠のグリッドに部屋・氏名・**誰が入れた予約か**（M5 の `booked_via`）を出し、予約詳細へリンクする。

#### M5. 既存 2,048 行が stay 非紐付け ── ゲスト画面に「自分の予約」が出ない／重複予約を誘発する

本番の `stay_id` 紐付けは**わずか 2 行**。FM 取込に加え、男鹿の将来日付（2027-11 まで入っている）の電話予約も
`guest_name` 直書きとみられる。

トークン → stay で「予約した時間の確認」を出す方式（要件4）では、
**電話で取った予約が本人のゲスト画面に出ず、同じお客様がもう1枠取る**事故が構造的に起きる。

対策:

1. **`booked_via`（'staff' / 'guest' / 'import'）と `source_token_id` / `created_by` 列を追加**（＝ 誰が入れた予約かの区別は**必要**）
2. 運用として電話予約も予約詳細モーダル経由（stay 紐付け）に統一
3. ゲスト画面に「お電話でのご予約はこの画面に出ない場合があります」の逃げ文言

#### M6. 設定変更・開きっぱなし画面に対する挿入時再検証が無い

設定を保存せず毎回生成する思想（`bath-settings.ts:7-8`）自体は正しいが、公開側ではゲストが画面を開いたまま設定が変わる。
RPC は**挿入時点の設定で枠妥当性を再評価**すること。

なお「枠外」行は `slotStartsInRangeOf` が空集合を返して上限カウントから漏れる（`bath-slots.ts:255-267`）。
スタッフ運用では許容でも、**公開側の上限強制は「帯」ではなく実挿入行の集計で数える**方が破れにくい。

#### M7. 枠生成ロジックの二重実装（TS → SQL）のズレリスク

autumn-book は autumn-shared の TS を import しない方針（`autumn-shared/CLAUDE.md`「対象アプリ」）なので、
`bath-slots.ts` をそのまま共有できない。

推奨は **SQL 実装**だが、**PMS 側も同じ SQL 関数に寄せて単一実装にする出口**を最初から計画する。
PMS の枠取得は既にサーバ側 `/api/calendar-panels` 経由なので、そこを RPC 呼び出しに差し替えれば
`PrivateBathModal` は無改修で一本化できる。

#### M8. 公開ホスト未確定のまま紙 QR は刷れない

ディープリンク契約はパス以下のみ固定で「ホスト名は未確定」（`autumn_book_deeplink_contract.md` §1）。
**紙に刷った QR のホストは後から変えられない。** `stay.yamado.co.jp`（仮）の確定が館内図 QR 配布の前提。

---

### Minor

- `time_from` が text である件: 本番全 2,050 行が5桁ゼロ埋め（'HH:MM'）で現状は整合。RPC 側で `formatHm` 相当の正規化を強制すれば実害は封じられる。
- Cookie の `maxAge` が3日固定（`autumn-book/apps/web/src/routes/r/c/[token]/+server.ts:11`）。4泊以上で切れるが、紙が部屋にあるので再スキャンで復帰可。許容。
- 西和賀の施設既定 ranges が「翌朝のみ」で byBath（一寸）が正、という紛らわしい保存状態（本番実データ）。浴室別設定があるので実害は無いが整理を推奨。
- カレンダーパネルにスタッフ / ゲストの区別表示が無い（`booked_via` 追加後に列を足す）。
- `pms.facility_bath_timeslots`（旧マスタ）は「この画面からは読まない」と明示された残骸（`settings/master/services/+page.server.ts:6`）。`private_bath_days` と併せて棚卸しを。

---

## 3. 未決事項（答えで設計が変わるものだけ）

| # | 問い |
|---|---|
| 1 | **料金**: 男鹿の 2,200円（公式以外）をゲスト予約時にどう課金するか ── 請求書へ自動計上 / フロントが手動計上 / 予約時オンライン決済は不要か。西和賀は全経路無料でよいか |
| 2 | **受付開始と締切**: ゲストはいつから取れるか（チェックイン後のみ？ 予約確定後すぐ？）。当日は何分前まで / 何時までか |
| 3 | **ゲスト自身のキャンセル・時間変更**を許すか。許すなら締切（例: 利用30分前） |
| 4 | **公開ホスト**: `stay.yamado.co.jp`（仮）を紙 QR 印刷の前に確定できるか |
| 5 | autumn-book の **`/r` 配下だけメンテ解除して先行公開**してよいか（予約エンジン等は 503 のまま） |
| 6 | **電話予約の運用変更**: 今後フロントの電話予約は必ず予約詳細モーダル経由（stay 紐付け）にできるか。既存の将来日付 `guest_name` 行（特に男鹿）を stay へ紐付け直す作業をやるか |
| 7 | **浴室マスタの整備**: 男鹿の浴室登録と、既存行の `bath_id` 一括バックフィル（西和賀 = 一寸）を実施してよいか |
| 8 | **上限の単位**: 「1部屋につき1時間帯1回」は現行どおり **stay（部屋）単位**でよいか（2部屋の予約は部屋ごとに QR が刷られ、部屋ごとに1枠） |

---

## 4. 設計判断（結論）

### 4.1 SoT の境界

| 対象 | SoT |
|---|---|
| 枠の定義 | **PMS 設定**（`pms.facility_billing_settings.metadata.private_bath` + `pms.facility_baths`） |
| 予約行 | **`pms.private_bath_slots`** |
| 在庫 | 上2つから**毎回導出**（実体を持たない） |
| 料金・販売可否 | **現状 SoT 不在 ＝ 新設** |

**読み方は「① book スキーマの SECURITY DEFINER RPC が pms を読む」を採用。**

- ②（枠の書き出し同期）は「設定を直したのに古い枠が残る」を潰した現行思想（`bath-settings.ts:7-8`）への逆行かつ、同期という新しい故障点を作る。
- ③（TS 二重実装）は book が autumn-shared を import しない方針と衝突。
- ① でも SQL 版枠生成の「二重実装」は生じるが、
  (i) **表示と挿入検証が同じ SQL 関数を通る**ためゲスト経路内は常に自己整合、
  (ii) 一意インデックスが最終防衛、
  (iii) PMS の `/api/calendar-panels` を同 RPC に差し替えれば**将来単一実装に収束**できる。
  ズレは「移行期の表示差」に限定され、許容できる。

### 4.2 トークン方式

**既存 `/r/c/[token]` → httpOnly Cookie（`ab_stay`）交換方式を再利用。別トークンは作らない。**

理由:

1. 発行・失効・監査・8桁フォールバックまで実装済み（`20260710103006_book_inroom_phase1.sql`）。
2. **紙 QR は部屋に残る・写真で共有される・LINE 転送される**ので、URL からトークンを消す交換方式の脅威モデルがそのまま当てはまる（インルーム設計の敵対的レビュー結論と同一）。
3. **要件4「再スキャンで予約確認」と相性が良い** ── 再スキャン → 再 claim → `/r` 側で常に最新の予約一覧を表示。
   同じ紙で何度でも・家族の何台でも成立し、チェックアウト後は `valid_to` 超過で「ご滞在は終了しました」
   （`autumn-book/apps/web/src/routes/r/+page.server.ts:30-34` の既存挙動）。

軽量方式（URL に bearer を残す）は履歴・Referer・転送に残り続け、**失効前の紙の写真1枚で第三者が予約操作できる**ため不採用。

発行主体は **book（`book.issue_stay_token` 系）が唯一の鋳造元、PMS が呼ぶ** ── P8b の既定方針どおりで、疎結合（stay_id は論理参照）も保たれる。

### 4.3 置き場所

**autumn-book の `/r` 配下の1ルート群**（`/r/bath`）。

- **PMS の公開ルートは不可**: PMS は「`/login`・`/auth`・`/api/cron`・`/api/tl-lincoln`・`/api/square/webhook`・`/kiosk-login` 以外すべて認証必須」の純スタッフ面（`autumn-pms/sveltekit/src/hooks.server.ts:33-41`）。anon 導線を開けるのは認証境界の破壊。i18n も無い。
- **独立アプリも不要**: トークン基盤・i18n・メンテ制御を三重に作ることになる。
- `pms` スキーマを anon に開かない前提は ①の RPC 方式で完全に保てる（本番確認済み: **anon は pms の全テーブルに権限ゼロ**）。

### 4.4 館内図 QR の実装

- **新 kind `'qr'` を追加**する（`var` の拡張ではなく）。
  `var` は文字列差し込み（`facility-map-template.ts:63-70`）、`image` は静的画像（`imageKey` ＝ `pms.facility_map_images.id`）で、
  **部屋ごとに中身が変わる画像はどちらにも載らない**。
  `'qr'` ブロックは選択中の部屋（`RoomGuide`）のトークン URL を描く。
  既存 `MAP_VARS` の `private_bath` 文言変数（`facility-map-template.ts:247`「右記QRコードから貸切風呂のご予約が可能です。」）を隣に置く運用がそのまま生きる。
- **生成はクライアント側 SVG**（小さな QR エンコーダを vendored）。SVG はベクタなので印刷解像度の問題が消える。
  誤り訂正 M、URL は `https://<host>/r/c/<64hex>` ≒ 90 文字で QR Version 5 前後、**印字 20mm 角以上**を目安に。
  サーバ画像生成はエンドポイント・キャッシュが増えるだけで利点が無い。
- **トークンは館内図 load 時に get-or-create**（`facility-map-data.ts` は部屋ごとの `stay_id` を内部で持っており、`RoomGuide` に露出させるだけ）。
  刷り直し・全部屋一括印刷でも同一 stay は同一トークン ＝ **旧紙も有効のまま**。
  部屋移動で stay を作り直した場合は旧トークン失効 ＋ 新発行。

### 4.5 課金（要件7）

**入湯税の自動計上の作法をそのまま踏襲する。**

- `pms.bill_items.source`（`20260731170000_pms_bill_source.sql`）＝ その行を誰が起こしたか。
  `null` ＝ 人が入れた行は**絶対に触らない**、値が入っている行だけ自動で作り直す。
- 手本は `autumn-pms/sveltekit/src/lib/server/bath-tax.ts`（`BATH_TAX_SOURCE = 'bath_tax'`、`:160-215`）。
  「**メモが入っている行は自動計算の対象外** ＝ 現場が意図して手で決めたいときの逃げ道」
  「自動では直せない不一致は `mismatch` で人に知らせるだけで勝手に直さない」まで含めて確立済み。
  返す形も `{ status, insert[], update[], deleteIds[] }` の plan 型。
- **貸切風呂は `source = 'private_bath'` で揃える。**

注意点:

| 論点 | 扱い |
|---|---|
| 請求書がまだ無い | `pms.bills` は `stay_group_id` に紐づく。ゲストが枠を取る時点で bill 行が存在するとは限らない。**段階1は「行に `price_yen` を記録するだけ・フロントが手動計上」で開始**し、自動計上は段階2 |
| 無料 / 有料の判定 | `core.stays.channel_code`（`$lib/channels.ts` の `DIRECT_CHANNEL_PREFIX`）。**印刷の表示条件と課金で二重実装しない**よう、判定関数を1本にする |
| `effective_date` | `dayOffset=1`（翌朝）の枠をどの夜に付けるかを決める（推奨: **泊まった日**＝ `bath_date - dayOffset`） |
| 取り消しとの整合 | `stay-services.ts` はキャンセル・日程変更で**枠を行ごと削除**するが明細は見ていない。自動計上を入れるなら**同じ経路で明細も始末**する。発行済み（`status='issued'`）・印刷済み・freee 連携済みは**触らず警告**（入湯税と同じ作法） |

---

## 5. 段階別の推奨

### 段階1（館内図 QR × 限定単体運用）

| 要素 | 内容 |
|---|---|
| migration① | `YYYYMMDDHHMMSS_pms_private_bath_public_ready.sql`：`pms.private_bath_slots` に `booked_via text not null default 'staff' check (booked_via in ('staff','guest','import'))`・`source_token_id uuid`・`price_yen integer` を追加。既存の `stay_id is null` 行を `'import'` にバックフィル |
| migration② | `YYYYMMDDHHMMSS_book_private_bath_rpcs.sql`：<br>・`book.get_or_issue_stay_token(p_stay, p_facility, p_room_code, p_valid_to, p_guest_name)`（authenticated・`has_facility_access` 内部ガード。stay の有効トークン再利用）<br>・内部関数 `book.private_bath_slot_starts(p_settings jsonb)`（`buildBathSlotGroups` の SQL 版・唯一の SQL 実装）<br>・`book.private_bath_context(p_token)`（anon。滞在・泊リスト・浴室・枠・埋まり・自分の予約・適用料金を1発で返す）<br>・`book.reserve_private_bath(p_token, p_bath, p_slots jsonb)`（anon。advisory lock ＋ 枠妥当性・滞在期間・締切・`perRoomPerRange` を単一トランザクションで検証、`booked_via='guest'`・`source_token_id`・`price_yen` を書いて insert。一意違反は `slot_taken` に変換）<br>・`book.cancel_private_bath(p_token, p_slot_id)`（anon。自分の行のみ・締切前のみ） |
| PMS | 館内図: `RoomGuide` に stayId / トークン URL 追加 ＋ load で get-or-create 呼び出し／`MapBlock` に `kind:'qr'` 追加（エディタ含む）<br>新画面: **`/operations` に日別の貸切風呂一覧**（浴室 × 枠 × 部屋 × `booked_via` バッジ・予約詳細へリンク） |
| book | `/r/bath`（枠選択・確定・自分の予約表示・キャンセル。`ab_stay` Cookie 前提、無ければ既存 claim へ誘導）<br>`maintenance.ts` に `/r` 除外／claim レート制限を KV or DB へ |
| 権限境界 | テーブルは現状維持（anon 権限ゼロのまま）。ゲストは anon RPC のみ・トークン内部検証。PMS スタッフは authenticated RPC |
| 運用 | ホスト確定 → 男鹿の浴室マスタ登録・`bath_id` バックフィル → 館内図レイアウトに QR ＋ `private_bath` 文言配置 → **チェックイン時に従来どおり館内図を渡すだけ（追加の配布作業ゼロ）** |

### 段階2（PMS 本連携）

- チェックイン・キャンセル・日程変更・TL 取込キャンセルの各経路で get-or-create / `revoke_stay_token` を自動接続。
- 販売条件を `metadata.private_bath.public = { enabled, openFrom, cutoffMin, closures[], pricingByChannel }` として
  `settings/master/services` に UI 追加（死んでいる `private_bath_days` はここで正式に廃止 or 休止日カレンダーとして転用を確定）。
- **`price_yen > 0` の行を `pms.bill_items` へ自動計上**（`source='private_bath'`・入湯税と同じ plan 型・memo 付き行は触らない）。
  `stay-services.ts` の取り消し経路に明細の始末を追加。
- `savePrivateBath` / `/api/calendar-panels` を同じ RPC / SQL 関数へ寄せて**枠生成を単一実装化**（`booked_via='staff'`）。

### 段階3（会員マイページ・事前チェックイン）

- `reserve_private_bath` に会員経路を追加（`auth.uid()` → `book.members.guest_id` → stay 照合。`add_booking_options:185-197` と同型）。
- `/account/reservations/[code]` に貸切風呂セクション。
- **事前チェックインフォームは現存しない**（リポジトリ全域を確認済み）ため新設し、その1ステップに枠選択を組み込む。
  トークンは同じ `book.stay_access_tokens` を予約確定時発行・`valid_from` 前倒しで流用。
- 多言語（ja/en/zh-TW）は pms マスタに i18n を足さず、`autumn_book_design.md` §15.2 の `book.option_products` 相当のコンテンツ層で吸収。

---

## 6. 段階1の着手順（最小セット）

1. **決めごと2つ**（未決事項 #1 #4）: 男鹿 2,200円の課金方法と公開ホストの確定。
2. **データ整備**（運用 SQL・migration ではない）: 男鹿 `facility_baths` 登録／西和賀既存行の `bath_id` = 一寸 バックフィル／男鹿の将来日付 `guest_name` 行の扱い決め。
3. **migration①**（pms 列追加 ＋ import バックフィル）→ **migration②**（RPC 5本）。
   命名・適用は `autumn-shared` 方針（`main` へ直 push）。
4. **book**: `/r/bath` ルート ＋ `/r` メンテ除外 ＋ claim レート制限の KV 化。
5. **PMS**: 館内図 `kind:'qr'`（クライアント SVG 生成・EC=M）＋ get-or-create 呼び出し／`/operations` の貸切風呂一覧。
6. **通しテスト**:
   - 同一枠への並行 reserve（advisory lock と一意キーの二段防衛）
   - 設定変更後の古い画面からの reserve 拒否
   - 刷り直し後の旧 QR 有効性
   - チェックアウト後スキャンの「ご滞在は終了しました」表示

---

## 7. 調査で判明した想定との差分

- 本番の台帳は 470 件ではなく **2,050 件**（男鹿切替で FM 取込が入ったため）。`stay_id` 紐付けは **2 件のみ**。
- `book.stay_access_tokens` は本番 **0 件** ＝ トークン発行運用は未開始。**館内図 QR が事実上の初回ロールアウト**になる。
- `pms.private_bath_days` は DDL のみ存在し、**コード参照ゼロ・本番 0 行**の死んだ定義。

---

## 8. 変更履歴

- 2026-08-31 初版（設計レビュー）。要件1〜9 に対する Blocker 4 / Major 8 / Minor 5 と、段階1〜3 の推奨設計。
