# 公式サイトの予約で複数の部屋を 1 回で取る（複数室予約）— 設計書

> 作成: 2026-10-10（autumn-book v0.116.0・autumn-shared は `20261010053641` まで。読み取り調査のみ。コード・migration・DB 書き込みは未着手）
> 改訂: 2026-10-10 — ユーザー回答を反映（上限 4 室・非会員も 1 室ずつ取消・日程変更は全室同時で最初から・**テーブルを正規化し補完ビューをやめて既存予約をバックフィル**）。§2 を全面改訂、§6・§9・§12 を更新
> 対象リポ: autumn-book（公式サイト・マイページ・管理画面）／autumn-shared（migration・DB 関数・`send-booking-mail`）／autumn-pms（電文の受け側・部屋ごとの取消の反映）
> 関連: `docs/vip-member-page.md`（特別会員・§13 がこの設計の上に載る。直すべき点は本書 §12）、`docs/saved-cards.md`、`docs/partner-group-booking.md`（取引先の団体予約）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典を付ける。判断には【判断】、ユーザーに聞くものには【要確認 Qn】を付ける。

---

## 0. 依頼と決定（2026-10-10）

| 項目 | 決定 |
|---|---|
| 室数の上限 | **4 室**（超える場合は電話）。4 室目をかごに入れた時点で注意を出す — Q1 |
| 条件 | **全室同じチェックイン日・同じ泊数**。日付・泊数が違えば別の予約 |
| 部屋タイプ・プラン・人数 | **部屋ごとに選べる**（和室・朝夕食 1 室＋洋室・朝食のみ 1 室）。子どもは今回は大人のみ（列と電文は用意）— Q6 |
| 決済 | 合計で **1 回** |
| 取消 | **1 室ずつできる**。会員（マイページ）も **非会員（メールのリンク）も最初から** — Q5。全室まとめても取り消せる |
| 日程変更 | **最初から全室同時で可能**（在庫が全室ぶん確保できるときだけ。できなければ変更不可の案内）。部屋ごとに別の日程にはしない — Q8 |
| かご | 在庫を押さえず `sessionStorage`、「予約へ進む」で一括仮押さえ — Q2 |
| 支払方法が両立しないプラン | 同じ予約にできない（かごで止める）— Q3 |
| 1 室取消時のクーポン | 使用済みのまま・取り消した部屋の按分は消える（全室取消で復帰）— Q4 |
| 部屋ごとに違うプランの PMS 受け | 電文 `rooms[i].plan` を足し、autumn-pms が泊行の `plan_code` に使う小改修 — Q7 |
| 滞在コード | N≥2 は `YB-…-1`〜`-N`（取引先と同じ）・N=1 は従来どおり — Q9 |
| **データの持ち方** | **冗長なテーブルを避け、できる限り正規化する。部屋の属性は 1 か所にだけ持つ。既存の 1 室の予約はバックフィルで同じ形に揃え、読み方を 1 通りにする**（補完ビューで新旧 2 通りを残す案は採らない）— Q10 |
| 特別会員 | この仕組みの上に `docs/vip-member-page.md` §13 を載せる。直す点は §12 |

---

## 1. 現状の整理（1 室前提になっている箇所）

### 1.1 DB（autumn-shared）

| # | もの | 1 室前提の中身 | 出典 |
|---|---|---|---|
| D1 | `book.holds` | 1 行＝1 室。**束の値（`session_id`・`member_user_id`・`facility_id`・`checkin_date`・`checkout_date`・`expires_at`・`status`・`client_key`・`tenant_id`）と部屋の値（`room_type_id`・`rate_plan_id`・`adult_count`・`child_counts`・`price_snapshot`）が同じ行**にある。同じ `session_id` の有効な仮押さえは次の `create_hold` で解放・3 件まで | `20260611100300`・`20261009210747` |
| D2 | `book.create_hold`（新署名・service_role） | 1 室の見積（`book.quote`）→ 在庫 −1 → 1 行 insert。接続元 10 分 20 件・全体 500 件 | `20261009210747` |
| D3 | `book.quote` | 1 室・大人のみ。`{lines[{date, unit_price, adults, subtotal}], total, per_person, tax_included}`（`total`・`per_person`・`tax_included` は `lines` から導ける） | `20260611100400` |
| D4 | `book.get_hold(p_hold_id, p_session_id)` | 1 件を返す（`quote = price_snapshot`） | `20260611100500` |
| D5 | `book.confirm_booking`（最新） | `holds` 1 行 → `core.stays` 1 行 → `booking.bookings` 1 行。`metadata` に `price_snapshot`（丸ごと）・`points_used`・`points_earned`・`coupon{…, discount}`・`guest`（代表者＋`male/female`）・`booking_code`・`hold_id`・`locale`。`cancellation_policy_snapshot` 列にプラン規定 | `20260907113300` |
| D6 | `booking.bookings`（既存・共有スキーマ） | `stay_id`（単数）・`rate_plan_id`（単数・取引先予約は null）・`total_amount`・`cancellation_fee`・`cancellation_policy_snapshot`・`payment_status`・`paid_amount`・`metadata`。OTA 取込（PMS の TL import）と取引先予約も同じ表に入る | `20261010053641`・autumn-pms `tl-lincoln/import.ts` 2357 |
| D7 | `core.stays`（既存・共有） | **既に部屋ごと**: `reservation_code`・`check_in_date`・`check_out_date`・`party_size`・`adult_count`・`room_type_id`・`status`・`notes`・`estimated_arrival_time`・`channel_code`・`source`・`metadata`。PMS が `stay_group_id`・`assigned_room_id`・`metadata.book_*` を書く | `20260907113300`・autumn-pms `import.ts` 450〜480 |
| D8 | `book.direct_payments` | **`hold_id` が主キー**（FK なし）。`guest`・`points_used`・`locale`・`lodging_amount`・`bath_tax_amount`・`prepay_discount_amount`・`prepay_discount_detail`・`amount`・`payment_intent_id`・`status`・`refunds[]`・`cancel_admin_fee_percent` | `20260926113646`〜`20261007010002` |
| D9 | `book.direct_payment_prepare` / `confirm` / `refund_due` | 1 仮押さえ＝1 決済。割引は `_early_prepay_discount(facility, rate_plan, checkin, snapshot, as_of)`（**プランごとの率**）。返金は全部か無しか | `20260926232136`・`20260926151458`・`20261007010002` |
| D10 | `book._cancel_booking_core` | `core.stays.reservation_code = コード` → `bookings.stay_id` → 予約全体を取消。在庫戻し 1 室・ポイント逆仕訳は全額・クーポン復帰 | `20261006025043` |
| D11 | `book._cancel_fee` | 規定 1 つ × 基準額 1 つの**純粋関数**（部屋ごとに呼べる） | `20261006025924` |
| D12 | `compute_cancel_fee` / `guest_booking_by_token` / `guest_cancel_booking` / `mail_render_context` / `admin_booking_detail` / `my_reservations` | いずれも `core.stays.reservation_code = コード` で滞在 1 行 → 予約。`my_reservations` は**会員の滞在を全部**並べる（滞在 N 行＝N 件に見える） | `20261006025043`・`20260907081954`・`20260611100500` |
| D13 | `book.amend_booking` / `_amend_compute` | 1 室の日程・プラン・部屋・人数の変更。`booking_amendments` に before/after | `20260907113411`・`20261006025043` |
| D14 | `book._emit_pms_event` | `rooms` は 1 件固定（`v_s`）。`cancellation_policy` は `bookings.cancellation_policy_snapshot`、泊明細は `metadata.price_snapshot.lines` | `20261006075659` |
| D15 | `book.booking_option_orders` | `booking_id` と `stay_id`（部屋を特定できる） | `20260711070733` |
| D16 | `book._finalize_booking` / `_grant_prepay_bonus` | 付与は `bookings.total_amount × 還元率`。早期決済ポイントは `direct_payments.prepay_discount_detail.bonus_points × (amount − refunded) / amount` | `20260926225536` |
| D17 | 取引先予約 `rms_partner_create_booking` | **複数室を既に扱う**: `core.stays` を部屋ごと（`reservation_code = コード-1, -2…`・`metadata.room_index`）、`booking.bookings` 1 行（`stay_id = stay_ids[1]`・`rate_plan_id` null・`metadata.stay_ids`）。部屋タイプ・プランは 1 件に 1 つ。取消は全室一括 | `20261010053641`・`20261006022716` |
| D18 | PMS 取込 `autumn-pms direct-booking/import.ts` | `payload.rooms[]` を N 滞在として展開（`stay_groups` 1 行＝`metadata.book_booking_id`）。**booking.bookings・book.holds を直接は読まない**（電文だけ）。取消 `cancelDirectGroup` はグループ全体 | `import.ts` 221〜620・1013〜1110・grep 結果 |
| D19 | yamado-one（Expo） | RPC だけを呼ぶ: `create_hold`（旧 7 引数）・`get_hold`・`confirm_booking`・`cancel_booking`・`my_reservations`・`quote`・`plan_offers` ほか。**表は直接読まない**。`my_reservations` の列名（`room_type_id`・`rate_plan_id`・`adult_count`・`cancellation_policy`・`points_used` …）に依存 | `yamado-one/src/lib/api/booking.ts` 248〜455 |

### 1.2 autumn-book（画面・サーバ）

| # | もの | 1 室前提の中身 | 出典 |
|---|---|---|---|
| B1 | プラン詳細 `[brand]/[facility]/plans/[plan]` | 部屋の行ごとに `?/hold` → `sbCreateHold` 1 件 → `/booking/hold?id=<hold_id>`。**仮押さえの入口はここだけ** | `+page.server.ts` 131〜190 |
| B2 | 予約入力 `/booking/hold` | `sbGetHoldMapped` 1 件。`holdBathTax`・`prepayDiscountViewFor(facility, plan, hold)`・`planBookingForm(facility, {ratePlanId})`。`expandQuestions(questions, roomCount)` / `answerKey(q, roomIndex)` は複数室の形を既に持つ | `+page.server.ts`・`lib/booking-questions.ts` 84〜100 |
| B3 | 決済 `/booking/pay` | `prepareDirectPayment({holdId, expectedAmount})` → `confirmDirectIntent(intentId, holdId)`。cookie `BookingDraft` / `LastBooking` は 1 室 | `+server.ts`・`direct-booking-finish.ts` |
| B4 | 完了・マイページ・日程変更・非会員取消・管理画面 | `MemberReservation`（単数の `roomTypeUuid`・`ratePlanUuid`・`adults`）、`amend/` 1 室、`booking/cancel` 全体、`admin/reservations/[code]` 1 室 | 各 `+page.server.ts` |
| B5 | メール `send-booking-mail/templates.ts` | `booking.price_lines`・`room.name`・`plan.name` が単数 | `templates.ts` 39・275・372 |

### 1.3 ここから分かること

- PMS は N 室の電文を既に受けられる（D18）。足りないのは部屋ごとの取消の受け口と部屋ごとのプラン（§7）。
- 他システムは**表を直接読まず RPC・電文を経由**している（D18・D19）。表を正規化しても、**RPC の戻りの列名と電文の形を保てば壊れない**。
- 1 室の予約を「部屋 1 つの複数室予約」として同じ形に揃えられる（バックフィル）。

---

## 2. データモデル【提案・正規化】

### 2.1 どのテーブルに何を持つか（ひとめ）

「1 回の予約」は **1 件の予約 ＋ N 件の部屋**。値は**どこか 1 か所にだけ**置き、ほかはそこを読む。

| 持ちもの | 置く場所 | 例 |
|---|---|---|
| **予約全体のこと**（予約番号・代表者・いつ予約したか・合計いくら払うか・ポイントをいくら使ったか・クーポン・決済の状態） | `booking.bookings`（1 行） | YB-2026-000123、山田太郎、合計 95,000 円、3,000 pt 利用 |
| **部屋ごとの「宿泊」のこと**（日付・部屋タイプ・人数・滞在コード・現場への要望・部屋の状態） | `core.stays`（部屋ごとに 1 行・**今もそう**） | YB-…-2、洋室、大人 2 名、10/20〜21、予約中 |
| **部屋ごとの「お金」のこと**（プラン・泊ごとの料金・クーポンとポイントの按分・割引・入湯税・キャンセル規定・キャンセル料・返金） | **`book.booking_rooms`（新表・部屋ごとに 1 行・`core.stays` と 1:1）** | 2 室目: 朝食のみプラン、30,000 円、クーポン按分 400 円、キャンセル料 9,000 円 |
| **カード決済の事実**（Stripe にいくら請求したか・返金の履歴） | `book.direct_payments`（1 行） | PaymentIntent pi_…、92,000 円、返金 2 回 |
| **仮押さえの束**（誰が・どの施設・いつの日付・期限） | **`book.hold_groups`（新表・1 行）** | セッション abc、山人、10/20 から 1 泊、20 分 |
| **仮押さえの部屋**（部屋タイプ・プラン・人数・見積） | `book.holds`（部屋ごとに 1 行。**束の値は持たせない**） | 和室×2・洋室×1 |

### 2.2 原則

1. **部屋の値は `core.stays`（宿泊）と `book.booking_rooms`（お金）に分け、列を重ねない。** `core.stays` に既にある列（`room_type_id`・`adult_count`・`check_in/out`・`status`・`reservation_code`・`notes`）は `booking_rooms` に作らない。
2. **予約全体の値で「部屋の和」で導けるものは持たない。** 画面・メール・電文は `book._booking_totals(booking_id)`（§2.6）で和を取る。
3. 例外として**残す集計列は 3 つだけ**（理由つき・§2.5）: `bookings.total_amount`・`bookings.cancellation_fee`・`bookings.paid_amount`。いずれも他チャネル（OTA・取引先）の行と共用の既存列で、autumn-pms・会計が「予約 1 件の額」として見る。RPC だけが書き、部屋の和と一致することを RPC が検証する。
4. **仮押さえも同じ**: 束の値は `hold_groups` だけ、部屋の値は `holds` だけ。
5. **既存の 1 室の予約・仮押さえはバックフィルで同じ形にする**（§2.8）。読み方は 1 通り。補完ビューは作らない。

### 2.3 `book.hold_groups`（仮押さえの束・新表）と `book.holds`（部屋・既存表を痩せさせる）

**`book.hold_groups`**

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | 束の id。`/booking/hold?id=` と `direct_payments.hold_id` に入る |
| `tenant_id` / `facility_id` | uuid FK | |
| `session_id` | text | `ab_book_sid` |
| `member_user_id` | uuid null | 検証済みセッションの会員 |
| `checkin_date` / `checkout_date` | date | 全室共通 |
| `status` | text | `active / converted / expired / released`（束で 1 つ） |
| `expires_at` | timestamptz | 束で 1 つ |
| `client_key` | text | 接続元（試行上限） |
| `guest_draft` | jsonb null | ②→③の引き継ぎ（従来 `holds.guest_draft`） |
| `locale` | text | 従来は `price_snapshot.locale` に入っていた |
| `metadata` | jsonb | 特別会員の `member_page`（§12）など束のもの |
| `created_at` | timestamptz | |

**`book.holds`（変更後）** — 部屋のことだけ

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | 部屋の仮押さえ id（旧署名 `get_hold(p_hold_id)` の互換に使う） |
| `group_id` | uuid FK → `hold_groups` **not null** | |
| `room_index` | integer | 1〜4。`unique (group_id, room_index)` |
| `room_type_id` / `rate_plan_id` | uuid FK | 部屋ごと |
| `adult_count` | integer | |
| `child_counts` | jsonb | `{}`（Q6） |
| `price_lines` | jsonb | `book.quote` の `lines` だけ（`total` 等は導出） |
| `room_total` | integer | `Σ subtotal`。`lines` から導けるが、在庫・金額の検索と合計の計算で毎回展開しないために持つ【判断・唯一の例外。trigger で `lines` と一致を検証】 |

- **落とす列**（束へ移す）: `tenant_id`・`session_id`・`member_user_id`・`facility_id`・`checkin_date`・`checkout_date`・`status`・`expires_at`・`client_key`・`guest_draft`・`price_snapshot`（→ `price_lines`＋`room_total`）。バックフィル（§2.8）で束を作ってから `alter table … drop column`。
- 索引: `holds (group_id)`、`hold_groups (session_id, status)`、`hold_groups (status, expires_at)`、`hold_groups (client_key, created_at)`。
- RLS は従来どおり（社内参照のみ・顧客は RPC）。

### 2.4 `book.booking_rooms`（予約の部屋のお金・新表）

| 列 | 型 | 説明 | なぜここか |
|---|---|---|---|
| `stay_id` | uuid **PK** FK → `core.stays` | 部屋＝滞在と 1:1。別の id を作らない | |
| `booking_id` | uuid FK → `booking.bookings` | | |
| `tenant_id` / `facility_id` | uuid | RLS 用（`private.has_facility_access`） | |
| `room_index` | integer | 1〜4。`unique (booking_id, room_index)` | 取引先は `core.stays.metadata.room_index` に入れているが、公式は共有表の metadata に書かずここに持つ |
| `rate_plan_id` | uuid FK | **部屋ごとのプラン**（`core.stays` に無い） | |
| `price_lines` | jsonb | 泊ごとの料金 `[{date, unit_price, adults, subtotal}]` | `core.stays` に料金列は無い |
| `room_total` | integer | 宿泊料金（割引前・税込・入湯税除く）＝ Σ subtotal | §2.3 と同じ理由 |
| `coupon_share` | integer | クーポン割引の按分（§5.2） | |
| `points_share` | integer | ポイント利用の按分（§5.3） | |
| `prepay_discount` | integer | 予約時決済割の実額（部屋ごとの率・§5.4）。現地払いは 0 | |
| `prepay_detail` | jsonb null | `_early_prepay_discount` の戻り（段・`bonus_points`） | `_grant_prepay_bonus` が Σ を読む |
| `bath_tax` | integer | 入湯税（オンライン決済のときだけ > 0） | |
| `guest_detail` | jsonb | 部屋ごとの回答 `{male, female, answers:{…}}` | 従来 `metadata.guest.male/female`（1 室）にあったもの。要望欄の文は従来どおり `core.stays.notes` |
| `cancellation_policy_snapshot` | jsonb | **部屋ごとのプラン規定の写し**（特別会員は §12 の合成） | 部屋ごとにプランが違うため。`bookings.cancellation_policy_snapshot` 列には**書かない**（§2.5） |
| `cancelled_at` | timestamptz null | 取消日時（`core.stays` に無い。状態そのものは `core.stays.status`） | |
| `cancelled_by` | text null | `member / guest_token / staff / admin` | |
| `cancel_waived` | boolean | 免除 | |
| `cancel_fee` | integer | この部屋のキャンセル料 | |
| `cancel_fee_detail` | jsonb null | `_cancel_fee` の戻り（`rules_source`・`rate`・`base`） | |
| `cancel_kept` | integer | 返金しなかった額（max(キャンセル料, 割引, 事務手数料)） | |
| `created_at` / `updated_at` | | | |

導出（列にしない）: `charge = room_total − coupon_share`、`paid_share = charge − points_share − prepay_discount + bath_tax`（オンライン決済時）、`per_person`・`tax_included`、部屋の `status`（＝`core.stays.status`）、`adults`（＝`core.stays.adult_count`）、`room_type_id`（＝`core.stays.room_type_id`）、滞在コード（＝`core.stays.reservation_code`）。

### 2.5 `booking.bookings` の列・`metadata` の整理（予約全体のもの・部屋のものは置かない）

| 列 / キー | 扱い | 理由 |
|---|---|---|
| `stay_id` | **代表（1 室目）を入れる** | 既存 not null・取引先予約と同じ。`pms.direct_booking_inbox.stay_id` も代表 |
| `rate_plan_id` | **null**（部屋ごとに `booking_rooms.rate_plan_id`） | 部屋ごとに違う。取引先予約も null。既存の読み手は本 migration で `booking_rooms` に向ける（他システムは読んでいない・D18・D19） |
| `total_amount` | **残す（集計）**＝ 生きている部屋の `charge` の和 | OTA・取引先と共用の「予約 1 件の額」。autumn-pms の電文 `amounts.total_amount`・`_finalize_booking`・管理一覧・会計が読む。RPC だけが更新し `book._assert_booking_totals` で和と一致を検証 |
| `cancellation_fee` | **残す（集計）**＝ 部屋の `cancel_fee` の和 | 同上（PMS のキャンセル料の記録） |
| `payment_status` / `paid_amount` | 予約全体の決済（1 PaymentIntent） | 本来の場所 |
| `cancellation_policy_snapshot` | **書かない（null）** | 規定は部屋ごと。既存予約はバックフィルで `booking_rooms` へ移して null に |
| `cancelled_at` / `status` | 予約全体（最後の 1 室が取り消されたとき） | |
| `metadata.booking_code` | 残す | 予約コード（式索引を張る・§2.7） |
| `metadata.hold_group_id` | 残す（従来 `hold_id` → 束 id に） | 追跡用 |
| `metadata.guest` | 残す（**代表者**: 氏名・連絡先・到着・送迎・要望・`client`・`onsitePayment`） | 部屋ごとの `male/female` は `booking_rooms.guest_detail` へ |
| `metadata.member_user_id` | 残す | 予約した会員 |
| `metadata.points_earned` / `points_finalized` | 残す | 予約全体の付与見込み・確定フラグ（グレードは予約者で 1 つ） |
| `metadata.points_used` | **書かない** → `Σ points_share` | 導出できる |
| `metadata.coupon` | `{member_coupon_id, coupon_id, name}` だけ残す。**`discount` は書かない** → `Σ coupon_share` | 導出できる |
| `metadata.price_snapshot` | **書かない** | 部屋の `price_lines` / `room_total` へ |
| `metadata.payment` | 残す（Stripe の要約・現地払いは無し） | 予約全体 |
| `metadata.locale` / `cancelled_by` / `cancel_waived` / `amended_count` / `last_amended_at` | 残す | 予約全体 |
| `metadata.stay_ids` / `room_count` / `rooms_cancelled` | **作らない** | `booking_rooms` から導ける |

> 補足: `booking.bookings` は OTA・取引先と共用なので **DDL（列の追加・削除）はしない**。上の「書かない」は「公式予約の行でそのキー／列を使わない」という意味。

### 2.6 和を取る共通関数

```sql
-- 予約全体の集計（画面・メール・電文・返金が使う唯一の入口）
create or replace function book._booking_totals(p_booking_id uuid)
returns table (
  room_count int, live_rooms int,
  room_total int, coupon_discount int, charge int, points_used int,
  prepay_discount int, bath_tax int, paid_share int,
  cancel_fee int, cancel_kept int,
  live_room_total int, live_charge int, live_points_used int, live_paid_share int
) language sql stable security definer set search_path = '' as $$
  select count(*)::int, count(*) filter (where s.status <> 'cancelled')::int,
         coalesce(sum(r.room_total),0)::int, coalesce(sum(r.coupon_share),0)::int,
         coalesce(sum(r.room_total - r.coupon_share),0)::int, coalesce(sum(r.points_share),0)::int,
         coalesce(sum(r.prepay_discount),0)::int, coalesce(sum(r.bath_tax),0)::int,
         coalesce(sum(r.room_total - r.coupon_share - r.points_share - r.prepay_discount + r.bath_tax),0)::int,
         coalesce(sum(r.cancel_fee),0)::int, coalesce(sum(r.cancel_kept),0)::int,
         coalesce(sum(r.room_total) filter (where s.status <> 'cancelled'),0)::int,
         coalesce(sum(r.room_total - r.coupon_share) filter (where s.status <> 'cancelled'),0)::int,
         coalesce(sum(r.points_share) filter (where s.status <> 'cancelled'),0)::int,
         coalesce(sum(r.room_total - r.coupon_share - r.points_share - r.prepay_discount + r.bath_tax) filter (where s.status <> 'cancelled'),0)::int
    from book.booking_rooms r join core.stays s on s.id = r.stay_id
   where r.booking_id = p_booking_id
$$;

-- 集計列 3 つが部屋の和と合っているか（RPC の最後と、日次の点検 cron で呼ぶ）
create or replace function book._assert_booking_totals(p_booking_id uuid) returns void …;  -- 不一致なら raise
```

### 2.7 予約コードの引き方（滞在コードに `-k` が付いても壊れないように）

```sql
create or replace function book._booking_by_code(p_code text) returns booking.bookings
language sql stable security definer set search_path = '' as $$
  select b.* from booking.bookings b
   where b.metadata->>'booking_code' = regexp_replace(p_code, '-\d+$', '') limit 1
$$;
create index if not exists bookings_book_code_idx on booking.bookings ((metadata->>'booking_code')) where metadata ? 'booking_code';
```

D12 の 6 関数は `core.stays.reservation_code = …` の引き方を `_booking_by_code` に差し替える。

### 2.8 バックフィル（既存の 1 室の予約・仮押さえを同じ形に）

**対象の見込みの確かめ方**（migration を書く前に PROD で読み取り・MCP は読み取りのみ）:

```sql
-- 公式の予約（取引先・OTA は対象外）: metadata.booking_code を持つ行
select count(*), min(created_at), max(created_at),
       count(*) filter (where metadata ? 'price_snapshot') as with_snapshot,
       count(*) filter (where rate_plan_id is null) as no_plan,
       count(*) filter (where status = 'cancelled') as cancelled
  from booking.bookings where metadata ? 'booking_code';
-- 仮押さえ: 状態別
select status, count(*) from book.holds group by 1;
-- 1 予約に滞在が 2 行以上ある公式予約は無いはず（あれば手で確認）
select b.id from booking.bookings b join core.stays s on s.reservation_code like (b.metadata->>'booking_code') || '%'
 where b.metadata ? 'booking_code' group by b.id having count(*) > 1;
```

**手順（1 本の migration の中・同一トランザクション）**

1. **退避表**（巻き戻し用・30 日後に別 migration で drop）: `create table book._mr_backup_bookings as select id, rate_plan_id, cancellation_policy_snapshot, metadata from booking.bookings where metadata ? 'booking_code'; create table book._mr_backup_holds as select * from book.holds;`
2. `book.hold_groups` を作り、**既存の `holds` 1 行ごとに束 1 行**を作る（`id` は新規・束の値を写す・`locale = price_snapshot->>'locale'`）。`holds.group_id` / `room_index = 1` / `price_lines = price_snapshot->'lines'` / `room_total = (price_snapshot->>'total')::int` を埋める。`direct_payments.hold_id`（＝旧 hold id）を**束 id に書き換える**（`direct_payments` は FK 無し・主キー更新）。`bookings.metadata.hold_id` → `hold_group_id` に付け替え。
3. `holds` の束の列を `drop column`、`price_snapshot` を drop、`group_id not null`。
4. `book.booking_rooms` を作り、公式予約 1 件ごとに 1 行（`stay_id = b.stay_id`・`room_index 1`・`rate_plan_id = b.rate_plan_id`・`price_lines = metadata->'price_snapshot'->'lines'`・`room_total = coalesce((price_snapshot->>'total')::int, total_amount + coupon.discount)`・`coupon_share = coupon.discount`・`points_share = metadata.points_used`・`prepay_discount = metadata.payment.prepay_discount`・`prepay_detail = direct_payments.prepay_discount_detail`・`bath_tax = metadata.payment.bath_tax`・`guest_detail = {male, female} from metadata.guest`・`cancellation_policy_snapshot = b.cancellation_policy_snapshot`・取消済みなら `cancelled_at = b.cancelled_at`・`cancelled_by = metadata.cancelled_by`・`cancel_waived`・`cancel_fee = b.cancellation_fee`・`cancel_fee_detail = metadata.cancel_rank_benefit`・`cancel_kept = direct_payments.amount − refunded_amount`〔paid かつ cancelled のとき〕）。
5. `booking.bookings` の公式予約行: `rate_plan_id = null`・`cancellation_policy_snapshot = null`・`metadata` から `price_snapshot`・`points_used`・`coupon.discount`・`guest.male`・`guest.female`・`cancel_rank_benefit` を除く（`hold_id` → `hold_group_id`）。
6. `book._assert_booking_totals` を全件に流し、件数（手順 0 の見込み）と一致することを `raise notice` で出す。不一致があれば `raise exception` で**全体を巻き戻す**。
7. 関数の差し替え（§2.9）。

**巻き戻し**: 退避表から `update booking.bookings set rate_plan_id, cancellation_policy_snapshot, metadata = … from book._mr_backup_bookings`、`holds` は `_mr_backup_holds` から再作成、`direct_payments.hold_id` を旧 id に戻す（`hold_groups` に旧 hold id を `metadata.legacy_hold_id` で残しておく）。関数は直前の定義（§2.9 の「写す元」）を当て直す。巻き戻し用の SQL は migration ファイル末尾のコメントに**丸ごと**書いておく。

**他システムへの影響**

