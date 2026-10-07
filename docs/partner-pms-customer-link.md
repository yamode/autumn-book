# 取引先 × PMS 顧客マスタの紐づけ・予約名義の選択・与信枠の反映 — 設計書

> 作成: 2026-10-07（autumn-book v0.90.0 時点・読み取り調査のみ。実装・migration・DB 書き込みは未着手）
> 改訂: 2026-10-07 — §9 の未決事項にユーザーの決定が出たため、§4〜§9 を決定に合わせて書き直した（決定は §9「決定事項」）
> 対象リポ: autumn-book（取引先ページ・管理画面）／autumn-shared（migration）／autumn-pms（取込・与信）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・表・列）を付ける。提案には【提案】を付ける。

---

## 1. 目的と範囲

ユーザー依頼（原文）:
> 取引先ページに設定する取引先を、Autumn-pms の顧客マスタにある旅行会社や法人に、紐づけできるようにして。その場合、予約データを、宿泊者名で取るか、旅行会社名で取るか、選べるように。また、旅行会社の場合には、与信枠も反映できるようにしたい。

やること（範囲）:

1. **紐づけ** — 取引先（`public.rms_partners`）を PMS の顧客マスタ（`core.guests` の旅行会社／法人）に紐づけられるようにする。
2. **予約名義の選択** — 取引先ページからの予約を、PMS 上で「宿泊者名で取る（現状）」か「旅行会社名で取る（代表者＝旅行会社・宿泊者は部屋別の名前）」かを取引先ごとに選べるようにする。
3. **与信枠の反映** — 紐づけ先が旅行会社で PMS 側に与信管理（月別の受付上限・延べ室数）の設定があるとき、取引先ページにその枠（残り室数）を見せ、枠を超える予約は **後払いを選べなくし、一部をデポジットとしてオンライン決済で先に受ける**。与信の設定は book の管理画面からも編集できるようにする。

やらないこと（範囲外）:

- PMS の顧客画面・与信画面そのものの作り直し
- 月次請求書の freee 連携
- 公式サイト（一般のお客様）の予約フロー
- 金額の与信枠（未精算残高の上限）— 決定事項 #1 により今回は扱わない（§7.5 に参考として残す）

## 2. 用語

| 用語 | 意味 | 実体 |
|---|---|---|
| 取引先 | 取引先ページ（限定 URL `/p/[token]`）を持つ旅行会社・法人 | `public.rms_partners`（施設ごと・1行） |
| 取引先予約 | 取引先ページから入った予約 | `public.rms_partner_bookings` ＋ `booking.bookings` ＋ `core.stays` |
| 顧客マスタ | PMS の顧客台帳（全モジュール共有） | `core.guests`（テナント単位・施設列なし） |
| 旅行会社 | PMS の顧客種別 `guest_type='group'`（画面表記「旅行会社」） | `core.guests.guest_type` |
| 法人 | PMS の顧客種別 `guest_type='corporate'`（画面表記「法人」） | 同上 |
| 代表者 | PMS の予約グループの「宿泊者（代表者）」。予約票・請求・封筒がこれを見る | `pms.stay_groups.representative_guest_id` |
| 予約者 | 代理で予約した人（紹介実績の数え元） | `pms.stay_groups.booker_guest_id` |
| 部屋別の宿泊者名 | 団体・旅行会社予約で、部屋ごとに書く実際に泊まる人の名前 | `core.stays.metadata.room_guest_name`（＋`room_guest_family_name` / `room_guest_given_name`） |
| 与信（PMS） | 旅行会社ごとの **月別の受付上限（延べ室数＝部屋×泊）**。PMS では超えても止めず警告のみ | `core.guests.metadata.pms.credit_*` |
| 受付枠・残り室数 | 与信の上限と、そこから予約済みを引いた数（本書で取引先に見せる値） | `rms_partner_credit_check` の結果 |
| 後払い | 予約時にお金を受け取らない支払方法（月末締め翌月末銀行振込・取引先の自由入力の支払方法・チェックイン日決済） | `payment_option` が `online` / `deposit_online` 以外 |
| デポジット | 受付枠を超える予約で、予約時にオンライン決済（Stripe）で先に受ける一部金。残額は現地または請求書 | 新しい支払方法 `deposit_online`（§5.2） |
| 取引先払い | 宿泊料金・入湯税を取引先へ月末に請求し、お客様には請求しない予約 | 電文 `payment.billed_to='partner'` → `pms.stay_groups.metadata.billed_to_partner` |

---

## 3. 現状（調査結果）

### 3.1 PMS の顧客マスタ `core.guests`

出典: `autumn-shared/supabase/migrations/20260412000001_core_schema.sql`、`20260610090300_pms_guest_extensions.sql`、`20260826042247_pms_guests_legal_form.sql`、`20260718130000_pms_base_charges_geo_segments.sql`

- **1つの表に個人・法人・旅行会社が同居**する。種別は `guest_type text not null default 'individual' check (guest_type in ('individual','corporate','group'))`。
  - PMS の画面表記: individual=個人 / corporate=法人 / **group=旅行会社**（`autumn-pms/sveltekit/src/lib/i18n/messages/ja.ts` 3115 行付近 `guests.typeGroup: '旅行会社'`）。
- 法人・旅行会社向けの列: `corporate_name` / `corporate_name_kana` / `branch`（支店名）/ `legal_form`（法人格）/ `legal_form_position`（prefix/suffix）/ `receipt_address` / `workplace` 等。名前の列には法人格を入れない決まりで、正式名称は PMS の `$lib/guests-shared` の `withLegalForm()` が1箇所で組み立てる。
- **テナント単位**（`tenant_id` のみ・`facility_id` なし）。西和賀・男鹿で同じ顧客行を共有する。
- **締め日・支払条件・与信枠（金額）に相当する列は無い**（migration 全 495 本を `credit_limit` / `closing_day` / `payment_terms` / `与信` / `締め` で検索。該当は「レジ締め」のみ）。
- PMS は「列を増やさない」方針で旅行会社の設定を `metadata.pms` に持つ（3.4）。
- `pms.guest_freee_links`（`20260805210000`）のコメントに **「`core.guests.metadata` は各アプリが read-modify-write しており、別アプリの同時更新で紐づけが消えうる」** と明記されている（§5.5 の設計の前提）。
- 顧客統合 `pms.merge_guests`（`20260907052841` が現行版）は `core.guests` を参照する全表を付け替える。**新しく FK を張る表はここに追記が要る**（忘れると統合で紐づけが消える）。

### 3.2 PMS の予約が顧客マスタをどう参照しているか

出典: `20260610090200_pms_stay_groups_and_nights.sql`、`20260907052841_pms_stay_groups_booker_guest.sql`、`autumn-pms/sveltekit/src/lib/room-guest.ts`、`lib/server/reservation-register.ts`

- `pms.stay_groups.representative_guest_id` … 代表者（宿泊者）。予約票・請求・封筒・応対がここを見る。
- `pms.stay_groups.booker_guest_id` … 予約者（代理予約した方）。2026-09-07 追加。紹介実績の数え元。
- `core.stays.guest_id` … 部屋ごとの顧客（通常は代表者と同じ）。
- 部屋別の宿泊者名は **`core.stays.metadata.room_guest_name`（文字列・必ず書く）＋ `room_guest_family_name` / `room_guest_given_name`**（`lib/room-guest.ts`）。伝票・部屋割り表・食事時間割・請求書はこの文字列を読む。
- つまり PMS では「旅行会社名で取った予約」＝ **代表者が旅行会社の顧客行で、部屋ごとに宿泊者名を文字列で持つ** 形が既に成立している（TL-リンカーン経由の旅行会社予約がこの形）。

### 3.3 取引先 `public.rms_partners` の現状の列

出典: `20260926025319_rms_partner_rate_portal.sql`、`20260926054852_rms_partner_booking.sql`、`20261001074722_rms_partner_memorandum_booker.sql`、`autumn-book/apps/web/src/lib/server/partners/store.ts`（`PartnerRow`）

