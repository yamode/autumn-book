# 部屋タイプ横断の室数検索と、取引先の「1予約に複数部屋タイプ」（設計・未実装）

2026-10-28。要望: 必要な室数を部屋タイプ横断で検索でき、足りなければ組み合わせ（和室1＋洋室1 など）で予約へ進める。
表の会員・特別会員・取引先のすべてで同じロジックにする。

## 現状（調査結果）

| 対象 | 室数の扱い | 部屋タイプを混ぜられるか |
|---|---|---|
| 公式サイト `/[brand]/[facility]/plans` | 検索に室数入力なし（大人人数のみ）。複数室は予約かご（`multi-room.ts`・最大4室） | かごでは混ぜられる |
| 特別会員 `/p/[token]`（kind=member） | 検索に室数あり。かご（`memberCart`）→ `memberPageHold`（公式の仮押さえの束） | かごでは混ぜられる |
| 通常の取引先 `/p/[token]` | 検索に室数あり（同じ部屋タイプ N 室）。`createPartnerBooking` → DB `rms_partner_create_booking` | **混ぜられない**（下記） |

### 通常の取引先が1部屋タイプ前提である箇所

- `partner_bookings` が `room_type_id / room_code / room_name / plan_code / plan_name / meal_type / room_count / adult_total` を1行に1組だけ持つ。
- `rms_partner_create_booking`（最新は `20261028104906_book_partner_advance_payment.sql`・約890行）が `p->>'room_code'` で部屋タイプを1つ決め、`rms_partner_room_type_remaining` の残室を `v_room_cnt` で比べ、`rooms[]` の各要素は `adults` と泊ごとの料金（`nights`）だけを持つ。
- 入湯税・事前支払（前受金・一部事前支払）・請求書・取消・PMS の滞在（`core.stays`・room_index 付き）・団体予約の見積が、この1組を前提に組まれている。
- 画面側: `BookingTarget`（`booking.ts`）・`/p/[token]/book` の `target`（roomCode / planCode / roomCount）・`quotePartnerBooking`。

## 共通ロジック（DB 変更なし・先に出せる）

- `lib/partner-room-combos.ts`（v0.198.0 で追加済み）: 部屋×プランの提示（残室つき）と必要室数から、プランごとの組み合わせを作る純関数。
- 公式・会員・取引先のどれもが、同じ関数で「単独で足りる／組み合わせで足りる」を判定する。
- 渡し先だけが違う: 公式＝予約かご、特別会員＝`memberCart`（実装済み）、取引先＝下記の複数タイプ予約。

## 取引先: 1予約に複数部屋タイプ（案・DB 変更あり）

後方互換にして段階的に入れる。

1. **DB（autumn-shared・main 直 push・実 UTC 秒・反映確認）**
   - `partner_bookings` の部屋タイプ列は「1室目（代表）」として残す。
   - 新テーブル `rms_partner_booking_rooms(booking_id, room_index, room_type_id, room_code, room_name, plan_code, plan_name, meal_type, adults, amount)` を足し、既存予約は1室ずつ埋め戻す。
   - `rms_partner_create_booking`: `rooms[i]` に任意で `room_code / plan_code / plan_name / meal_type` を許す（無ければ最上位の値＝従来どおり）。残室は部屋タイプごとに数えて判定。`core.stays` は各室の `room_type_id` で作る（既に room_index ごとに作っている）。
   - 取消・変更・事前支払の金額は合計で扱う（部屋タイプは金額の按分に影響しない）。
2. **サーバ**: `BookingTarget.rooms` に任意の `roomCode / planCode / planName` を足し、`quotePartnerBooking` を部屋ごとの料金で積む。請求書・管理画面の予約詳細・メール・PMS 連携（`room_name` 表示）を「部屋ごとの行」に対応させる。
3. **画面**: 検索結果に組み合わせカード → `/p/[token]/book?rooms=<JSON>` で複数タイプの確認・入力画面へ。

## 先に決めたいこと・リスク