| システム | 読んでいるもの | 影響 |
|---|---|---|
| autumn-pms | 電文 `pms.direct_booking_inbox.payload` だけ（`booking.bookings` 直接読みは TL 取込の OTA 行の書き込みのみ・D18） | 電文の形を保つ（`rooms[]` が N 件・`cancellation_policy` は 1 室目の規定・`price_snapshot` は `{rooms:[…], lines:[全室結合]}`）→ **壊れない** |
| yamado-one | RPC の戻り（D19） | `get_hold` の戻りに `quote` を組み直して返す（`price_lines`＋`room_total` から）。`my_reservations` の既存列は**名前・順序を保ち**（1 室目の `room_type_id` / `rate_plan_id` / `adult_count`、`cancellation_policy` は 1 室目の規定、`points_used` は和）、末尾に `room_count`・`rooms jsonb` を**追加**（`returns table` の変更は drop → create）。`confirm_booking` / `cancel_booking` の戻りは従来どおり → **壊れない** |
| autumn-rms | `booking.bookings` / `book.holds` を読まない（grep 0 件） | なし |
| Book 管理画面・メール | 本 migration で `booking_rooms` に向ける | — |

**旧署名（yamado-one 用）を残す理由と、重複データを作らない方法**

- `book.create_hold(7 引数)`・`get_hold`・`confirm_booking(6 引数)` は yamado-one が直接呼ぶため残す（HANDOFF の TODO どおり、yamado-one をサーバ経由にしたら drop）。
- 中身は**薄い入口**にする: `create_hold` → `create_hold_group(rooms = [1 室])` を呼び、**その部屋の `holds.id`** を `hold_id` として返す（戻りの形は従来どおり）。`get_hold(p_hold_id)` → `holds.id` から束を引いて従来の形を組む。`confirm_booking(p_hold_id, …)` → `holds.id` から束 id を引いて `confirm_booking_group` を呼ぶ。**データの形は束＋部屋の 1 通り**になり、旧署名専用の列や行は残らない。

### 2.9 migration の SQL 案の全体（autumn-shared・`bash ~/.claude/new-migration.sh autumn-shared book_multi_room`）

1 ファイル。既存関数は「最新定義を丸ごと写して差分を足す」。写す元:

| 関数 | 写す元 | 差分 |
|---|---|---|
| `book.create_hold_group(p_session_id, p_facility_id, p_checkin, p_nights, p_rooms jsonb, p_client_key, p_member_user_id, p_locale)` | 新規（`create_hold` `20261009210747` を写す） | §3.1 |
| `book.create_hold`（旧 7 引数） | `20261009210747` の旧署名 | 中身を `create_hold_group` の呼び出しに（§2.8） |
| `book.get_hold_group(p_group_id, p_session_id)` / `book.get_hold`（旧） | `20260611100500` | 束＋部屋配列／旧は 1 室の形を組む |
| `book.release_hold_group` / `book._release_hold`（束単位に） / `release_expired_holds` | `20260926152750`・`20260611100300` | 束の全室を戻す |
| `book.confirm_booking_group(p_group_id, p_session_id, p_guest, p_points_used, p_locale, p_member_coupon_id, p_rooms_detail jsonb)` | 新規（`confirm_booking` `20260907113300` を写す） | §3.2・§5 |
| `book.confirm_booking`（旧 6 引数） | `20260907113300` | 中身を `confirm_booking_group` の呼び出しに |
| `book.direct_payment_prepare` / `_confirm` / `_refund_due` / `_record_refund` | `20260926232136`・`20260926151458`・`20261007010002`・`20260926113646` | 束 id・部屋ごとの割引と入湯税・部屋ごとの返金（§4） |
| `book._grant_prepay_bonus` | `20260926225536` | `bonus_points` を `Σ booking_rooms.prepay_detail->>'bonus_points'` に |
| `book.cancel_booking_room(p_booking_code, p_room_index, p_waive_fee, p_reason)` / `book.guest_cancel_booking_room(p_token, p_room_index)` | 新規（`_cancel_booking_core` `20261006025043`・`guest_cancel_booking` `20260907081954` を写す） | §6.1・§6.2 |
| `book._cancel_booking_core` | `20261006025043` | 生きている部屋を順に部屋取消（全室一括） |
| `book.compute_cancel_fee(p_booking_code, p_as_of, p_room_index default null)` | `20261006025043` | 部屋ごと／全室の内訳 `rooms[]` |
| `book.amend_booking_dates(p_booking_code, p_checkin, p_nights)` / `book._amend_compute_dates` / `book.quote_amendment_dates` | 新規（`amend_booking` `20260907113411`・`_amend_compute` `20261006025043` を写す） | §6.3 |
| `book.amend_booking` / `_amend_compute`（1 室の部屋・プラン・人数変更） | `20260907113411`・`20261006025043` | `booking_rooms` を読む・N≥2 は `use_amend_dates` で拒否 |
| `book.my_reservations` | `20260611100500` | 予約単位・末尾に `room_count`・`rooms` |
| `book.guest_booking_by_token` / `mail_render_context` / `admin_booking_detail` / `admin_list_bookings` | `20261006025043`・`20260907061853` | `_booking_by_code`・`rooms[]`・`_booking_totals` |
| `book._emit_pms_event` | `20261006075659` | `rooms[]` N 件・`rooms[i].plan`・`room_cancelled`（§7） |
| `book._finalize_booking` | `20260926225536` | 変更なし（`total_amount` が生きている部屋の和） |
| `book._booking_totals` / `_assert_booking_totals` / `_booking_by_code` / `_allocate` | 新規 | §2.6・§2.7・§5.1 |

---

## 3. 料金・在庫【提案】

### 3.1 仮押さえの束 `book.create_hold_group`

```
p_rooms = [{ rate_plan_id, room_type_id, adults, child_counts? }, ...]   -- 1〜4 件・順番が room_index
```

1. 入力検査: `1 <= 室数 <= 4`（`invalid_room_count`・定数は `book._max_rooms_per_booking()` 1 か所）・`p_nights` 1〜14・各室 `adults` 1〜6・全室が `p_facility_id` のプラン・部屋タイプ・プランは `public_on_direct and is_active` ＋ `plan_contents.is_published`。
2. 試行上限: **束 1 件を 1 回と数える**（接続元 10 分 20 束・全体 500 束）。
3. 同じセッションの前の有効な束は解放してから取り直す（支払中＝`direct_payments.payment_intent_id is not null` の束は触らない）。同一セッションの有効な束は **1 件**。
4. 見積: 部屋ごとに `book.quote`。
5. 在庫: **部屋タイプごとに必要数を集計**し、`booking.availability` を全泊 `for update` → `available_rooms − buffer_rooms >= 必要数 and not stop_sell` を全泊確認（足りなければ `sold_out:<room_type_id>`）→ `available_rooms −= 必要数`。
6. `hold_groups` 1 行 → `holds` を部屋ごとに insert。
7. 戻り `{ group_id, expires_at, rooms:[{hold_id, room_index, quote}], total }`。

- 期限 20 分（束）。`direct_payment_prepare` の「1 回だけ 15 分延ばす」は束の `expires_at`。
- `release_expired_holds()` は束単位（`hold_groups.status='active' and expires_at < now()`）で全室の在庫を戻す。

### 3.2 確定 `book.confirm_booking_group`

`confirm_booking`（`20260907113300`）を部屋のループに:

1. 束を `for update`・`active`・期限内・本人。
2. 名寄せ・会員・クーポン検証（`min_total` は束の合計）・`v_total = Σ room_total`・`v_discount`・`v_charge`・ポイント `v_use`・付与見込み `v_earn = floor(v_charge / 1.10 × rate)`（従来どおり予約全体）。
3. 予約番号 1 つ。`core.stays` を部屋ごとに insert（`reservation_code` は Q9・`adult_count`・`party_size`・`room_type_id`・`notes` ＝ 代表の要望＋**その部屋の回答**・`estimated_arrival_time`・`channel_code`）。
4. `booking.bookings` 1 行（§2.5 の方針: `stay_id = 1 室目`・`rate_plan_id null`・`total_amount = v_charge`・`cancellation_policy_snapshot null`・`metadata` は残すキーだけ）。
5. `booking_rooms` を部屋ごとに insert（`price_lines`・`room_total`・按分 §5・`cancellation_policy_snapshot = その部屋のプランの規定`・`guest_detail = p_rooms_detail[i]`）。
6. ポイント台帳・クーポン使用・確認メール・`_emit_pms_event('new')`・束を `converted`・`_assert_booking_totals`。
7. 戻りは従来のキー ＋ `rooms:[{room_index, stay_id, reservation_code, charge}]`。

### 3.3 部屋ごとの見積の見せ方

- 金額は部屋ごとに `book.quote`（`plan_offers` の値）、合計は足し算。「1 名あたり」は部屋ごと。

### 3.4 上限

- **1 予約 4 室**（決定）。超えるときは「お電話で」。DB の check・かご・RPC の 3 か所が同じ定数関数を見る。

---

## 4. 決済【提案】

### 4.1 合計 1 回の PaymentIntent

- `direct_payment_prepare(p_hold_id = 束 id, …)`: 束の全室を読み、部屋ごとに割引 `_early_prepay_discount(facility, その部屋の rate_plan_id, checkin, その部屋の見積, 今日)` と入湯税 `_direct_bath_tax(facility, adults, children, nights)` を計算して**合計だけ**を `direct_payments` に書く（`lodging_amount`・`bath_tax_amount`・`prepay_discount_amount`・`amount`。これらは Stripe の請求額を決める**準備時の作業値**で、確定後は `booking_rooms` が正）。部屋ごとの内訳は保存しない（確定時に同じ関数で再計算する・下）。
  - 再計算の決定性: 早期決済割の段は「予約した日」で決まるので、`direct_payments.created_at`（JST 日付）を `p_as_of` に渡して確定時に再計算する（`_early_prepay_discount` は第 5 引数に `as_of` を持つ・`20260926221912`）。食い違えば従来どおり `amount_mismatch` → `late`。
  - ポイントは束の合計に対して `least(残高, Σ room_total − Σ 割引)`。
  - 支払方法: **全室のプランで許されているものだけ**（決定 Q3・両立しない組み合わせはかごで止める）。
- `direct_payment_confirm`: `confirm_booking_group` を呼び、`Σ(room_total − coupon_share − prepay_discount + bath_tax) − points = amount` を突き合わせる。確定後に `booking_rooms` の `prepay_discount`・`prepay_detail`・`bath_tax` を書く（`confirm_booking_group` の `p_rooms_detail` で渡す）。
- Stripe 側は変更なし（`refId` に束 id・metadata の `hold_id` キーに束 id）。Webhook も束 id。保存カードは従来どおり。
- **チェックアウト日決済（SetupIntent）は公式サイトには無い**（取引先だけ）。公式の `payment_method='deposit'` は「現地払いも予約時決済も選べる」の意味で預り金ではない。
- 事務手数料の率は束で 1 つ（`direct_payments.cancel_admin_fee_percent`・トリガーで写す）。部屋ごとの額は §5.5。

### 4.2 部屋ごとの取消での一部返金

`direct_payment_refund_due(p_booking_code)` を「**今あるべき返金額**」に:

```
A  = direct_payments.amount（Stripe に請求した額）
L  = Σ(生きている部屋) paid_share                         … paid_share = room_total − coupon_share − points_share − prepay_discount + bath_tax
K  = Σ(取消済みの部屋) cancel_kept                        … cancel_kept = max(cancel_fee〔paid_share まで〕, prepay_discount〔入湯税を除いた paid_share まで・免除なら 0〕, admin_fee〔同・事務手数料の免除なら 0〕)
due = max(0, A − L − K − refunded_amount)
```

- 全室取消（L = 0）では従来の式と同じ額。1 室の予約は完全に一致。
- `refundAfterCancel(code, reason, {roomIndex})` は従来どおり `refund_due` → Stripe `refunds.create` → `direct_payment_record_refund`。`refunds[]` の要素に `room_index` を足す（返金の履歴は `direct_payments` が唯一の置き場所・`booking_rooms` には返金額の列を作らない。部屋ごとの返金実績は `refunds[]` を `room_index` で集計）。
- `payment_status`: 一部返金後 `partial_refund`、全額で `refunded`。
- 返金失敗は従来どおり `refund_status='failed'`・管理画面の再実行。取消自体は成立。

### 4.3 早期決済ポイント（`early_prepay_mode = 'points'`）

- `_grant_prepay_bonus`: `bonus_points` の元を `direct_payments.prepay_discount_detail` から **`Σ booking_rooms.prepay_detail->>'bonus_points'`** に変える。`× (amount − refunded) / amount` の按分はそのまま。
- 画面の「付与予定ポイント」も同じ式（TS）。

---

## 5. ポイント・早期決済特典・キャンセル料・クーポンの按分【提案】

### 5.1 原則

- **「部屋の金額比で按分し、端数は 1 室目から 1 円ずつ」**（最大剰余法）。確定時に `booking_rooms` に書いて固定。基準は `room_total`。
- DB の純関数 `book._allocate(p_amount integer, p_weights integer[]) returns integer[]` と、TS の同じ式 `allocateByWeight()`（`lib/multi-room.ts`・テスト付き）。

### 5.2 クーポン

- 割引額は束の合計で決め（`min_total` も合計）、`coupon_share_i = allocate(v_discount, room_total[])`。
- 部屋の取消: クーポンは使用済みのまま・取り消した部屋の按分は消える（決定 Q4）。全室取消で従来どおり復帰。`_cancel_fee_base` 相当は部屋ごとに `room_total_i`（＝割引前）。

### 5.3 ポイント

- 利用 `v_use` は合計で決め、`points_share_i = allocate(v_use, charge[])`。
- 部屋の取消: `points_share_i` を返還（逆仕訳）。付与見込み `metadata.points_earned` は残りの `Σ charge` で再計算し差分を逆仕訳。全室取消なら従来どおり全額取消。
- 早期決済ポイントは §4.3。

### 5.4 予約時決済割・早期決済割

- 按分ではなく**部屋ごとに実計算**（プランごとに率・対象が違う）。`prepay_discount_i`・`prepay_detail_i`。取消時の「割引額は返金しない」は部屋ごとに効く（§4.2）。

### 5.5 事務手数料

- 率は束で 1 つ。部屋の額 `admin_fee_i = floor(paid_share_i × 率)`（千分率の整数・TS の `adminFeeOf` と同じ式）。上限はその部屋の入湯税を除いた支払分。1 室ずつの合計と全室一括の `floor(A × 率)` の 1〜2 円差は許容【判断】。

### 5.6 キャンセル料（部屋ごと）

- `_cancel_fee(その部屋の cancellation_policy_snapshot, room_total_i, checkin, as_of, rank)`。グレードの規定・特別会員の `favorable / page` も同じ関数で部屋ごとに効く。全室一括は部屋ごとの合計。

### 5.7 入湯税

- 部屋ごと `adult_count × 泊 × 税額`。取消では必ず返す。

---

## 6. 取消・日程変更【提案】

### 6.1 1 室の取消 `book.cancel_booking_room(p_booking_code, p_room_index, p_waive_fee, p_reason)`

認可は `cancel_booking` と同じ（本人＝`members.guest_id = stays.guest_id` か施設スタッフ。免除はスタッフだけ・理由必須）。中身（`_cancel_booking_core` `20261006025043` を部屋単位に・内部関数 `book._cancel_room_core(booking, room, …)` に置き、全室取消と非会員取消も同じ内部関数を呼ぶ）:

1. 予約（`_booking_by_code`・`for update`）・部屋（`booking_rooms`・`for update`）・滞在。滞在が `reserved` でない → `not_cancellable`。
2. キャンセル料 §5.6 → `cancel_fee`・`cancel_fee_detail`。`cancel_kept` は §4.2 の式（オンライン決済済みのとき。現地払いは `cancel_fee`）。
3. `booking_rooms`: `cancelled_at`・`cancelled_by`・`cancel_waived`・`cancel_fee`・`cancel_kept`。`core.stays.status = 'cancelled'`（PMS の `stays_release_rooms_on_cancel` トリガーが部屋割りを解放）。
4. `booking.bookings`: `total_amount −= charge_i`・`cancellation_fee += cancel_fee_i`・`metadata.points_earned` 再計算。**最後の 1 室**なら `status='cancelled'`・`cancelled_at`・`metadata.cancelled_by/cancel_waived`・クーポン復帰・キャンセルリンクの無効化（`booking_access_tokens.used_at`）。
5. 在庫: その部屋の `room_type_id` を全泊 +1。
6. ポイント: `points_share_i` 返還・付与見込みの差分（§5.3）。その部屋の `reserved` のオプション（`booking_option_orders.stay_id`）を `cancelled`。
7. PMS 電文: 最後の 1 室なら `cancelled`（従来・`cancel.rooms` に全室の内訳）。それ以外は **`modified`**（`amendment.kind='room_cancelled'`・§7.2）。
8. メール: 最後の 1 室なら `booking_cancelled`。それ以外は新しい種類 **`booking_room_cancelled`**（payload: `room_index`・部屋名・プラン名・この部屋のキャンセル料・返金見込み・残りの部屋）。
9. 監査ログ（スタッフ・管理者）に `cancel_booking_room`。
10. `_assert_booking_totals`。戻り `{booking_code, room_index, cancellation_fee, remaining_rooms, booking_cancelled}`。

TS（マイページ `?/cancelRoom`・非会員 `?/cancelRoom`・管理画面）はこの後に `refundAfterCancel(code, by, {roomIndex})`。

### 6.2 非会員（メールのリンク）の 1 室ずつの取消（決定 Q5・最初から）

- `guest_booking_by_token(p_token)` の戻りに `rooms[]`（部屋ごと: `room_index`・部屋名・プラン名・人数・金額・状態・`fee`〔その部屋の `_cancel_fee`〕・返金見込みの材料）を足す。`cancellable` は「生きている部屋が 1 つ以上」。
- 新 RPC `book.guest_cancel_booking_room(p_token, p_room_index)`（anon 可・`guest_cancel_booking` `20260907081954` を写して `_cancel_room_core` を呼ぶ）。トークンの `used_at` は**全室が取り消されたときだけ**立てる（従来は取消で即 used）。従来の `guest_cancel_booking(p_token)`（全室）は残す。
- 画面 `/booking/cancel`: 部屋ごとのカードに「この部屋を取り消す」、下に「すべてのお部屋を取り消す」。GET は閲覧だけ・取消は POST（従来の方針）。
- レート制限・トークンの扱いは従来どおり。

### 6.3 日程変更（決定 Q8・最初から全室同時）

**方針**: 複数室の予約の日程変更は**チェックイン日・泊数だけ**（全室同時・部屋ごとに別の日程にはしない）。部屋タイプ・プラン・人数は変えない（部屋ごとの変更は後回し・§9 M3）。1 室の予約は従来の `amend_booking`（部屋・プラン・人数も変えられる）をそのまま使う。

**新 RPC `book.amend_booking_dates(p_booking_code, p_checkin, p_nights)`**（`amend_booking` `20260907113411` を写す）:

1. 本人・`confirmed`・締切（チェックイン日 9:00 施設 TZ）・回数（2 回）・オンライン決済済みは不可（従来の規則）。
2. 見積: 生きている部屋ごとに `book.quote(その部屋の rate_plan_id, room_type_id, p_checkin, p_nights, adult_count)`（`_amend_compute_dates` が部屋ループで返す）。クーポンは `percent` なら新しい合計で再計算して按分、`fixed` なら `least(旧割引, 新合計)` を按分。ポイントは `new_use = least(old_use, Σ new_charge)` を按分し、差分を返還（従来と同じ規則を束に広げたもの）。
3. ペナルティ判定: 部屋ごとに `_cancel_fee(その部屋の規定, room_total_i, 旧 checkin, 今日, rank)`。**1 室でも率 > 0**（かつ `allow_amend_in_penalty` でない）なら `amend_in_penalty`。
4. 在庫: 旧区間を部屋タイプごとに集計して +N → 新区間を部屋タイプごとに集計して `for update`・全泊 `available_rooms − buffer_rooms >= 必要数` → −N。**どれか 1 タイプでも足りなければ `sold_out:<room_type_id>` で全体を巻き戻す**（「在庫が全室ぶん確保できるときだけ」）。画面はその場合「この日程では全室を確保できません」と案内（部分変更はしない）。
5. 更新: `core.stays`（全室の日付）、`booking_rooms`（`price_lines`・`room_total`・`coupon_share`・`points_share`）、`booking.bookings`（`total_amount`・`tax_amount`・`metadata.amended_count/last_amended_at`）。規定の写しはプランが変わらないので据え置き。オプションの `needs_reschedule` は従来どおり。
6. `booking_amendments` に 1 行（`kind='dates'`・`before/after` に `rooms[]`）。電文 `modified`（`amendment.kind='dates'`・`rooms[]` N 件）。PMS の `expandDirectBooking` は日付の差分で泊行を作り直す（従来の 1 室の日程変更と同じ経路）。
7. 戻り `{booking_code, amendment_no, diff, new_total, points_refund, kind:'dates'}`。

- 見積だけの `book.quote_amendment_dates(p_booking_code, p_checkin, p_nights)` を同じ計算で（画面のプレビュー）。
- 既存 `amend_booking`（1 室の部屋・プラン・人数・日程）は `booking_rooms` を読むように直し、N≥2 の予約では `use_amend_dates` で拒否。
- 画面 `account/reservations/[code]/amend`: N≥2 は日付・泊数のピッカーだけを出す（候補の部屋・プランの選択は出さない）。

### 6.4 オプション（滞在アレンジ）

- `booking_option_orders.stay_id` で部屋を特定（既存）。追加画面で部屋を選ぶ（N≥2）。部屋の取消でその部屋の分を `cancelled`（§6.1 の 6）。

---

## 7. PMS 電文【提案】

### 7.1 `new` / `paid` / `refunded` / `modified`（`rooms[]` を N 件に）

- `rooms[i]`: `room_index`・`stay_id`・`reservation_code`・`room_type_id/code/name`・`adults`・`male/female`（`booking_rooms.guest_detail`）・`children`・`nights[]`（`price_lines`）・**`plan: {rate_plan_id, code, name, meal_plan}`**（新・部屋ごと）。トップの `plan` は 1 室目（PMS の既存の読み方の互換）。
- `cancellation_policy` は 1 室目の規定（PMS の `policySnapshot` 用・互換）、`price_snapshot` は `{rooms:[{room_index, lines, total}], lines:[全室結合], total}`。
- `amounts` は `_booking_totals` から（`gross_total = room_total`、`discount_total = coupon_discount`、`points_used`、`total_amount = bookings.total_amount`、`bath_tax`・`prepay_discount` は和）。
- **autumn-pms の小改修（決定 Q7・M1 と同時）**: `rooms[i].plan` があれば泊行の `plan_code`・コース解決にそれを使う（無ければトップの `plan`）。

### 7.2 部屋の取消 `modified`（`amendment.kind = 'room_cancelled'`）

- `rooms[]` は生きている部屋だけ。`amendment = {kind:'room_cancelled', cancelled_rooms:[{room_index, stay_id, reservation_code, room_type_name, fee}], remaining_rooms}`。
- **autumn-pms（要改修・M2 と同時）**: `modified` で `kind === 'room_cancelled'` のとき `cancelled_rooms[].stay_id` に `cancelStayServices`・`markOccupancyDirty`・`enqueueInventoryPush`、`cancellation_logs` に部屋分の記録。`stay_groups` は `active` のまま。改修前でも壊れない（現状の `modified` は `rooms[]` に無い滞在を触らない・`core.stays` は Book が cancelled にしトリガーで部屋割りが解放される。貸切風呂の枠だけ手で外す）。
- 最後の 1 室の取消は従来の `cancelled`。

---

## 8. 画面【提案】

### 8.1 流れ（スマホで迷わない形）

```
検索（日付・泊数・人数）→ プラン一覧 / プラン詳細（部屋の行）
   ├ 「この部屋で予約へ進む」… 1 室でそのまま予約入力へ（今と同じ 1 タップ）
   └ 「＋ もう 1 室追加」… 画面下の「予約かご」バーへ（在庫はまだ押さえない・sessionStorage）
        かごバー: 「2 室 ・ 大人 4 名 ・ 合計 ¥…  [内訳] [予約へ進む]」（別プラン・別タイプ・別人数を同じ要領で。同じ施設・同じ日程だけ。4 室まで）
→ 「予約へ進む」で全室を一括で仮押さえ（create_hold_group）→ /booking/hold?id=<束 id>
→ 予約入力（代表者 1 回・部屋ごとの人数内訳と質問・支払方法 1 回・合計 1 回）→ 完了（部屋ごとの明細）
```

- 押さえた瞬間に満室なら、どの部屋が取れなかったかを出して**かごはそのまま**残す。
- 日付・泊数・施設を変えたら「かごを空にしますか」。支払方法が両立しないプランは追加時に止める（Q3）。**4 室目をかごに入れた時点で**、かごバーの上に注意を出す（2026-10-10 ユーザー指示）: 「1 回のご予約は 4 室までです。5 室以上は、別のご予約にするか、お電話でお問い合わせください（日付が違うお部屋も別のご予約になります）」。4 室のあいだは「＋ もう 1 室追加」を押せない状態にし（押しても同じ文言）、5 室目はかご・RPC・DB の check でも止める。
- かごの内訳は下から出るシート（部屋の削除・人数の変更）。スマホはプラン詳細の固定フッターに重ねる。

### 8.2 プラン詳細

- `?/hold` を `rooms` JSON（1 室でも配列）を受ける形に。「＋ もう 1 室追加」はクライアント処理。同じタイプを 2 室は「追加」を 2 回（内訳で「和室 ×2」）。残室 `remaining` より多くは追加できない。

### 8.3 予約入力（`/booking/hold`）

- 束の期限（`HoldTimer` 1 つ）。「選び直す」は全室解放 → かごを残して戻る。
- 右欄（スマホは上の要約カード）: 部屋ごとのカード（部屋名／プラン名／大人 N 名／宿泊料金）→ 合計／クーポン／ポイント／予約時決済割（部屋ごとの額の合計・率が違うときは「部屋ごとに適用」）／入湯税／お支払い額。
- 本文: 代表者 1 回。部屋ごと: 男女の内訳（その部屋のプランの `askGender`）、`scope='room'` の質問（プランごとに `expandQuestions`・`answerKey(q, roomIndex)`）。`applyPlanAnswers` は部屋ごと → その部屋の `core.stays.notes` に。
- 支払方法 1 回。カード決済部品は従来どおり（Intent は束 1 つ）。`expectedAmount` は合計。

### 8.4 完了

- `LastBooking` cookie を `rooms[]` に（部屋ごとの `roomUuid`・`planUuid`・`adults`・`total`）。部屋ごとの明細＋合計＋付与予定ポイント。

### 8.5 マイページ

- 一覧: 1 予約 1 行・「3 室」のバッジ。
- 予約詳細: 部屋ごとのカード（部屋名／プラン名／人数／金額／状態）に「この部屋を取り消す」（その部屋のキャンセル料・返金の見込み）。下に「すべてのお部屋を取り消す」。日程変更は N≥2 で日付・泊数だけ（§6.3）。オプション追加で部屋を選ぶ。

### 8.6 非会員のキャンセル画面（`/booking/cancel?t=`）

- 部屋ごとのカード＋「この部屋を取り消す」／「すべてのお部屋を取り消す」（§6.2）。取消後も残りの部屋があれば同じリンクで続けて見られる。

### 8.7 メール

- 確認メール: 部屋ごとの明細（部屋名・プラン名・人数・泊ごとの料金）＋合計（`mail_render_context.booking.rooms[]`・`templates.ts` を `rooms[]` 対応に）。
- 部屋の取消メール `booking_room_cancelled`。全室取消は従来の `booking_cancelled`。日程変更のメールは従来どおり（全室の新日程）。

### 8.8 管理画面

- 予約一覧: 室数の列。予約詳細: 部屋ごとの表（状態・プラン・部屋・人数・金額・キャンセル料・返金）。取消フォームに「全室／この部屋だけ」・部屋ごとの免除。返金の内訳は `refunds[]` の `room_index`。

---

## 9. 段階分けと 2 エージェントの分担

### 9.1 段階

| 段 | 内容 | リポ |
|---|---|---|
| **M0** | DB の正規化とバックフィル（§2.3〜§2.9 の migration 1 本）。**Book を束の経路に切り替える（室数は 1 だけ）**。1 室で従来と同じ結果（電文・メール・マイページ・管理画面・yamado-one）になることを確認する段 | autumn-shared / autumn-book |
| **M1** | 複数室の画面: かご・`?/hold` の `rooms[]`・予約入力の部屋ごと表示と質問・完了・確認メール・マイページ一覧・管理画面の表示。autumn-pms の `rooms[i].plan` | autumn-book / autumn-shared（メール）/ autumn-pms |
| **M2** | 部屋ごとの取消（会員・**非会員**・管理画面）: `cancel_booking_room`・`guest_cancel_booking_room`・`refund_due` の部屋対応・`refundAfterCancel({roomIndex})`・`booking_room_cancelled` メール。**全室同時の日程変更**: `amend_booking_dates`・`quote_amendment_dates`・画面。autumn-pms の `room_cancelled` 受け | autumn-shared / autumn-book / autumn-pms |
| **M3** | 部屋ごとの部屋・プラン・人数の変更（複数室の予約）・子ども区分・退避表の drop（M0 の 30 日後） | — |
| **VIP** | `docs/vip-member-page.md` §13 を本設計に合わせて実装（§12） | — |

> M0・M1・M2 の DB は **3 本の migration に分けてよい**（M0 は大きいので単独。M1 は `_emit_pms_event` の `plan`、M2 は取消・日程変更の RPC）。いずれも実 UTC 秒・`new-migration.sh`。

