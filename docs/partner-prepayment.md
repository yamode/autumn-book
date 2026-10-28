# 取引先の事前支払（一部事前支払・前受金）設計

2026-10-28 ユーザー指示:
- 支払方法で「一部事前支払」もできるようにする。事前に払う分は**銀行振込・カードを選べる**。
- 宿泊日前の**事前振込（前受金）**もできるようにする。その**請求書も出せる**ようにする。

状態: **設計案（未実装）**。★は未確認の前提。ユーザーの確認後に実装する。

## 1. 現状（再利用するもの）

- 支払方法の ID は固定3種（`invoice_monthly` / `online` / `online_checkin`）＋自由入力（`custom_*`）。`lib/partner-booking.ts`
- デポジット（`deposit_online`・Phase 3b）は**受付枠を超えたときだけ**サーバが差し込む支払方法で、取引先は選べない。
  額（`creditDeposit`: 定率／1室あたり／1泊分）・残額の精算先（`creditDepositRemainder`: 請求書／現地）・
  キャンセル時の充当・月次請求書の差引・PMS 電文（`amounts.paid`）まで一式ある。ただしカード（Stripe）のみ。
- 月次請求書は `rms_partner_invoices`（取引先×月で1枚）。銀行振込の入金確認・前受金の請求書は無い。

## 2. 追加する支払方法（ID）

取引先の `paymentOptions` に入れて選べるようにする（UI は「支払方法と請求条件」のチェックボックス）。

| ID | 表示名 | 事前に払う額 | 払い方 | 予約の確定 |
|---|---|---|---|---|
| `deposit_online` | 一部事前支払（カード） | 一部（§3） | 予約時にカード（Stripe PaymentIntent） | 決済後（既存の仮押さえ→`mark_paid`） |
| `deposit_bank` | 一部事前支払（銀行振込） | 一部（§3） | 期限までに銀行振込（前受金の請求書） | 即確定 |
| `advance_bank` | 前受金（全額・銀行振込） | 全額 | 期限までに銀行振込（前受金の請求書） | 即確定 |

- 全額のカード事前払いは既存の `online`（予約時決済割引つき）。ここでは増やさない。
- `deposit_online` は「受付枠超過時に差し込む」既存の挙動も残す。取引先が選べるようになるだけで、超過時の扱いは変えない。
- 割引（`prepayDiscount`）は `online` だけに付く。一部・前受金には付けない（デポジットと同じ・N6）。

## 3. 額・残額・期限（設定は既存を共用）

- 事前に払う額（一部のとき）: 既存 `creditDeposit`（定率30%／1室あたり／1泊分）を**そのまま共用**。
  → 設定欄の名前を「受付枠超過時のデポジット」から「事前支払の額（一部事前支払・デポジット共通）」に改める。
- 残額の精算先: 既存 `creditDepositRemainder`（請求書／現地）を共用。★
- 銀行振込の振込期限（新設・`booking_settings.advanceDue`）: **宿泊日の N 日前**（既定 7 日前）。
  予約が期限より後（直前の予約）なら**予約日の翌営業日ではなく予約日+3日**、ただしチェックイン日の前日を超えない。★
- 計算は DB 関数 `_rms_partner_deposit_amount` と TS `depositAmountOf` が同じ規則（片方だけ変えない）。前受金（全額）は `請求額`＝宿泊料金＋入湯税。

## 4. 銀行振込の前受金の流れ

1. 取引先が予約 → 即確定（`status='confirmed'`、`payment_status='unpaid'`）。PMS へは通常どおり `new` 電文。
2. 台帳に `advance_amount`（前受金の額）・`advance_due_date`（振込期限）・`advance_invoice_id` を記録。
3. **前受金の請求書**を予約確定と同時に発行し、予約者へメール（月次請求書と同じ PDF・振込先は発行者設定の口座）。
4. 入金確認は**管理画面の予約詳細で宿が「入金済み」にする**（手動。自動消込はしない）。★
   入金済みになると `payment_status='paid'`・`paid_amount=advance_amount`。以後はデポジットと同じ扱い。