| 列 | 型 | 備考 |
|---|---|---|
| id / tenant_id / **facility_id** | uuid | **施設ごとに1行**（同じ会社でも西和賀・男鹿で別行） |
| name | text | 取引先名（文字列。顧客マスタとは無関係） |
| kind | text | `agent`（旅行会社・エージェント）/ `corporate`（法人）/ `other` |
| contact_name / contact_email | text | |
| url_token / is_active / valid_from / valid_until / max_days_ahead / show_inventory / include_advance / pricing / note | | 公開設定・特別レート |
| booking_enabled | boolean | 予約受付 |
| booking_settings | jsonb | `PartnerBookingSettings`（`lib/partner-booking.ts` 164 行〜）: `paymentOptions` / `customPaymentOptions[{id,label,note,billable}]` / `perks` / `planNames` / `invoiceRecipientName` / `invoiceDue` / `prepayDiscount` / `leadDays` / `cutoffHour` / `maxRooms` / `maxNights` / `cancelDays` / `notice` / `options` / `notifyEmails` / `notifyPartner` / `showOfficialPerks` |
| payment_method_id | uuid → pms.payment_methods | 旧設定（RPC 内で名前の既定にだけ使う） |
| memorandum / memorandum_updated_at / memorandum_updated_by | | 覚書 |
| created_by / updated_by / created_at / updated_at | | |

- **スキーマは `public`**（`book` ではない）。autumn-rms から移設した表のため。migration のファイル名は `rms_partner_*` が慣例（`20261001231445_rms_partner_billed_to_partner.sql` 等）。本設計もこの慣例に従う。
- RLS: `rms_partners` は施設アクセスのあるスタッフに開放、`rms_partner_accounts` / `rms_partner_bookings` / `rms_partner_invoices` は **service_role のみ**。autumn-book のサーバは service_role クライアント（`lib/server/partners/admin-client.ts`）で読み書きし、`core` / `pms` スキーマも `db.schema('core')` / `db.schema('pms')` で直接読んでいる（`booking.ts` 67〜68 行、`invoices.ts` 243 行）。
- 管理画面の権限: `app_metadata.role` が `admin` / `staff`（`lib/server/auth.ts` 90〜130 行）。管理者だけの操作は `admin-app-data.ts` 47 行のように `role==='admin'` ＋ `core.memberships` の `tenant_admin` で縛る前例がある。

### 3.4 PMS の「旅行会社」設定と与信管理（既に実装済み）

出典: `autumn-pms/sveltekit/src/lib/agency.ts`、`lib/agency-credit.ts`、`lib/server/agency-credit.ts`、`routes/guests/agencies/+page.server.ts`、`routes/api/agency-credit/+server.ts`、`routes/reservations/[id]/+page.svelte` 240 行

- 旅行会社（`guest_type='group'`）のマスタ設定は **`core.guests.metadata.pms`** に入る（列は増やさない方針）:
  - `agency_contact`（担当者）/ `agency_commission_rate`（送客手数料率・予約の既定値）
  - **与信**: `credit_enabled`（'1' で有効）/ `credit_growth_rate`（増加率 N%）/ `credit_min_rooms`（最低枠・延べ室数／月）/ `credit_note`
- **与信の意味は「金額」ではなく「月別の受付上限（延べ室数＝部屋×泊）」**。
  - 上限 ＝ `ceil(過去3年の同月の送客実績の平均 × (1 + N/100))`、ただし最低枠を下回らない（`creditLimitRooms`）。
  - 基準の母数は「取引が始まっていた年」だけ（`baselineRooms`・`firstDeliveredMonth`）。
  - 数えるもの（`loadAgencyRoomHistory`）: **`pms.stay_groups.representative_guest_id = 旅行会社` のグループ配下の `core.stays`** ＋ `core.stays.guest_id = 旅行会社` の部屋。泊ごとに月へ割り振る。キャンセル／No Show は `cancelled`、今日より前の夜は `delivered`。
  - **booker_guest_id（予約者）は数えていない**（2026-09-07 追加の列より与信のほうが先に作られたため）。
  - **施設ごと**に数える（枠は部屋在庫に対するもの）。
- **PMS では超えても止めない。警告のみ**（2026-08-24 指示）。予約詳細が `GET /api/agency-credit?guest=&months=` を後から叩いて警告を出す。
- 判定ロジックは **PMS の TypeScript にだけある**（DB 関数ではない）。`/api/agency-credit` は PMS のログインユーザー（`reservations:view`）向けで、autumn-book のサーバからは呼べない。
- **設定の保存は read-modify-write**: 旅行会社一覧の `saveAll`（`routes/guests/agencies/+page.server.ts` 40〜120 行）は `select id, metadata` → TS で `{...meta, pms:{...pms, ...next}}` を組み立て → `update({metadata})` の順。変わった行だけ UPDATE するが、読んでから書くまでの間に他アプリが同じ行の `metadata` を書くと、その更新は上書きで消える。

### 3.5 取引先予約が PMS 予約になるまでの流れ

出典: `autumn-book/apps/web/src/lib/server/partners/booking.ts`（`createPartnerBooking` 325〜420 行）、`20260926113433_rms_partner_prepay_discount_as_payment.sql`（`rms_partner_create_booking` 現行版）、`20261001231445_rms_partner_billed_to_partner.sql`（`_rms_partner_emit_pms_event` 現行版）、`20260907112816_pms_direct_booking_inbox.sql`、`autumn-pms/sveltekit/src/lib/server/direct-booking/import.ts`

```
取引先ページ /p/[token]/book
  └ createPartnerBooking（book・検証・見積）
      └ RPC public.rms_partner_create_booking(p)  ← 1トランザクション・施設ごとの advisory lock
          ├ core.guests に「宿泊者」を **毎回新規 INSERT**（guest_type='individual', touch_point=取引先名, metadata.source='rms_partner'）
          ├ core.stays を部屋ごとに INSERT（guest_id=その宿泊者, source/channel_code='rms_partner'）
          ├ booking.bookings INSERT（channel='rms_partner', metadata.rms_partner_id ...）
          ├ public.rms_partner_bookings INSERT（guest_name=宿泊者名, partner_name=取引先名, booked_by=ログインID ...）
          └ _rms_partner_emit_pms_event(id,'new') → pms.direct_booking_inbox に電文（schema autumn.direct_booking/1）
                 guest  = 宿泊者（core.guests の行）
                 booker = { member_user_id:null, guest_id:null, name:取引先名 }
                 payment.billed_to = 'partner' | 'guest'（月末締め or billable な自由入力なら partner）
                 requests = [{ご請求…},{取引先: 名（ログインID）},{支払方法},…]
      └ attachBookingExtras … 予約者（booker_profile: 氏名・部署・電話・メール）・交通手段・特典を台帳 detail に残す
autumn-pms direct-booking/import.ts
  ├ pms.stay_groups INSERT: representative_guest_id = 電文 guest.guest_id（＝宿泊者）, booker_guest_id = 電文 booker.guest_id（＝null）
  ├ metadata: booker_name=取引先名, billed_to_partner, billed_to_name, book_payment_option, book_requests …
  ├ 宿泊料金・入湯税の明細をロック／請求書の発行ガード（billed_to_partner のとき・$lib/partner-billing）
  └ 顧客の重複疑いに印を付ける（自動統合はしない）
```

事実として確定していること:

- **予約者名（取引先名）は文字列でしか PMS に渡っていない**（`booker.guest_id` が null）。顧客マスタの旅行会社行とは繋がらない → 紹介実績にも与信の `booked` にも数えられない。
- **宿泊者は毎回新しい個人の顧客行**になる（名寄せは PMS 側の重複疑いのみ）。
- 請求先（取引先払いか）は電文の `payment.billed_to` で伝わり、PMS では `stay_groups.metadata.billed_to_partner/billed_to_name` に入る。
- 月次請求書（`public.rms_partner_invoices`・`invoices.ts`）は `rms_partner_bookings` を **チェックアウト日基準・月末締め** で集め、宛名は `booking_settings.invoiceRecipientName`（空なら `partner_name`）。**入金の記録（paid_at 等）は持たない**（status は issued / void のみ）。

### 3.6 取引先予約の支払方法・オンライン決済・取消の現状（デポジット設計の前提）

出典: `lib/partner-booking.ts` 15〜47 行・360〜400 行、`lib/server/partners/booking.ts` 455〜530 行・540〜900 行、`lib/partner-cancel-fee.ts` 110〜146 行、`lib/partner-invoice.ts` 156〜180 行、`20260926065713_rms_partner_booking_online_payment.sql`、`20261006022716_rms_partner_cancel_fee.sql`、`autumn-pms/.../direct-booking/import.ts` 615〜700 行