### 9.2 分担（団体予約・特別会員と同じ流儀: **A が先に終わり §14 を書いてから B が作る**）

| 担当 | ファイル |
|---|---|
| **A: DB／サーバ** | autumn-shared の migration（§2.9・M2 の RPC）と `functions/send-booking-mail/templates.ts`（`rooms[]`・`booking_room_cancelled`）、`lib/multi-room.ts`（純関数＋テスト: `allocateByWeight`・`canAddToCart`〔施設・日程・支払方法の両立・4 室・残室〕・`roomRefundPreview`・`MAX_ROOMS_PER_BOOKING = 4`・型 `CartItem` / `HoldGroup` / `BookingRoom`）、`lib/server/supabase-data.ts`（`createHoldGroup`・`sbGetHoldGroupMapped`・`releaseHoldGroup`・`confirmBookingGroup`・`sbMyReservations` の `rooms`・`sbCancelBookingRoom`・`sbComputeCancelFee(code, roomIndex?)`・`sbQuoteAmendmentDates` / `sbAmendBookingDates`・`guestCancelBookingRoom`・`LastBooking` / `BookingDraft` の `rooms[]`）、`lib/server/direct-payments.ts`（束 id・`refundAfterCancel({roomIndex})`）、`lib/server/direct-booking-finish.ts`、`lib/server/booking-questions.ts`（部屋ごとの `applyPlanAnswers`）、`routes/(public)/[brand]/[facility]/plans/[plan]/+page.server.ts`、`routes/(public)/booking/hold/+page.server.ts`・`pay/+server.ts`・`pay/return`・`complete/[code]`・`cancel/+page.server.ts`（`?/cancelRoom`）、`routes/(public)/account/+page.server.ts`・`reservations/[code]/+page.server.ts`（`?/cancelRoom`）・`amend/+page.server.ts`（N≥2 は日付だけ）・`options/+page.server.ts`、`routes/admin/reservations/[code]/+page.server.ts`、`lib/server/admin-app-data.ts`、`lib/types.ts` |
| **B: 画面** | `plans/[plan]/+page.svelte`（2 つのボタン・`lib/components/BookingCart.svelte`〔新規〕・内訳シート）、`booking/hold/+page.svelte`（部屋カード・部屋ごとの男女と質問）、`PriceBreakdown.svelte`（部屋ごとの行）、`booking/complete/[code]/+page.svelte`、`booking/cancel/+page.svelte`（部屋カード・部屋ごとの取消）、`account/+page.svelte`、`account/reservations/[code]/+page.svelte`（部屋カード・取消）、`…/amend/+page.svelte`（N≥2 は日付だけ）、`…/options/+page.svelte`（部屋選択）、`admin/reservations/+page.svelte`・`[code]/+page.svelte`、`lib/components/admin/BookingRoomsTable.svelte`（新規） |

**A → B の契約（骨子。A が §14 に正式版を書く）**

- `?/hold`（プラン詳細）: 入力 `rooms` JSON `[{planId, roomTypeId, adults}]`（1〜4）・`checkin`・`nights`・`back`・`via`・Turnstile。成功 303 `/booking/hold?id=<group_id>`。失敗 `fail(409, {message, soldOut:[{roomTypeId, roomName}]})`・`fail(429)`・`fail(400, {message, code:'too_many_rooms'|'mixed_payment'|'mixed_facility'})`。
- `/booking/hold` load: `hold: { id, facilityId, checkin, nights, expiresAt, status, rooms:[{ index, holdId, roomTypeId, planId, adults, quote }], total }`、`roomsView:[{ index, room, plan, adults, quote, askGender, questions }]`、`payOptions`、`bathTax`、`prepay:{ total, rooms:[{index, amount, permille, early}], mixedRates }`、`member`、`adminFeePercent`、既存の `planHref/backHref/via`。
- `?/submit`・`pay prepare`: 従来 ＋ 部屋ごとの `male@i` / `female@i` / 質問 `${q.id}@i`。
- `LastBooking`: `rooms:[{ roomUuid, planUuid, adults, total }]`。
- `/account/reservations/[code]` load: `booking` ＋ `rooms:[{ index, stayCode, roomName, planName, adults, total, status, cancelFee, cancelPreview, refundPreview }]`、`canCancelRoom`、`amend:{ …, datesOnly: boolean }`。actions `?/cancel`・`?/cancelRoom(roomIndex)`。
- `/booking/cancel` load（`state:'ready'`）: `booking` ＋ `rooms[]`（上と同じ形）、actions `?/cancel`（全室）・`?/cancelRoom(roomIndex)`。
- `/account/reservations/[code]/amend`（N≥2）: load `{ current:{ checkin, nights, rooms[] }, quote: AmendDatesQuote | null }`、action `?/amend(checkin, nights)`。
- `/admin/reservations/[code]`: `rooms[]` ＋ 返金実績。`?/cancel` に `scope:'all'|'room'`・`roomIndex`。

**順序**: A が M0 の migration を書く → **PROD で §2.8 の件数を読み取りで確かめる** → main に push → `supabase db push --linked` → `migration list --linked` と `information_schema`・`_assert_booking_totals` 全件で確認 → M0 の TS（1 室で従来と同じ結果）→ §14 → B。M1・M2 も同じ手順。親がレビュー・結合・バージョン（MINOR）・HANDOFF.md の転記。

---

## 10. テストチェックリスト（HANDOFF.md 転記用）

### DB・バックフィル（M0）
- [ ] 適用前に §2.8 の件数を読み取り、適用後に `booking_rooms` の行数が公式予約の件数と一致・`hold_groups` の行数が旧 `holds` の行数と一致・`_assert_booking_totals` 全件が通る
- [ ] 既存予約の `bookings.rate_plan_id` が null・`cancellation_policy_snapshot` が null・`metadata` から `price_snapshot`／`points_used`／`coupon.discount` が消え、同じ値が `booking_rooms` にある。退避表 `_mr_backup_*` がある
- [ ] `direct_payments.hold_id` が束 id に変わり、支払済みの予約の返金（管理画面の再実行）が従来どおり動く
- [ ] 旧署名 `create_hold`（yamado-one）→ `get_hold` → `confirm_booking` → `my_reservations` → `cancel_booking` が従来の形で動き、DB には束＋部屋の 1 通りで入る
- [ ] `create_hold_group`: 1 室で従来の `create_hold` と同じ見積・在庫 −1・20 分。3 室（和室 ×2・洋室 ×1）で和室 −2・洋室 −1。和室の残り 1 で `sold_out`（何も減らない）。5 室は `invalid_room_count`。同一 IP 10 分 21 束目は `rate_limited`
- [ ] `confirm_booking_group`: 1 室で従来と同じ電文・メール・マイページの見え方。3 室で `core.stays` 3 行（`-1/-2/-3`）・`booking_rooms` 3 行・`bookings` 1 行（`total_amount` ＝ 和 − クーポン）
- [ ] 按分: クーポン 1,000 円・部屋 30,000 / 20,000 → 600 / 400。ポイント 1,001 → 端数が 1 室目。合計が必ず一致
- [ ] `direct_payment_prepare/confirm`（束）: 請求額 ＝ Σ(部屋の宿泊料金 − 部屋の割引) − ポイント ＋ Σ 入湯税。早期決済割の対象プランと対象外が混ざっても部屋ごとの率。日付をまたいだ確定は `late`
- [ ] `my_reservations`: 3 室の予約が 1 行・`rooms` に 3 件・既存列（1 室目）が入る
- [ ] `_finalize_booking`: 1 室取り消した予約の宿泊後、残った部屋の金額で確定。早期決済ポイントが Σ `prepay_detail.bonus_points × 支払残の比`

### 取消・日程変更（M2）
- [ ] `cancel_booking_room`: 2 室目だけ取消 → その滞在だけ `cancelled`・在庫 +1（そのタイプ）・`total_amount` 減・`cancellation_fee` にその部屋の規定の額・`points_share` 返還・電文 `modified`（`room_cancelled`）・メール `booking_room_cancelled`。残り 1 室の取消で予約が `cancelled`・電文 `cancelled`・クーポン復帰・リンク無効
- [ ] 全室一括（マイページ「すべて」・非会員「すべて」・管理画面）: 電文 `cancelled` 1 本・メール 1 通・キャンセル料は部屋ごとの合計
- [ ] `guest_cancel_booking_room`: メールのリンクから 2 室目だけ取消でき、リンクは残りの部屋に対して生きている。全室取り消すとリンクが使えなくなる
- [ ] `direct_payment_refund_due`: 1 室取消後の返金 ＝ その部屋の支払分 − max(キャンセル料, 割引, 事務手数料)。2 室目で 2 回目の返金が正しい。全室の合計が 1 室ずつの合計と一致（事務手数料の 1〜2 円差は許容）。`refunds[]` に `room_index`
- [ ] `amend_booking_dates`: 3 室の予約を 1 日ずらす → 全室の日付・料金が変わり、在庫が旧区間 +N・新区間 −N。1 タイプでも足りないと `sold_out` で何も変わらない。1 室でもペナルティ期間なら `amend_in_penalty`。オンライン決済済みは不可。電文 `modified`（`dates`）で PMS の泊行が作り直される
- [ ] 1 室の予約の `amend_booking`（部屋・プラン・人数・日程）が従来どおり。2 室以上で呼ぶと `use_amend_dates`

### 公式サイト（本番ドメインまたは localhost・会員と非会員）
- [ ] プラン詳細の部屋の行に「この部屋で予約へ進む」と「＋ もう 1 室追加」。1 室はこれまでと同じ手数
- [ ] 「追加」でかごバー（室数・人数・合計）。内訳で外す・人数変更。同じタイプ 2 回で「×2」。残室より多く追加できない。5 室目は追加できない
- [ ] 別の日付・施設で「かごを空にしますか」。支払方法が両立しないプランは追加できず理由が出る
- [ ] 「予約へ進む」で全室が押さえられ、予約入力に部屋ごとのカードと合計・期限 1 つ。1 室だけ満室だとどの部屋かが出てかごは残る
- [ ] 部屋ごとの男女の内訳（聞かないプランの部屋は出ない）と質問（「2室目 …」）。現地払いで確定 → 完了画面とメールに部屋ごとの明細
- [ ] カード決済で確定（請求額 ＝ 画面の合計・保存カードも可）。早期決済割の対象 1 室＋対象外 1 室で割引が対象の部屋だけ
- [ ] 「選び直す」で全室解放・かごが残る。20 分で全室期限切れ
- [ ] PMS の予約詳細に 1 グループ・部屋ごとの滞在（**部屋ごとのプラン名**・人数・泊ごとの料金・要望欄にその部屋の回答）
- [ ] スマホ（iPhone・Android）でかごバーと部屋カードが横にはみ出さない

### マイページ・非会員・管理画面
- [ ] 一覧に「3 室」。詳細に部屋ごとのカード（状態・金額・キャンセル料と返金の見込み）。「この部屋を取り消す」→ その部屋だけ取消・返金。「すべて」→ 全体取消
- [ ] 2 室以上の日程変更は日付・泊数だけの画面。確保できない日程は「全室を確保できません」。1 室は従来の画面
- [ ] 非会員のキャンセル画面に部屋ごとのカード。1 室だけ取り消した後も同じリンクで残りを見られる
- [ ] オプション追加で部屋を選べる。取り消した部屋のオプションは取消済み
- [ ] 管理画面: 一覧に室数・詳細に部屋の表・取消フォームで「この部屋だけ」（理由必須・免除）・返金の再実行が部屋の累計で正しい
- [ ] 1 室の予約の見え方・操作がこれまでと変わらない

---

## 11. 要確認（残り）

決定済み: Q1（4 室・**4 室目を入れた時点で注意表示**）・Q2・Q3・Q4・Q5（非会員も最初から）・Q6・Q7・Q8（全室同時・最初から）・Q9・Q10（正規化・バックフィル）。

> **2026-10-10 決定: Q11〜Q13 は推奨どおり**（ユーザー回答）。

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| Q11 | バックフィルの退避表 `_mr_backup_*` をいつ消すか | A. 30 日後に別 migration で drop／B. 消さない | **A**（M3 に含める） |
| Q12 | `holds.room_total`（`price_lines` から導ける唯一の冗長列）を持つか | A. 持つ（在庫・合計の計算で毎回 JSON を展開しない・trigger で一致を検証）／B. 持たず毎回 `lines` から和を取る | **A**（`booking_rooms.room_total` も同じ扱い） |
| Q13 | 複数室の予約で**部屋ごとの部屋・プラン・人数の変更**（日程以外）をいつ入れるか | A. M3／B. M2 で日程変更と一緒に | **A**（まず全室同時の日程変更で様子を見る） |

---

## 12. 特別会員の設計（`docs/vip-member-page.md` §13）で直すべき点

§13.8 の決定（Q2 変更: 室数に制限なし → 本書で 4 室・公式の複数室を先に実装し、特別会員はその上に載せる）を受けて、§13 を次のとおり書き換える。

| # | 箇所 | 今の記述 | 直し方 |
|---|---|---|---|
| V1 | §13.3.3 `book.create_member_page_hold` の署名 | 1 室（`p_rate_plan_id, p_room_type_id, …, p_lines`） | **`book.create_member_page_hold_group`** にし、本書 §3.1 の `create_hold_group` を丸ごと写す。`p_rooms = [{rate_plan_id, room_type_id, adults, lines:[…専用料金の泊明細…]}]`（1〜4）。見積部分だけ「TS が渡す `lines` を部屋ごとに検証（長さ＝泊数・日付連続・`unit_price > 0`・`subtotal = unit_price × adults`）」に差し替え。戻りは `create_hold_group` と同じ |
| V2 | §13.3.4 `price_snapshot.member_page` の置き場所・Z3「列は足さない」 | 仮押さえ 1 行の `price_snapshot.member_page` | 束のもの（`partner_id`・`facility_id`・`member_user_id`・`page_name`・`cancel_policy_mode`・`cancel_rules`）は **`hold_groups.metadata.member_page`** → 確定で `bookings.metadata.member_page`。部屋のもの（**そのプランに付く `perks` の写し・`plan_display_name`**）は **`holds` と `booking_rooms` に `member_perks jsonb null` 列**（VIP の migration で追加・正規化の原則どおり部屋の値は部屋の表）。`price_snapshot` は無くなる（`price_lines`＋`room_total`）ので Z3 の判断は不要 |
| V3 | §13.3.5 `confirm_booking` の差し替え元 | `confirm_booking`（`20260907113300`） | **`confirm_booking_group`**（本書 §3.2）。キャンセル規定の合成（`page` / `favorable`）は**部屋ごとの `booking_rooms.cancellation_policy_snapshot`** に対して行う（`bookings.cancellation_policy_snapshot` は null のまま・§2.5） |
| V4 | §13.3.6 `_cancel_fee` | そのまま | 変更不要（部屋ごとに呼ばれる）。呼び元は `cancel_booking_room` / `_cancel_room_core` / `compute_cancel_fee(code, room_index)` / `_amend_compute_dates` |
| V5 | §13.1 Z6・§13.2 V4「複数室（1 予約 1 室・Q2）」 | 1 室固定 | 削除。「公式の複数室（4 室まで）の上に載る」に |
| V6 | §13.4.3 1.「member は室数 1 に固定」 | `rooms=1` | 取引先ページの料金カレンダーの室数（同じタイプ×N 室）を使い、`/p/[token]/book`（member 版）で `rooms[]` を組んで `create_member_page_hold_group` に渡す。公式の `BookingCart.svelte` を取引先ページで使うかは V 実装時の判断 |
| V7 | §13.4.3 3. `createMemberPageHold` → `/booking/hold?id=<hold_id>` | 1 室 | `createMemberPageHoldGroup` → `/booking/hold?id=<group_id>`。`HOLD_NAV_COOKIE` の `id` は束 id |
| V8 | §13.4.3 4.「`sbGetHoldMapped` に `memberPage`」 | 1 室 | `sbGetHoldGroupMapped` の戻りに `memberPage`（束）と `rooms[i].perks`（部屋） |
| V9 | §13.6 契約 `fixedRooms: 1 \| null` | 1 室固定 | 削除。`maxRooms: 4` |
| V10 | §13.6 契約 `/booking/hold` の `memberPage: { pageName, perks, cancelMode, backHref }` | 束 1 つ分の特典 | `memberPage: { pageName, cancelMode, backHref }` ＋ `rooms[i].perks` |
| V11 | §13.7 チェックリスト「室数は 1 に固定」 | 1 室 | 「2 室（同じタイプ）で予約でき、専用料金が 2 室分・特典が部屋ごと。1 室だけ取り消すとその部屋の専用規定（favorable / page）で計算」に |
| V12 | §13.8 Q2 | 推奨 A（1 室） | 「決定: 複数室・4 室まで（`docs/official-multi-room.md`）」 |
| V13 | §13.4.4 要望欄「【特別会員特典】title／title」 | 予約全体に 1 行 | 部屋ごとに特典が違うので**その部屋の `core.stays.notes`** に（`confirm_booking_group` の `p_rooms_detail[i].notes_prefix`） |
| V14 | §13.5 本人確認「`holds.session_id` …」 | 1 行 | `hold_groups.session_id` / `member_user_id` |
| V15 | §13.2 V1・§13.6 A の名前 | `create_member_page_hold` / `member-hold.ts` | `create_member_page_hold_group` / `createMemberPageHoldGroup` |
| V16 | §13.3「1 ファイル」 | — | VIP の migration は本書 M0〜M2 の **後ろの実秒**で切る（`create_hold_group` / `confirm_booking_group` を写すため） |

---

## 付録 A. 変えないもの（互換）

- `booking.bookings` / `core.stays` の **DDL**（列の追加・削除なし）。公式予約の行で使わなくなる列・キーは §2.5 のとおり。
- 旧署名 `create_hold(7 引数)`・`get_hold`・`confirm_booking(6 引数)`・`cancel_booking`・`my_reservations` の**戻りの列名**（yamado-one）。中身は束＋部屋の 1 通りのデータに向ける。
- 予約番号 `YB-YYYY-NNNNNN`・完了画面 URL・マイページ URL・非会員のキャンセルリンク（トークン）。
- 電文 `autumn.direct_booking/1` の形（`rooms[]` が N 件・`rooms[i].plan` が増えるだけ）。
- Stripe の PaymentIntent・Webhook・保存カード。`_cancel_fee`・`_finalize_booking`・`rank_cancel_policies`。

## 付録 B. 気になる点（今回は直さない）

- `/booking/hold/+page.server.ts` の `REWARD_RATE` 直書き（`member_ranks.reward_rate` と二重）。
- 取引先予約（`rms_partner_create_booking`）の「部屋タイプ・プランは 1 件に 1 つ」と `core.stays.metadata.room_index` の持ち方は本設計の範囲外（取引先側の正規化は別件）。
- `direct_payments` の `lodging_amount`・`bath_tax_amount`・`prepay_discount_amount`・`prepay_discount_detail` は「準備時の作業値」として残る（既存 not null・Stripe の請求額を決めるのに要る）。確定後の正は `booking_rooms`。将来 nullable にして確定時に消すことも検討。

---

## 14. 実装メモ（M0・サーバ側の契約）

> 2026-10-10 A（DB／サーバ）。autumn-shared・autumn-book とも **commit / push なし・本番 DB 未適用**。親がレビューして反映する。
> 検証: 本番には書かず、ローカルの使い捨てコンテナ（`public.ecr.aws/supabase/postgres:17.6.1.084`）に本番の列を写した最小スキーマと本番を模した行を入れ、migration → 各 RPC → 巻き戻し SQL まで流して確認した（§14.9）。

### 14.1 migration（1 本）

| 順 | ファイル | 中身 |
|---|---|---|
| 1 | `autumn-shared/supabase/migrations/20261010092423_book_multi_room_m0.sql` | §2 の正規化・バックフィル・検証・関数の差し替え（§2.9 の M0 分）・権限・`notify pgrst`。末尾のコメントに巻き戻し SQL |

- 構造変更とバックフィルは**分けていない**（`holds` の列を落とす前に束へ写す必要があり、1 トランザクションで失敗時に全体を戻すため）。`supabase db push` はファイル単位でトランザクションに包む前提（親が `--dry-run` で確認すること）。
- 関数の「写す元」は **PROD の `pg_get_functiondef`**（`schema_migrations` は `20261010053641` まで一致を確認済み）。各関数の直前のコメントに元の migration を書いた。
- ファイル内の節: 0 純関数 → 1 退避表 → 2 `hold_groups` → 3 `holds` を痩せさせる → 4 `booking_rooms` とバックフィル → 5 集計・引き方の関数 → 6 検証（`raise exception` で全体を戻す）→ 7 仮押さえ RPC → 8 確定 → 9 決済 → 10 取消 → 11 管理画面・マイページ → 12 日程変更 → 13 PMS 電文 → 14 権限。

### 14.2 表

- **`book.hold_groups`**（新）: §2.3 のとおり。`member_user_id` は `on delete set null`（退会を仮押さえで止めない）。RLS は施設スタッフの select だけ・anon は権限なし。
- **`book.holds`**（変更後）: `id, group_id, room_index, room_type_id, rate_plan_id, adult_count, child_counts, price_lines, room_total, created_at`。`unique(group_id, room_index)`・`room_index between 1 and book._max_rooms_per_booking()`・trigger `_check_room_total`（`price_lines` が空でなければ Σsubtotal = room_total）。
- **`book.booking_rooms`**（新）: §2.4 のとおり（列名も同じ）。PK `stay_id`・`unique(booking_id, room_index)`・同じ trigger。RLS は施設スタッフの select だけ。
- **退避表** `book._mr_backup_bookings`（公式予約の `id, stay_id, rate_plan_id, cancellation_policy_snapshot, metadata, total_amount, cancellation_fee`）・`book._mr_backup_holds`（旧 `holds` 全列）。service_role の select だけ。M3 で drop（Q11）。
- `booking.bookings` は列の追加・削除なし。式索引 `bookings_book_code_idx ((metadata->>'booking_code'))` だけ足した。

### 14.3 バックフィルと巻き戻し

- **公式予約の判定**: `metadata ? 'hold_id' かつ metadata ? 'booking_code'`（`hold_id` は `book.confirm_booking` だけが書く。取引先予約も `booking_code` を持つが `hold_id` は持たない。チャネルでは判定しない・§14.10-1）。判定は退避表を作るところ 1 か所で、以後のバックフィル・検証はその id を使う。
- **取消済みの部屋の判定**: 予約が `cancelled` のときだけ（PMS 側だけで滞在が取り消された予約は生きている部屋のまま・§14.10-4）。
- **仮押さえ**: 旧 `holds` 1 行 → 束 1 行。**束 id ＝ 旧 hold id**（`metadata.legacy_hold_id` にも残す）。`direct_payments.hold_id`・Stripe の `metadata.hold_id` は書き換えない。部屋は `group_id = id, room_index = 1, price_lines = price_snapshot.lines, room_total = price_snapshot.total`。
- **予約**: 1 件 → `booking_rooms` 1 行（§2.8 手順 4 のとおり。`prepay_*`・`bath_tax` は `metadata.payment` → 無ければ支払済みの `direct_payments`）。取消済みは `cancelled_at = bookings.cancelled_at`・`cancel_fee = bookings.cancellation_fee`・`cancel_fee_detail = metadata.cancel_rank_benefit`・`cancel_kept` はオンライン決済なら `refund_due` と同じ式、現地払いはキャンセル料。
- `bookings` の公式予約行: `rate_plan_id = null`・`cancellation_policy_snapshot = null`・`metadata` から `price_snapshot / points_used / cancel_rank_benefit / coupon.discount / guest.male / guest.female` を外し、`hold_id` → `hold_group_id`。
- **検証（節 6）**: 件数（公式予約 = `booking_rooms`、旧 holds = `hold_groups` = `holds`）と `_assert_booking_totals` 全件・掃除漏れが無いこと。どれか合わなければ `raise exception` → 何も適用されない。`raise notice` に件数が出る。
- **巻き戻し**（migration 末尾のコメント。`begin … commit` で流す）: ①2 室以上の予約・束が無いことを確かめる ②**関数を先に戻す**: 適用前に親が保存した `pg_get_functiondef`（`autumn-shared/docs/rollback/20261010092423_functions_before.sql`・保存の SQL は §14.6）を、`set local check_function_bodies = off`・`drop function book.my_reservations()` の後に当て直し、`my_reservations` の権限を付け直す ③`booking_rooms` から予約の行へ値を戻す（M0 後にできた 1 室の予約も戻る）④束＋部屋 → 旧 `holds`（1 室目の id ＝ 束 id なので `direct_payments` はそのまま）⑤新しい表・関数 19 本・索引を drop。コンテナで ②〜⑤ が通り（SQL 関数の `get_hold` 等も旧の表で動く）、旧の形に戻ることを確認済み。
- **差し替えた既存関数（26 本）**: `book._release_hold(uuid)`、`book.create_hold(text, uuid, uuid, date, integer, integer, text, uuid, text)`、`book.get_hold(uuid, text)`、`book.release_hold(uuid, text)`、`book.release_expired_holds()`、`book.direct_payment_bath_tax(uuid, text, uuid)`、`book.direct_payment_attach_intent(uuid, text, integer)`、`book.direct_payment_get(text, text, uuid)`、`public.rms_partner_room_type_remaining(uuid, uuid, date, date)`、`book.confirm_booking(uuid, text, jsonb, integer, text, uuid)`、`book.direct_payment_prepare(uuid, text, uuid, jsonb, integer, text)`、`book.direct_payment_confirm(uuid, text, integer)`、`book._grant_prepay_bonus(uuid)`、`book._cancel_booking_core(text, boolean, text, text, uuid)`、`book.cancel_booking(text, boolean, text)`、`book.compute_cancel_fee(text, date)`、`book.guest_booking_by_token(text)`、`book.mail_render_context(uuid)`、`book.direct_payment_set_admin_fee_waived(text, boolean)`、`book.admin_booking_detail(text)`、`book.admin_list_bookings(uuid, text, text, text, date, date, uuid, integer, integer)`、`book.my_reservations()`（drop → create）、`book._amend_compute(core.stays, booking.bookings, uuid, uuid, date, integer, integer)`、`book.amend_booking(text, uuid, uuid, date, integer, integer)`、`book.quote_amendment(text, uuid, uuid, date, integer, integer)`、`book._emit_pms_event(uuid, text, jsonb)`。7 引数の `book.create_hold` は無変更。
- **新しく作った関数（19 本・すべて `book`）**: `_max_rooms_per_booking()`・`_allocate(integer, integer[])`・`_quote_of(jsonb, integer, integer)`・`_room_cancel_kept(integer, integer, integer, integer, boolean, numeric, boolean)`・`_merge_prepay_details(jsonb)`・`_check_room_total()`・`_booking_totals(uuid)`・`_assert_booking_totals(uuid)`・`_booking_by_code(text)`・`_hold_group_id(uuid)`・`_hold_group_restore_inventory(uuid, date, date)`・`_booking_cancel_fee(uuid, date, text)`・`_booking_rooms_view(uuid)`・`_release_hold_group(uuid)`・`create_hold_group(text, uuid, date, integer, jsonb, text, uuid, text)`・`get_hold_group(uuid, text)`・`release_hold_group(uuid, text)`・`confirm_booking_group(uuid, text, jsonb, integer, text, uuid, jsonb)`・`_confirm_booking_group(uuid, text, jsonb, integer, text, uuid, jsonb, jsonb)`。

### 14.4 RPC（DB）

**新規**