- **別セッション（事前支払）が同じ RPC を今日も変更している**（`20261028104906`）。この RPC を同時に書き換えると衝突するので、事前支払の作業が落ち着いてから着手する。
- 本番の金額処理（請求・前受金・取消返金）に触るため、実装は設計レビュー → 段階導入（まず `rooms[i]` の任意キーを足すだけで挙動不変）→ 画面、の順にする。
- 公式サイトの検索に室数入力を足す作業は DB 変更なしで先に出せる（予約かごへ渡す）。

---

## 決定と設計（2026-10-28 追記）

### ユーザーの決定
- 混ぜる範囲は**同じプランの部屋タイプ違いだけ**。プラン・キャンセル規定・予約時の質問・特典は予約に1つのまま。部屋タイプだけが部屋ごとに違う。
- 取消は**部屋タイプ単位（部屋単位）で選べる**。
- 実予約はまだ入っていないので、移行（埋め戻し）のコストは小さい。理想形で作ってよい。

### 台帳の理想形: 部屋ごとの行（正規化）
`rms_partner_booking_rooms`（1室1行）を新設する。

| 列 | 内容 |
|---|---|
| booking_id, room_index | 予約と部屋番号（1 始まり）。`unique (booking_id, room_index)` |
| stay_id | その部屋の `core.stays`（取消・変更・PMS の単位） |
| room_type_id, room_code, room_name | 部屋タイプ（この部屋の） |
| adults, male, female | 人数・男女内訳 |
| nights jsonb | 泊ごとの単価（今の `detail.rooms[i].nights`） |
| room_total | この部屋の宿泊料金（泊の和） |
| status, cancelled_at, cancel_fee, cancel_kept 等 | 部屋ごとの取消の結果（公式の `booking_rooms` と同じ考え方） |

- `rms_partner_bookings` の `room_type_id / room_code / room_name / room_count` は「1室目（代表）」として残し、既存の一覧・請求の読み取りは壊さない（段階的に部屋の行へ寄せる）。`plan_*` は予約に1つのまま。
- 既存予約は1室ずつ行を埋め戻す（`detail.rooms[]` と stays から生成）。
- 在庫判定は部屋タイプごとに数えて `rms_partner_room_type_remaining` を型ごとに呼ぶ。電文は `rooms[i]` の部屋タイプを部屋の行から出す（PMS 取込は `rooms[i].room_type_id` を既に読むので PMS 改修は不要の見込み）。

### 取消（部屋単位）
- 取消は部屋の行ごと（部屋タイプでまとめて複数室も可）。キャンセル料は「その部屋の宿泊料金 × 料率」を合算。返金・前受金・月次請求の精算は部屋の取消額を差し引く。
- 全部屋が取消なら予約全体が取消。

### 段階
1. **P1 DB + 確定**: 部屋の行・`rms_partner_create_booking`（20261028104906 を写して差分のみ）・電文・埋め戻し。画面は検索→組み合わせ→確認→確定。取消は従来どおり予約全体。
2. **P2 表示・請求**: 予約一覧・管理画面・メール要約・月次請求書／前受金請求書の「お部屋」を部屋タイプ別の行に。
3. **P3 部屋単位の取消**: 取消プレビュー・キャンセル料・返金・請求の精算（前受金・預り金との整合）。

### 確認が要る点
- P3 は前受金・請求書の金額に触れるので、別セッション（事前支払）の実装との擦り合わせが要る。
- 本番確認はヤマドツーリズムで2か月以上先・取消前提（ログインはユーザー）。

### 実装状況（2026-10-29）
- P1: v0.205.0（autumn-shared 20261028125440・本番適用済み）。
- P2: v0.206.0。表示・請求書・メールは `lib/partner-room-types.ts`（予約時の `detail.rooms[i]`）で部屋タイプ別の室数。月次請求書の短縮名は部屋ごとの行から。全体取消のあと、アプリが部屋ごとの行を cancelled にする（`markBookingRoomsCancelled`）。DB の期限切れ処理（`rms_partner_expire_pending`）は部屋の行を変えない＝P3 で扱う。