- 支払方法 ID（`PartnerPaymentOptionId`）は固定3種＋自由入力:
  - `invoice_monthly` 月末締め翌月末銀行振込（後払い・請求書の対象）
  - `online` オンライン決済（予約時）— Stripe **PaymentIntent**（全額＝`chargeAmountOf` ＝ 宿泊料金＋入湯税−予約時決済割引）
  - `online_checkin` オンライン決済（チェックイン日）— Stripe **SetupIntent** でカード登録のみ・チェックイン日に自動請求（予約時にはお金を受け取らない）
  - `custom_*` 自由入力（`billable` なら請求書の対象。決済は伴わない）
- オンライン決済は「支払待ちの仮押さえ」（`await_payment=true` → `status='pending_payment'`・35 分）で作り、`rms_partner_mark_paid`（PaymentIntent 成功）／`rms_partner_mark_card_saved`（SetupIntent 成功）で確定して PMS へ `new` 電文を出す。**`mark_paid` は `p_amount` をそのまま `paid_amount` に書くので、全額でなくても記録できる**（金額の検証は book 側 `checkPaymentIntent(expectedAmount)`）。
- `rms_partner_bookings` の支払の列: `payment_option` / `payment_status`（none / unpaid / scheduled / charge_failed / paid / refunded / refund_failed）/ `paid_at` / `paid_amount` / `stripe_*` / `refund_amount` / `prepay_discount_amount` / キャンセル料の列（`cancel_fee` / `cancel_fee_settlement` in none/invoice/refund/card）。
- 取消の精算（`settlementOf`）: `payment_status='paid'` → `refund`（支払額から `max(キャンセル料, 割引額)` を差し引いて返金・`partnerRefundOf`）。未決済でキャンセル料あり → `invoice`（月末の請求書に不課税で載せる）。カード登録のみ → `card`。
- 月次請求書: 当月チェックアウトの全予約を利用明細に載せ、**予約ごとに「ご請求の対象」か「お支払い済み・別途精算」の二択**（`partner-invoice.ts` 471 行）。`paid_amount` を請求額から差し引く計算は **取消予約のキャンセル料（`cancelChargeOf`）にしか無い**。
- PMS 取込は、`payment.status='paid'` または `option='online_checkin'` のとき **`amounts.charge`（請求額＝全額）で入金行（`bill_payments`・由来 `rms_partner_prepaid`）を1本起こす**（`seedPartnerPrepayment`）。一部入金の表現は電文に無い。
- autumn に「デポジット」に当たる既存概念: 公式サイトのプラン支払設定 `payment_method='deposit'`（内金）があるが、**実装上は「カードで全額の事前決済か現地払いを選べる」扱い**で、一部金の決済は存在しない（`lib/direct-payment.ts` 76 行コメント、`lib/member-payment.test.ts`）。PMS の `pms.payment_methods` にも「デポジット」の決済区分は無い（入金行の支払方法を1つ選ぶだけ）。
- Stripe の PaymentIntent は金額を自由に指定できるので、**一部金の決済そのものは既存の `preparePaymentIntent({amount})` で作れる**（`lib/server/payments/intents.ts`）。

### 3.7 既存の判定ポイント（与信をどこで効かせるか）

| タイミング | 現状 | 備考 |
|---|---|---|
| 予約入力画面の表示（`/p/[token]/book` の load） | 支払方法の選択肢を `partnerPaymentChoices(s)` で出す（`+page.server.ts` 99〜101 行） | ここで選択肢を出し分けられる |
| 見積（`/book/quote`・`quotePartnerBooking`） | 残室・受付ルール | 与信は見ない |
| 予約確定（`rms_partner_create_booking`） | 施設ロック → 期限切れ仮押さえの解放 → 残室の数え直し → 作成 | **唯一の直列化ポイント**（`pg_advisory_xact_lock('rms_partner_booking:'||facility_id)`） |
| オンライン決済の仮押さえ | `core.stays` は `reserved` で作られ、35 分で `rms_partner_expire_pending` が解放 | 仮押さえも在庫を食う＝室数に含まれるべき |

---

## 4. 「与信枠」の解釈（決定済み）

PMS に実在する「与信」は **室数の受付上限**（3.4）であり、金額の与信枠はどこにも無い。**決定（2026-10-07・#1）: PMS 既存の室数の枠を反映する。金額の与信は今回やらない**（参考: §7.5）。

決定で変わった本線（推奨案との差）:

| 項目 | 推奨していた案 | 決定 |
|---|---|---|
| 超過時の挙動 | 受け付けない | **後払いだけ選べなくし、一部をデポジットとしてオンライン決済で先に受ける**（§5.3・§6.2） |
| 残り室数の表示 | 見せない | **見せる**（§6.2） |
| 与信設定の編集 | PMS だけ（book は読むだけ） | **book の管理画面からも編集できる**（§5.5・§6.1） |

---

## 5. データモデル案

### 5.1 方針

- **紐づけは取引先側（`public.rms_partners`）に列を足す**。`core.guests` の列は触らない（共有表・ALTER は autumn-pms と競合しうる／PMS 自身も列を増やさない方針）。
- **与信の設定の正は引き続き `core.guests.metadata.pms.credit_*`**（PMS と同じ場所・同じキー）。book からの編集は **DB 関数による部分更新**で行い、TS の read-modify-write を増やさない（§5.5）。
- **予約名義の設定は取引先ごと**（決定 #4）。
- **判定は DB 関数**にし、`rms_partner_create_booking` の中（advisory lock 配下）で呼ぶ。TS に写すと PMS と二重実装になり、数え方がずれる。
- デポジットは **新しい支払方法 `deposit_online`** として既存のオンライン決済（仮押さえ → PaymentIntent → `mark_paid`）の流れに乗せる。新しい決済フローは作らない。

### 5.2 追加する列（migration の要旨）

ファイル名は実 UTC 秒で `bash ~/.claude/new-migration.sh autumn-shared rms_partner_pms_guest_link` 等で生成する（キリ番禁止）。

#### (1) `public.rms_partners` — 紐づけ・名義・与信の挙動【提案】

```sql
alter table public.rms_partners
  -- PMS の顧客マスタ（旅行会社・法人）への紐づけ。null = 未紐づけ（従来どおり）
  add column if not exists pms_guest_id uuid references core.guests(id) on delete set null,
  -- 予約名義: guest = 宿泊者名で取る（従来）/ partner = 旅行会社（紐づけ先の顧客）名で取る
  add column if not exists booking_name_mode text not null default 'guest'
    check (booking_name_mode in ('guest', 'partner')),
  -- 与信（PMS の室数枠）を超えたときの取引先ページの挙動。紐づけ先が旅行会社で credit_enabled のときだけ意味を持つ
  --   deposit … 後払いを選べなくし、デポジット（deposit_online）か全額予約時決済（online）だけにする ← 決定 #2・既定
  --   warn    … 受け付けて警告する（予約一覧・通知メール・PMS の要望欄に印）
  --   ignore  … 与信を見ない
  add column if not exists credit_over_action text not null default 'deposit'
    check (credit_over_action in ('ignore', 'warn', 'deposit'));

create index if not exists idx_rms_partners_pms_guest
  on public.rms_partners (pms_guest_id) where pms_guest_id is not null;
```

- **`partner` 名義は `pms_guest_id` が必須**。アプリ側の保存検証で「紐づけ無しで partner は選べない」とし、DB 側は BEFORE UPDATE トリガーで `pms_guest_id` が null になったら `booking_name_mode` を `guest` に戻す（`on delete set null` と CHECK が矛盾しないように）。
- 紐づけ先の種別（group / corporate）・テナント一致はアプリ側で検証する。
- **同じ旅行会社（同じ `pms_guest_id`）を西和賀・男鹿の2つの取引先が指すことを許す**（決定 #11）。一意制約は張らない。
- デポジットの額・残額の精算先は `booking_settings`（jsonb）に持つ（§5.3）。列は増やさない（他の受付ルールと同じ場所）。

#### (2) `public.rms_partner_bookings` — 予約時点のスナップショット【提案】