| 関数 | 権限 | 入力 | 出力・例外 |
|---|---|---|---|
| `book.create_hold_group(p_session_id, p_facility_id, p_checkin, p_nights, p_rooms jsonb, p_client_key, p_member_user_id, p_locale='ja')` | service_role | `p_rooms = [{rate_plan_id, room_type_id, adults, child_counts?}]`（1〜4・並び順＝room_index） | `{group_id, hold_id(=group_id), expires_at, total, rooms:[{hold_id, room_index, room_type_id, rate_plan_id, adults, quote}]}`。例外 `invalid_params / invalid_locale / invalid_room_count / rate_limited / too_many_holds / plan_not_found / room_not_found / not_sellable / min_stay_violation / sold_out:<room_type_id>`。在庫は部屋タイプごとの必要数で全泊を確認（足りなければ何も減らさない）。**1 室目の `holds.id` は束 id と同じ値** |
| `book.get_hold_group(p_group_id, p_session_id)` | anon・authenticated・service_role | 束 id（部屋 id でも可） | `{group_id, hold_id, status, expires_at, facility_id, checkin_date, checkout_date, locale, guest_draft, total, rooms:[{hold_id, room_index, room_type_id, rate_plan_id, adult_count, child_counts, quote}]}` ＋ **1 室目の写し** `room_type_id, rate_plan_id, adult_count, child_counts, quote`。本人（セッション or 束の会員）以外は null |
| `book.release_hold_group(p_group_id, p_session_id)` | service_role | | `'released' / 'not_found' / 'not_active' / 'in_payment'`（全室の在庫を戻す） |
| `book.confirm_booking_group(p_group_id, p_session_id, p_guest, p_points_used=0, p_locale='ja', p_member_coupon_id=null, p_rooms_detail jsonb=null)` | anon・authenticated・service_role | `p_rooms_detail = [{male, female, notes, answers}]`（並び順＝room_index。null なら 1 室目の男女は `p_guest.male/female`） | 従来の `confirm_booking` のキー ＋ `rooms:[{room_index, stay_id, reservation_code, charge}]`。例外は従来どおり（`hold_expired / forbidden / invalid_guest / coupon_invalid / invalid_locale`） |
| `book._confirm_booking_group(…, p_rooms_detail, p_pay jsonb)` | service_role | `p_pay = [{room_index, prepay_discount, prepay_detail, bath_tax}]` | 確定の本体。**決済の内訳は anon から渡せない**ように公開版と分けた |
| `book._booking_totals(booking_id)` | service_role | | §2.6 の列（生きている部屋 ＝ `booking_rooms.cancelled_at is null`） |
| `book._assert_booking_totals(booking_id)` | service_role | | 合わなければ `booking_totals_mismatch: …` |
| `book._booking_by_code(code)` | service_role | 予約コード or 滞在コード（`YB-…-2`） | 公式予約（`booking_rooms` を持つ行）だけ。無ければ null |
| `book._booking_cancel_fee(booking_id, as_of, rank)` | service_role | | 1 室は `_cancel_fee` の戻りそのまま。複数室は 1 室目の戻り＋`fee/base` の和・`rate` の最大・`rooms[]` |
| `book._booking_rooms_view(booking_id)` | service_role | | 部屋の表示用 `[{room_index, stay_id, reservation_code, room_type_id, room_name, rate_plan_id, plan_name, meal_plan, adults, male, female, stay_status, cancelled, cancelled_at, price_lines, room_total, coupon_share, points_share, prepay_discount, bath_tax, charge, paid_share, cancel_fee, cancel_kept, cancel_waived, cancellation_policy}]` |
| `book._allocate(amount, weights[])` / `_quote_of` / `_room_cancel_kept` / `_merge_prepay_details` / `_hold_group_id` / `_hold_group_restore_inventory` / `_release_hold_group` / `_max_rooms_per_booking()` | service_role | | 内部 |

**差し替え（署名・戻りの形は従来どおり。変わる点だけ）**

| 関数 | 変わる点 |
|---|---|
| `create_hold`（9 引数・service_role） | `create_hold_group` の 1 室呼び。戻り `{hold_id, expires_at, quote}` は従来どおり（hold_id ＝ 束 id）。7 引数（yamado-one）は 9 引数を呼ぶだけなので無変更 |
| `get_hold` | 部屋＋束から従来の形（`quote` は `_quote_of` で組み直し `locale` 付き） |
| `confirm_booking`（6 引数） | `_confirm_booking_group` を呼ぶ。戻りに `rooms` が増えるだけ |
| `release_hold` / `_release_hold` / `release_expired_holds` | 束単位（全室の在庫を戻す。`release_expired_holds` の戻りは束の件数） |
| `direct_payment_prepare` | 束の全室。**全室のプランで予約時決済が許されているときだけ**。割引・入湯税を部屋ごとに計算し、合計を従来の列に、部屋ごとの内訳を `prepay_discount_detail.rooms[]`（`_early_prepay_discount` の戻り＋`room_index`・`bath_tax`）に。1 室なら `prepay_discount_detail` は従来の内訳＋`rooms` |
| `direct_payment_confirm` | `prepay_discount_detail.rooms[]` を `p_pay` にして `_confirm_booking_group`。内訳が無い行（M0 適用前に準備した支払）は 1 室目に全額。部屋の支払分の和 ≠ 請求額なら `late`（全額返金） |
| `direct_payment_bath_tax` / `attach_intent` / `get` | 束 id（部屋 id でも可） |
| `direct_payment_set_admin_fee_waived` | 印を付けたら取消済みの部屋の `cancel_kept` を計算し直す（管理画面は取消の後に印を付けるため） |
| `_grant_prepay_bonus` | `bonus_points` の元を `Σ booking_rooms.prepay_detail.bonus_points` に（部屋が無い行は従来） |
| `_cancel_booking_core` | `_booking_by_code` で引き、生きている部屋を部屋ごとに取消（部屋の規定 × 部屋の宿泊料金・在庫 +1・`cancel_*` 記録）。`total_amount` は変えない。`cancellation_fee = Σ cancel_fee`。`metadata.cancel_rank_benefit` は書かない（`booking_rooms.cancel_fee_detail` へ）。ポイント返還は取り消した部屋の `points_share` の和。公式予約でない行は `not_direct_booking` |
| `cancel_booking` / `compute_cancel_fee` | `_booking_by_code`（滞在コードでも可）。公式予約でない行は従来の式（`compute_cancel_fee`）。署名は据え置き（`p_room_index` は M2） |
| `guest_booking_by_token` / `mail_render_context` / `admin_booking_detail` | 規定・プラン・金額を部屋から。既存キーは同じ値（1 室）。`booking.room_count`・`booking.rooms[]`（`_booking_rooms_view`。anon の `guest_booking_by_token` だけは `stay_id` を落とす）を追加。`price_lines` は全室の泊明細の結合、`discount` / `points_used` は部屋の和 |
| `admin_list_bookings` | 滞在 1 行のまま。予約は lateral で「部屋の予約（主キー）」か「滞在の予約（stay_id の一意索引）」の 1 行を引く（OR 結合をやめて索引が効く形に。結果が同じことをコンテナで確認）。プランは部屋のプラン |
| `my_reservations` | drop → create（**既存 17 列の名前・順序は同じ**）。公式予約は `booking_code` が予約コード・`rate_plan_id` / `cancellation_policy` は 1 室目・`points_used` は和。末尾に `room_count integer, rooms jsonb` |
| `_amend_compute` / `amend_booking` / `quote_amendment` | 部屋の値で計算・更新（`booking_rooms` の `rate_plan_id / price_lines / room_total / coupon_share / points_share / cancellation_policy_snapshot`）。`bookings.rate_plan_id` は null のまま、`metadata` に `price_snapshot / points_used / coupon.discount` を書かない。2 室以上は `amend_booking` が `use_amend_dates`、`quote_amendment` は `room_count` と `amendable=false` |
| `_emit_pms_event` | `rooms[]` を部屋の数（予約中は生きている部屋・取消は全室）・**`rooms[i].plan` も入れた**（M1 の予定を前倒し）。トップの `plan` / `cancellation_policy` は 1 室目。`amounts` は同じ部屋の集合の和、`amounts.coupon` は `metadata.coupon ＋ discount`（PMS が読む）。`price_snapshot` は 1 室なら従来の見積の形＋`rooms`、複数室は `{lines(結合), total, locale, rooms}` |
| `public.rms_partner_room_type_remaining` | 仮押さえの CTE を束×部屋に（取引先ページの残室） |

変えていない: `direct_payment_refund_due`・`direct_payment_record_refund`（全室取消では従来の式で同じ額。部屋ごとの返金は M2）、`_finalize_booking`、`_cancel_fee`、`guest_cancel_booking`、`admin_cancel_booking`。

### 14.5 Book のサーバ関数（autumn-book）

| ファイル | 契約 |
|---|---|
| `lib/multi-room.ts`（新・テスト `multi-room.test.ts`） | `MAX_ROOMS_PER_BOOKING = 4`・`allocateByWeight(amount, weights)`（`book._allocate` と同じ式）・`parseHoldRooms(get)`（?/hold のフォーム: `rooms` JSON か従来の 1 室のフィールド → `{ok, rooms}` / `{ok:false, code:'missing'\|'too_many_rooms'\|'invalid'}`）・`childTotalOf`・型 `HoldGroup` / `HoldGroupRoom` / `BookingRoom` / `HoldRoomRequest` |
| `lib/server/supabase-data.ts` | `createHoldGroup(sid, facilityId, checkin, nights, rooms[{planId, roomTypeId, adults}], {clientKey, memberUserId, locale})` → `{groupId, expiresAt, total, rooms[{index, holdId, quote}]}` か `{error:'sold_out'\|'rate_limited'\|'too_many_holds'\|'too_many_rooms', soldOutRoomTypeId?}`。`releaseHoldGroup(groupId, sid)`。`sbGetHoldGroupMapped(groupId, sid, client?)` → `HoldGroup \| null`（**1 室目の値を最上位にも写す**ので 1 室の画面はそのまま動く）。`confirmBookingGroup(groupId, sid, guest, {client, pointsUsed, locale, memberCouponId, rooms?: RoomDetailInput[]})`。`type SbHold = HoldGroup`。`LastBooking.rooms?`＋`lastBookingRoomsOf(hold)`。`MemberReservation.roomCount?`・`rooms?: BookingRoom[]`。旧 `createHold / releaseHold / getHold / sbGetHoldMapped / confirmBooking` は削除（呼び元なし） |
| `routes/(public)/[brand]/[facility]/plans/[plan]/+page.server.ts` | `?/hold` は `parseHoldRooms` → `createHoldGroup`（施設は URL の slug から）。失敗: `fail(400, {message, code:'too_many_rooms'\|'invalid'})`・`fail(429, {message})`・`fail(409, {message, soldOut:[{roomTypeId, roomName}]})`。DB の `invalid_params / plan_not_found / room_not_found` も `code:'invalid'` の 400。成功 303 `/booking/hold?id=<束 id>`（`HOLD_NAV_COOKIE.id` も束 id）。デモは 1 室目だけ |
| `routes/(public)/booking/hold/+page.server.ts`・`pay/+server.ts`・`pay/return/+server.ts`・`lib/server/direct-booking-finish.ts` | `sbGetHoldGroupMapped` / `releaseHoldGroup` / `confirmBookingGroup` に置き換え。`hold.id` は束 id（決済の `holdId`・Stripe の refId もこれ）。`LastBooking.rooms` を入れる。画面に渡す `hold` に `rooms` / `total` が増えるだけ |
| `lib/server/direct-payments.ts` | 変更なし（`p_hold_id` に束 id が入る） |

### 14.6 本番に当てる前の事前確認 SQL（読み取りのみ・MCP の execute_sql で可）

公式予約の判定は migration と同じく **`metadata ? 'hold_id' and metadata ? 'booking_code'`**（`hold_id` は `book.confirm_booking` だけが書くキー。取引先予約・OTA は持たない）。

```sql
-- 公式予約。2026-10-10 時点の PROD: 1 件（取消済み・price_snapshot あり・クーポン/ポイントなし）
select count(*) n, min(b.created_at), max(b.created_at),
       count(*) filter (where b.metadata ? 'price_snapshot') with_snapshot,
       count(*) filter (where b.rate_plan_id is null) no_plan,
       count(*) filter (where b.status = 'cancelled') cancelled,
       count(*) filter (where b.payment_status <> 'pending') paid
  from booking.bookings b
 where b.metadata ? 'hold_id' and b.metadata ? 'booking_code';
-- チャネル別: booking_code を持つ行と、そのうち公式予約（hold_id あり）。取引先は official = 0 のはず
-- （PROD: autumn_booking 1 / 1・rms_partner 1 / 0）
select coalesce(ch.code, '(null)') channel, count(*) with_code,
       count(*) filter (where b.metadata ? 'hold_id') official
  from booking.bookings b left join booking.channels ch on ch.id = b.channel_id
 where b.metadata ? 'booking_code' group by 1;
-- (a) 予約は生きているのに滞在だけ取り消された公式予約（PMS 側だけの取消）。部屋は「生きている」としてバックフィルされる
--     （お金の記録は予約の状態に従う・§14.10-4）。PROD: 0 件
select count(*) from booking.bookings b join core.stays s on s.id = b.stay_id
 where b.metadata ? 'hold_id' and b.metadata ? 'booking_code'
   and b.status <> 'cancelled' and s.status = 'cancelled';
-- (b) hold_id を持つのにチャネルが autumn_booking でない／無い行（あれば中身を見てから当てる）。PROD: 0 件
select count(*) from booking.bookings b left join booking.channels ch on ch.id = b.channel_id
 where b.metadata ? 'hold_id' and (ch.code is distinct from 'autumn_booking');
-- 仮押さえ（PROD: expired 15・released 2・converted 2）と支払（PROD: 0 件）
select status, count(*) from book.holds group by 1;
select status, count(*) from book.direct_payments group by 1;
-- 進行中の仮押さえ・支払（あれば適用を少し待つ）
select count(*) from book.holds where status = 'active' and expires_at > now();
select count(*) from book.direct_payments where status = 'pending' and payment_intent_id is not null;
-- 金額の食い違い（0 行のはず。あれば migration の検証で止まる）
select b.id, b.total_amount, b.metadata->'price_snapshot'->>'total' snap_total, b.metadata->'coupon'->>'discount' discount
  from booking.bookings b
 where b.metadata ? 'hold_id' and b.metadata ? 'booking_code'
   and coalesce((b.metadata->'price_snapshot'->>'total')::int, b.total_amount + coalesce((b.metadata->'coupon'->>'discount')::int, 0))
       - coalesce((b.metadata->'coupon'->>'discount')::int, 0) <> b.total_amount;
select h.id from book.holds h
 where jsonb_array_length(coalesce(h.price_snapshot->'lines', '[]')) > 0
   and (select sum((l->>'subtotal')::int) from jsonb_array_elements(h.price_snapshot->'lines') l) <> (h.price_snapshot->>'total')::int;
-- 1 予約に滞在が 2 行以上ある公式予約（0 行のはず）
select b.id from booking.bookings b
  join core.stays s on s.reservation_code like (b.metadata->>'booking_code') || '%'
 where b.metadata ? 'hold_id' and b.metadata ? 'booking_code' group by b.id having count(*) > 1;
```

**巻き戻し用の関数定義の保存**（適用前に親が実行・読み取りのみ）。結果を `autumn-shared/docs/rollback/20261010092423_functions_before.sql` に保存する（各定義の末尾に `;`）:

```sql
select string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.oid::regprocedure::text)
  from pg_proc p
 where p.oid = any (array[
   'book._release_hold(uuid)', 'book.create_hold(text, uuid, uuid, date, integer, integer, text, uuid, text)',
   'book.get_hold(uuid, text)', 'book.release_hold(uuid, text)', 'book.release_expired_holds()',
   'book.direct_payment_bath_tax(uuid, text, uuid)', 'book.direct_payment_attach_intent(uuid, text, integer)',
   'book.direct_payment_get(text, text, uuid)', 'public.rms_partner_room_type_remaining(uuid, uuid, date, date)',
   'book.confirm_booking(uuid, text, jsonb, integer, text, uuid)',
   'book.direct_payment_prepare(uuid, text, uuid, jsonb, integer, text)', 'book.direct_payment_confirm(uuid, text, integer)',
   'book._grant_prepay_bonus(uuid)', 'book._cancel_booking_core(text, boolean, text, text, uuid)',
   'book.cancel_booking(text, boolean, text)', 'book.compute_cancel_fee(text, date)', 'book.guest_booking_by_token(text)',
   'book.mail_render_context(uuid)', 'book.direct_payment_set_admin_fee_waived(text, boolean)', 'book.admin_booking_detail(text)',
   'book.admin_list_bookings(uuid, text, text, text, date, date, uuid, integer, integer)', 'book.my_reservations()',
   'book._amend_compute(core.stays, booking.bookings, uuid, uuid, date, integer, integer)',
   'book.amend_booking(text, uuid, uuid, date, integer, integer)', 'book.quote_amendment(text, uuid, uuid, date, integer, integer)',
   'book._emit_pms_event(uuid, text, jsonb)'
 ]::regprocedure[]);   -- 26 本（件数を確かめる）
```

適用後の確認: `select count(*) from book.booking_rooms`（＝公式予約の件数）、`select count(*) from book.hold_groups`（＝旧 holds の件数）、`select book._assert_booking_totals(id) from booking.bookings b where exists (select 1 from book.booking_rooms r where r.booking_id = b.id)`、`information_schema.columns` で `book.holds` に `status` 等が無いこと。

### 14.7 M1 の画面担当（B）が使う契約（予定）

- **かご → ?/hold**: フォームに `rooms` = `JSON.stringify([{planId, roomTypeId, adults}])`（1〜4・並び順が「1室目・2室目…」）・`checkin`・`nights`・`back`・`via`・Turnstile。失敗の `soldOut[]` でどの部屋が取れなかったかを出し、かごは残す。`code:'too_many_rooms'` の文言はサーバ側と同じ（§8.1）。
- **`/booking/hold` の load**（M1 で A が足す）: 今の `hold: HoldGroup`（`rooms[]` あり）に加えて `roomsView:[{index, room, plan, adults, quote, askGender, questions}]`・`prepay:{total, rooms:[{index, amount, permille, early}], mixedRates}`（`direct_payment_prepare` の `prepay_discount_detail.rooms[]` と同じ式）。
- **?/submit・pay prepare**: 部屋ごとの `male_<i>` / `female_<i>`（`resolveRoomGenders` は既に配列対応）・質問 `answerKey(q, i)`。サーバは `confirmBookingGroup(…, {rooms: RoomDetailInput[]})` に `{male, female, notes(回答の行)}` を部屋ごとに渡す（M1 で `applyPlanAnswers` を部屋ごとに）。オンライン決済は `direct_payment_prepare` に部屋ごとの回答を渡す口がまだ無い → **M1 で `direct_payments` に `rooms_detail jsonb` を足すか、`guest.rooms` に入れて `direct_payment_confirm` が `p_rooms_detail` に渡す**（M1 の migration で決める）。
- **完了**: `LastBooking.rooms[{roomUuid, planUuid, adults, total}]`。
- **マイページ一覧**: `MemberReservation.roomCount` / `rooms`。
- **lib/multi-room.ts に M1 で足す**: `CartItem`・`canAddToCart`（施設・日程・支払方法の両立・4 室・残室）・`roomRefundPreview`。
- **メール**: `mail_render_context.booking.rooms[]` は入っている。`templates.ts` の `rooms[]` 対応は M1（今は 1 室の `room.name` / `plan.name` / `price_lines` のまま。複数室でも壊れはしないが明細が混ざる）。

### 14.8 本番に当てる前に親が確かめること

1. §14.6 の事前確認（特に進行中の仮押さえ・支払が無い時間帯に当てる）。
2. `supabase db push --linked --dry-run` で対象がこの 1 本だけ・トランザクションで当たること。適用ログの `NOTICE [book_multi_room_m0]` の件数。
3. **Book のデプロイと順番**: migration を先に当てても、旧 Book（旧署名 `create_hold` / `get_hold` / `confirm_booking` / `direct_payment_*` に旧 hold id）は動く（束 id ＝ 1 室目の部屋 id のため）。新 Book（`get_hold_group` 等）は migration の後にデプロイ。
4. yamado-one: `create_hold`（7 引数）→ `get_hold` → `confirm_booking` → `my_reservations`（列が 2 つ増える）→ `cancel_booking` を一度通す。`database.types.ts` を再生成するなら `my_reservations` の列追加に注意。
5. 1 室の予約で: 現地払い・カード（早期決済割あり）・取消（会員・非会員リンク・管理画面＋事務手数料免除＋返金）・日程変更・PMS の取込（電文 `new / paid / cancelled / modified`）・確認メール・取消メールが従来どおりか（§10 の M0 のチェックリスト）。
6. autumn-pms の型 `direct-booking/types.ts` は `rooms[i].plan` を知らない（無視されるので壊れない）。

### 14.9 ローカル検証で確かめたこと（使い捨てコンテナ・本番の列を写したスタブ）

- バックフィル: 公式予約 2 件（取消済み 1・クーポン/ポイント付きの予約中 1）＋取引先予約 1 件 → `booking_rooms` 2 行（取引先は対象外）・旧 holds 2 行 → 束 2・部屋 2。`_assert_booking_totals` 全件一致。予約の行から部屋のキーが消える。
- 旧署名: `create_hold`（7・9 引数）→ `get_hold`（`quote` の形・`locale` 付き）→ `confirm_booking` → 電文 `rooms[]` 1 件・`plan` 付き。
- 3 室の束で和室 −2・洋室 −1。5 室は `invalid_room_count`。残り 1 の和室を 2 室で `sold_out:<id>`・在庫は減らない。期限切れ・解放で全室戻る。
- 会員 2 室（30,000 / 20,000）・クーポン 1,000・ポイント 1,001 → クーポン 600 / 400・ポイント 601 / 400・滞在コード `-1 / -2`・部屋ごとの男女と回答・`total_amount` 49,000。全室取消でポイント・付与の逆仕訳・クーポン復帰・在庫戻し。
- オンライン決済 1 室（定率 5%・入湯税 150×2）: 請求 57,300・`booking_rooms` に割引 3,000・入湯税 300・二度目の確定は `already`。取消で `cancel_kept` 3,000（＝ `refund_due` の差し引き額）。
- 1 室の日程・プラン変更（バックフィルした予約）・`quote_amendment`。
- 権限: anon は `create_hold_group` / `_confirm_booking_group` / `booking_rooms` を使えない。他人のセッションでは `forbidden`。`guest_booking_by_token` の `rooms[]` に `stay_id` が無い。
- 判定: `hold_id` を持つ公式予約 3 件（PMS 側だけで滞在が取り消された 1 件を含む・生きている部屋になる）だけがバックフィルされ、取引先予約は対象外。
- `admin_list_bookings`（lateral）と旧の OR 結合で同じ行（stay_id・booking_id）になる。
- 巻き戻し（関数を先に当て直す → ③④⑤）で旧の形に戻る（旧 SQL 関数 `get_hold`・`my_reservations` 等を本文の検査なしで当て、表を戻した後に動く）。

### 14.10 設計から外れた点

1. **公式予約の判定を `metadata ? 'hold_id'`（＋`booking_code`）にした**（§2.8 の `metadata ? 'booking_code'` だけだと取引先予約も入る。PROD に 1 件ある。チャネルの結合にすると channel_id の付け違いで取りこぼすので使わない）。
2. **束 id ＝ 旧 hold id（バックフィル）・新しい束も 1 室目の部屋 id ＝ 束 id**。§2.8 の「束 id は新規・`direct_payments.hold_id` を書き換え」はやめた（書き換え不要・Stripe の refId もそのまま・旧 Book と新 Book が同時に動ける）。
3. **`_booking_by_code` の正規表現**: 設計の `-\d+$` は `YB-2026-001001` の連番を削ってしまうので「完全一致 → 末尾 `-\d{1,2}` を外して一致」に。公式予約（`booking_rooms` を持つ行）だけを返す。
4. **生きている部屋 ＝ `booking_rooms.cancelled_at is null`**（設計は `core.stays.status <> 'cancelled'`）。お金の集計を PMS が書く宿泊の状態に左右させないため。バックフィルも予約が `cancelled` のものだけを取消済みにする（PMS 側だけで滞在が取り消された予約は生きている部屋＝`total_amount` と一致したまま。§14.6 (a) で件数を確認）。取消の可否は従来どおり `core.stays.status = 'reserved'` も見る。
5. **`_assert_booking_totals` の取消済みの予約**: `total_amount` は「最後に取り消した部屋たち」の charge の和（全室取消で `total_amount` を変えない従来の挙動と、M2 の部屋ごとの減額を両立）。`paid_amount` は日程変更していない予約だけ検査。
6. **部屋ごとの早期決済割・入湯税は `direct_payments.prepay_discount_detail.rooms[]` に保存**し、確定でそのまま `booking_rooms` に写す（設計は「保存せず確定時に `as_of` で再計算」。準備時に請求した額と部屋の内訳が必ず一致するほうを取った）。
7. **確定 RPC を公開版と内部版に分けた**（`confirm_booking_group` は anon から呼べるので、決済の内訳 `p_pay` は service_role 専用の `_confirm_booking_group` だけが受ける）。
8. **`_emit_pms_event` の `rooms[i].plan` を M0 で入れた**（M1 予定。PMS は無視するので壊れない）。
9. **`direct_payment_refund_due` / `record_refund` は M0 では変えない**（全室取消では従来の式で同じ額）。`booking_rooms.cancel_kept` は記録として書く。部屋ごとの返金は M2。`direct_payment_set_admin_fee_waived` は `cancel_kept` を計算し直すよう変えた。
10. **公式予約でない行**（取引先・OTA）の扱い: `compute_cancel_fee` / `admin_booking_detail` / `my_reservations` / `guest_booking_by_token` / `mail_render_context` は従来の式で返す。`_cancel_booking_core` は `not_direct_booking`（従来は取引先予約も Book の経路で取り消せてしまい、公式の電文・在庫戻しが走っていた）。
11. 本人確認を `is distinct from` に（`auth.uid()` が null のとき束の会員の比較が null になり素通りする穴を閉じた）。`create_hold_group` は部屋タイプが施設のものかも確かめる（`room_not_found`）。
12. `reservation_code = コード` で引いている他の関数（`add_booking_options`・`list_my_booking_options`・`admin_resend_booking_mail`・`admin_rotate_cancel_token`・`admin_link_booking_member`・`admin_register_member_for_booking`・`list_my_amendments` 等）は **M0 では変えていない**（1 室は予約コード＝滞在コードなので従来どおり）。2 室以上の予約を作る M1 で `_booking_by_code` に向けること。

---

## 15. M1 実装メモ（画面の複数室・2026-10-10）

> A／B を 1 人で実装。autumn-book・autumn-shared とも **commit / push なし・本番 DB 未適用**（読み取り SQL だけ）。親がレビューして反映する。

### 15.1 migration（1 本・`autumn-shared/supabase/migrations/20261010125453_book_multi_room_m1.sql`）

表の DDL なし・関数の差し替えだけ（写す元は PROD の `pg_get_functiondef`、`schema_migrations` は `20261010092423` まで）。使い捨てコンテナ（`supabase/postgres:17.6.1.084`・`check_function_bodies = off`）で 1 トランザクションとして流れることだけ確かめた（本文の実行検証はしていない）。

| 節 | 中身 |
|---|---|
| 1 | 新 `book._stay_id_by_code(text) → uuid`（service_role）。公式予約（`_booking_by_code`）なら代表の滞在（`bookings.stay_id`＝1 室目）、それ以外は `reservation_code` 一致の滞在。1 室は従来と同じ結果 |
| 2 | `book.direct_payment_confirm` — **オンライン決済の経路で部屋ごとの回答を渡す口**（§14.7 の残り）。Book が `direct_payment_prepare` の `p_guest.rooms = [{male, female, notes, answers}]` に入れ、確定で `_confirm_booking_group(p_guest - 'rooms', …, p_rooms_detail = guest.rooms, p_pay)`。`rooms` の無い行（M1 前に準備した支払・yamado-one）は従来どおり |
| 3 | §14.10-12 の 7 関数を `_stay_id_by_code` に向けた: `add_booking_options`（M1 では代表の部屋に付く）・`list_my_booking_options` / `list_my_amendments`（予約 id で絞る＝全部屋）・`admin_resend_booking_mail`・`admin_rotate_cancel_token`・`admin_link_booking_member`（顧客の付け替えを全部屋の滞在に）・`admin_register_member_for_booking` |

巻き戻しは関数を当て直して `drop function book._stay_id_by_code(text)`（末尾のコメント）。適用は M0 と同じ手順（`db push --linked --dry-run` → 本適用 → `migration list --linked`）。**Book のデプロイより前に当てる**こと（新 Book は複数室のオンライン決済で `guest.rooms` を送る。未適用だと `rooms` が `metadata.guest` に残り、男女は 1 室目以外が空になる）。

### 15.2 画面の流れ

```
プラン詳細（部屋の行）
  ├「この部屋で予約へ進む」… 1 室は今と同じ 1 タップ（?/hold に従来の 1 室のフィールド）
  └「＋ もう 1 室追加」… sessionStorage（ab_booking_cart_v1）のかごへ。在庫は押さえない
       別施設・別日程 → confirm「かごを空にしますか」／支払方法が両立しない → 理由（Q3）／残室超え → 理由
       4 室目を入れた時点でバーの上に注意（§8.1 の文言）。4 室のあいだ「追加」は押せない見た目・押しても同じ文言
画面下のかごバー（BookingCart）「N室・大人M名・合計 ¥」［内訳］［予約へ進む］
  内訳: 同じ部屋・プラン・人数は「×2」・1 室ずつ外す・かごを空にする
  予約へ進む → かごの施設のプラン詳細の ?/hold（rooms JSON）→ 303 /booking/hold?id=<束 id>
     失敗はバーに理由（満室なら部屋名）・かごは残す
予約入力 → 代表者 1 回・予約ごとの質問 1 回・部屋ごとのカード（男女の内訳・部屋ごとの質問）・ポイント／支払は合計 1 回
完了（部屋ごとの行・かごを空に）→ 確認メール（部屋ごと）→ マイページ（一覧に「N室」・詳細に部屋カード）
```

- 料金の明細は **泊ごとの見出し → その下に部屋ごとの行**（2026-10-10 指示。`nightGroups`・`PriceBreakdown`・メール・管理画面）。1 室は行の「1室目」を省き、1 泊でも見出しを出す。「1名1泊」は使わない。**1 室の予約の明細もこの形に変わった**（指示どおり）。
- 1 室の予約は、ボタンの文言（「この部屋で予約へ進む」）と明細の形以外は従来と同じ（予約入力の質問の並び・男女・支払・金額）。

### 15.3 変えたファイル