5. 期限を過ぎても未入金: 管理画面の予約一覧・取引先の予約一覧に「前受金 未入金（期限超過）」を出す。**自動取消はしない**。★
6. 取消: 入金済みならデポジットと同じ充当・返金（`settlementOf` の `deposit` 系）。未入金なら前受金の請求書を無効化（void）。

## 5. 前受金の請求書

- `rms_partner_invoices` に**種別**（`kind`: `monthly` / `advance`）を足す。1予約につき1枚（`advance` は予約ごと・月次の取引先×月の一意制約には入れない）。★既存の一意制約を実装前に確認。
- 紙面（`partner-invoice.ts`）は月次と同じ部品を使い、題名を「前受金のご請求書」、明細は予約1件（宿泊日・部屋・人数・お支払い額）。
  税の扱いは★: 前受金は役務提供前のため**消費税の区分を載せず「ご宿泊料金の前受金」と表示**し、月次請求書（適格請求書）で精算時に税区分を示す。経理確認が必要。
- 月次請求書: 前受金が入金済みの予約は、既存の「うちデポジット ○円 お支払い済み」と同じ形で差し引く（`deposit` 行）。未入金のままチェックアウトした予約は通常どおり全額ご請求（前受金の請求書は無効化して二重請求を避ける）。
- 取引先の画面（アカウント→ご請求書）に前受金の請求書も並べる。

## 6. DB（autumn-shared・main 直 push → 反映確認 → `db push --linked`）

- `rms_partner_bookings`: `advance_amount integer`, `advance_due_date date`, `advance_invoice_id uuid`、`payment_option` の許可値に `deposit_bank` / `advance_bank` を追加（CHECK があれば更新）。
- `rms_partner_invoices`: `kind text not null default 'monthly'`、`booking_id uuid null`（advance のみ）。
- `rms_partner_create_booking`: 新 ID を受ける（即確定・額は DB 内で計算し直す・期限も DB 内で決める）。
  `deposit_online` は「受付枠超過時のみ」の検証を外す（取引先の `paymentOptions` に入っているときは選べる）。
- 入金確認用 RPC（`rms_partner_mark_advance_paid`）。取消用に既存の返金系 RPC を流用。
- ファイル名は `bash ~/.claude/new-migration.sh autumn-shared book_partner_advance`（実 UTC 秒）。

## 7. PMS（autumn-pms・別リポ）★

- 即確定の銀行振込は予約時点では入金が無い。電文 `new` は `payment.option` に新 ID を載せ `payment.status='unpaid'`（入金行なし）。
- 入金確認時に PMS へ入金行（`rms_partner_prepaid`）を足す**追加の電文**が要る（現状、電文に一部入金の更新は無い）。
  → autumn-pms 側の変更が必要。Book 側だけ先に出す場合は「入金済み」を PMS に反映せず、PMS では請求書の備考で運用する。

## 8. 実装フェーズ（逐次・各フェーズでテスト＋Fable レビュー）

1. **設定・表示**（TS のみ）: 新 ID・ラベル・設定欄（額・残額・期限）・取引先の選択画面・テスト。
2. **DB と予約確定**: migration・`create_booking`・`deposit_online` の選択解禁・即確定の銀行振込。
3. **前受金の請求書**: 紙面・発行・PDF・メール・取引先画面・void。
4. **入金確認と請求書の差引・取消**: 管理画面「入金済み」・月次請求書の差引・取消の充当。
5. **PMS 連携**（autumn-pms）: 入金の追加電文。

## 9. 確認したいこと

- 額・残額の設定をデポジットと共用してよいか（別設定にするか）。
- 振込期限の既定（宿泊日の7日前）と、直前予約のときの扱い。
- 入金確認は手動でよいか。期限超過の自動取消は要るか。
- 前受金の請求書の税表記（消費税を載せるか）。
- PMS への入金反映をどこまでやるか（フェーズ5を同時に出すか）。