```sql
alter table public.rms_partner_bookings
  add column if not exists pms_guest_id uuid references core.guests(id) on delete set null,  -- 予約時の紐づけ先
  add column if not exists name_mode text not null default 'guest'
    check (name_mode in ('guest', 'partner')),                                              -- 予約時の名義
  add column if not exists credit_result jsonb,                                              -- 予約時の与信判定（§5.4）。null=判定なし
  -- デポジット（payment_option='deposit_online' のときだけ）
  add column if not exists deposit_amount integer,                                           -- 予約時に先に受けた額（円）。paid_amount と同じ値になる
  add column if not exists remainder_option text;                                            -- 残額の精算: invoice_monthly（請求書）/ onsite（現地）/ custom_*（取引先の自由入力）
```

- `payment_status` の CHECK は変えない（デポジット決済後は `paid`。`paid_amount = deposit_amount`）。「全額払い済み」と見分けるのは `payment_option='deposit_online'`。
- 後から取引先の設定を変えても過去の予約の意味が変わらないよう、予約ごとに写す。

#### (3) `pms.merge_guests` への追記（顧客統合で紐づけを失わない・決定 #12: Phase 1 で同時）【提案・pms 関数の変更】

```sql
-- merge_guests の「参照の付け替え」ブロックに追記（20260907052841 の create or replace を再発行）
update public.rms_partners         set pms_guest_id = p_target where pms_guest_id = p_source;
update public.rms_partner_bookings set pms_guest_id = p_target where pms_guest_id = p_source;
```

- **pms スキーマの関数の変更**であり、autumn-pms 側の変更と競合しうる。理由: 統合で `on delete set null` が走ると紐づけが黙って消え、名義・与信が外れる（`booker_guest_id` で同じ事故を避けた前例が 20260907052841 にある）。着手前に autumn-pms の未適用 migration で `merge_guests` を触っていないか確認し、1ファイルで `create or replace` を丸ごと出す。

### 5.3 デポジット方式（決定 #2）の設計

#### 支払方法 `deposit_online`【提案】

- `lib/partner-booking.ts` の `PartnerPaymentOptionId` に `deposit_online` を足す。表示名「デポジット（予約時にオンライン決済・残額は後日）」。`isStripePaymentOption` は `online` / `online_checkin` / `deposit_online` を true にする。
- **取引先の `paymentOptions` には出さない（人が選ぶ設定ではない）。受付枠を超えた予約でだけ、サーバが選択肢に差し込む**（§6.2）。超えていない予約では従来どおりの選択肢。
- 「後払い」の定義（超過時に **出さない** もの）: `invoice_monthly`、`custom_*`（billable の有無を問わず）、**`online_checkin`**（予約時にお金を受け取らないため後払い扱い。→ 新しい未決事項 §9-N1）。
- 超過時に出すもの: `online`（全額・予約時決済割引あり）と `deposit_online`（一部）。取引先の `paymentOptions` に `online` が無くても `deposit_online` は出す（超過時の唯一の受け方になるため）。

#### デポジットの額【提案】

`booking_settings.creditDeposit`（取引先ごと。既定はテナント共通の既定値）:

| type | 計算 | 向き |
|---|---|---|
| `percent`（**既定・30%**） | `floor(請求額（宿泊料金＋入湯税）× 率 / 100)` | 単価が違う部屋・プランでも同じ重さ |
| `yen_per_room` | `円 × 室数`（請求額を超えない） | 「1室 1 万円」のような分かりやすい説明 |
| `first_night` | 1泊目の宿泊料金（全部屋ぶん）＋入湯税の1泊ぶん | 連泊の多い旅行会社向け。ノーショー時のキャンセル料（当日 100% なら 1泊分）に近い |

- 既定 30% の根拠: キャンセル規定の直前料率（前日 50% / 当日 100% が多い）の中間で、取消時にデポジットで概ね賄える額。**率の既定値は未決（§9-N2）**。
- 予約時決済割引（`prepayDiscount`）は **デポジットには付けない**（割引は全額の予約時決済へのインセンティブ。一部金に付けると請求額の計算が複雑になる）。
- 入湯税の扱い: 定率は入湯税込みの請求額に掛ける。残額＝請求額−デポジット。

#### 残額の精算【提案】

`booking_settings.creditDepositRemainder`: `invoice`（月末の請求書に残額を載せる）/ `onsite`（現地でお客様が払う）。既定は **取引先の `paymentOptions` に `invoice_monthly` か billable な自由入力があれば `invoice`、無ければ `onsite`**。予約の `remainder_option` には実際の ID（`invoice_monthly` / `onsite` / `custom_*`）を写す。

- `invoice` のとき: 月次請求書で、その予約は「ご請求の対象」にしつつ **デポジット額を差し引いた残額を請求**する。`partner-invoice.ts` の `buildInvoiceLines` は現状「予約単位で請求対象か別精算か」の二択なので、**「対象だがお支払い済み額を差し引く」3つ目の形**を足す（利用明細の行に「うちデポジット ○円 お支払い済み」を出す）。
- `onsite` のとき: PMS の請求書で残額が現地請求になる（PMS 側はデポジットの入金行＋通常の明細。`billed_to='guest'`）。

#### キャンセル時のデポジットの扱い【提案】

既存の `settlementOf` / `partnerRefundOf` を次のように拡張する:

- キャンセル料 `fee` を既存どおり計算（予約時点の規定・基準は宿泊料金）。
- **デポジットをキャンセル料に充当**: `kept = min(fee, deposit)`、`refund = deposit − kept`（Stripe の一部返金・既存の `rms_partner_mark_refunded(p_amount)`）。
- `fee > deposit` のとき、不足分 `fee − deposit` は残額の精算先で受ける: `remainder_option` が請求書なら月末の請求書に不課税で載せる（既存の `cancel_fee_settlement='invoice'` の仕組み）、現地なら宿が別途請求（請求書払いでない取引先での不足分の受け方は **未決 §9-N3**）。
  - **2026-10-07 変更**: 不足分は精算先にかかわらず請求書で請求する（残額が現地の取引先でも、月次の請求書に不課税で載せる）。N3 の「デポジット上限（不足分は請求しない）」は廃止。
  - **2026-10-07 追加**: 予約時決済の事務手数料（施設の率・既定 5%・予約時に `cancel_policy.admin_fee_percent` へ残す）もデポジットから差し引く。充当 = min(max(キャンセル料, デポジット × 率), デポジット)。不足分はキャンセル料だけから出す。
- 台帳: `cancel_fee_settlement` に **`deposit`（デポジットから充当・不足は請求書）** を足す（CHECK の更新）。`cancelChargeOf`（請求書に載せる取消の受取額）は `deposit` のとき `max(0, fee − refund済み後の kept)` ＝ 不足分だけを請求、充当分は「お支払い済み」に出す。
- 免除（スタッフが取消で「キャンセル料を取らない」）はデポジット全額返金（既存の `waived` と同じ）。

#### PMS への電文での入金表現【提案】

`autumn.direct_booking/1` に項目を **足す**（既存項目の意味は変えない）:

- `payment.option = 'deposit_online'`、`payment.status = 'paid'`（デポジット決済後に `mark_paid` → `new` 電文。既存の流れ）
- **`amounts.paid`**（＝デポジット額）を追加。`amounts.charge` は従来どおり全額。
- `payment.remainder = 'invoice' | 'onsite'`、`payment.billed_to` は残額が請求書なら `'partner'`、現地なら `'guest'`。
- `requests` の先頭付近に `{label:'デポジット', value:'予約時に ○○円 をお支払い済み（残額 ○○円 は 請求書／現地）'}`。
- PMS 取込 `seedPartnerPrepayment` は **`amounts.paid ?? amounts.charge`** で入金行を起こすよう変更（1行・由来 `rms_partner_prepaid`・備考に「デポジット」を含める）。`billed_to='partner'` のときの明細ロック・発行ガードは従来どおり効く（宿泊料金の残額は取引先へ請求）。PMS 側の変更はこの1点（Phase 3）。
- 取消・返金電文は既存（`cancelled` に `cancel.fee` / `refunded` に `refund.amount`）で足りる。

#### 超過判定のタイミング【提案】