| ファイル | 中身 |
|---|---|
| `lib/multi-room.ts`（＋`multi-room-cart.test.ts`） | `CartItem`・`canAddToCart`（施設・日程 → 4 室 → 支払方法 → 残室）・`payCompatible`・`sameStay`・`cartIsFull`・`cartSummary`・`cartRoomsPayload`・`cartGroups`・`readCart` / `writeCart`（try/catch・壊れた値や別日程の混在は空・5 室以上は 4 室に切る）・`nightGroups`（泊の見出し → 部屋の行）・`combineQuotes`・`combinePayments` |
| `lib/components/BookingCart.svelte`（新） | かごバー・内訳シート・一括仮押さえの送信（別ページの action なので結果は自分で処理） |
| `lib/components/PriceBreakdown.svelte` | `rooms` を受けて泊の見出し → 部屋の行 |
| `lib/format.ts` | `formatNightDate`（4月15日（水）／Apr 15 (Wed)／4月15日（三）） |
| `lib/server/hold-group.ts`（新） | 束の部屋ごとのプラン・部屋タイプ（`loadHoldGroupRooms`）・全室で合わせた支払設定（`groupPayment`）・会員の現地払いの案内（`groupMemberOnsiteHint`） |
| `lib/server/booking-questions.ts` | `applyGroupAnswers`（1 室は従来の `applyPlanAnswers` と同じ結果。複数室は予約ごとの項目を 1 回＝代表の備考へ、部屋ごとの項目と男女は `rooms[i]`＝その部屋の滞在の備考と `guest_detail` へ）・`groupBookingForms` |
| `lib/server/direct-payments.ts` | `combinePrepayViews`（部屋ごとの割引・早期決済ポイントの和・率が違えば `mixedRates`）・`prepareDirectPayment` の guest に `rooms` |
| `lib/server/supabase-data.ts` / `admin-app-data.ts` | `GuestCancelBooking.rooms` / `BookingDetail.booking.rooms` の型 |
| プラン詳細 `+page.server.ts` / `+page.svelte` | `?/hold` で支払方法の両立を検査（`mixed_payment`）・プランの施設を検査・上限の文言を paraglide に・`multiRoom` フラグ（デモは false）・2 つのボタン・かご |
| `booking/hold/+page.server.ts` / `+page.svelte` | `rooms[]`（部屋ごとの表示・質問・男女）・`groupQuote`（全室の見積）・支払方法は全室で合わせる・付与見込みは全室の和・部屋カード・部屋ごとのキャンセル規定 |
| `booking/pay/+server.ts` | 全室の支払方法で判定・`applyGroupAnswers`・guest に `rooms` |
| `booking/complete/[code]` | 部屋ごとの行（`LastBooking.rooms`）・人数は全室の和・かごを空に |
| `booking/cancel/+page.svelte` | 複数室は部屋の一覧を表示（取消は従来どおり全室まとめて） |
| `account/+page.*` | 一覧に「N室」・人数は全室の和 |
| `account/reservations/[code]/*` | 部屋カード・2 室以上は取消／日程変更のボタンを出さず「お電話で」・`?/cancel` と `amend` の入口もサーバで止める |
| `admin/reservations/[code]/+page.svelte` | 部屋の表（滞在コード・客室／プラン・人数・男女・金額・状態）と泊の見出し → 部屋の行の明細 |
| `messages/{ja,en,zh-TW}.json` | `cart_*`・`hold_room_*`・`price_night_*`・`complete_room_line`・`account_rooms_badge`・`reservation_*`。`plan_detail_book` を「この部屋で予約へ進む」に |
| autumn-shared `functions/send-booking-mail/templates.ts`（＋test） | `booking.rooms[]`（2 室以上）で部屋ごとの行・人数の合計・明細は泊の見出し → 部屋の行（1 室も）・規定が部屋ごとに違えば部屋ごとの節・取消メールは部屋を並べる |

### 15.4 M2 に残したもの

- 部屋ごとの取消（会員・非会員・管理画面）・部屋ごとの返金・`booking_room_cancelled` メール・全室同時の日程変更。M1 では **マイページは 2 室以上の取消・日程変更を「お電話で」**、非会員のリンク・管理画面の取消は M0 の **全室まとめての取消**のまま。
- オプション（滞在アレンジ）の部屋の選択（M1 は代表＝1 室目の部屋に付く）。
- `roomRefundPreview`（部屋ごとの返金見込み）。
- 管理画面の予約一覧の「室数」の列（一覧は滞在 1 行のまま。滞在コード `-k` からも詳細に入れる）。
- autumn-pms の `rooms[i].plan` 受け（電文には M0 から入っている）。

### 15.5 設計から外れた点

1. かごの内訳で **人数は変えられない**（料金の見積をやり直す必要があるため）。人数を変えるときは検索条件の人数を変えて部屋を足し直す。
2. 予約入力の「あと N 日で率が下がる」は複数室では出さない（部屋ごとに違うため）。率が部屋ごとに違うときは割引行の名前を「予約時決済割引（お部屋ごとの率）」にする。
3. 複数室の予約ごとの質問は、全室のプランの予約ごとの項目を id で重ねずに 1 回だけ聞き、回答は代表者の備考（全部屋の滞在に入る）。部屋ごとの項目の回答は「N室目」を付けずにその部屋の滞在の備考の先頭へ。
4. かごバーは **プラン詳細にだけ**出す（プラン一覧・客室ページには出さない）。別の施設のプラン詳細でもバーは出し「かごのお部屋は ○○ のご予約です」と添える（「予約へ進む」はかごの施設へ送る）。
5. 確認メールの「当日お支払い額」「現地にて承ります」の文面（オンライン決済でも同じ）は M1 では変えていない（既存の挙動）。

---

## 16. M2 実装メモ（1 室ずつの取消・部屋ごとの返金・全室同時の日程変更・2026-10-11）

> A／B を 1 人で実装。autumn-book・autumn-shared とも **commit / push なし・本番 DB 未適用**（読み取り SQL だけ）。親がレビューして反映する。
> 検証: 使い捨てコンテナ（`supabase/postgres:17.6.1.084`）に M0 と同じスタブ（本番の列を写した最小スキーマ）→ M0 → M1 → **M2** を当て、主な RPC と巻き戻しを流した（§16.6）。

### 16.1 migration（1 本・`autumn-shared/supabase/migrations/20261010204933_book_multi_room_m2.sql`）

写す元は PROD の `pg_get_functiondef`（`schema_migrations` は `20261010125453` まで）。M0・M1 で再定義した関数はそのファイルの定義（＝PROD）。表の DDL は `book.mail_outbox` の kind の check だけ（`booking_room_cancelled` を足す）。`booking.bookings` / `core.stays` の DDL なし。

| 節 | 関数 | 新規／写す元 | 中身 |
|---|---|---|---|
| 0 | `book.mail_outbox` の check | — | kind に `booking_room_cancelled` |
| 1 | `_cancel_room_core(booking_id, room_index, waive, by, rank, dp, now, today, cancel_options)` | 新規（M0 `_cancel_booking_core` のループの中身） | 部屋 1 つ: キャンセル料（部屋の規定 × 部屋の宿泊料金）・`cancel_kept`・滞在 cancelled・在庫 +1・（1 室取消のときだけ）その部屋のオプションを cancelled |
| 1 | `_cancel_booking_core` | M0 | 部屋ごとの処理を `_cancel_room_core` に（金額・順番は同じ）。取消日時を `clock_timestamp()` に。電文 cancelled の `cancel` に `total_fee`・`rooms[]` を追加 |
| 1 | `_cancel_booking_room_core(code, room_index, waive, reason, by, actor)` | 新規 | 生きている最後の 1 室 → `_cancel_booking_core`（全体取消）に任せる。それ以外 → `total_amount −= 部屋の charge`（`accommodation/net/tax` も）・`cancellation_fee = Σ`・ポイント按分の返還・付与見込みを `floor(残り ÷ 1.10 × ランクの率)` へ（減らすだけ）・電文 `modified`（`room_cancelled`）・メール `booking_room_cancelled`・監査 `cancel_booking_room`・`_assert_booking_totals`。クーポンは使用済みのまま・リンクは生きたまま |
| 1 | `cancel_booking_room` / `admin_cancel_booking_room` / `guest_cancel_booking_room(token, room_index)` | 新規（`cancel_booking` / `admin_cancel_booking` / `guest_cancel_booking`） | 認可は写し元と同じ。非会員は取消済みの部屋に `reason='room_not_cancellable'` |
| 1 | `compute_cancel_fee(code, as_of, room_index)` | 新規の 3 引数版（2 引数版は残す） | 部屋 1 つのキャンセル料 ＋ `total_amount`（部屋の charge）・`cancelled` |
| 1 | `guest_booking_by_token` | M0 | 2 室以上は**生きている部屋**で取消の可否（代表の 1 室目が取消済みでも可）。`rooms[i].fee`（今日のその部屋のキャンセル料）・`live_rooms` |
| 1 | `mail_render_context` | M0 | `booking_room_cancelled` の `cancel = {waived, fee, by, room_index, room, points_returned, remaining_rooms}` |
| 2 | `direct_payment_refund_due` | PROD（20261007010002） | 部屋の記録が無い・**全室を一度に取り消した**（1 室の予約を含む）→ **従来の式そのまま**（`partial:false`）。1 室ずつ取り消した → `due = A − Σ生きている部屋の paid_share − Σ取り消した部屋の cancel_kept − 返金済み`（`partial:true`・`live_share`・`rooms[]`）。生きている予約でも取り消した部屋があれば `result='due'` |
| 2 | `direct_payment_record_refund(…, p_room_index)` | 新規の 5 引数版（4 引数版は残す） | `refunds[]` と電文 `refunded.refund` に `room_index`・`reservation_code`。一部返金なら `bookings.payment_status='partial'`（全額は `refunded`） |
| 2 | `direct_payment_set_admin_fee_waived` | M0 | 計算し直すのは**直近の取消の部屋だけ**（返金済みの部屋の返金しない額を後から変えない） |
| 3 | `_amend_compute_dates(booking, checkin, nights)` / `quote_amendment_dates` / `amend_booking_dates` | 新規（`_amend_compute` / `quote_amendment` / `amend_booking`） | §16.3 |
| 4 | `my_reservations` | M0 | 列は同じ。`rooms[]` に `coupon_share / prepay_discount / bath_tax / paid_share / cancel_kept` |
| 4 | `admin_list_bookings` | M0 | drop → create。末尾に `room_count`・`room_index` |
| 4 | `add_booking_options` | M1 | `items[].room_index` で部屋を選ぶ（無ければ生きている部屋の最初）。状態は「予約 confirmed かつ付ける部屋が生きていて reserved」 |
| 4 | `list_my_booking_options` | M1 | drop → create。末尾に `room_index` |
| 5 | `_emit_pms_event` | M0 | 1 室ずつ取り消して予約が生きているときは `amounts.bath_tax / prepay_discount` も生きている部屋の和（他の amounts は M0 から生きている部屋の和）。それ以外は従来どおり |

権限: 内部関数（`_cancel_room_core`・`_cancel_booking_room_core`・`_amend_compute_dates`・5 引数の `record_refund`）は service_role だけ。`cancel_booking_room`・`admin_cancel_booking_room`・3 引数の `compute_cancel_fee`・`quote_amendment_dates`・`amend_booking_dates`・作り直した 2 本は authenticated・service_role。`guest_cancel_booking_room` は anon・authenticated・service_role。

### 16.2 PMS 電文（autumn-pms の受け口の前提に合わせた形）

- **1 室取消（最後の 1 室以外）**: `event='modified'`・`amendment.kind='room_cancelled'`。`rooms[]` は**生きている部屋だけ**。`amounts` も生きている部屋の和。`amendment.cancelled_rooms[]` に今回取り消した部屋（必須: `room_index`・`stay_id`・`reservation_code`〔`YB-…-k`〕・`room_type_name`・`fee`。加えて `cancelled_at`・`cancelled_by`・`waived`・`cancellation_policy`〔その部屋の規定の写し〕・`room_type_id`）。
- **最後の 1 室の取消・全室一括**: 従来どおり `event='cancelled'`（`rooms[]` は全室）。`cancel.fee` は今回取り消した部屋の和（従来）、`cancel.total_fee` は予約全体、`cancel.rooms[]` は全室の取消の内訳（M2 で追加）。
- **部屋ごとの返金**: `event='refunded'` の `refund` に `room_index`・`reservation_code`（予約全体の返金・遅延返金・Stripe の管理画面からの返金は null）。
- **全室同時の日程変更**: `event='modified'`・`amendment.kind='dates'`・`before/after` に `checkin / checkout / total / points_used / coupon_discount / rooms[]`（`after.rooms[i].price_snapshot` は部屋の見積）。`rooms[]` は生きている部屋（新しい泊明細）。
- PMS は取り消した部屋の請求書の宿泊明細を自動では外さない（現場が手で外す）。

**1 室取消の電文の例**（コンテナで 2 室のオンライン決済の予約の 2 室目をスタッフが取り消したときの実物。`guest`・`booker`・`stay` 等は省略、id は短縮）:

```json
{
  "schema": "autumn.direct_booking/1",
  "event": "modified",
  "sequence": 3,
  "booking": { "booking_id": "df6c7079-…", "booking_code": "YB-2026-006002", "status": "confirmed", "locale": "ja" },
  "rooms": [
    {
      "room_index": 1, "stay_id": "47f694cb-…", "reservation_code": "YB-2026-006002-1",
      "room_type_id": "a000…000a", "room_type_code": "WA", "room_type_name": "和室",
      "adults": 2, "male": null, "female": null, "children": { "a": 0, "b": 0, "c": 0, "d": 0, "e": 0 },
      "nights": [ { "date": "2026-11-09", "unit_price": 30000, "subtotal": 60000 } ],
      "plan": { "rate_plan_id": "b000…0001", "code": "P1", "name": "朝夕食", "meal_plan": "2食", "rms_plan_template_id": null }
    }
  ],
  "plan": { "rate_plan_id": "b000…0001", "code": "P1", "name": "朝夕食", "meal_plan": "2食", "rms_plan_template_id": null },
  "amounts": {
    "gross_total": 60000, "discount_total": 0, "points_used": 0, "total_amount": 60000, "charge": 60000,
    "bath_tax": 300, "prepay_discount": 3000, "tax_included": 5455, "coupon": null, "points_earned": 0
  },
  "payment": { "method": "deposit", "status": "paid", "option": "online", "method_name": "オンライン決済(stripe)", "payment_intent_id": "pi_B", "paid_amount": 77450 },
  "cancellation_policy": { "rules": [ { "days_before": 3, "rate": 0.3 }, { "days_before": 0, "rate": 1 } ] },
  "amendment": {
    "kind": "room_cancelled",
    "cancelled_at": "2026-10-10T21:01:17.050628+00:00",
    "by": "staff", "waived": false, "reason": "テスト",
    "cancelled_rooms": [
      {
        "room_index": 2, "stay_id": "807468f7-…", "reservation_code": "YB-2026-006002-2",
        "room_type_id": "a000…000b", "room_type_name": "洋室", "fee": 0,
        "cancelled_at": "2026-10-10T21:01:17.050628+00:00", "cancelled_by": "staff", "waived": false,
        "cancellation_policy": []
      }
    ],
    "remaining_rooms": 1
  },
  "cancel": null, "charge": null, "refund": null,
  "price_snapshot": {
    "lines": [ { "date": "2026-11-09", "adults": 2, "unit_price": 30000, "subtotal": 60000 } ],
    "total": 60000, "per_person": 30000, "tax_included": 5455, "locale": "ja",
    "rooms": [ { "room_index": 1, "lines": [ { "date": "2026-11-09", "adults": 2, "unit_price": 30000, "subtotal": 60000 } ], "total": 60000 } ]
  }
}
```

**部屋ごとの返金の電文（`event='refunded'`）の `refund`**:

```json
{ "amount": 19143, "refunded_at": "2026-10-10T21:01:17.060908+00:00", "refund_id": "re_1", "reason": "cancel:staff:room2",
  "room_index": 2, "reservation_code": "YB-2026-006002-2", "total_refunded": 19143, "method_name": "オンライン決済(stripe)" }
```

**最後の 1 室の取消（`event='cancelled'`）の `cancel`**:

```json
{ "cancelled_at": "2026-10-10T21:01:17.066969+00:00", "by": "staff", "fee": 0, "waived": false, "reason": "テスト",
  "total_fee": 0,
  "rooms": [ { "room_index": 1, "stay_id": "47f694cb-…", "fee": 0, "waived": false, "cancelled_at": "2026-10-10T21:01:17.066969+00:00" },
             { "room_index": 2, "stay_id": "807468f7-…", "fee": 0, "waived": false, "cancelled_at": "2026-10-10T21:01:17.050628+00:00" } ] }
```

### 16.3 全室同時の日程変更

- `_amend_compute_dates`: 生きている部屋ごとに `book.quote(同じプラン・同じ部屋タイプ・新しい日程・同じ人数)`。クーポンは percent なら新しい合計で、fixed なら `least(今の割引〔生きている部屋の和〕, 新しい合計)`、`_allocate` で部屋の宿泊料金の比に按分。ポイントは `least(今の利用, 新しい支払額)` を部屋の支払額の比で按分（差は返還）。ペナルティは部屋ごとの規定で、1 室でも率 > 0（かつ `allow_amend_in_penalty` でない）なら `in_penalty`。戻りのキーは `_amend_compute` と同じ（画面の `AmendQuote`）＋ `rooms[]`・`available`・`sold_out[]`（在庫の目安・自分の部屋を足し戻して判定）。
- `amend_booking_dates`: 本人・confirmed・生きている部屋がすべて reserved・2 回まで・締切前・ペナルティ外・**オンライン決済済み（返金し切っていない）は `prepaid_online`**。在庫は旧区間を部屋タイプごとに +N → 新区間を行ロック → 部屋タイプごとに全泊 `available − buffer ≥ N` → −N。足りなければ `sold_out:<room_type_id>` で全体が戻る。滞在の日付は**予約の全部屋（取り消した部屋も）**をそろえる（予約の日程は 1 つ・代表の滞在から日程を読む画面があるため）。部屋のお金は生きている部屋だけ更新。`booking_amendments` に `kind='dates'`。
- 1 室の予約の `amend_booking`（部屋・プラン・人数・日程）は変えていない。2 室以上は従来どおり `use_amend_dates`。

### 16.4 Book（autumn-book）

| ファイル | 中身 |
|---|---|
| `lib/multi-room.ts`（＋`multi-room-cancel.test.ts`） | `roomRefundPreview`（1 室の返金見込み・`_room_cancel_kept` と同じ式）・`remainingRefundPreview`（残りの全室・まだ 1 室も取り消していなければ従来の式）・`liveRooms`・`roomsStatus`。`BookingRoom` に `stayStatus / paidShare / bathTax / prepayDiscount / cancelKept` |
| `lib/server/supabase-data.ts` | `sbCancelBookingRoomAsMember`・`guestCancelBookingRoom`（`GuestCancelReason` に `room_not_cancellable`）・`sbComputeCancelFee(…, roomIndex?)`（`rooms[]` も返す）・`sbQuoteAmendmentDates` / `sbAmendBookingDates`（`AmendDatesQuote`）・`sbAddBookingOptions` の `roomIndex`・`sbListMyBookingOptions` の `roomIndex`。マイページの予約の状態は 2 室以上なら生きている部屋で決める |
| `lib/server/direct-payments.ts` | `refundAfterCancel(code, reason, { roomIndex })`（5 引数の `record_refund`・Stripe の metadata に `room_index`） |
| `lib/server/admin-app-data.ts` | `adminCancelBookingRoom`・一覧の `room_count / room_index`・詳細の部屋のお金の型・`cancel_policy.rooms` |
| `lib/types.ts` | `BookingOptionOrder.roomIndex` |
| `account/reservations/[code]` | 部屋カードに「この部屋を取り消す」（その部屋のキャンセル料・返金の見込み・最後の 1 室なら全体取消の注意）→ `?/cancelRoom`。下のボタンは「すべてのお部屋を取り消す」（返金見込みは残りの全室）。日程変更は「日程を変更する（全室）」。M1 の「1 室だけはお電話で」を削除 |
| `…/amend` | 2 室以上は日付・泊数だけ（`datesOnly`）。部屋ごとの今と変更後の金額・全室を確保できない日程は「全室のお部屋を確保できない」 |
| `…/options` | 2 室以上は「どのお部屋のアレンジですか」を選ぶ。予約詳細のオプションに「N室目」 |
| `booking/cancel` | 部屋カードごとに「この部屋を取り消す」（二段確認）→ `?/cancelRoom`。取消後は action が返す最新の表示（URL から `?t=` を落としているため）。全室は「すべてのお部屋を取り消す」 |
| `admin/reservations/[code]` | 取消フォームに「予約全体／この部屋だけ」（部屋の選択）・部屋ごとの返金見込み・部屋の表に返金しない額と支払分・1 室取消の後も返金の内訳と再実行・代表の 1 室目が取消済みでも操作を出す・メールの種類「1室の取消受付」 |
| `admin/reservations` | 一覧に「室数」の列（`N室`・2 室以上は `k室目`） |
| `messages/{ja,en,zh-TW}.json` | `reservation_room_*`・`reservation_cancel_all_btn`・`reservation_multi_cancel_note`・`amend_dates_*`・`amend_err_sold_out_all`・`options_room_label`・`gcancel_room_*`・`gcancel_btn_all`・`gcancel_err_room*`。`reservation_multi_phone` を削除 |
| autumn-shared `functions/send-booking-mail/templates.ts`（＋test） | `buildRoomCancelledMail`（取り消したお部屋・その部屋のキャンセル料〔基準はその部屋の宿泊料金〕・戻したポイント・引き続きご予約のお部屋と合計）。`renderMail` が kind で振り分け |

### 16.5 本番に当てる順番と条件

1. 適用前に巻き戻し用の関数定義を保存（読み取り・migration 末尾のコメントの SQL・10 本）→ `autumn-shared/docs/rollback/20261010204933_functions_before.sql`。
2. `supabase db push --linked --dry-run` で対象がこの 1 本（ほかに未適用の migration があればその中身も）か確認 → 本適用 → `migration list --linked`。`information_schema.routines` で `cancel_booking_room` 等ができたこと、`admin_list_bookings` の戻りに `room_count` があること。
3. **send-booking-mail を同時にデプロイ**（`supabase functions deploy send-booking-mail --no-verify-jwt`）。古い関数のままだと `booking_room_cancelled` を予約確認メールの文面で送ってしまう（migration を当てる前に新しい関数をデプロイしても害は無い）。
4. Book のデプロイは migration の後（新 Book は `cancel_booking_room` / `quote_amendment_dates` 等と `my_reservations` の新しいキーを使う。旧 Book は新 DB でそのまま動く）。
5. autumn-pms の `room_cancelled` の受け口は先にデプロイ済みが望ましい（無くても壊れない: 現状の `modified` は `rooms[]` に無い滞在を触らない・滞在は Book が cancelled にしトリガーで部屋割りが解放される）。

### 16.6 確認した範囲（使い捨てコンテナ）

- M0 → M1 → M2 が 1 トランザクションで当たる（M2 は `check_function_bodies = on`）。
- 会員 3 室（60,000 / 20,000 / 40,000・クーポン 1,000・ポイント 3,000）: 2 室目の取消で滞在 cancelled・洋室の在庫 +1・`total_amount` 119,000 → 99,167・ポイント +500 返還・付与見込み 1,081 → 901・クーポン used のまま・電文 `modified/room_cancelled`（`rooms[]` 2 件）・メール `booking_room_cancelled`・`mail_render_context.cancel`。非会員リンクの `rooms[i].fee`・取消済みの部屋は `room_not_cancellable`。3 室目にオプション（`room_index` 付き）。全室同時の日程変更（+1 日・2 泊）で全滞在の日付・部屋のお金・在庫（旧区間 +2・新区間 −2）・電文 `dates`。リンクで 1 室目 → 3 室目（最後）を取消 → 予約 cancelled・電文 cancelled（`cancel.rooms` 3 件）・クーポン復帰・リンク無効・ポイントの差し引きが 0。
- オンライン決済 2 室（請求 77,450・事務手数料 5%）: 2 室目の取消で `refund_due` = 20,150 − 1,007 = **19,143**（`partial:true`）→ 5 引数の記録で `refunds[].room_index`・電文 `refunded` に `room_index / reservation_code`・`refund_status=partial`・`payment_status=paid` のまま → 1 室目（最後）で残り **54,300**（= 57,300 − 割引 3,000）。事務手数料の免除は直近の部屋だけ計算し直す。
- 1 室のオンライン決済の予約を `_cancel_booking_room_core` で取り消すと全体取消の経路・`refund_due` は従来の式（`partial:false`・54,300）。
- 在庫不足（新しい日の和室の残り 1 に 2 室）: 見積 `available:false / sold_out:[和室]`、確定は `sold_out:<id>` で日付・在庫とも変わらない。2 室で `amend_booking` → `use_amend_dates`。ペナルティ期間の部屋が 1 つあると `amend_in_penalty`。anon は内部関数を呼べない。
- 巻き戻し: M1 適用後の 10 本の定義を保存 → M2 → 末尾のコメントの SQL で新しい関数が消え、`admin_list_bookings` が旧の形に戻り、旧の `_cancel_booking_core`・`guest_booking_by_token`・`admin_list_bookings` が 1 室ずつ取り消したデータの上で動く。
- `svelte-check --threshold error` 0 件・`vitest` 712 件・send-booking-mail の vitest 34 件。画面はブラウザで見ていない（実データ接続が要るため）。

### 16.7 設計から外れた点

1. **全室を一度に取り消した複数室の予約の返金は従来の式**（請求額全体に対する max(キャンセル料の和, 割引, 事務手数料)）。1 室ずつの和とは事務手数料の基準が違い、例の予約では 3,872 と 4,007 で 135 円差（§5.5 の「1〜2 円差」より大きいことがある）。どちらの式かは `refund_due.partial` で分かる。
2. 部屋ごとの一部返金（5 引数の `record_refund`）では `booking.bookings.payment_status='partial'`（本番の check にある値。`partial_refund` は無く、共有表の DDL はしない）。全額なら従来どおり `refunded`、4 引数版（遅延返金・Stripe 管理画面の同期）は従来どおり変えない。Book の `mapReservationRow` は `partial` を `partial_refund`（一部返金）として表示する。1 室ずつ取り消した予約は、返金しない額があるので最後まで `partial` のまま（全額返金にならない）。
3. 付与見込みの再計算は「会員ランクの率 × 残りの合計」で、元の見込みより**増やさない**（宿泊後の `_finalize_booking` が最終的に合わせる）。日程変更では付与見込みを変えない（従来の `amend_booking` と同じ）。
4. 1 室取消ではその部屋のオプションを取消にするが、**全室一括・最後の 1 室の取消ではオプションに触らない**（従来の全体取消と同じ動きを保つため）。
5. 事務手数料の免除の印（`cancel_admin_fee_waived`）は予約に 1 つなので、管理画面で免除した後に会員が別の部屋を取り消すと、その部屋も免除になる。
6. 日程変更で取り消した部屋の滞在の日付もそろえる（お金の記録・泊明細は取消時のまま）。
7. 非会員の画面の取消後の表示は、action が `guestBookingByToken` をもう一度引いて返す（`update({ invalidateAll: false })`）。
8. 1 室取消で付けた電文 `cancelled_rooms[]` の項目は autumn-pms の受け口の前提（2026-10-11 の指示）に合わせて、設計 §7.2 より多い（`cancelled_at`・`cancelled_by`・`waived`・`cancellation_policy`）。

### 16.7a レビュー（Fable）を受けて直した点（2026-10-11）

- **中-2** 生きている部屋が 1 室だけのとき、`_booking_cancel_fee` は `rooms[]` を返さない（全体の `fee`／`rate` がその部屋の値）。マイページ（`account/reservations/[code]/+page.server.ts`）と管理画面（`roomFeeOf`）で、`rooms[]` が空で生きている部屋が 1 つならその部屋に全体の値を割り当てる（DB は変えない）。部屋カードのキャンセル料 0 円・返金見込みの過大を直した。
- **中-3** Stripe の冪等キーを `book-direct-cancel-<予約 id>-<返金済み額>-<今回の返金額>` に。同じ取消で 2 回呼ばれても同じキー（記録後は due=0 で返金しない）。
- **中-4** `_cancel_booking_room_core` は全室一括と同じく「生きている部屋がすべて reserved」のときだけ（別の部屋がチェックイン済みなら `not_cancellable`）。`guest_booking_by_token` の可否も reserved でない生きている部屋を優先して見る（`checked_in` 等）。マイページの「この部屋を取り消す」・管理画面の操作も同じ条件で出す。
- **低-1** `_emit_pms_event` の `price_snapshot` で代表（1 室目）の見積の形を使うのは「部屋が全体で 1 つ」の予約だけ。2 室以上で生きている部屋が 1 つのときは生きている部屋で組む（取消済みの 1 室目の明細にならない）。
- **低-4** 上の 16.7-2。
- 電文 `cancelled_rooms[].cancelled_by` はそのまま（PMS 側が読む）。
- 再確認: コンテナで M0→M1→M2 と §16.6 の RPC を流し直し、加えて「2 室目がチェックイン済みで 1 室目の取消が `not_cancellable`・リンクの理由が `checked_in`」「2 室目だけ生きている予約の電文 `price_snapshot` が 2 室目の明細」「部屋の一部返金で `payment_status='partial'`」を確認。`svelte-check` 0 件・`vitest` 712 件・メール 34 件。