1. **予約入力画面の load**（日程が決まった後の `/book/quote` の応答に含める）: `rms_partner_credit_check` を呼び、滞在が触る月の `{month, limit, booked, remaining}` と `over`（この予約を足すと超えるか）を返す。`over` なら支払方法の選択肢を `online` / `deposit_online` に差し替え、デポジット額を見積に載せる。
2. **確定（`rms_partner_create_booking`）**: advisory lock 配下で同じ関数を呼んで **再判定**。`credit_over_action='deposit'` で超過なのに `payment_option` が `online` / `deposit_online` 以外 → `raise exception 'credit_over_deposit_required:<month>:<over>'`（見積後に枠が埋まったケース。`friendlyRpcError` で「受付枠に達したため、デポジットでのお支払いが必要になりました。画面を更新してください」）。逆に超過していないのに `deposit_online` が来たら、そのまま受ける（取引先が自分で選ぶことは無いが、見積後に枠が空いた場合の整合のため拒否しない）。
3. デポジットの額は RPC 内で `booking_settings.creditDeposit` から計算し直して `deposit_amount` に書く（画面の値を信じない）。PaymentIntent の金額は台帳の `deposit_amount`（`preparePartnerPayment` で `payment_option='deposit_online'` なら `chargeAmountOf` の代わりに `deposit_amount` を使う。`checkPaymentIntent(expectedAmount)` も同様）。

### 5.4 与信判定の DB 関数（決定 #9: `public` で開始）【提案】

PMS の `loadAgencyRoomHistory` ＋ `judgeMonths` を SQL に写す。PMS の `agency-credit.test.ts` のケースを SQL でも通して数え方を一致させる。PMS が乗り換えるときに `pms.agency_credit_check` へ移す（本体は同じ）。

```sql
create or replace function public.rms_partner_credit_check(
  p_guest uuid, p_facility uuid, p_months text[],
  p_add jsonb default '{}'::jsonb,                      -- {"2027-02": 3} この予約で足す延べ室数（月別）。見積・確定で渡す
  p_today date default (now() at time zone 'Asia/Tokyo')::date
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
-- 返り値: { enabled, settings:{growth_rate,min_rooms,note}, over:boolean,
--           months:[{month, baseline, limit, booked, adding, remaining, over, status}] }
--  enabled=false … 旅行会社でない / credit_enabled<>'1' / p_months が空（1本も数えない）
-- 数え方（PMS $lib/server/agency-credit.ts と同じ・ただし booker も含める＝決定 #8）:
--  対象グループ = pms.stay_groups where facility_id=p_facility and (representative_guest_id=p_guest OR booker_guest_id=p_guest)
--  対象の部屋   = core.stays where facility_id=p_facility and (stay_group_id in 対象グループ or guest_id=p_guest) and 期間が窓に重なる
--  泊に展開     = generate_series(check_in_date, check_out_date - 1)  ← チェックアウト日は泊ではない
--  dead         = stays.status in ('cancelled','no_show') or group.status='cancelled'
--  booked       = 生きている泊の数（月別）/ delivered = そのうち p_today より前の夜
--  基準         = 過去3年の同月の delivered の平均（firstDeliveredMonth 以降の年だけ母数）
--  上限         = greatest(ceil(基準 × (1 + N/100)), 最低枠)
--  remaining    = limit − booked − adding（この予約ぶん）。over = remaining < 0 の月がある
$$;
revoke execute on function public.rms_partner_credit_check(uuid, uuid, text[], jsonb, date) from public, anon, authenticated;
grant execute on function public.rms_partner_credit_check(uuid, uuid, text[], jsonb, date) to service_role;
```

- 設定の読み出しは `core.guests.metadata->'pms'->>'credit_enabled'` 等。PMS の `parseAgencyCreditSettings` と同じ「おかしな値は制限しない側に倒す」規則。
- **仮押さえ（支払待ち）も `core.stays` が `reserved` で存在するので自動的に `booked` に入る**。期限切れで `cancelled` になれば戻る（`rms_partner_expire_pending` の挙動を実装時に確認）。
- 取引先ページから作った予約（PMS 取込前）は `pms.stay_groups` に無いが、`core.stays.guest_id`（宿泊者名義では宿泊者の個人行）なので数えられない時間が生じる。→ 対象の部屋の条件に **`core.stays.metadata->>'rms_partner_id'` が、この旅行会社に紐づく取引先の id であること** を OR で足し、取込前も数える（取込後は `stay_group_id` 経由で重複しないよう `distinct`）。
- `credit_result`（台帳）にはこの関数の返り値をそのまま残す。

### 5.5 与信設定を book から編集するしくみ（決定 #7）

PMS の保存は TS の read-modify-write（3.4）。book が同じことを TS でやると、2アプリが同じ `metadata` を読んで書く競合が起きる。**book 側は DB 関数で `metadata.pms` の該当キーだけを1文で部分更新する**【提案】:

```sql
create or replace function public.rms_partner_set_agency_credit(
  p_guest uuid,
  p_patch jsonb,                 -- 許可キーだけ: credit_enabled / credit_growth_rate / credit_min_rooms / credit_note（文字列。PMS と同じ表現）
  p_actor text,                  -- 'book:<auth.users.id>'（誰が変えたか）
  p_expected_updated_at timestamptz default null   -- 楽観ロック。画面に出した時点の core.guests.updated_at。違えば更新しない
) returns jsonb language plpgsql security definer set search_path = '' as $$
-- 1. core.guests を for update で読む（guest_type='group' でなければ例外）
-- 2. p_patch のキーを許可リストで絞る（それ以外は捨てる）。値は PMS の parseAgencyCreditSettings が読める文字列に正規化
-- 3. update core.guests
--      set metadata = jsonb_set(coalesce(metadata,'{}'), '{pms}',
--            coalesce(metadata->'pms','{}'::jsonb) || p_filtered
--            || jsonb_build_object('credit_updated_at', now(), 'credit_updated_by', p_actor))
--    where id = p_guest and (p_expected_updated_at is null or updated_at = p_expected_updated_at)
-- 4. 更新 0 行なら 'conflict'（画面に「他の人が先に変えました。読み直してください」）
-- 返り値: { result:'updated'|'conflict', pms: metadata->'pms' }
$$;
revoke execute ... from public, anon, authenticated;
grant execute ... to service_role;
```

- **同時更新に強い理由**: 読み書きが DB の1文（行ロック配下）で、`||` の対象は更新時点の値。TS で組み立てた丸ごとの `metadata` を書かないので、他アプリが直前に書いた別キー（担当者・手数料率・PMS の他の項目）を消さない。
- **PMS 側の read-modify-write は残る**（PMS が丸ごと書くと book の更新を消しうる）。影響を小さくするために: (a) `credit_updated_at / credit_updated_by` を両画面に出し「最終更新: 2026-10-07 10:12（book・○○）」と見えるようにする、(b) PMS の `saveAll` / 顧客カルテの保存も同じ関数（または同じ `jsonb_set` 方式）に乗り換えることを autumn-pms に提案する（任意・Phase 3 の後）。両方が直るまでは「与信は原則どちらか1つの画面で直す」運用。
- **権限**: book 側は **管理者（`app_metadata.role='admin'`）だけ**が編集できる。スタッフは読むだけ（PMS の `guests:edit` に相当する権限が book のスタッフには無いため）。→ 未決 §9-N4。
- 編集できる項目は PMS と同じ4つ（与信 ON / 増加率 / 最低枠 / 運用メモ）。担当者・手数料率は編集しない（与信画面の範囲外）。
- 紐づけ先が `guest_type='group'` 以外（法人）では編集 UI を出さない（関数も例外にする）。

### 5.6 与信の「利用（室数）」の数え方（決定 #8: 予約者も含める）

| 含めるもの | 理由 |
|---|---|
| 代表者＝旅行会社のグループ配下の全部屋（PMS 既存） | TL 経由・電話の旅行会社予約 |
| **予約者（booker_guest_id）＝旅行会社のグループ配下の全部屋（追加）** | 「宿泊者名で取る」取引先予約。これを含めないと取引先ページの予約が枠を食わない |
| 取引先ページの予約で PMS 取込前のもの（`core.stays.metadata.rms_partner_id` で特定） | 取込の遅れで枠が実際より多く見えないように |
| 取引先ページのオンライン決済・デポジットの仮押さえ（支払待ち） | 在庫を押さえている（35 分で消える） |
| キャンセル・No Show・期限切れ | **含めない**（枠が戻る）。cancelled として別集計 |

- 取消時の戻しは「数えない」だけで実現する。
- **PMS の手入力予約は advisory lock の外**で入るので、取引先ページの判定と同時に入ると枠を超えうる。PMS は警告のみなので許容する。
- 取引先ページ同士の同時予約は `rms_partner_create_booking` の施設ロックで直列化される（既存）。
- PMS 側の集計（`loadAgencyRoomHistory` / `loadAgencyCreditList`）も `booker_guest_id` を含めるよう変える（autumn-pms・Phase 3）。変えるまでは book と PMS で数が食い違う期間があるので、PMS の変更を先に出す。

### 5.7 RLS／権限

- `rms_partners` の新列は既存ポリシー（施設アクセスのあるスタッフ）のまま。`pms_guest_id` は非機微。
- `rms_partner_credit_check` / `rms_partner_set_agency_credit` は service_role のみ。book のサーバが権限（admin / staff）を確かめてから呼ぶ。
- 管理画面の顧客検索（候補の表示）は service_role で `core.guests` を `tenant_id` ＋ `guest_type in ('group','corporate')` で絞って読む（返す列は `id, guest_type, corporate_name, name, corporate_name_kana, branch, legal_form, legal_form_position, guest_code, updated_at, metadata->'pms'` に限定。個人情報は返さない）。

---

## 6. 画面の変更

### 6.1 管理画面 `/admin/partners/[id]`（`routes/admin/partners/[id]/+page.svelte`）

「公開設定」の直下に **「PMS の顧客マスタとの紐づけ」** セクションを足す【提案】:

- 未紐づけ: 検索欄（旅行会社名・法人名・かな・顧客コードで `core.guests` を検索。種別は旅行会社／法人のみ・決定 #6）→ 候補一覧（種別バッジ・正式名称（法人格つき）・支店・顧客コード）→「この顧客に紐づける」。
- 紐づけ済み: 正式名称・種別・顧客コード・**PMS の顧客カルテへのリンク**（`/guests/<id>`・与信画面 `/guests/<id>/credit`）・「紐づけを外す」。
- **予約名義**（ラジオ・紐づけ済みのときだけ・決定 #4）: 「宿泊者名で取る（PMS の代表者＝お客様）」／「旅行会社名で取る（PMS の代表者＝この旅行会社・お客様は部屋別の宿泊者名）」。
- **与信**（紐づけ先が旅行会社のときだけ）:
  - 設定（決定 #7・管理者は編集可・スタッフは表示のみ）: 与信管理 ON/OFF・増加率（%）・最低枠（室/月）・運用メモ。「最終更新: 日時（book／PMS・誰）」を出す。保存は `rms_partner_set_agency_credit`（楽観ロック。競合時は「他の人が先に変えました」）。
  - 超過時の挙動: 「後払いを止めてデポジットで受ける」（既定）／「受け付けて警告する」／「与信を見ない」。
  - デポジット: 額の決め方（定率％／1室あたり円／1泊分）と値、残額の精算（請求書／現地）。既定値を表示。
  - 今後 12 か月の月別の上限・予約済み・残り（`rms_partner_credit_check` の結果）。
- 「ご請求書（月次）」の宛名（`invoiceRecipientName`）が空のときのプレースホルダに、紐づけ先の正式名称（法人格つき）を出す（決定 #10）。
- 予約一覧: 名義（宿泊者／旅行会社）、与信の警告つきで受けた予約の印、デポジット予約は「デポジット ○円 済・残額 ○円（請求書／現地）」。

`+page.server.ts` の `save` に `pmsGuestId` / `bookingNameMode` / `creditOverAction` / `creditDeposit*` を足し、新アクション `searchGuests`・`saveAgencyCredit`（admin のみ）を足す。`store.ts` の `PartnerSettingsInput` / `PartnerRow` / `PARTNER_COLUMNS` を拡張。

### 6.2 取引先ページ `/p/[token]/book`（予約入力・確認）と料金カレンダー

**残り室数の表示（決定 #3）**【提案】:

- 予約入力画面: 日程を選んだ直後（見積の応答に含める）に、滞在が触る月ごとに **「御社の受付枠 2027年2月: 残り 3 室（上限 10 室・ご予約済み 7 室）」** のボックスを出す。この予約ぶんを足した後の残りも併記（「このご予約で残り 1 室」）。単位は延べ室数なので「室数×泊数で数えます」の注記を付ける。
- 料金カレンダー（`/p/[token]/calendar`・月表示）: 月の見出しの脇に「受付枠 残り N 室」。与信が入っている旅行会社だけ。
- 確認画面・完了画面・取引先ページの予約一覧: 「受付枠内／枠超過（デポジット）」の印。
- 超過時の案内文（`credit_over_action='deposit'`）: 「2027年2月は御社の受付枠（上限 10 室）を超えるため、このご予約は **デポジット（○○円）を予約時にお支払いいただく方法** か **全額の予約時決済** でお受けします。後払いはお選びいただけません。枠について御社担当者へご相談の場合は宿までご連絡ください。」
- `warn` のとき: 「受付枠を超えますが、このままお申し込みいただけます（宿で確認のうえご連絡することがあります）」。

**支払方法の出し分け**: 見積の応答に `creditOver` と `paymentChoices`（超過時は `online` / `deposit_online` だけ）を含め、画面はそれを描く。デポジットの行には額・残額・精算先を出す。確定（`/book/reserve`）は RPC 内の再判定が最終（§5.3）。

**名義 `partner`**: 宿泊者欄の見出しはそのまま「ご宿泊者（代表者）」。確認・完了画面に「ご予約名義: ○○株式会社（お部屋の宿泊者名: 山田 太郎 様）」の1行。入力項目は増やさない（部屋ごとの宿泊者名は Phase 2 後半で任意入力に）。

### 6.3 確認メール・通知メール（`lib/server/partners/mail.ts`・`booking-extras.ts`）

- 取引先へのメール: 「ご予約名義」行（partner のとき）、デポジット予約は「デポジット ○円 お支払い済み・残額 ○円（請求書／現地）」。
- 宿への通知（`notifyEmails`）: 与信超過（warn で受けた・deposit で受けた）は件名に「【受付枠超過】」。

### 6.4 PMS 側（autumn-pms）

| 変更 | 時期 | 内容 |
|---|---|---|
| なし | Phase 1 | 名義 `guest` ＋ `booker.guest_id` は **現行の import.ts でそのまま `booker_guest_id` に入る** |
| 部屋別の宿泊者名の取込 | Phase 2 | `rooms[i].guest` → `core.stays.metadata.room_guest_*` |
| 与信集計に booker を含める | Phase 3（book より先） | `lib/server/agency-credit.ts` の集計で `representative_guest_id` に加え `booker_guest_id` も読む。冒頭コメントも更新 |
| 一部入金の取込 | Phase 3 | `seedPartnerPrepayment` で `amounts.paid ?? amounts.charge` |
| 与信設定の保存を部分更新に | 任意（Phase 3 後） | `saveAll` / 顧客カルテの保存を `rms_partner_set_agency_credit` 相当に乗り換え、`credit_updated_at/by` を表示 |

---

## 7. 段階的な導入計画

### Phase 1 — 紐づけと予約者の連携（小・安全）

**内容**: §5.2 (1)(2)(3) の列と `merge_guests` の追記、管理画面の紐づけ UI（検索・紐づけ・解除）、RPC で `booker.guest_id = pms_guest_id` を電文に載せる、`rms_partner_bookings.pms_guest_id` を書く、請求書宛名の既定（決定 #10）。名義は `guest` 固定、与信は `ignore` 固定（列は作るが UI は出さない）。