### 16.8 M3 に残したもの

- 複数室の予約の部屋ごとの部屋・プラン・人数の変更、子ども区分、退避表 `_mr_backup_*` の drop（Q11）。
- 確認メールの再送（管理画面）は 1 室ずつ取り消した後も取り消した部屋を並べる（M1 の `templates.ts` は `rooms[]` を全部出す）。
- 取り消した部屋の請求書の宿泊明細の自動での除外（autumn-pms）。
- 予約全体の取消・最後の 1 室の取消でのオプションの扱い（今は触らない）。

---

## 17. M3 設計（2026-10-11）

> 作成: 2026-10-11（autumn-book v0.120.0・autumn-shared は `20261010221207`〔特別会員〕まで本番適用済み）。読み取り調査のみ。コード・migration・DB 書き込みは未着手。
> 写す元は **PROD の `pg_get_functiondef`**（M0〜VIP の作法）。本節で「最新定義」と書いた関数は、本番の `schema_migrations` が `20261010221207` まで一致していることを先に確かめてから写す。
> 事実には出典（migration の version・ファイル・行）を付ける。判断は【判断】、ユーザーに聞くものは【要確認 Mn】（§17.9）。

### 17.0 決定（ユーザー・2026-10-11）と範囲

| # | 決定 |
|---|---|
| 1 | **部屋ごとの部屋タイプ・プラン・人数の変更**を作る（複数室の予約・1 室の予約とも）。公式マイページと、**特別会員の専用ページの「ご予約一覧」でも**（専用ページは専用料金で計算し直す。公式マイページは専用ページ経由の予約を操作しない方針は維持）。管理画面（スタッフ）からもできるようにする（推奨案 §17.3.3） |
| 2 | 子どもの料金区分は今回も入れない（列と電文は従来どおり用意だけ） |
| 3 | 退避表 `book._mr_backup_*` は **2026-11-09 以降に drop**（M0 本番適用 2026-10-10 ＋ 30 日）。drop の SQL は別 migration として**用意だけ**し、M3 本体には含めない（§17.6） |
| 4 | PMS の請求書の宿泊明細の自動除外は **autumn-pms 側で別エージェントが実装**（電文の形に変更が要るものは §17.4 に書く） |
| 5 | あわせて直す: **管理画面からの確認メール再送で取り消した部屋を載せない**／**予約全体の取消・最後の 1 室の取消でオプションも取り消す**（§17.5） |

M3 に**含めないもの**: 日程変更の中身（M2 の `amend_booking_dates` のまま）・オンライン決済済みの予約の変更（§17.1.8・【要確認 M2】）・子ども区分・部屋の追加（室数を増やす変更。かごで別予約にする）・部屋の分割／統合・PMS 側の表示（autumn-pms の別エージェント）。

### 17.1 変更の単位と規則

#### 17.1.1 単位（1 回の操作で何を変えるか）

- **1 回の操作 ＝ 1 予約の「生きている部屋」のうち 1〜N 室の `部屋タイプ・プラン・人数` を変える。日程（チェックイン日・泊数）は含めない。** 日程は従来どおり `amend_booking_dates`（全室同時・M2 §16.3）／1 室の公式予約は従来の `amend_booking`（日程を含む複合変更）でそのまま【判断】。
  - 理由: (a) 日程と部屋の変更を同時に受けると、在庫の振替（旧区間 ＋N → 新区間 −N）と部屋タイプの振替（旧タイプ ＋1 → 新タイプ −1）が交差して全体巻き戻しの条件が複雑になる、(b) ペナルティ期間の判定が「日程を動かすか」で変わる（§17.1.6）、(c) 画面が「日程を変える」「このお部屋を変える」の 2 つの入口になり迷わない。
  - RPC の入力は**配列**（`p_rooms = [{room_index, rate_plan_id, room_type_id, adults, …}]`・1〜生きている室数）。クーポン・ポイントの再按分は**生きている全室**に効く（§17.1.5）ので、1 室でも N 室でも計算は同じ。**M3 の画面は 1 室ずつ送る**（部屋カードの「このお部屋を変更」→ 1 回の操作）。まとめて変える画面は作らない（回数 §17.1.7 と関係する）。
- 「変化なし」（部屋タイプ・プラン・人数のどれも同じ）は `no_change`。
- **部屋の追加・削除はしない**（室数は変わらない。削除は 1 室取消〔M2〕・追加は別の予約）。`room_index` は変わらない。滞在コード `YB-…-k` も変わらない。

#### 17.1.2 できる条件（既存の規則の写し・出典は M0 `amend_booking` 2515 行〜・M2 `amend_booking_dates` 1217 行〜）

| 条件 | 規則 | 例外名 |
|---|---|---|
| 本人 | 会員: `members.guest_id = 代表滞在の guest_id`（`auth.uid()`）。専用ページ: `_member_page_booking_check`（対象者・このページ経由・予約した本人〔Q10 A〕）。スタッフ: `_require_admin`（admin / staff）・理由必須 | `forbidden` / `reason_required` |
| 専用ページ経由の予約のガード | `_member_page_guard(metadata, by)`。公式マイページ（`by='member'`）からは `member_page_booking`。専用ページの入口（`book.member_page_ctx`）とスタッフ（`by in ('staff','admin')`）は通る（VIP §13.3.10） | `member_page_booking` |
| 予約・部屋の状態 | 予約 `confirmed`、**生きている部屋がすべて `core.stays.status = 'reserved'`**（M2 §16.7a 中-4 と同じ。1 室でもチェックイン済みなら全体を変えない。PMS も in-house の予約に `modified` が来ると例外を投げる〔autumn-pms `import.ts` 322 行〕） | `not_amendable` |
| 変更対象 | `p_rooms[i].room_index` が生きている部屋（`booking_rooms.cancelled_at is null`）。取消済みの部屋は変えられない | `room_not_found` |
| 締切 | チェックイン日 9:00（施設 TZ）前（従来） | `past_deadline` |
| 回数 | 予約で 1 つの `metadata.amended_count`。日程変更と**共有**。上限は §17.1.7（【要確認 M1】） | `amend_limit` |
| オンライン決済済み | `direct_payments.status='paid' and refund_status <> 'full'` の予約は**不可**（M2 の日程変更と同じ・§17.1.8） | `prepaid_online` |
| ペナルティ | §17.1.6 | `amend_in_penalty` |
| プラン | 施設のプランで `public_on_direct and is_active`＋`plan_contents.is_published`（`_amend_compute` と同じ） | `plan_not_found` |
| 部屋タイプ | `pms.room_types.facility_id = 予約の施設`・`is_active` | `room_not_found` |
| 人数 | 1〜6（`price_adult_1〜6`）かつ **`room_types.capacity_max >= adults`**（公式は `book.quote` の join で落ちる〔`20260611100400` 52 行〕。専用ページの `lines` 経路は RPC が明示的に確かめる） | `over_capacity`（専用）／`not_sellable`（公式） |
| 支払方法の両立（決定 Q3 の延長） | 予約の支払は現地払い（オンライン決済済みは変更不可のため）。**新しいプランが会員の現地払いを許すこと**（`book.v_plans.payment_method in ('onsite','deposit')`）。両立しなければ拒否 | `payment_incompatible` |
| 在庫 | §17.1.3 | `sold_out:<room_type_id>` |

#### 17.1.3 在庫（部屋タイプの振り替え）

`amend_booking_dates` の「部屋タイプごとに集計 → 行ロック → 全泊確認 → 一括更新」をそのまま使う。期間は**今の滞在期間**（変わらない）。

1. 変更する部屋ごとに `旧タイプ → 新タイプ` を出し、**部屋タイプごとの純増 `n[type] = (新で使う数) − (旧で手放す数)`** を集計する。同じタイプで人数だけ変える部屋は純増 0。
2. 純増が負のタイプ: `available_rooms = least(available_rooms + |n|, total_rooms)`（解放）。
3. 純増が正のタイプ: `booking.availability` を滞在期間で `for update` → 全泊 `available_rooms − buffer_rooms >= n and not stop_sell` → 1 泊でも足りなければ `sold_out:<room_type_id>` で**全体を巻き戻す**（部分変更はしない・日程変更と同じ）→ `available_rooms −= n`。
4. 見積（`quote_amendment_rooms`）は在庫の**目安**を返す（`available` / `sold_out[]`。自分が手放す分を足し戻して判定する `_amend_compute_dates` の式と同じ）。確定は行ロックの下で確かめる。

#### 17.1.4 料金の引き直し

| 経路 | 新しい部屋の見積 | 検証 |
|---|---|---|
| 公式（マイページ・管理画面の公式予約） | **`book.quote(新 rate_plan_id, 新 room_type_id, 今の checkin, 今の nights, 新 adults)`**（`_amend_compute` M0 と同じ） | `quote` が null（休館・料金なし・定員超え・min_stay）なら `not_sellable` |
| 専用ページ経由（専用ページ・管理画面からの専用ページ経由の予約） | **TS が渡す `p_rooms[i].lines`**（`quotePartnerBooking` で出した専用料金の泊明細。VIP §13.3.11 の `_amend_compute_member_dates` と同じ流儀） | `book._member_lines(lines, checkin, nights, 新 adults)`（長さ ＝ 泊数・日付連続・`unit_price ≥ 1`・`adults` ＝ 新しい人数・`subtotal = unit_price × adults`）。違えば `invalid_lines`。料金の正しさは TS が持つ |

- 変えない部屋は `price_lines` / `room_total` を据え置く（引き直さない）。変える部屋だけ新しい `price_lines`・`room_total`。
- 専用ページ経由の予約を**スタッフが管理画面から**変えるときも `lines` が要る（§17.3.3。Book の管理画面サーバが `loadPartnerContext(db, member_page.partner_id, facility)` → `quoteMemberRooms` で組む。組めない日・プランは「専用料金を出せません」で止める）。

#### 17.1.5 クーポン・ポイントの再按分（`_amend_compute_dates` の規則を「生きている全室」に適用）

- クーポン: `percent` → 新しい合計（生きている全室の `room_total` の和）で再計算、`fixed` → `least(今の割引〔生きている部屋の和〕, 新合計)`。**`_allocate(新割引, 生きている全室の room_total[])`** で部屋ごとの `coupon_share` を書き直す（変えない部屋の按分も動く・日程変更と同じ）。
- ポイント: `new_use = least(今の利用〔和〕, 新しい支払額）`、`_allocate(new_use, charge[])`。減った分は返還（`point_ledger` に正の delta・退会済みはスキップ〔H-2〕）。増やす方向には使わない（従来）。
- 付与見込み `metadata.points_earned` は変えない（従来の `amend_booking` と同じ・宿泊後の `_finalize_booking` が合わせる）。
- 予約時決済割・早期決済割（`prepay_discount` / `prepay_detail`）・入湯税（`bath_tax`）は**触らない**（オンライン決済済みは変更不可なので 0 のまま。§17.1.8）。
- `bookings.total_amount / accommodation_amount / net_amount / tax_amount` は新しい `Σ charge`。最後に `_assert_booking_totals`。

#### 17.1.6 ペナルティ期間

- 変更する部屋ごとに `_cancel_fee(その部屋の cancellation_policy_snapshot, room_total, checkin, 今日, rank)`。**率 > 0 の部屋が 1 つでもあれば `amend_in_penalty`**（`rank_cancel_policies.allow_amend_in_penalty` なら通す）。日程変更（M2）と同じ。
- 注: 既存の 1 室の `_amend_compute`（最新 `20261010221207` 1897 行〜）は `in_penalty = date_changed and rate > 0` で、**日程を動かさないプラン・部屋・人数の変更はペナルティ期間でも通る**。安いプラン・少ない人数へ変えるとキャンセル料の基準額（`room_total`）が下がる抜け道になるので、新 RPC では塞ぐ。既存の `amend_booking` も揃えるかは【要確認 M3】（推奨: 揃える。`_amend_compute` の 1 行の差し替え）。
- スタッフ（管理画面）は `p_force = true` でペナルティ・締切を越えられる（理由必須・監査ログ）。回数とオンライン決済済みは越えられない（§17.1.7・§17.1.8）。

#### 17.1.7 回数（日程変更と共有）【要確認 M1】

- 今は予約で **2 回**（`metadata.amended_count`・`booking_amendments.amendment_no check (between 1 and 2)`〔`20260711075937` 29 行〕・画面の「あと N 回」は `amend_remaining`）。日程変更と部屋の変更が同じ数を使うと、2 室の予約で「日程 1 回 ＋ 部屋 1 室」で尽きる。
- 推奨: **上限を `2 + (室数 − 1)`**（1 室: 2〔従来どおり〕・2 室: 3・4 室: 5）にし、`book._amend_limit(booking_id)` 1 か所で返す。DDL は `booking_amendments` の check を `between 1 and 5` に広げるだけ（Book 専用表・共有表ではない）。`quote_amendment(_dates/_rooms)` の `amend_remaining` も同じ関数から。
- 代案: 2 回のまま（DDL なし）。足りないときは電話。

#### 17.1.8 オンライン決済済み（prepaid_online）の扱い【要確認 M2】

- 現状: M2 の日程変更は `prepaid_online` で不可（金額が変わると Stripe の請求額と食い違うため）。1 室の `amend_booking` も TS（`isPrepaidOnline`）で止めている。
- **推奨（M3）: 部屋の変更も不可のまま。** 理由: (a) 増額なら新しい PaymentIntent（保存カード or メールのリンク）と `direct_payments` の 2 本目の記録、減額なら `refund_due` の式に「変更による返金」を足す必要があり、`_assert_booking_totals` の `paid_amount` 検査（`amended_count = 0` のときだけ）や `booking_rooms.prepay_discount / bath_tax` の再計算（早期決済割の段は予約日で固定・入湯税は人数×泊）も要る。M3 の範囲を超える。(b) お客さまには「取消 → 取り直し」（キャンセル料がかからない期間なら全額返金）か電話で案内（画面の文言は既存 `amend_prepaid_blocked`）。
- 将来（M4 の種）: 減額だけ先に許す案 — 変更後に `refund_due` を「`A − Σ生きている部屋の paid_share − Σ取消部屋の cancel_kept − refunded`」で引き直せば差額が自然に返金額になる（部屋の `paid_share` が `booking_rooms` から導けるため）。増額は保存カードへの追加請求（取引先のチェックアウト日決済の仕組みの流用）。いずれも設計は別途。

#### 17.1.9 キャンセル規定の写し・特別会員の方式の合成

- **プランが変わる部屋は、新しいプランの規定を写す**（既存 `amend_booking` と同じ: `rate_plans.cancellation_policy` → `booking_rooms.cancellation_policy_snapshot`）。プランが同じ（部屋タイプ・人数だけ）なら据え置き。
- 特別会員の予約（`bookings.metadata.member_page` あり）: プラン規定に**予約時の方式**（`member_page.cancel_policy_mode` / `cancel_rules`。`bookings.metadata` に写してあるので今の専用ページの設定ではなく予約時の値）を合成する。合成の式は `_confirm_booking_group`（`20261010221207` 238〜245 行: 配列を `{rules}` に正規化 → `page` なら `{rules: 専用規定, source:'member_page'}`・`favorable` なら `|| {member_page:{mode, rules}}`・`rank` はそのまま）にある。**純関数 `book._member_policy_snapshot(p_plan_policy jsonb, p_member_page jsonb) returns jsonb` に切り出し**、`_confirm_booking_group`（写して差し替え）と新 RPC の両方が呼ぶ【判断・同じ式を 2 か所に書かない】。
- 変えない部屋の規定は触らない。

#### 17.1.10 専用特典（`member_perks`）と要望欄の特典の行

- 専用ページ経由の予約でプランが変わる部屋: **`booking_rooms.member_perks` を新しいプランの特典に差し替える**。特典は TS が `p_rooms[i].member_perks`（`perksSnapshotOf(s.perks, 新 planCode)`・`_member_perks_of` で `id/title/description` に絞る）で渡す（仮押さえと同じ流儀）。渡さなければ null（特典なし）。**今の専用ページの設定**から取る（予約時の特典の表は保存していない）【判断】。
- `core.stays.notes` の先頭の「【特別会員特典】title／title」の行（`_confirm_booking_group` 167〜170 行が付ける）を**差し替える**: `notes` の先頭行が `【特別会員特典】` で始まればその行を外し、新しい特典があれば新しい行を先頭に置く（それ以外の行〔部屋ごとの回答・代表の要望〕は残す）。公式の予約（`member_page` なし）は何もしない。
- プランが同じなら特典も行も触らない。

#### 17.1.11 人数が変わるときの男女の内訳・回答

- `booking_rooms.guest_detail.male / female` は合計が人数と合わなくなるので **null に戻す**（PMS は 0/0 を「不明」として扱う〔autumn-pms `import.ts` 523〜525 行〕）【判断・画面で聞き直さない】。`guest_detail.answers`・`core.stays.notes` の部屋ごとの回答は残す（プランが変わって質問が合わなくなっても消さない。現場が要望欄で読む）。
- `core.stays.adult_count = party_size = 新 adults`、`room_type_id = 新 room_type_id`（既存 `amend_booking` と同じ列）。

#### 17.1.12 4 室上限・定員

- 室数は変わらないので `_max_rooms_per_booking()` の検査は不要。定員は §17.1.2（`capacity_max`）。

#### 17.1.13 PMS 電文（§17.4 に autumn-pms 側の要点）

- `_emit_pms_event(booking_id, 'modified', amendment)`。`rooms[]` は生きている部屋（新しい部屋タイプ・プラン・人数・泊明細）、`amounts` は生きている部屋の和（M2 から）。`amendment` は次の形:

```jsonc
{
  "amendment_no": 2,
  "kind": "plan" | "room" | "party" | "composite",   // booking_amendments.kind と同じ語彙（変えた部屋の変更の種類を合成。2 種類以上なら composite）
  "scope": "rooms",                                   // 新。日程変更は "dates"（kind='dates'）、1 室取消は kind='room_cancelled'
  "by": "member" | "staff" | "admin", "reason": "…" | null, "forced": false,
  "changed_rooms": [                                  // 新。変えた部屋だけ
    { "room_index": 2, "stay_id": "…", "reservation_code": "YB-2026-000123-2",
      "before": { "room_type_id": "…", "room_type_name": "和室", "rate_plan_id": "…", "plan_code": "P1", "plan_name": "朝夕食", "adults": 2, "total": 60000 },
      "after":  { "room_type_id": "…", "room_type_name": "洋室", "rate_plan_id": "…", "plan_code": "P2", "plan_name": "朝食のみ", "adults": 3, "total": 66000 } }
  ],
  "before": { "total": 119000, "points_used": 3000, "coupon_discount": 1000, "rooms": [ /* 生きている全室の旧値（dates と同じ形） */ ] },
  "after":  { "total": 125000, "points_used": 3000, "coupon_discount": 1000, "rooms": [ /* 新値・price_snapshot 付き */ ] }
}
```

- `booking_amendments` には 1 行（`kind` は上の語彙・`stay_id` は変えた部屋の滞在〔複数なら若い `room_index`〕・`before/after` は上と同じ・`member_user_id` は会員〔スタッフ操作でも予約の会員・null 不可のため〕）。DDL 不要（`kind` の check は既存の語彙で足りる）。

#### 17.1.14 メール・通知

- **新しいメールの種類は作らない**【判断】。既存の日程変更も `book.notifications`（マイページのお知らせ）だけでメールは送っていない（`amend_booking` / `amend_booking_dates` に `_enqueue_booking_mail` は無い）。部屋の変更も同じく `notifications`（専用ページ経由は URL を専用ページの予約詳細に）。
- 変更後の内容をメールで送りたいときは、管理画面の**確認メール再送**を使う（§17.5.1 の修正後は「今の部屋だけ・今の金額」で出る）。会員向けの「変更内容のご案内」メールが要るなら【要確認 M5】。

### 17.2 DB（autumn-shared・migration 1 本 ＋ 退避表 drop は別ファイル）

`bash ~/.claude/new-migration.sh autumn-shared book_multi_room_m3`。写す元は PROD の最新定義（M2・VIP 適用後）。

#### 17.2.1 新しい関数

| 関数 | 権限 | 中身 |
|---|---|---|
| `book._member_policy_snapshot(p_plan_policy jsonb, p_member_page jsonb) returns jsonb` | service_role | §17.1.9 の合成（`_confirm_booking_group` 238〜245 行を切り出す） |
| `book._amend_limit(p_booking_id uuid) returns integer` | service_role | 回数の上限（【要確認 M1】の結果。既定は 2） |
| `book._amend_compute_rooms(p_booking booking.bookings, p_rooms jsonb, p_by text) returns jsonb` | service_role | 見積の本体（`_amend_compute_dates` を写し、ループを「変える部屋は新しい値・変えない部屋は今の値」に）。先頭で `_member_page_guard(p_booking.metadata, p_by)`。`p_rooms[i] = {room_index, rate_plan_id, room_type_id, adults, lines?, member_perks?}`。見積は `p_booking.metadata ? 'member_page'` なら `lines` 必須（`_member_lines`・`capacity_max`）、無ければ `book.quote`。戻りは `_amend_compute_dates` と同じキー（`quote`・`kind`・`is_noop`・`deadline_at`・`past_deadline`・`old_charge`・`new_total`・`new_charge`・`diff`・`points_refund`・`new_points_used`・`coupon`・`new_discount`・`in_penalty`・`available`・`sold_out[]`・`rooms[]`）＋ `changed_rooms[]`（§17.1.13 の形）・`amend_remaining` |
| `book._amend_booking_rooms_core(p_booking_code text, p_rooms jsonb, p_by text, p_actor uuid, p_reason text, p_force boolean) returns jsonb` | service_role | 確定の本体（`amend_booking_dates` を写す）: ロック（予約・全滞在・全部屋）→ 条件（§17.1.2）→ `_amend_compute_rooms` → 在庫（§17.1.3）→ `core.stays`（変えた部屋の `room_type_id / adult_count / party_size`・特典の行〔§17.1.10〕）→ `booking_rooms`（変えた部屋: `rate_plan_id / price_lines / room_total / cancellation_policy_snapshot / member_perks / guest_detail`、全室: `coupon_share / points_share`）→ `bookings`（合計・`amended_count`・`last_amended_at`）→ ポイント返還 → `booking_amendments` → 電文 `modified` → `notifications` → 監査（スタッフ）→ `_assert_booking_totals`。戻り `{booking_code, amendment_no, diff, new_total, points_refund, kind, changed_rooms}`。M2 の `_cancel_booking_room_core` ＋ 薄い入口の作法 |
| `book.quote_amendment_rooms(p_booking_code text, p_rooms jsonb)` / `book.amend_booking_rooms(p_booking_code text, p_rooms jsonb)` | authenticated・service_role | 会員（公式マイページ）。`auth.uid()` の本人確認は `amend_booking_dates` と同じ。`p_by='member'`。専用ページ経由の予約はガードで `member_page_booking` |
| `book.admin_quote_amendment_rooms(p_booking_code, p_rooms)` / `book.admin_amend_booking_rooms(p_booking_code, p_rooms, p_reason, p_force boolean default false)` | authenticated（`_require_admin`）・service_role | 管理画面。理由必須。`p_by='admin'`（`admin_cancel_booking_room` と同じ・admin / staff）。`p_force` はペナルティ・締切だけ越える（§17.1.6）。専用ページ経由の予約は `p_rooms[i].lines`（専用料金）と `member_perks` を Book の管理画面サーバが付けて渡す |
| `book.member_page_quote_amendment_rooms(p_partner_id, p_member_user_id, p_booking_code, p_rooms)` / `book.member_page_amend_booking_rooms(…)` | service_role | 専用ページ。`_member_page_booking_check` → `set_config('request.jwt.claim.sub', 会員)`・`set_config('book.member_page_ctx', partner)` → `_amend_compute_rooms` / `_amend_booking_rooms_core(…, 'member', 会員, null, false)`。通知の URL は専用ページ（`member_page_amend_booking_dates` と同じ） |

#### 17.2.2 差し替える既存関数（巻き戻し用に PROD の定義を保存する）

| 関数 | 写す元 | 差分 |
|---|---|---|
| `book._confirm_booking_group` | `20261010221207` | 規定の合成を `_member_policy_snapshot` の呼び出しに（結果は同じ） |
| `book._cancel_booking_core` | `20261010221207` | §17.5.2（オプションの取消） |
| `book.mail_render_context` | `20261010204933` | §17.5.1（確認メールは生きている部屋だけ） |
| `book._amend_compute` | `20261010221207` | 【要確認 M3】が「揃える」なら `in_penalty` を `rate > 0 and not allow`（日程に限らない）に。`amend_remaining` を `_amend_limit` から |
| `book.quote_amendment` / `quote_amendment_dates` | `20261010092423` / `20261010204933` | `amend_remaining` を `_amend_limit` から（【要確認 M1】で上限を変えるとき） |
| `book.amend_booking` / `amend_booking_dates` / `member_page_amend_booking_dates` | 同上 | `amend_limit` の判定を `_amend_limit` に（同上） |

**DDL**: 【要確認 M1】で上限を変えるなら `alter table book.booking_amendments drop constraint …; add constraint … check (amendment_no between 1 and 5)`（制約名は `\d` で実名を確かめる）。それ以外の DDL は無し（`booking.bookings` / `core.stays` / `mail_outbox` は触らない。`booking_amendments.kind` の check は既存の語彙で足りる）。

権限: 内部 4 本は service_role だけ。会員用 2 本と管理用 2 本は authenticated・service_role。専用ページ用 2 本は service_role。巻き戻しは「新しい関数を drop・差し替えた関数を `docs/rollback/<version>_functions_before.sql` から当て直す・check を戻す」を migration 末尾のコメントに。

### 17.3 画面

#### 17.3.1 公式マイページ（`/account/reservations/[code]`）

- **1 室の公式予約**: 従来の変更ウィザード（`amend/`・日程・部屋・プラン・人数をまとめて・`amend_booking`）を**そのまま残す**【判断・既存の動きを変えない】。
- **2 室以上**: 予約詳細の部屋カードに **「このお部屋を変更」**（生きている部屋・`canAmend` と同じ条件〔reserved・締切前・残回数・現地払い〕）→ 新ルート **`amend/room/[index]`**: 現在（部屋名・プラン名・人数・金額）／候補（`sbPlanOffers(facility, checkin, nights, adults)` のプラン × 部屋タイプ・残室つき・人数のセレクタ 1〜6）／見積（`quote_amendment_rooms`: この部屋の今と変更後・予約全体の今と変更後〔クーポン／ポイントの再按分後〕・返還ポイント・あと N 回・在庫の目安）／確定 → 予約詳細へ 303。失敗の文言は `amend_*` の既存キー ＋ `amend_err_payment_incompatible`・`amend_err_over_capacity`（新）。
- 「日程を変更する（全室）」（既存・`amend/`・`datesOnly`）はそのまま。
- 専用ページ経由の予約は従来どおり参照のみ（ボタンを出さない・action は 403・DB のガード）。

#### 17.3.2 専用ページの「ご予約一覧」（`/p/[token]/bookings/[id]`）

- **室数を問わず**（1 室も）部屋カードに「このお部屋を変更」→ 新ルート `bookings/[id]/amend/room/[index]`。候補は専用ページの料金で出す: プランは `member_page_plans(facility_id)`（公開プラン・支払方法）、部屋タイプは `loadStayPage` と同じ部屋一覧、料金は候補ごとに `quoteMemberRooms`（`ignoreRemaining: true`・残室は DB が確かめる）。選んだ候補の `lines`・`member_perks` を `member_page_quote_amendment_rooms` → 確定で作り直して `member_page_amend_booking_rooms`（画面の金額は受け取らない・日程変更と同じ）。専用料金を出せない組み合わせは候補から外す。
- 既存の「日程を変更する（全室）」（`bookings/[id]/amend`）はそのまま。
- 確認モード（会員なし）では出さない。アクセスログ `booking_amend`（`detail` に `room_index`）。

#### 17.3.3 管理画面（`/admin/reservations/[code]`）【推奨案】

- 部屋の表（`BookingRoomsTable`）の各行に **「変更」**（生きている部屋・予約 confirmed・全室 reserved・現地払い）→ 行の下に開くフォーム: 部屋タイプ（施設の部屋タイプ）・プラン（公開プラン）・人数・理由（必須）・「キャンセル料がかかる期間・締切後でも変更する（`force`）」・見積（`admin_quote_amendment_rooms`）→ 確定 `?/amendRoom`（`admin_amend_booking_rooms`）→ 監査ログ `amend_booking_rooms`。
- 専用ページ経由の予約: 管理画面サーバが `member_page.partner_id` の取引先コンテキストを読み（`loadPartnerContext`）、候補の料金を `quoteMemberRooms` で出して `lines` と `member_perks`（`perksSnapshotOf`）を付けて渡す。専用料金を出せない候補は選べない（「専用料金が設定されていません」）。
- オンライン決済済みは管理画面でも不可（文言: 「カードでお支払い済みのご予約は変更できません。取消 → 取り直し、または返金後に…」）。
- 管理画面に**日程変更は従来どおり無い**（M3 では足さない。足すなら `amend_booking_dates` の admin 版を同じ作法で）。