**テストチェックリスト（Phase 1）**
- [ ] 管理画面の取引先設定で、旅行会社（PMS 種別「旅行会社」）を名前・かな・顧客コードで検索して紐づけられる
- [ ] 法人（種別「法人」）も検索・紐づけできる。個人は候補に出ない
- [ ] 別テナントの顧客は候補に出ない（DEV データで確認）
- [ ] 紐づけ済みの表示に正式名称（法人格つき）・顧客コード・PMS カルテへのリンクが出る。リンクで PMS の顧客カルテが開く
- [ ] 「紐づけを外す」で null に戻る（取引先の他の設定は変わらない）
- [ ] 紐づけた取引先からテスト予約 → PMS の予約詳細の「予約者」にその旅行会社が入っている（`stay_groups.booker_guest_id`）
- [ ] PMS 顧客カルテ（旅行会社）の紹介実績にその予約が数えられる
- [ ] 未紐づけの取引先からの予約は従来どおり（予約者は名前の文字列のみ・`booker_guest_id` null）
- [ ] PMS で紐づけ先の顧客を別の顧客へ統合（`merge_guests`）→ 取引先の紐づけが統合先に付け替わる（`rms_partners.pms_guest_id` と `rms_partner_bookings.pms_guest_id`）
- [ ] 月次請求書の宛名: `invoiceRecipientName` が空の取引先では紐づけ先の正式名称（法人格つき）、入力済みならその値。金額は Phase 1 前と変わらない

### Phase 2 — 予約名義「旅行会社名で取る」

**内容**: `booking_name_mode` の UI、RPC の名義分岐、電文 `rooms[i].guest`、PMS 取込の部屋別宿泊者名、確認メール・予約一覧の名義表示、`direct_booking_inbox.guest_name` を宿泊者名に。宿泊者の個人顧客行は作らない（決定 #5）。

**テストチェックリスト（Phase 2）**
- [ ] 紐づけ無しの取引先では名義のラジオが出ない（「宿泊者名」固定）
- [ ] 名義を「旅行会社名」にして予約 → PMS の予約詳細の代表者が旅行会社、部屋別の名前欄に宿泊者名（姓・名）が入っている
- [ ] 同じ予約で、PMS の新着予約一覧（受信箱）の表示名が宿泊者名になっている
- [ ] 食事伝票・部屋割り表に部屋別の宿泊者名が出る（`room_guest_name` を読む既存機能で）
- [ ] PMS の請求書の宛名が旅行会社（正式名称・法人格つき）になる。取引先払いの予約では宿泊料金の明細ロックと発行ガードが従来どおり効く
- [ ] 宿泊者の個人顧客行が作られない（`core.guests` に増えない）
- [ ] 名義を「宿泊者名」に戻して予約 → 従来どおり（代表者＝宿泊者・予約者＝旅行会社）
- [ ] 取引先ページの予約一覧・確認メール・完了画面に名義の行が出る（旅行会社名義のときだけ）
- [ ] 2室以上の予約で、全部屋に部屋別の宿泊者名が入る
- [ ] 旅行会社名義の予約を取消 → PMS 側もキャンセルになり、部屋別の名前は残る
- [ ] 紐づけを外した後は名義が自動的に「宿泊者名」に戻り、予約できる（トリガーの整合）

### Phase 3a — 受付枠の表示と与信設定の編集

**内容**: `rms_partner_credit_check`、`rms_partner_set_agency_credit`、管理画面の与信セクション（表示・admin の編集・楽観ロック）、取引先ページの残り室数表示（入力・カレンダー・確認）、`credit_over_action` の UI（この段階では `warn` / `ignore` のみ有効にし、`deposit` は 3b で有効化）。PMS の集計に `booker_guest_id` を含める（先に出す）。

**テストチェックリスト（Phase 3a）**
- [ ] PMS の旅行会社一覧で与信 ON・増加率 0%・最低枠 2 室にした旅行会社を紐づけ、管理画面に同じ設定と今後 12 か月の表が出る
- [ ] 表の「予約済み」が PMS の `/guests/[id]/credit` の月別の数と一致する（代表者・予約者の両方を含めた数・PMS 側変更後）
- [ ] 管理者が book で増加率を 20% に変える → PMS の旅行会社一覧に 20% と出る。担当者・手数料率（同じ `metadata.pms`）は消えていない
- [ ] スタッフ（role=staff）では与信の編集欄が出ない／保存アクションが 403
- [ ] 2つのタブで同じ旅行会社の与信を開き、片方で保存 → もう片方の保存が「他の人が先に変えました」で止まる
- [ ] 「最終更新」に日時と book／PMS の別が出る
- [ ] 法人（corporate）を紐づけた取引先では与信セクションが出ない
- [ ] 取引先ページで日程を選ぶと、月ごとの「受付枠 残り N 室（上限・予約済み）」と「このご予約で残り M 室」が出る。単位の注記がある
- [ ] 料金カレンダーの月見出しに残り室数が出る（与信 ON の旅行会社だけ。OFF・法人・未紐づけでは出ない）
- [ ] 月またぎ（1/31〜2/2）の 1 室予約は 1 月に 1 室・2 月に 1 室として数えられる（チェックアウト日は数えない）
- [ ] `warn`: 枠を超える予約ができ、確認画面に警告文、宿への通知メールの件名に【受付枠超過】、管理画面の予約一覧に印、PMS の予約詳細の事前質問・要望に「与信」行
- [ ] `ignore`: 超過しても表示も判定もされず予約できる
- [ ] 予約を取消 → 残り室数が戻る
- [ ] 取引先ページから予約した直後（PMS 取込前）でも残り室数が減っている
- [ ] 2つの取引先（西和賀・男鹿）が同じ旅行会社を指しているとき、枠は施設ごとに別に数えられる
- [ ] PMS の `agency-credit.test.ts` と同じケースを SQL の関数で通し、上限・基準が一致する

### Phase 3b — 超過時のデポジット方式

**内容**: 支払方法 `deposit_online`、`creditDeposit` / `creditDepositRemainder` の設定 UI、見積での選択肢の差し替え、RPC の再判定と `deposit_amount` の計算、PaymentIntent の額、電文 `amounts.paid` と PMS 取込、月次請求書の「デポジット差し引き」、取消時の充当・返金（`cancel_fee_settlement='deposit'`）。

**テストチェックリスト（Phase 3b）**
- [ ] 残り 1 室の月に 2 室の予約 → 支払方法が「全額の予約時決済」と「デポジット（○円）」だけになり、後払い（月末締め・自由入力・チェックイン日決済）は出ない。案内文が出る
- [ ] 同じ条件で 1 室 → 従来どおりの支払方法が出る
- [ ] デポジット（定率 30%）: 宿泊料金 100,000 円・入湯税 1,500 円 → デポジット 30,450 円・残額 71,050 円と見積に出る。予約時決済割引は付かない
- [ ] 1室あたり定額・1泊分でも額が仕様どおり（請求額を超えない）
- [ ] デポジットを選んで Stripe テストカードで支払う → 予約確定（`paid_amount=deposit_amount`・`payment_option='deposit_online'`）。35 分放置すると仮押さえが消え、枠が戻る
- [ ] PMS の予約に入金行が **デポジット額で1本** 立つ（全額ではない）。残額が請求書なら宿泊料金の明細がロックされ `billed_to_partner`、現地なら残額が現地請求になる
- [ ] 見積後に別の予約で枠が埋まり、後払いのまま確定しようとすると RPC が拒否し、画面を更新すると支払方法が差し替わる
- [ ] 月次請求書: デポジット予約が「ご請求の対象」として残額だけ請求され、明細に「うちデポジット ○円 お支払い済み」が出る。合計・消費税の端数処理が既存どおり
- [ ] 残額「現地」の取引先では、月次請求書に載るが請求額 0（別途精算）
- [ ] 取消（キャンセル料 < デポジット）: 差額が Stripe で一部返金され、取消メールに充当・返金額が出る
- [ ] 取消（キャンセル料 > デポジット・残額は請求書）: デポジット全額充当・返金 0・不足分が月末の請求書に不課税で載る
- [ ] 取消の免除: デポジット全額返金
- [ ] 取引先ページの予約一覧・管理画面の予約一覧にデポジットの額・残額・精算先が出る
- [ ] `credit_over_action` を `warn` に戻すと、超過時も後払いが選べる（デポジットは出ない）

### 7.5 金額の与信（今回はやらない・参考）

- 枠の保存先: `core.guests.metadata.pms.credit_limit_yen`（PMS の旅行会社カルテに項目を足す）。
- 利用額 ＝ Σ（未請求の後払い予約の請求額）＋ Σ（issued・未入金の請求書の `billed_total`）。
- **前提**: `rms_partner_invoices` に `paid_at` / `paid_amount` を足し、入金消込の操作を作る（freee の入金と二重管理になる点は要検討）。これが無いと「未入金」が積み上がって必ず止まる。

---

## 8. 影響範囲（触るファイルの見取り図）

| リポ | ファイル | Phase |
|---|---|---|
| autumn-shared | `…_rms_partner_pms_guest_link.sql`（列・索引・トリガー・`merge_guests` 追記・RPC 差し替え） | 1 |
| autumn-shared | `…_rms_partner_booking_name_mode.sql`（RPC・電文の名義分岐・`rooms[].guest`） | 2 |
| autumn-shared | `…_rms_partner_credit_check.sql`（判定関数・設定更新関数・RPC 内の判定） | 3a |
| autumn-shared | `…_rms_partner_deposit.sql`（`deposit_amount` / `remainder_option`・`cancel_fee_settlement` CHECK・電文 `amounts.paid`） | 3b |
| autumn-book | `lib/server/partners/store.ts`（型・列・顧客検索・与信設定の読み書き） | 1〜3a |
| autumn-book | `routes/admin/partners/[id]/+page.server.ts` / `+page.svelte` | 1〜3b |
| autumn-book | `lib/partner-booking.ts`（`deposit_online`・`creditDeposit` 設定・額の計算の純関数＋テスト） | 3b |
| autumn-book | `lib/server/partners/booking.ts`（見積の与信・選択肢の差し替え・PaymentIntent の額・`friendlyRpcError`） | 3a〜3b |
| autumn-book | `lib/partner-cancel-fee.ts`（`deposit` 精算）、`lib/partner-invoice.ts`（デポジット差し引き）＋テスト | 3b |
| autumn-book | `routes/p/[token]/book/*`、`calendar/*`、`bookings/*`、`lib/server/partners/mail.ts`、`booking-extras.ts` | 2〜3b |
| autumn-book | `HANDOFF.md`（テストチェックリスト追記）、`package.json` ×2（版上げ） | 各 |
| autumn-pms | `lib/server/agency-credit.ts`、`lib/agency-credit.ts`（booker を数える・コメント更新） | 3a（先に） |
| autumn-pms | `lib/server/direct-booking/import.ts`（`rooms[].guest` → `room_guest_*`／`amounts.paid`） | 2・3b |
| autumn-pms | `routes/guests/agencies/+page.server.ts` 等（部分更新への乗り換え・最終更新の表示） | 任意 |

---

## 9. 決定事項（2026-10-07・ユーザー回答）と新たな未決事項

### 9.1 決定事項

| # | 論点 | 決定（2026-10-07） | 本文への反映 |
|---|---|---|---|
| 1 | 「与信枠」の意味 | **A. PMS 既存の室数の枠を反映**（推奨どおり） | §4・§5.4。金額の与信は §7.5 に参考として残すのみ |
| 2 | 超過時の挙動 | **後払いだけ選べなくし、一部デポジット方式**（推奨と異なる） | §5.3（支払方法 `deposit_online`・額・残額・取消・電文・判定タイミング）、§6.2、Phase 3b |
| 3 | 残り室数を取引先に見せるか | **見せる**（推奨と異なる） | §6.2（入力画面・料金カレンダー・確認画面・案内文）、Phase 3a |
| 4 | 名義の単位 | **取引先ごと** | §5.2 (1) `booking_name_mode` |
| 5 | 旅行会社名義のとき宿泊者を顧客台帳に登録するか | **登録しない** | §5.2 (5) 相当（Phase 2）・Phase 2 チェックリスト |
| 6 | 紐づけ対象の種別 | **旅行会社＋法人の両方** | §6.1 検索条件。与信は旅行会社のみ |
| 7 | 与信設定を book からも編集 | **編集できるようにする**（推奨と異なる） | §5.5（部分更新 RPC・楽観ロック・更新者記録・admin のみ）、§6.1、Phase 3a |
| 8 | 与信集計に予約者＝旅行会社を含める | **含める** | §5.4・§5.6・PMS 側の集計変更（Phase 3a で先に） |
| 9 | 判定関数の置き場所 | **`public.rms_partner_credit_check` で開始**（推奨） | §5.4 |
| 10 | 請求書宛名の既定に紐づけ先の正式名称 | **使う**（推奨） | §6.1・Phase 1 |
| 11 | 同じ旅行会社を2施設の取引先が指す | **許す**（推奨） | §5.2 (1) |
| 12 | `merge_guests` 追記のタイミング | **Phase 1 で同時**（推奨） | §5.2 (3) |

### 9.2 新たな未決事項（決定 #2・#3・#7 を具体化して出てきた細部）

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| N1 | 超過時に **チェックイン日決済（`online_checkin`）** を後払いとして止めるか | 止める（予約時にお金を受け取らないため）／残す（カードは押さえているので与信リスクは小さい） | **止める**。枠の目的は在庫保護で、カード登録だけではノーショーの穴が埋まらない |
| N2 | デポジットの額の既定 | 定率 30%／定率 50%／1泊分／1室 1 万円 | **定率 30%** を全取引先の既定にし、取引先ごとに変えられる |
| N3 | 残額「現地」の取引先で、取消時にキャンセル料がデポジットを超えた不足分の受け方 | 宿が別途請求（手作業）／不足分は請求しない（デポジット上限）／残額が現地の取引先では常に「1泊分」以上のデポジットを求める | ~~デポジット上限（不足分は請求しない）~~ → **2026-10-07 変更: 不足分は精算先にかかわらず請求書で請求**（現地精算の取引先でも、不足分のある取消予約は月次の請求書の対象・ご請求あり） |
| N4 | book で与信設定を編集できる人 | 管理者（role=admin）のみ／スタッフも | **管理者のみ**。PMS 側の `guests:edit` と同じ重さ |
| N5 | 残り室数の表示の粒度 | 月別（延べ室数）だけ／日別の残室とは別に月別も／「残りわずか」等の段階表示 | **月別の延べ室数だけ**（PMS の枠と同じ単位。日別の残室は既存の空室表示に任せる） |
| N6 | デポジット決済に予約時決済割引を付けるか | 付けない／デポジット額に対して付ける | **付けない**（§5.3） |
| N7 | PMS 側の与信設定の保存も部分更新 RPC へ乗り換えるか（競合の根治） | 乗り換える（autumn-pms の改修）／当面はこのまま（運用で片方の画面に寄せる） | **乗り換える**（Phase 3a の後に autumn-pms へ依頼）。それまでは「最終更新」の表示で気づけるようにする |
| N8 | 取込前の取引先予約を枠に数える方法（`core.stays.metadata.rms_partner_id` で拾う） | 数える／取込後だけ数える | **数える**（取込の遅れで二重に受けないため） |

---

## 10. 補足（調査で分かった注意点）

- `rms_partners` は `public` スキーマ。autumn-book の CLAUDE.md の「book スキーマ専用」とは別に、取引先系は `public.rms_*` の慣例で続いている。本設計も `public` に足す。
- `core.guests` に FK を張る新しい列（`rms_partners.pms_guest_id` / `rms_partner_bookings.pms_guest_id`）は、PMS の顧客統合 `pms.merge_guests` に付け替え行を足さないと統合時に `on delete set null` で消える。
- 電文スキーマ `autumn.direct_booking/1` に項目を **足す**だけ（既存項目の意味は変えない）。これまでの追加（`payment.billed_to` 等）と同じ流儀。
- 与信の数え方で `pms.stay_nights` を読まないのは PMS 側の PostgREST 行上限対策。SQL 関数なら `core.stays` から `generate_series` で泊に展開すれば同じ結果になる。
- デポジットの決済は既存のオンライン決済の流れ（仮押さえ 35 分 → PaymentIntent → `mark_paid` → `new` 電文）をそのまま使い、違うのは **金額** と **PMS への `amounts.paid`** だけ。Stripe の Webhook・冪等キー・返金の仕組みも既存のまま。
- `online_checkin`（SetupIntent）と `deposit_online`（PaymentIntent）は別物。デポジットでカードを登録して残額をチェックイン日に自動請求する「組み合わせ」は作らない（残額は請求書か現地）。