### 17.4 autumn-pms への依頼（別エージェント・電文の形は §17.1.13）

| # | 内容 | 必須か |
|---|---|---|
| P1 | **部屋ごとの変更の受け**: `modified` で `amendment.scope = 'rooms'` のとき、`expandDirectBooking` の既存の展開で足りることを確かめる。泊行は `rooms[i].room_type_id / adults / plan` で作り直される（`import.ts` 527〜545 行）、`core.stays.room_type_id / adult_count` は Book が書く（PMS は `room_type_id` を**補完のみ**・509 行）。**部屋割り**: 部屋タイプが変わった滞在は `assigner.plan` が元の部屋（`keepByDate` / `fallbackKeepRoomId`）を**維持しない**こと（351〜362 行のコメントどおりか）を確認。違えば `after.room_type_id ≠ 旧` の滞在は `assigned_room_id` を外して再割当 | 要確認（壊れないが要検証） |
| P2 | **変更ログ**: 今の差分検知はトップの `plan.name`（1 室目）・大人の合計・室数・合計金額だけ（392〜399 行）。2 室目のプラン・部屋タイプの変更が `notes` に残らない。`amendment.changed_rooms[]` を読んで「2室目: 和室→洋室・朝夕食→朝食のみ・2名→3名」を予約グループの `notes` と `cancellation_logs` 相当の変更ログに書く | 推奨 |
| P3 | プランが変わった部屋の `stay_nights.dinner_option`（人が入れた値は最優先・空のときだけ既定で埋める・579〜580 行）: 旧プランの既定コースが残る。`changed_rooms[].before.plan_code ≠ after.plan_code` の滞在は、`dinner_option` が旧プランの既定値と同じなら新プランの既定値に差し替える（人が変えた値は残す） | 推奨 |
| P4 | 請求書の宿泊明細の自動除外（決定 4・1 室取消 `room_cancelled` のとき取り消した部屋の泊行を請求から外す）。電文は M2 の `cancelled_rooms[]`（`stay_id`・`reservation_code`）で足りる。**電文の形の変更は不要** | PMS 側で実装 |
| P5 | `modified` の `amendment.kind` の語彙が増える（`scope='rooms'` の `plan / room / party / composite`）。既存は `room_cancelled` 以外を「従来どおりの変更」として展開しているので壊れない（1668 行のログにも出る） | 情報 |

### 17.5 あわせて直すもの（決定 5）

#### 17.5.1 管理画面からの確認メール再送で取り消した部屋を載せない

- 事実: `admin_resend_booking_mail`（`20261010221207` 2285 行〜）は `booking_confirmation` を `_enqueue_booking_mail` するだけ。`mail_render_context`（M2 669 行〜）は `rooms = _booking_rooms_view(booking_id)`（**取消済みを含む全室・`cancelled` フラグ付き**）、代表の `room / plan / adult_count / price_lines` は `bookings.stay_id`（1 室目）から。`templates.ts` の `multiRoomsOf` は `rooms.length > 1` なら全部並べる（276 行）。1 室目が取消済みで 2 室目だけ生きている予約を再送すると、1 室の文面に**取り消した 1 室目**が出る。
- 直し方（DB 1 か所・テンプレートは小改修）: `mail_render_context` で **`kind = 'booking_confirmation'` のときは `rooms` を生きている部屋だけ**（`cancelled_at is null`）にし、代表（`room / plan / adult_count / price_lines / total_amount`）も**生きている部屋の最初**から組む（`total_amount` は `bookings.total_amount`＝生きている部屋の和でよい）。`booking_cancelled` / `booking_room_cancelled` は全室のまま（取り消した部屋を並べる文面に要る）。`templates.ts` は `multiRoomsOf` が 1 件なら 1 室の文面に落ちる（既存の分岐）ので変更は最小（人数の合計・`rooms.length` の「N室」が生きている数になることをテストで確かめる）。
- 再送は「今の内容」のメールとして日程変更・部屋の変更の後にも使える（§17.1.14）。

#### 17.5.2 予約全体の取消・最後の 1 室の取消でオプションも取り消す

- 事実: `_cancel_room_core(…, p_cancel_options)` は 1 室取消のときだけ `true`（M2 1814 行）。全室一括と最後の 1 室（`_cancel_booking_core` 経由・1644 行）は `false` で、オプション（`booking_option_orders`）が `reserved` のまま残る（§16.7-4）。
- 直し方: `_cancel_booking_core` のループで **`p_cancel_options => true`** にし、さらにループの後に `update book.booking_option_orders set status = 'cancelled', cancelled_at = now() where booking_id = v_booking.id and status in ('reserved','needs_reschedule')`（部屋に紐づかない行・M1 以前に代表の部屋へ付いた行の取りこぼしを拾う）。`fulfilled` は触らない。オプションは現地払い（`booking_option_orders` に決済の列は無い〔`20260711070733`〕）なので返金処理は無い。
- メール `booking_cancelled` にオプションの取消を書くかは任意（M3 では書かない【判断】）。

### 17.6 退避表 `book._mr_backup_*` の drop（2026-11-09 以降・別 migration）

- 対象: `book._mr_backup_bookings`・`book._mr_backup_holds`（M0 `20261010092423` 159〜171 行。service_role の select だけ）。
- **M3 本体には含めない。** ファイルは **2026-11-09 以降に** `bash ~/.claude/new-migration.sh autumn-shared book_multi_room_drop_backup` で切る（実 UTC 秒。先に切って main に置くと次の `db push` で当たってしまうため、**当日まで `supabase/migrations/` に置かない**。SQL は下書きとして `autumn-shared/docs/rollback/_draft_book_multi_room_drop_backup.sql` に置く）。
- 事前確認（読み取り・当日）: `select book._assert_booking_totals(b.id) from booking.bookings b where exists (select 1 from book.booking_rooms r where r.booking_id = b.id)` が全件通る／`select count(*) from book._mr_backup_bookings`・`_mr_backup_holds` を記録／巻き戻しの予定が無いこと。`docs/rollback/20261010092423_*.sql` は記録として残す（表を消しても M0 の巻き戻し手順書は読めるが、**実行はできなくなる**ことを HANDOFF に書く）。
- SQL（下書き）:

```sql
-- book_multi_room_drop_backup: M0（20261010092423）のバックフィル退避表を消す（M0 本番適用 2026-10-10 から 30 日後・Q11）
do $$ begin
  if to_regclass('book._mr_backup_bookings') is null and to_regclass('book._mr_backup_holds') is null then
    raise notice '[book_multi_room_drop_backup] 退避表は既に無い'; return;
  end if;
  raise notice '[book_multi_room_drop_backup] _mr_backup_bookings=% _mr_backup_holds=%',
    (select count(*) from book._mr_backup_bookings), (select count(*) from book._mr_backup_holds);
end $$;
drop table if exists book._mr_backup_bookings;
drop table if exists book._mr_backup_holds;
-- 巻き戻し: できない（退避表は M0 適用前の値の写し。消した後に M0 を巻き戻す手段は無くなる）
```

### 17.7 実装の分担と契約（A: DB・サーバ → B: 画面。団体予約・複数室・特別会員と同じ流儀）

| 担当 | ファイル |
|---|---|
| **A** | autumn-shared: migration 1 本（§17.2）・巻き戻し用の関数定義の保存（差し替える 7〜9 本）・`functions/send-booking-mail/templates.ts`（§17.5.1 のテスト）・`docs/rollback/_draft_book_multi_room_drop_backup.sql`（§17.6）。autumn-book: `lib/multi-room.ts`（型 `AmendRoomInput` / `AmendRoomsQuote` / `ChangedRoom`・`amendLimitOf(roomCount)`〔DB の `_amend_limit` と同じ式・テスト〕）、`lib/server/supabase-data.ts`（`sbQuoteAmendmentRooms` / `sbAmendBookingRooms`・`mapAmendRoomsQuote`）、`lib/server/partners/member-bookings.ts`（`memberAmendRoomLines(db, partner, booking, changes)`・`memberPageQuoteAmendRooms` / `memberPageAmendRooms`・候補 `memberRoomCandidates`）、`lib/server/admin-app-data.ts`（`adminQuoteAmendRooms` / `adminAmendBookingRooms`・専用ページ経由の `lines` の組み立て）、`lib/server/member-reservation-detail.ts`（部屋カードの `canAmendRoom`・`hrefs.amendRoom(index)`）、routes: `account/reservations/[code]/amend/room/[index]/+page.server.ts`（新）、`p/[token]/bookings/[id]/amend/room/[index]/+page.server.ts`（新）、`admin/reservations/[code]/+page.server.ts`（`?/quoteRoom`・`?/amendRoom`）、`messages/*.json` の新キー |
| **B** | `account/reservations/[code]/+page.svelte`（部屋カードの「このお部屋を変更」）・`amend/room/[index]/+page.svelte`（新・候補の一覧 → 人数 → 見積 → 確定。`lib/components/booking/AmendRoomPicker.svelte` を切り出して専用ページと共用）、`p/[token]/bookings/[id]/+page.svelte`・`amend/room/[index]/+page.svelte`（新）、`admin/reservations/[code]/+page.svelte`・`lib/components/admin/BookingRoomsTable.svelte`（行の「変更」とフォーム） |

**A → B の契約（骨子。A が実装後に正式版を §18 として書く）**

- `/account/reservations/[code]` load: `rooms[i].canAmendRoom: boolean`・`hrefs.amendRoom: (index) => string`。
- `/account/reservations/[code]/amend/room/[index]` load: `{ code, facility:{name, phone}, room:{ index, roomName, planName, adults, total, roomTypeId, planId }, candidates:[{ ratePlanId, roomTypeId, planName, roomName, total, perPerson, remaining }]（?adults= の人数で）, adults, selected:{ratePlanId, roomTypeId}|null, quote: AmendRoomsQuote|null, quoteError: string|null, amendRemaining }`。action `?/confirm(ratePlanId, roomTypeId, adults)` → 303 予約詳細／`fail(400, {message})`。
- `AmendRoomsQuote = AmendQuote & { rooms:[{index, oldTotal, newTotal, charge, couponShare, pointsShare}], changed:[{index, before:{…}, after:{…}}], available, soldOut: string[] }`。
- `/p/[token]/bookings/[id]` load: `rooms[i].canAmendRoom`・`hrefs.amendRoom`。`…/amend/room/[index]` load は上と同じ形（候補は専用料金・`candidates[i].perks`）。action `?/confirm(planCode, planName, roomCode, adults)`。
- `/admin/reservations/[code]`: `detail.booking.rooms[i].canAmend`・`amendOptions:{ roomTypes:[{id, name, capacity}], plans:[{id, name, onsite}] }`。actions `?/quoteRoom(roomIndex, ratePlanId, roomTypeId, adults)` → `{ roomQuote }`／`?/amendRoom(roomIndex, ratePlanId, roomTypeId, adults, reason, force)` → `{ amended:{…} }`／`fail(status, {message})`。
- 失敗の文言キー（新）: `amend_err_payment_incompatible`・`amend_err_over_capacity`・`amend_err_room_not_found`。既存: `amend_prepaid_blocked`・`amend_err_penalty`・`amend_err_past_deadline`・`amend_err_limit`・`amend_err_no_change`・`amend_err_sold_out`・`amend_err_not_sellable`。

**順序**: A が migration を書く → 使い捨てコンテナで M0→M1→M2→VIP→**M3** を当て、§17.8 の DB 項目を流す → PROD から差し替える関数の定義を保存（`docs/rollback/<version>_functions_before.sql`）→ main に push → `supabase db push --linked --dry-run`（対象がこの 1 本だけ）→ 本適用 → `migration list --linked`・`pg_proc` で新関数・`booking_amendments` の check → **`send-booking-mail` をデプロイ**（§17.5.1 のテンプレート修正と同時）→ TS → §18 → B。Book のデプロイは migration の後（旧 Book は新 DB でそのまま動く）。親がレビュー・結合・バージョン（MINOR）・HANDOFF.md の転記。autumn-pms（§17.4）は別エージェント・前後どちらでもよい（P1 は先に確認しておくと安心）。

### 17.8 テストチェックリスト（HANDOFF.md 転記用）

#### DB（M3）
- [ ] `amend_booking_rooms`（会員・3 室の予約・2 室目を 和室 2 名 → 洋室 3 名・プランも変更）: `core.stays.room_type_id / adult_count` と `booking_rooms.rate_plan_id / price_lines / room_total / cancellation_policy_snapshot`（新プランの規定）が変わり、1・3 室目の `price_lines` は据え置き、`coupon_share / points_share` は全室で再按分、`total_amount` ＝ 新しい和、在庫は和室 +1・洋室 −1（滞在期間）、`booking_amendments(kind='composite')`、電文 `modified`（`amendment.scope='rooms'`・`changed_rooms` 1 件・`rooms[]` 3 件の新値）、`notifications` 1 件、`_assert_booking_totals` が通る
- [ ] 同じタイプで人数だけ変更 → 在庫は動かない（`kind='party'`）。`guest_detail.male/female` が null に
- [ ] 洋室の残り 0 で部屋タイプを洋室へ → `sold_out:<id>`・何も変わらない（和室の在庫も戻っていない）。見積は `available:false`
- [ ] 定員超え（洋室 `capacity_max=2` に 3 名）→ 公式は `not_sellable`、専用ページは `over_capacity`
- [ ] 現地払い不可のプラン（`payment_method='prepayment'`）へ → `payment_incompatible`
- [ ] ペナルティ期間（率 > 0）の部屋 → `amend_in_penalty`。スタッフの `p_force=true` は通る（理由必須・監査ログに `forced`）。締切後も同様。回数と `prepaid_online` は `force` でも不可
- [ ] オンライン決済済み（`direct_payments.status='paid'`）→ `prepaid_online`（会員・専用ページ・管理画面とも）
- [ ] 回数: 日程変更 1 回 → 部屋の変更で `amended_count` が共有で増える。上限（【要確認 M1】の値）で `amend_limit`。`amend_remaining` が `quote_amendment / _dates / _rooms` で同じ
- [ ] 取消済みの部屋・2 室目がチェックイン済みの予約 → `room_not_found` / `not_amendable`
- [ ] `member_page_amend_booking_rooms`（専用ページ経由・2 室）: `lines` が専用料金で `room_total` に入る・`lines` の長さ／日付／`adults`／`subtotal` の不一致は `invalid_lines`・プラン変更で `booking_rooms.member_perks` が新プランの特典に・`core.stays.notes` の先頭行「【特別会員特典】…」が差し替わる（特典なしのプランなら行が消え、回答・代表の要望は残る）・`cancellation_policy_snapshot` が予約時の方式（`page` / `favorable`）で合成される（`_confirm_booking_group` と同じ結果）
- [ ] ガード: 専用ページ経由の予約に会員の `amend_booking_rooms` / `quote_amendment_rooms` → `member_page_booking`。`admin_amend_booking_rooms` は通る
- [ ] 1 室の予約: 公式マイページは従来の `amend_booking`（日程を含む）がそのまま。専用ページは `member_page_amend_booking_rooms` で部屋・プラン・人数が変わる
- [ ] `_confirm_booking_group`（差し替え後）: 公式・専用ページ（page / favorable / rank）の規定の合成が従来と同じ（コンテナで md5 でなく結果を比べる）
- [ ] §17.5.1: 1 室目を取り消した 2 室の予約で `admin_resend_booking_mail` → `mail_render_context` の `rooms` が生きている 1 件・`room / plan / adult_count / price_lines` が 2 室目・文面に 1 室目が出ない。`booking_cancelled` / `booking_room_cancelled` の文面は従来どおり
- [ ] §17.5.2: オプション（`reserved`・`needs_reschedule`）の付いた 2 室の予約を全室一括で取消 → 全部 `cancelled`・`cancelled_at`。最後の 1 室の取消でも同じ。`fulfilled` は変わらない。1 室取消は従来どおりその部屋の分だけ
- [ ] （【要確認 M3】で揃える場合）1 室の `amend_booking` でペナルティ期間のプランだけの変更が `amend_in_penalty` になる

#### 公式マイページ
- [ ] 2 室以上の予約詳細の部屋カードに「このお部屋を変更」。候補（プラン × 部屋タイプ・残室）と人数を選ぶと、この部屋の今／変更後と予約全体の今／変更後・返還ポイント・あと N 回が出る。確定で予約詳細に戻り、金額・部屋・プランが変わっている
- [ ] 在庫が無い候補は選べない（「満室」）。確定の瞬間に無くなっていたら「満室になりました」でかごは残らない（部屋の変更にかごは無い）
- [ ] 1 室の予約は従来の変更画面のまま。カード払い済みは「変更できません」の案内。専用ページ経由の予約はボタンが無く、専用ページへのリンク
- [ ] 変更後に PMS の予約詳細で部屋ごとの部屋タイプ・プラン名・人数・泊ごとの料金が変わり、部屋割りが新しいタイプの部屋になっている（autumn-pms P1）

#### 専用ページ
- [ ] 1 室・2 室の予約とも部屋カードに「このお部屋を変更」。候補の料金が**専用料金**（料金カレンダーの同じ日の金額と一致）・特典がプランごとに出る。専用料金の無いプラン・部屋は候補に出ない
- [ ] 確定後、予約詳細の部屋カードの特典・方式・金額が変わり、PMS の要望欄の特典の行が新しいプランのもの
- [ ] 公式マイページからは変えられない（403・DB も `member_page_booking`）

#### 管理画面
- [ ] 部屋の表の行の「変更」→ 部屋タイプ・プラン・人数・理由・（必要なら）強制 → 見積 → 確定。監査ログ `amend_booking_rooms`。カード払い済みは不可の案内
- [ ] 専用ページ経由の予約も変えられ、料金が専用料金・特典が差し替わる
- [ ] 確認メール再送で取り消した部屋が載らず、変更後の部屋・金額で出る
- [ ] 全室取消・最後の 1 室取消でオプションが取消済みになる（予約詳細のオプション欄）

### 17.9 要確認（実装を左右するものだけ・推奨案つき）

> **2026-10-11 決定: M1〜M5 はすべて推奨どおり**（ユーザー回答）。回数 `2 + (室数 − 1)`・オンライン決済済みは不可・1 室の `amend_booking` もペナルティ期間のプラン／部屋／人数の変更を止める・管理画面は admin / staff とも可（理由必須・force 可）・変更後のメールは送らない。

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| M1 | 変更回数の上限（日程変更と共有・今は予約で 2 回・`booking_amendments.amendment_no` の check） | A. **`2 + (室数 − 1)`**（1 室は従来どおり 2・4 室で 5。check を `between 1 and 5` に・`_amend_limit` 1 か所）／B. 2 回のまま（DDL なし・足りないときは電話） | **A** |
| M2 | オンライン決済済みの予約の部屋の変更 | A. **M3 は不可のまま**（取消 → 取り直し・電話）／B. 減額だけ許し差額を一部返金（`refund_due` の拡張・`prepay_discount` / `bath_tax` の再計算が要る）／C. 増額の追加請求まで（保存カード・新 PaymentIntent） | **A**（B・C は別設計） |
| M3 | 既存の 1 室の `amend_booking` が「日程を動かさないプラン・部屋・人数の変更はペナルティ期間でも通る」点を新 RPC に揃えるか | A. **揃える**（`_amend_compute` の `in_penalty` を日程に限らない 1 行の差し替え・安いプランへ逃げる抜け道を塞ぐ）／B. 既存はそのまま（新 RPC だけ塞ぐ・1 室と複数室で規則が違う） | **A** |
| M4 | 管理画面（スタッフ）の部屋の変更の権限と強制 | A. **admin / staff とも可・理由必須・`force`（ペナルティ・締切を越える）は admin / staff とも可**（取消の免除と同じ扱い）／B. `force` は admin だけ | **A** |
| M5 | 変更後の内容をお客さまにメールするか | A. **送らない**（マイページのお知らせ ＋ 管理画面の確認メール再送〔§17.5.1 後は今の内容〕で足りる・既存の日程変更と同じ）／B. 新しい種類 `booking_amended` を作る（`mail_outbox` の check・テンプレート・日程変更にも付ける） | **A**（B は要望が出てから） |

> 上記以外は本節の【判断】で置いた（1 回の操作は部屋だけ・日程は別／RPC は配列入力・画面は 1 室ずつ／1 室の公式予約はマイページの従来ウィザードを残す／特典は今の専用ページの設定から／人数が変わる部屋の男女は null／オプション取消のメール追記はしない／電文は `scope='rooms'` ＋ `changed_rooms[]`・`kind` は既存の語彙）。親のレビューで覆してよい。

---

## 18. M3 実装メモ（サーバ側の契約・2026-10-11）

> A（DB／サーバ）。autumn-book・autumn-shared とも **commit / push なし・本番 DB 未適用**（読み取り SQL だけ）。`.svelte` は作っていない・触っていない（B が本節を読んで作る）。
> 検証: 使い捨てコンテナ（`supabase/postgres:17.6.1.084`）に M0〜特別会員と同じスタブ＋M3 用のスタブ（`pms.room_types.capacity_max / is_active`・`booking_amendments` の check 2 本・`booking_option_orders.status` の check・現地払い不可のプラン P3）→ M0 → M1 → M2 → 特別会員（20261010221207）→ **M3** を当て、§18.8 の RPC と巻き戻しを流した。`svelte-check --threshold error` 0 件・`vitest` 778 件（新規 `multi-room-amend.test.ts`）・send-booking-mail の vitest 42 件（新規 3 件）。

### 18.1 migration（1 本・`autumn-shared/supabase/migrations/20261011030642_book_multi_room_m3.sql`）

写す元は PROD の `pg_get_functiondef`。本番の `schema_migrations` が `20261010221207` まで一致していること、差し替える 10 本の `md5(prosrc)` がコンテナ（M0〜特別会員を当てたもの）と PROD で一致することを確かめてから写した（各関数の直前に写す元）。

| 節 | 中身 |
|---|---|
| 0 | `book.booking_amendments_amendment_no_check` を `between 1 and 5` に（PROD の制約名で確認済み）。新 `book._amend_limit(booking_id) → 2 + (室数 − 1)`（室数は取り消した部屋を含む・1〜4 に丸める・`booking_rooms` が無い行は 2） |
| 1 | 新 `book._member_policy_snapshot(plan_policy, member_page)`（`_confirm_booking_group` の規定の合成を切り出し。`member_page` が null なら `plan_policy` をそのまま返す＝公式の予約は従来と同じ値） |
| 2 | 新: `_amend_compute_rooms`・`_amend_rooms_quote_extra`・`_amend_booking_rooms_core`（内部）、入口 `quote_amendment_rooms` / `amend_booking_rooms`（会員）・`admin_quote_amendment_rooms` / `admin_amend_booking_rooms`（管理画面）・`member_page_quote_amendment_rooms` / `member_page_amend_booking_rooms`（専用ページ） |
| 3 | 差し替え 10 本（下表） |
| 4 | 権限・`notify pgrst`。末尾のコメントに巻き戻し |

| 差し替えた関数 | 写す元 | 差分 |
|---|---|---|
| `_confirm_booking_group` | 20261010221207 | 規定の合成を `_member_policy_snapshot` の呼び出しに（結果は同じ。コンテナで page / favorable / rank / 規定なし / 配列形 / null の 7 通りを旧の式と比べて一致） |
| `_cancel_booking_core` | 20261010221207 | §17.5.2: 部屋ごとの `_cancel_room_core(…, p_cancel_options => true)`＋ループの後に予約の `reserved / needs_reschedule` のオプションを `cancelled`（部屋に紐づかない行も）。`fulfilled` は触らない |
| `mail_render_context` | 20261010204933 | §17.5.1: `kind='booking_confirmation'` かつ生きている部屋があるとき、`rooms` は生きている部屋だけ・代表（`room / plan / adult_count / price_lines` と `cancel_policy`）は生きている部屋の最初・`discount / points_used / room_count` も生きている部屋の値。取消のメールは全室のまま |
| `_amend_compute` | 20261010221207 | 決定 M3: `in_penalty = 変更あり and 率 > 0 and not allow_amend_in_penalty`（日程に限らない） |
| `quote_amendment` / `amend_booking` | 20261010092423 | 回数の上限・`amend_remaining` を `_amend_limit` から（`amend_limit` キーも返す） |
| `quote_amendment_dates` / `amend_booking_dates` | 20261010204933 | 同上 |
| `member_page_quote_amendment_dates` / `member_page_amend_booking_dates` | 20261010221207 | 同上 |

- 表の DDL は `booking_amendments` の check だけ（`booking.bookings` / `core.stays` / `mail_outbox` は触らない。`booking_amendments.kind` の check は既存の語彙で足りる）。
- 権限: 内部 5 本（`_amend_limit`・`_member_policy_snapshot`・`_amend_compute_rooms`・`_amend_rooms_quote_extra`・`_amend_booking_rooms_core`）と専用ページの 2 本は service_role だけ。会員の 2 本・管理画面の 2 本は authenticated・service_role。anon は全部不可（コンテナで `has_function_privilege` を確認）。
- 巻き戻し用の適用前の定義: `autumn-shared/docs/rollback/20261011030642_functions_before.sql`（コンテナから保存・10 本。**本番に当てる直前に migration 末尾のコメントの SQL で PROD から取り直して上書きする**）。
- 退避表の drop の下書き: `autumn-shared/docs/rollback/_draft_book_multi_room_drop_backup.sql`（§17.6 のとおり。`supabase/migrations/` には置いていない）。

### 18.2 RPC の入出力

**入力 `p_rooms`（全入口で同じ）**: `[{ room_index, rate_plan_id? | rate_plan_code?, room_type_id? | room_type_code?, adults?, lines?, member_perks? }]`（1〜4 件・`room_index` の重複不可・省いた値は今のまま）。

- コード: `rate_plan_code` ＝ この施設の `booking.rate_plans.code`（専用ページは `planCode■planName`）、`room_type_code` ＝ `pms.room_types.code`。見つからなければ `plan_not_found` / `room_not_found`。
- `lines`（専用ページ経由の予約では変える部屋に必須）: `[{date, unit_price, adults, subtotal}]`・長さ ＝ 泊数・日付は今のチェックインから連続・`adults` ＝ 新しい人数・`subtotal = unit_price × adults`（`_member_lines`）。違えば `invalid_lines`。公式の予約では見ない（`book.quote` で引き直す）。
- `member_perks`: 専用ページ経由でプランが変わる部屋だけ使う（`_member_perks_of` で `id / title / description`・20 件まで）。プランが変わらない部屋は据え置き。

**検査の順（`_amend_booking_rooms_core`）**: `invalid_params`（`p_by`）→ `not_found` → ガード `member_page_booking`（公式の会員経路・専用ページ経由の予約）→ `not_amendable`（予約 confirmed でない・生きている部屋が無い・生きている部屋に reserved でないものがある）→ `amend_limit`（`amended_count >= _amend_limit`・force でも越えない）→ `prepaid_online`（force でも越えない）→ 見積（`_amend_compute_rooms`: `invalid_params` / `room_not_found`〔取消済み・存在しない部屋・別施設の部屋タイプ〕/ `plan_not_found` / `payment_incompatible`〔新しいプランの `v_plans.payment_method` が `onsite / deposit` でない〕/ 定員 `over_capacity`〔専用ページ〕・`not_sellable`〔公式〕/ `invalid_lines` / `not_sellable`〔`book.quote` が出せない〕）→ `past_deadline`（force で越える）→ `no_change` → `amend_in_penalty`（変える部屋のうち 1 つでも今の規定 × 今の宿泊料金で率 > 0・force で越える）→ 在庫 `sold_out:<room_type_id>`（部屋タイプごとの純増が正のタイプだけ・全泊・行ロック・1 泊でも足りなければ全体が戻る）。

**見積の戻り**（`quote_amendment_rooms`・`admin_quote_amendment_rooms`・`member_page_quote_amendment_rooms` 共通）: `_amend_compute_dates` と同じキー（`quote{lines,total,per_person,tax_included}`・`kind`〔none / plan / room / party / composite〕・`is_noop`・`deadline_at`・`past_deadline`・`old_charge`・`new_total`・`new_charge`・`diff`・`points_refund`・`new_points_used`・`coupon`・`new_discount`・`in_penalty`・`date_changed:false`・`plan_changed`・`current_checkin`・`current_nights`・`available`・`sold_out[]`）＋ `room_changed`・`party_changed`・`member_page`・`changed_count`・`changed_rooms[]`（§18.3 の形）・`rooms[]`（生きている全室: `room_index, stay_id, reservation_code, changed, kind, room_type_id, rate_plan_id, adults, old_room_type_id, old_rate_plan_id, old_adults, quote, old_room_total, old_coupon_share, old_points_share, new_total, coupon_share, points_share, charge, in_penalty, cancellation_policy, member_perks`）＋ `ok`・`amend_remaining`・`amend_limit`・`room_count`・`live_rooms`・`prepaid_online`・`amendable`（`ok and 回数が残る and not prepaid_online and not past_deadline`）。見積は条件違反（ペナルティ・締切・回数）を例外にせずフラグで返す（入力・プラン・定員・`lines` の不正は例外）。

**確定の戻り**（`amend_booking_rooms`・`admin_amend_booking_rooms`・`member_page_amend_booking_rooms`）: `{ booking_code, amendment_no, diff, new_total, points_refund, kind, forced, changed_rooms }`。

**書くもの**: 変えた部屋の `core.stays.room_type_id / adult_count / party_size`（専用ページ経由でプランが変わる部屋は `notes` の先頭の「【特別会員特典】…」の行を新しい特典に差し替え・特典なしなら行を外す・他の行は残す）、`booking_rooms.rate_plan_id / price_lines / room_total / cancellation_policy_snapshot`（プランが変わる部屋だけ新しいプランの規定・特別会員は予約時の方式を合成）`/ member_perks / guest_detail`（人数が変わる部屋は `male / female` を外す・`answers` は残す）、生きている全室の `coupon_share / points_share`、`bookings.total_amount / accommodation_amount / net_amount / tax_amount`・`metadata.amended_count / last_amended_at`、ポイント返還（退会済みはスキップ）、`booking_amendments`（`kind` は上の語彙・`stay_id` は変えた部屋の最初・`member_user_id` は予約の会員〔非会員の予約はスタッフ〕・`after` に `scope:'rooms'` と `changed_rooms`）、電文 `modified`、お知らせ（専用ページ経由は `/p/<token>/bookings/<予約番号>`・メールは送らない〔決定 M5〕）、監査ログ `amend_booking_rooms`（スタッフ・管理者: `reason`・`forced`・`kind`・`diff`・`changed_rooms`）、`_assert_booking_totals`。付与見込み `points_earned` は変えない（従来）。

**専用ページの入口**: `_member_page_booking_check`（対象者・このページ経由・予約した本人）→ `request.jwt.claim.sub` と `book.member_page_ctx` を立てて見積・確定 → 戻す（`member_page_cancel_booking` と同じ作法・`p_by='member'`）。**管理画面**: `_require_admin(_admin_tenant())`（`admin_cancel_booking_room` と同じ・admin / staff）・予約のテナントが違えば `not_found`・`p_by='admin'`・確定は理由必須（`reason_required`）。

### 18.3 PMS 電文（`event='modified'`・`amendment.scope='rooms'`）

`rooms[]` は生きている部屋（新しい部屋タイプ・プラン・人数・泊明細・`male/female` は人数が変わった部屋は null）、`amounts` は生きている部屋の和（`_emit_pms_event` は変えていない）。§16.2 と同じ作法で、コンテナの 3 室の予約（クーポン 1,000・ポイント 3,000）の 2 室目を「和室・朝夕食・2 名 → 洋室・朝食のみ・2 名」に変えたときの実物（`guest` 等は省略・`rooms[]` は 2 室目だけ・`before/after.rooms` は 1 件に省略）:

```json
{
  "schema": "autumn.direct_booking/1",
  "event": "modified",
  "sequence": 2,
  "booking": { "booking_id": "4c6fbfdb-…", "booking_code": "YB-2026-008001", "status": "confirmed", "locale": "ja" },
  "rooms": [
    { "room_index": 2, "stay_id": "e1126c9b-…", "reservation_code": "YB-2026-008001-2",
      "room_type_id": "a000…000b", "room_type_code": "YO", "room_type_name": "洋室",
      "adults": 2, "male": 2, "female": 0, "children": { "a": 0, "b": 0, "c": 0, "d": 0, "e": 0 },
      "nights": [ { "date": "2026-11-10", "unit_price": 20000, "subtotal": 40000 }, { "date": "2026-11-11", "unit_price": 20000, "subtotal": 40000 } ],
      "plan": { "rate_plan_id": "b000…0002", "code": "P2", "name": "朝食のみ", "meal_plan": "朝", "rms_plan_template_id": null },
      "member_perks": null }
  ],
  "amounts": { "gross_total": 240000, "discount_total": 1000, "points_used": 3000, "total_amount": 239000, "charge": 236000,
               "bath_tax": 0, "prepay_discount": 0, "tax_included": 21727, "points_earned": 2536,
               "coupon": { "name": "千円引き", "discount": 1000, "coupon_id": "cc00…", "member_coupon_id": "cd00…" } },
  "amendment": {
    "amendment_no": 1,
    "kind": "composite",
    "scope": "rooms",
    "by": "member",
    "reason": null,
    "forced": false,
    "changed_rooms": [
      { "room_index": 2, "stay_id": "e1126c9b-…", "reservation_code": "YB-2026-008001-2",
        "before": { "room_type_id": "a000…000a", "room_type_name": "和室", "rate_plan_id": "b000…0001", "plan_code": "P1", "plan_name": "朝夕食", "adults": 2, "total": 120000 },
        "after":  { "room_type_id": "a000…000b", "room_type_name": "洋室", "rate_plan_id": "b000…0002", "plan_code": "P2", "plan_name": "朝食のみ", "adults": 2, "total": 80000 } }
    ],
    "before": { "checkin": "2026-11-10", "checkout": "2026-11-12", "total": 279000, "points_used": 3000, "coupon_discount": 1000,
                "rooms": [ { "room_index": 2, "rate_plan_id": "b000…0001", "room_type_id": "a000…000a", "adults": 2, "total": 120000, "coupon_share": 428, "points_share": 1286 } ] },
    "after":  { "checkin": "2026-11-10", "checkout": "2026-11-12", "total": 239000, "points_used": 3000, "coupon_discount": 1000,
                "price_snapshot": { "lines": [ "…全室の泊明細…" ], "total": 240000, "per_person": 48000, "tax_included": 21818 },
                "rooms": [ { "room_index": 2, "rate_plan_id": "b000…0002", "room_type_id": "a000…000b", "adults": 2, "total": 80000, "coupon_share": 333, "points_share": 1000,
                             "price_snapshot": { "lines": [ { "date": "2026-11-10", "adults": 2, "unit_price": 20000, "subtotal": 40000 }, { "date": "2026-11-11", "adults": 2, "unit_price": 20000, "subtotal": 40000 } ], "total": 80000, "per_person": 40000, "tax_included": 7273 } } ] }
  },
  "cancel": null, "charge": null, "refund": null
}
```

- `before.rooms` / `after.rooms` は**生きている全室**（変えない部屋も・按分し直した値）。変えた部屋は `changed_rooms[]` で分かる。
- スタッフの操作は `by: "admin"`・`reason`（入力した理由）・`forced`（締切・ペナルティを force で越えたとき true）。
- autumn-pms への依頼（§17.4 P1〜P3・P5）は電文の形の変更なしで足りる。P1（部屋タイプが変わった滞在の部屋割り）は PMS 側で要確認。

### 18.4 Book のサーバ関数（autumn-book）

| ファイル | 中身 |
|---|---|
| `lib/multi-room.ts`（＋`multi-room-amend.test.ts` 33 件） | `amendLimitOf(roomCount)`（DB の `_amend_limit` と同じ式）・型 `AmendRoomInput`（`index`・`ratePlanId? / ratePlanCode?`・`roomTypeId? / roomTypeCode?`・`adults?`・`lines?`・`memberPerks?`）・`amendRoomsPayload`（→ `p_rooms`）・型 `ChangedRoom` / `ChangedRoomSide` と `mapChangedRooms`・型 `AmendRoomsQuoteRoom` と `mapAmendRoomsQuoteRooms`・`canAmendRoomOf`（画面の案内用の可否）・`parseAdults`（1〜6）・`amendRoomErrorCode(e)`（DB の例外の語 → `AmendRoomErrorCode`・具体的な語から）・`amendRoomErrorStatus`・`AMEND_ROOM_MESSAGES_JA`（専用ページ・管理画面の文言） |
| `lib/server/supabase-data.ts` | 型 `AmendRoomsQuote`（`AmendQuote` ＋ `available`・`soldOut`・`roomCount`・`liveRooms`・`amendLimit`・`prepaidOnline`・`memberPage`・`roomChanged`・`partyChanged`・`changedCount`・`rooms: AmendRoomsQuoteRoom[]`・`changed: ChangedRoom[]`）・`mapAmendRoomsQuote`・型 `AmendRoomsResult`（`AmendResult` ＋ `forced`・`changed`）・`mapAmendRoomsResult`・`sbQuoteAmendmentRooms(client, code, rooms)`・`sbAmendBookingRooms(client, code, rooms)`（会員の authenticated クライアント） |
| `lib/server/partners/member-bookings.ts` | `memberRoomCandidates(db, partner, booking, roomIndex, adults)`（料金カレンダーで今の日程の全泊に出ている部屋タイプ × 公開プランを人数ごとに `quotePartnerBooking`・専用料金を出せない組は外す）→ `MemberRoomCandidate[]`・`memberAmendRoomInput(db, partner, booking, roomIndex, {roomCode, planCode, planName, adults})`（泊明細を作り直し、プランが変わるなら今の専用ページの特典を添える）→ `AmendRoomInput`・`memberPageQuoteAmendRooms(who, rooms)` / `memberPageAmendRooms(who, rooms)`・`staffMemberAmendRoomInput({partnerId, facilityId, bookingCode, checkIn, nights, rooms, roomIndex, change:{ratePlanId, roomTypeId, adults}})`（管理画面の UUID を料金カレンダーの識別に直して専用料金の入力を作る・会員の対象判定はしない） |
| `lib/server/admin-app-data.ts` | `adminQuoteAmendRooms(c, code, rooms)` / `adminAmendBookingRooms(c, code, rooms, reason, force)`・`BookingDetail.booking.rooms[i]` に `room_type_id?`・`rate_plan_id?`・`canAmend?` |
| `lib/server/member-reservation-detail.ts` | `amendGate(status, checkin, amendCount, roomCount = 1)`（`remaining` は `amendLimitOf(roomCount) − amendCount`・`limit` を足した）・`reservationDetailOf(event, client, r, { roomAmend?: { scope: 'multi' \| 'all', hrefOf } })` の戻りに `roomAmend`・`prepaidOnline`・`rooms[i].canAmendRoom / amendRoomHref` |
| `lib/partner-member-page.ts` | `memberPageOpError` の `amend_limit` の文言（「2回まで」→「変更回数の上限に達しています（日程とお部屋の変更で共通）」） |
| `messages/{ja,en,zh-TW}.json` | 新 `amend_err_payment_incompatible`・`amend_err_over_capacity`・`amend_err_room_not_found`。`amend_err_limit`（「（2回）」を外す）・`amend_err_penalty`（「宿泊日は」→「ご予約を」）の文言を直した |
| autumn-shared `functions/send-booking-mail/templates.ts`（＋test 3 件） | `liveRoomsContext(ctx)`: 予約確認メールは取消済みの部屋（`rooms[i].cancelled`）を除いて組む（古い DB の行でも載せない・生きている部屋が 1 件なら 1 室の文面）。取消のメールは従来どおり |

### 18.5 各ルートの load / actions（B が使う契約）

**`/account/reservations/[code]`（既存・load に追加）**: `roomAmend: { index, canAmend, href: string | null }[]`（**2 室以上のときだけ**・生きている部屋ごと・専用ページ経由の予約は空）・`rooms[i].canAmendRoom: boolean`・`rooms[i].amendRoomHref: string | null`（`/account/reservations/<code>/amend/room/<index>`）・`prepaidOnline: boolean`・`amend.limit`（回数の上限）。`amend.remaining` は `2 + (室数 − 1) − 変更回数` になった。

**`/account/reservations/[code]/amend/room/[index]`（新）**
- load: 1 室の予約は `…/amend`（従来のウィザード）へ 303、専用ページ経由・予約中でない → 予約詳細へ 303、オンライン決済済み → `?amend=prepaid` 付きで予約詳細へ 303、取消済み・無い部屋は 404。戻り `{ code, facility:{name, phone}, checkin, nights, room:{ index, stayCode, roomTypeId, planId, roomName, planName, adults, total, charge }, candidates: AmendRoomCandidate[], adults, selected:{ratePlanId, roomTypeId} | null, quote: AmendRoomsQuote | null, quoteError: string | null, amendRemaining, amendLimit, hrefs:{ back, self } }`。
  - `AmendRoomCandidate = { ratePlanId, roomTypeId, planName, roomName, total, perPerson, remaining, current, selectable, blocked: 'payment' | 'sold_out' | 'capacity' | null }`（`sbPlanOffers(施設, 今の checkin, 泊数, adults)`。同じ部屋タイプは残室を問わない）。
  - クエリ: `?adults=`（1〜6・既定は今の人数）・`?offer=<ratePlanId>__<roomTypeId>`（既定は今の組み合わせ）。今と違う組み合わせ・人数のときだけ `quote` を出す。
- action `?/confirm`: `ratePlanId`・`roomTypeId`・`adults` → 成功 303 予約詳細／`fail(status, { code: AmendRoomErrorCode | 'invalid', message })`（専用ページ経由は `fail(403, { code:'member_page_booking', message, href })`）。

**`/p/[token]/bookings/[id]`（既存・load に追加）**: 上と同じ `roomAmend`（**室数を問わず・1 室も**）・`rooms[i].canAmendRoom / amendRoomHref`（2 室以上のカード）・`prepaidOnline`・`amend.limit`。URL は `/p/<token>/bookings/<予約番号>/amend/room/<index>`。

**`/p/[token]/bookings/[id]/amend/room/[index]`（新・member だけ・取引先は 404）**
- load: 確認モードは 404、予約が confirmed でなければ予約詳細へ 303、無い部屋は 404。戻り `{ portal, code, checkin, nights, room:{ index, roomCode, roomName, planCode, planName, adults, total }, adults, candidates: MemberRoomCandidate[], selected:{roomCode, planCode, planName} | null, quote: AmendRoomsQuote | null, quoteError: string | null, unavailable: string | null, amendRemaining, amendLimit, hrefs:{ back, self } }`。
  - `MemberRoomCandidate = { roomCode, roomName, planCode, planName, total, perPerson, remaining: number | null, perks: {id,title,description}[] | null, current, selectable, blocked: 'payment' | 'sold_out' | null }`（専用料金・候補ごとの専用特典）。
  - クエリ: `?adults=`・`?room=<部屋タイプのコード>&plan=<planCode>&name=<planName>`（既定は今の組み合わせ）。
  - `unavailable`: オンライン決済済み・予約の施設が専用ページでオフなど（そのとき `candidates` は空）。
- action `?/confirm`: `roomCode`・`planCode`・`planName`・`adults` → 成功 303 予約詳細／`fail(status, { code, message })`（`code` は `AmendRoomErrorCode` か `invalid` / `unavailable` / `forbidden`）。アクセスログ `booking_amend`（`detail` に `room_index / room / plan / adults`）。

**`/admin/reservations/[code]`（既存）**
- load に追加: `amendRooms: { ok, remaining, limit, prepaidOnline, memberPage }`・`amendOptions: { roomTypes: { id, name, capacity }[], plans: { id, name, onsite, memberPage }[] }`（`ok` のときだけ中身あり）・`detail.booking.rooms[i].canAmend`（`ok` かつ生きている部屋）。締切・ペナルティは force で越えられるので `ok` には入れていない。専用ページ経由の予約では `plans[i].memberPage=false` のプランは選べない（専用料金なし）、`onsite=false` は選べない。
- actions（admin / staff とも可・それ以外は 403。テナント・施設の権限は DB の `_require_staff`・`private.has_facility_access`・§18.10 H-1）:
  - `?/quoteRoom`: `roomIndex`・`ratePlanId`・`roomTypeId`・`adults` → `{ roomQuote: AmendRoomsQuote, roomIndex }`／`fail(status, { amendRoomError, amendRoomCode })`。
  - `?/amendRoom`: 上 ＋ `reason`（必須）・`force`（`on`）→ `{ amended: { roomIndex, amendmentNo, kind, diff, newTotal, pointsRefund, forced, changed: ChangedRoom[] } }`／`fail(status, { amendRoomError, amendRoomCode })`。
  - 取引先予約は従来どおり `rejectPartner`（`fail(409, { message })`）。

### 18.6 B（画面）へのメモ

- 部屋の変更の画面は公式（`account/…/amend/room/[index]`）と専用ページ（`p/…/amend/room/[index]`）で候補の型が違う（公式は UUID、専用ページはコード）。共通部品 `AmendRoomPicker.svelte` は「候補の一覧（名前・料金・残室・選べない理由）→ 人数 → 見積 → 確定」の見た目だけにして、候補の識別子とフォームの hidden は呼び出し側で渡すと楽。
- 見積の表示: この部屋の今（`quote.rooms` の `changed` の行の `oldTotal`）と変更後（`newTotal`・`charge`）、予約全体の今（`quote.oldCharge`）と変更後（`quote.newCharge`）・差額 `quote.diff`・返還ポイント `quote.pointsRefund`・あと `quote.amendRemaining` 回・在庫の目安 `quote.available`（false なら「満室」）・`quote.inPenalty`（会員の画面では確定できない旨）・`quote.pastDeadline`。
- 失敗の文言は action の `message`（公式は paraglide、専用ページ・管理画面は日本語）をそのまま出せばよい。
- 管理画面の部屋の表（`BookingRoomsTable`）の各行の「変更」は `detail.booking.rooms[i].canAmend`。フォームの選択肢は `amendOptions`、見積は `?/quoteRoom`（`use:enhance` で `form.roomQuote`）、確定は `?/amendRoom`。`amendRooms.prepaidOnline` なら「カードでお支払い済みのご予約は変更できません」の案内。

### 18.7 本番に当てる順番と条件

1. 事前確認（読み取り）: `schema_migrations` の最新が `20261010221207`・差し替える 10 本の `md5(prosrc)` が §18.1 の確認時と同じ（PROD とコンテナで一致を確認済み）。`select booking_id, amendment_no from book.booking_amendments order by 2 desc limit 5`（check を広げるだけなので既存行は影響なし）。`docs/rollback/20261011030642_functions_before.sql` を migration 末尾のコメントの SQL で PROD から取り直して上書き。
2. `supabase db push --linked --dry-run`（対象がこの 1 本だけ）→ 本適用 → `migration list --linked`。`pg_proc` で新関数 13 本（§18.10 で 2 本増えた）、`pg_constraint` で `booking_amendments_amendment_no_check` が `1〜5` になったことを確認。
3. **`send-booking-mail` をデプロイ**（`supabase functions deploy send-booking-mail --no-verify-jwt`）。DB だけ先でも、DB が生きている部屋だけを返すので確認メールの再送は直る（テンプレートの修正は古い DB への備え）。
4. Book のデプロイは migration の後（新 Book は `quote_amendment_rooms` 等と `amend_limit` を使う。旧 Book は新 DB でそのまま動く: 旧 Book の画面の「あと N 回」は 2 回基準のまま出るが、DB は 2 + (室数 − 1) で判定する）。
5. autumn-pms（§17.4）は前後どちらでもよい。P1（部屋タイプが変わった滞在の部屋割り）は先に確かめておくと安心。

### 18.8 確認した範囲（使い捨てコンテナ）

- 会員 3 室（和室 P1 2 名 ×2・洋室 P2 1 名・2 泊・クーポン 1,000・ポイント 3,000）: 2 室目を洋室・P2・2 名へ → `kind='composite'`・`total_amount` 279,000 → 239,000・クーポン／ポイントの再按分（429/428/143 → 500/333/167・1,286/1,286/428 → 1,500/1,000/500）・2 室目の規定が P2 の規定に・1 室目の泊明細は据え置き・在庫 和室 +1／洋室 −1（滞在期間だけ）・`booking_amendments`（`member_user_id` ＝ 会員・`after.scope='rooms'`）・電文 `modified/composite/rooms`（`rooms[]` 3 件の新値）・お知らせ 1 件・`_assert_booking_totals` 通過。
- 同じタイプで人数だけ（1 室目 2→3 名）→ `party`・在庫は動かない・`guest_detail` の `male/female` が消え `answers` は残る。
- 洋室の残り 0 で和室 → 洋室: 見積 `available:false / sold_out:[洋室]`・確定 `sold_out:<洋室 id>`・和室の在庫も滞在も変わらない。
- 定員超え（洋室 capacity 2 に 3 名）→ 公式 `not_sellable`・専用ページ `over_capacity`。予約時決済だけのプラン → `payment_incompatible`。`room_index` の重複・形の不正 → `invalid_params`・存在しない部屋・取消済みの部屋 → `room_not_found`・変化なし → `no_change`。存在しないコード → `plan_not_found` / `room_not_found`。
- 回数: 3 室の予約で上限 4（`quote_amendment_dates` と `quote_amendment_rooms` の `amend_remaining` が同じ 2）→ 日程変更で 3 回目 → 部屋の変更で 4 回目 → 5 回目は `amend_limit`（管理画面の force でも）。1 室の予約は従来どおり 2（`quote_amendment.amend_remaining`）。
- ペナルティ（+2 日・P1 規定 3 日前 30%）: 会員のプラン変更 → `amend_in_penalty`・同じ予約の P2（規定なし → standard 1 日前）の部屋は通る・管理画面は理由なしで `reason_required`・`force` で通り監査ログ `forced:true`・電文 `by:'admin', forced:true, reason`・`booking_amendments.member_user_id` は予約の会員。**決定 M3**: 1 室の公式予約の `amend_booking` でプランだけの変更が `amend_in_penalty`（見積も `in_penalty:true`・変化なしの見積は false）。
- オンライン決済済み → `prepaid_online`（会員・管理画面の force とも）・見積は `prepaid_online:true / amendable:false`。2 室目がチェックイン済み → `not_amendable`。
- 特別会員（favorable・専用規定 7 日前 10%）2 室: 公式マイページの経路は見積・確定とも `member_page_booking`。専用ページで 1 室目を P2（特典なし）・1 名・専用料金 16,000 へ → `member_perks` null・要望欄の「【特別会員特典】…」の行だけ消え回答・代表の要望は残る・規定は P2 の規定に favorable を合成・お知らせの URL が専用ページ・`book.member_page_ctx` と `request.jwt.claim.sub` が戻っている。2 室目を P1（特典あり）へ → 特典の行が先頭に付き、電文 `rooms[i].member_perks` に新しい特典。`lines` 無し・人数の不一致 → `invalid_lines`。管理画面は `lines` 付きで通り、`lines` 無しは `invalid_lines`。1 室の予約（page 方式）も部屋タイプ・プラン・人数がまとめて変わる（規定 `{rules: 専用規定, source:'member_page'}` のまま）。
- `_member_policy_snapshot` が旧の `_confirm_booking_group` の式と 7 通りで一致。
- §17.5.1: 1 室目を取り消した 2 室の予約の確認メールの文脈 → `rooms` 1 件（2 室目）・`room`=洋室・`plan`=朝食のみ・`adult_count`=1・`room_count`=1・`price_lines` は 2 室目だけ。`booking_room_cancelled` は全室のまま。取り消していない予約は従来と同じ。
- §17.5.2: 全室一括の取消で `reserved` / `needs_reschedule`（部屋に紐づかない行も）が `cancelled`・`fulfilled` は残る。1 室取消はその部屋だけ、最後の 1 室の取消で残りも `cancelled`。
- 巻き戻し: 適用前の 10 本の定義を保存 → M3 → 末尾のコメントの SQL（`amendment_no >= 3` の行を消してから）で 10 本の `md5` が適用前と一致・新関数 11 本が消え・check が `1〜2` に戻る。
- 画面はブラウザで見ていない（`.svelte` が無い・実データ接続が要るため）。

### 18.9 設計から外れた点

1. **部屋タイプ・プランをコードでも受ける**（`rate_plan_code` / `room_type_code`）。専用ページは `booking` スキーマを読めないため（`create_member_page_hold_group` と同じ理由）。公式と管理画面は UUID。
2. **専用ページの泊明細の組み立ては `member-bookings.ts` に置いた**（設計は管理画面の分を `admin-app-data.ts`）。管理画面用は `staffMemberAmendRoomInput`（UUID → コード → `memberAmendRoomInput`）で、予約した会員が対象から外れていても使える（会員の判定をしない・`member_page_booking_rooms` を通さない）。
3. **load の `hrefs.amendRoom(index)` は関数にできない**（load の戻りはシリアライズされる）ので、`roomAmend[i].href`・`rooms[i].amendRoomHref` に URL の文字列を入れた。
4. **管理画面の部屋の変更は admin / staff とも可**（決定 M4）。§18.10 H-1 で DB の権限を `_require_staff`＋施設の権限に直し、`p_by` は実際の役割（admin / staff）。管理画面の取消は従来どおり TS で admin に限っている（扱いが違う）。
5. **`booking_amendments.member_user_id`**（not null・auth.users への FK）は、予約の会員 → 無ければ操作したスタッフ（非会員の公式予約を管理画面から変えたとき）。
6. **公式マイページの 1 室の予約は `amend/room/[index]` に来たら従来の `amend/` へ 303**（入口を 1 つに保つ）。RPC `amend_booking_rooms` 自体は 1 室の予約でも動く（専用ページは 1 室も使う）。
7. **見積は条件違反（締切・ペナルティ・回数・オンライン決済済み）を例外にせずフラグで返す**（`_amend_compute_dates` の見積と同じ扱い）。入力・プラン・定員・`lines` の不正は例外。
8. **`amend_err_limit`・`amend_err_penalty`・専用ページの `amend_limit` の文言を直した**（回数が室数で変わる・ペナルティ期間は日程以外も不可になったため。日程変更の画面にも出る）。
9. 管理画面の `canAmend` は締切・ペナルティを見ない（force で越えられる）。回数・オンライン決済済み・チェックイン済みの部屋があると false。
10. 確認メールのテンプレートにも取消済みの部屋を除く処理を入れた（`liveRoomsContext`・DB の修正の二重化。DB だけ先に当たっても足りる）。

### 18.10 レビュー（Fable）を受けて直した点（2026-10-11）

- **H-1（決定 M4）**: `admin_quote_amendment_rooms` / `admin_amend_booking_rooms` の `_require_admin` をやめ、新しい内部関数 `book._admin_amend_rooms_booking(code)`（`_require_staff(テナント)` → 予約を引いてテナント一致〔違えば `not_found`〕→ `private.has_facility_access(テナント, 予約の施設)` でなければ `forbidden`）を通すようにした。`p_by` は新しい `book._admin_actor_role()`（`private.is_tenant_admin(テナント) or private.is_superadmin()` なら `'admin'`、それ以外は `'staff'`）で、監査ログの `detail.by`・電文の `amendment.by` に実際の役割が出る。新関数 2 本は service_role だけ（巻き戻しの drop にも足した）。TS（`admin/reservations/[code]` の `?/quoteRoom`・`?/amendRoom`）は admin / staff 以外を `fail(403, { amendRoomError: '権限がありません。', amendRoomCode: 'forbidden' })`（同じページの会員まわりの action と同じ作法）。
- **M-1**: 公式マイページの `amend/room/[index]` で、今の部屋タイプが `book.plan_offers`（残室 0 で落ちる）から消える件。今の部屋タイプは、`plan_offers` に出なかった公開プラン（そのプランの部屋タイプに今の部屋タイプが含まれるもの）ごとに `book.quote`（`supabase-data.ts` の `quote`）で見積を引いて候補に足す。今の部屋タイプの候補は `remaining: null`（純増 0 なので在庫を問わない・残室は出さない）。`AmendRoomCandidate.remaining` は `number | null` になった。`plan_offers` は変えていない。
- **M-2**: `_amend_compute_rooms` の `rate_plan_code` の解決を「この施設の `is_active and public_on_direct` のプラン」に限り、2 件以上当たれば曖昧として `plan_not_found`。PROD の `select facility_id, code, count(*) from booking.rate_plans group by 1,2 having count(*)>1` は **0 行**（2026-10-11 読み取り）。コンテナで「非公開の同じコードは無視して解決」「公開の同じコードが 2 件で `plan_not_found`」を確認。
- **M-4**: チェックイン日（今の滞在の最初の生きている部屋）が今日（JST）より前の予約は、見積も確定も（管理画面の force でも）`past_checkin`。判定は `_amend_compute_rooms` の今の日程を読んだ直後（`book.quote` が過去日で `not_sellable` を先に投げるため）。TS: `AmendRoomErrorCode` に `past_checkin`・新キー `amend_err_past_checkin`（日英繁）・`AMEND_ROOM_MESSAGES_JA.past_checkin`。
- **L-2**: `min_stay_violation` を `not_sellable` から分け、コード `min_stay`・新キー `amend_err_min_stay`（「この条件（泊数・人数）ではご予約いただけません。…」・日英繁）・`AMEND_ROOM_MESSAGES_JA.min_stay`。
- **L-3**: `_amend_compute_rooms` の先頭のコメントを実際の動き（日程は変えない・コードは公開中だけ・`book.quote` は例外を投げる・変えない部屋の `lines` は見ない・例外とフラグの分け方・戻りのキー）に直した。
- **M-3（デッドロック）は今回は直していない。**
- 再確認: コンテナで M0 → M1 → M2 → 特別会員 → M3 と §18.8 の RPC を流し直し（結果は前回と同じ）、加えて「施設のあるスタッフは見積・確定でき監査・電文の `by` が `staff`」「別の施設のスタッフ・権限の無い利用者は `forbidden`」「テナント管理者は `by` が `admin`」「チェックイン日を過ぎた予約は見積も force の確定も `past_checkin`」「プランのコードの重複」を確認（想定外のエラー 0 件）。巻き戻しで差し替えた 10 本の `md5` が適用前と一致・新関数 13 本が消え・check が `1〜2` に戻る。`svelte-check --threshold error` 0 件・`vitest` 781 件・send-booking-mail 42 件。
