# 取引先 × PMS 顧客マスタの紐づけ・予約名義の選択・与信枠の反映 — 設計書

> 作成: 2026-10-07（autumn-book v0.90.0 時点・読み取り調査のみ。実装・migration・DB 書き込みは未着手）
> 対象リポ: autumn-book（取引先ページ・管理画面）／autumn-shared（migration）／autumn-pms（取込・与信）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・表・列）を付ける。提案には【提案】を付ける。

---

## 1. 目的と範囲

ユーザー依頼（原文）:
> 取引先ページに設定する取引先を、Autumn-pms の顧客マスタにある旅行会社や法人に、紐づけできるようにして。その場合、予約データを、宿泊者名で取るか、旅行会社名で取るか、選べるように。また、旅行会社の場合には、与信枠も反映できるようにしたい。

やること（範囲）:

1. **紐づけ** — 取引先（`public.rms_partners`）を PMS の顧客マスタ（`core.guests` の旅行会社／法人）に紐づけられるようにする。
2. **予約名義の選択** — 取引先ページからの予約を、PMS 上で「宿泊者名で取る（現状）」か「旅行会社名で取る（代表者＝旅行会社・宿泊者は部屋別の名前）」かを選べるようにする。
3. **与信枠の反映** — 紐づけ先が旅行会社で、PMS 側に与信管理の設定があるとき、取引先ページの予約でその枠を効かせる。

やらないこと（範囲外・本書では触れない）:

- PMS の顧客画面・与信画面そのものの作り直し
- 月次請求書の freee 連携（紐づけで将来できるようになるが、本書では「布石」まで）
- 公式サイト（一般のお客様）の予約フロー

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
| 与信（PMS） | 旅行会社ごとの **月別の受付上限（延べ室数）**。超えても止めず警告のみ | `core.guests.metadata.pms.credit_*` |
| 取引先払い | 宿泊料金・入湯税を取引先へ月末に請求し、お客様には請求しない予約 | 電文 `payment.billed_to='partner'` → `pms.stay_groups.metadata.billed_to_partner` |

---

## 3. 現状（調査結果）

### 3.1 PMS の顧客マスタ `core.guests`

出典: `autumn-shared/supabase/migrations/20260412000001_core_schema.sql`、`20260610090300_pms_guest_extensions.sql`、`20260826042247_pms_guests_legal_form.sql`、`20260718130000_pms_base_charges_geo_segments.sql`

- **1つの表に個人・法人・旅行会社が同居**する。種別は `guest_type text not null default 'individual' check (guest_type in ('individual','corporate','group'))`。
  - PMS の画面表記: individual=個人 / corporate=法人 / **group=旅行会社**（`autumn-pms/sveltekit/src/lib/i18n/messages/ja.ts` 3115 行付近 `guests.typeGroup: '旅行会社'`）。
- 法人・旅行会社向けの列: `corporate_name` / `corporate_name_kana` / `branch`（支店名）/ `legal_form`（法人格。例: 株式会社）/ `legal_form_position`（prefix/suffix）/ `receipt_address`（領収書宛名）/ `workplace` 等。
  - 名前の列には法人格を入れない決まり。正式名称は PMS の `$lib/guests-shared` の `withLegalForm()` が1箇所で組み立てる（20260826042247 のコメント）。
- **テナント単位**（`tenant_id` のみ・`facility_id` なし）。西和賀・男鹿で同じ顧客行を共有する。
- **締め日・支払条件・与信枠（金額）に相当する列は無い**（migration 全 495 本を `credit_limit` / `closing_day` / `payment_terms` / `与信` / `締め` で検索。該当は「レジ締め」のみ）。
- PMS は「列を増やさない」方針で旅行会社の設定を `metadata.pms` に持つ（下記 3.4）。
- 他アプリとの共有表なので、PMS 固有の関心事（freee 連携）は別表 `pms.guest_freee_links`（`20260805210000`）に逃がしている。その migration のコメントに **「`core.guests.metadata` は各アプリが read-modify-write しており、別アプリの同時更新で紐づけが消えうる」** と明記されている（本設計の重要な前提）。
- 顧客統合 `pms.merge_guests`（`20260907052841` が現行版）は `core.guests` を参照する全表を付け替える。**新しく FK を張る表はここに追記が要る**（忘れると統合で紐づけが消える）。

### 3.2 PMS の予約が顧客マスタをどう参照しているか

出典: `20260610090200_pms_stay_groups_and_nights.sql`、`20260907052841_pms_stay_groups_booker_guest.sql`、`autumn-pms/sveltekit/src/lib/room-guest.ts`、`lib/server/reservation-register.ts`

- `pms.stay_groups.representative_guest_id` … 代表者（宿泊者）。予約票・請求・封筒・応対がここを見る（reservation-register.ts 889 行コメント）。
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
| booking_settings | jsonb | `PartnerBookingSettings`（`lib/partner-booking.ts` 164 行〜）: `paymentOptions` / `customPaymentOptions[{id,label,note,billable}]` / `perks` / `planNames` / **`invoiceRecipientName`（請求書の宛名・空なら取引先名）** / `invoiceDue` / `prepayDiscount` / `leadDays` / `cutoffHour` / `maxRooms` / `maxNights` / `cancelDays` / `notice` / `options` / `notifyEmails` / `notifyPartner` / `showOfficialPerks` |
| payment_method_id | uuid → pms.payment_methods | 旧設定（RPC 内で名前の既定にだけ使う） |
| memorandum / memorandum_updated_at / memorandum_updated_by | | 覚書 |
| created_by / updated_by / created_at / updated_at | | |

- **スキーマは `public`**（`book` ではない）。autumn-rms から移設した表のため。autumn-book の CLAUDE.md は「book スキーマ専用」と言うが、取引先系は `public.rms_*` として既に運用されており、migration のファイル名は `rms_partner_*` が慣例（`20261001231445_rms_partner_billed_to_partner.sql` 等）。本設計もこの慣例に従う。
- RLS: `rms_partners` は施設アクセスのあるスタッフに開放、`rms_partner_accounts` / `rms_partner_bookings` / `rms_partner_invoices` は **service_role のみ**。autumn-book のサーバは service_role クライアント（`lib/server/partners/admin-client.ts`）で読み書きし、`core` / `pms` スキーマも `db.schema('core')` / `db.schema('pms')` で直接読んでいる（`booking.ts` 67〜68 行、`invoices.ts` 243 行）。

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
- **超えても止めない。警告のみ**（2026-08-24 指示・`agency-credit.ts` 冒頭）。予約詳細が `GET /api/agency-credit?guest=&months=` を後から叩いて警告を出す。
- 判定ロジックは **PMS の TypeScript にだけある**（DB 関数ではない）。`/api/agency-credit` は PMS のログインユーザー（`reservations:view`）向けで、autumn-book のサーバからは呼べない。

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
- 請求先（取引先払いか）は電文の `payment.billed_to` で伝わり、PMS では `stay_groups.metadata.billed_to_partner/billed_to_name` に入る。これも文字列。
- 月次請求書（`public.rms_partner_invoices`・`invoices.ts`）は `rms_partner_bookings` を **チェックアウト日基準・月末締め** で集め、宛名は `booking_settings.invoiceRecipientName`（空なら `partner_name`）。**入金の記録（paid_at 等）は持たない**（status は issued / void のみ）。

### 3.6 既存の「与信」を効かせるとしたらどこか（現状の判定ポイント）

| タイミング | 現状 | 備考 |
|---|---|---|
| 見積（`/p/[token]/book/quote`・`quotePartnerBooking`） | 残室・受付ルールを見る | 与信は見ない |
| 予約確定（`rms_partner_create_booking`） | 施設ロック → 期限切れ仮押さえの解放 → 残室の数え直し → 作成 | **ここが唯一の直列化ポイント**（`pg_advisory_xact_lock('rms_partner_booking:'||facility_id)`） |
| オンライン決済の仮押さえ（`await_payment=true`） | `core.stays` は `reserved` で作られ、35 分で `rms_partner_expire_pending` が解放 | 仮押さえも在庫を食う＝室数を数えるなら含まれるべき |
| 請求書発行（月末 cron） | 与信とは無関係 | 室数の与信は請求とは別物 |

---

## 4. 「与信枠」の解釈（最初に決めてもらう点）

PMS に実在する「与信」は **室数の受付上限**（3.4）であり、金額の与信枠（未精算残高の上限）は **どこにも無い**。依頼の「与信枠も反映」は、文脈上「PMS で設定してある与信（室数の枠）を取引先ページにも効かせる」と読むのが自然だが、金額の与信を新設したい可能性もある。

| 案 | 内容 | 必要なもの | 推奨 |
|---|---|---|---|
| **A. 室数の与信（PMS 既存）を反映** | 紐づけ先旅行会社の `credit_*` 設定と送客実績から月別の上限を出し、取引先ページの予約で判定する | 判定ロジックを DB 関数に（共有）／取引先ページの表示／超過時の挙動設定 | **◎ まずこれ**。設定は PMS に既にあり、現場の運用（旅行会社一覧でまとめて設定）と繋がる |
| B. 金額の与信（新設） | 「未精算の予約＋未入金の請求書の合計 ≦ 枠」で止める | 枠の保存先・**請求書の入金消込（paid_at / paid_amount と UI）**・取消時の戻し | △ 後続フェーズ。入金消込が無いと「未入金」が永遠に積み上がって必ず止まる |

本書は A を本線とし、B は §7.4 に「やるならこう」を書くに留める。

---

## 5. データモデル案

### 5.1 方針

- **紐づけは取引先側（`public.rms_partners`）に列を足す**。`core.guests` は触らない（共有表・ALTER は autumn-pms と競合しうる／PMS 自身も列を増やさない方針）。
- **与信の設定の正は PMS（`core.guests.metadata.pms.credit_*`）**。autumn-book は読むだけで、書かない（read-modify-write 競合を作らない。3.1）。設定の編集は PMS の旅行会社一覧／顧客カルテへリンクで誘導する。
- **予約名義の設定は取引先ごと**（`rms_partners`）。予約ごとの切替は Phase 2 以降の要望次第（§9）。
- **判定は DB 関数**にし、`rms_partner_create_booking` の中（advisory lock 配下）で呼ぶ。TS に写すと PMS と二重実装になり、数え方がずれる。

### 5.2 追加する列・表（migration の要旨）

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
  add column if not exists credit_over_action text not null default 'block'
    check (credit_over_action in ('ignore', 'warn', 'block'));

create index if not exists idx_rms_partners_pms_guest
  on public.rms_partners (pms_guest_id) where pms_guest_id is not null;

comment on column public.rms_partners.pms_guest_id is
  'PMS の顧客マスタ（core.guests・guest_type が group/corporate）への紐づけ。予約者（booker_guest_id）・旅行会社名義の代表者・与信の参照元。null=未紐づけ。';
```

- **`partner` 名義は `pms_guest_id` が必須**。アプリ側の保存検証で「紐づけ無しで partner は選べない」とし、DB でも `check (booking_name_mode = 'guest' or pms_guest_id is not null)` を足す（on delete set null で顧客が消えたときに矛盾しないよう、制約ではなく BEFORE トリガーで `booking_name_mode` を `guest` に戻す方が安全。どちらにするかは実装時に決める）。
- 紐づけ先の種別（group / corporate）・テナント一致はアプリ側で検証する（DB 側は FK のみ。`core.guests` に CHECK 用の関数を足さない）。
- `rms_partners` は施設ごとなので、**同じ旅行会社（同じ `pms_guest_id`）を西和賀・男鹿の2つの取引先が指すことは許す**（与信は施設ごとに数えるので自然）。一意制約は張らない。

#### (2) `public.rms_partner_bookings` — 予約時点のスナップショット【提案】

```sql
alter table public.rms_partner_bookings
  add column if not exists pms_guest_id uuid references core.guests(id) on delete set null,  -- 予約時の紐づけ先
  add column if not exists name_mode text not null default 'guest'
    check (name_mode in ('guest', 'partner')),                                              -- 予約時の名義
  add column if not exists credit_result jsonb;                                              -- 予約時の与信判定（{months:[{month,limit,booked,over}], action}）。null=判定なし
```

- 後から取引先の設定を変えても過去の予約の意味が変わらないよう、予約ごとに写す。
- `credit_result` は「警告のみで受けた」予約を後から追うため（管理画面の予約一覧で印を出す）。

#### (3) `pms.merge_guests` への1行追加（顧客統合で紐づけを失わない）【提案・pms 関数の変更】

```sql
-- merge_guests の「参照の付け替え」ブロックに追記（20260907052841 の create or replace を再発行）
update public.rms_partners        set pms_guest_id = p_target where pms_guest_id = p_source;
update public.rms_partner_bookings set pms_guest_id = p_target where pms_guest_id = p_source;
```

- これは **pms スキーマの関数の変更**であり、autumn-pms 側の変更と競合しうる。やむを得ない理由: 統合で `on delete set null` が走ると紐づけが黙って消え、名義・与信が外れる（booker_guest_id で同じ事故を避けた前例が 20260907052841 にある）。着手前に autumn-pms の未適用 migration で `merge_guests` を触っていないか確認し、1ファイルで `create or replace` を丸ごと出す。

#### (4) 与信判定の DB 関数【提案】

PMS の `loadAgencyRoomHistory` ＋ `judgeMonths` を SQL に写す。置き場所は2案:

| 案 | 置き場所 | 長所 | 短所 |
|---|---|---|---|
| **(a)** `public.rms_partner_credit_check(p_guest uuid, p_facility uuid, p_months text[])` | book 所有・既存 `rms_partner_*` と同じ名前空間 | pms スキーマに手を入れない。book 単独で完結 | PMS の TS と二重実装（数え方がずれる恐れ） |
| (b) `pms.agency_credit_check(...)` | 共有・PMS も `/api/agency-credit` から乗り換えられる | 1箇所に集約 | pms スキーマの変更＝autumn-pms と調整が要る |

**推奨: (a) で始め、PMS の `agency-credit.test.ts` のケースを SQL でも通して数え方を一致させる。PMS 側が乗り換えたくなったら (b) に移す**（関数本体は同じ）。

```sql
create or replace function public.rms_partner_credit_check(
  p_guest uuid, p_facility uuid, p_months text[], p_today date default (now() at time zone 'Asia/Tokyo')::date
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
-- 返り値: { enabled, settings:{growth_rate,min_rooms,note}, months:[{month, baseline, limit, booked, remaining, over, status}] }
--  enabled=false … 旅行会社でない / credit_enabled<>'1' / p_months が空（1本も数えない）
-- 数え方（PMS $lib/server/agency-credit.ts と同じ）:
--  対象グループ = pms.stay_groups where facility_id=p_facility and (representative_guest_id=p_guest OR booker_guest_id=p_guest)  ← booker も含める（§5.3）
--  対象の部屋   = core.stays where facility_id=p_facility and (stay_group_id in 対象グループ or guest_id=p_guest) and 期間が窓に重なる
--  泊に展開     = generate_series(check_in_date, check_out_date - 1)  ← チェックアウト日は泊ではない
--  dead         = stays.status in ('cancelled','no_show') or group.status='cancelled'
--  booked       = 生きている泊の数（月別）/ delivered = そのうち p_today より前の夜 / cancelled = dead の泊
--  基準         = 過去3年の同月の delivered の平均（firstDeliveredMonth 以降の年だけ母数）
--  上限         = greatest(ceil(基準 × (1 + N/100)), 最低枠)
$$;
revoke execute on function public.rms_partner_credit_check(uuid, uuid, text[], date) from public, anon, authenticated;
grant execute on function public.rms_partner_credit_check(uuid, uuid, text[], date) to service_role;
```

- 設定の読み出しは `core.guests.metadata->'pms'->>'credit_enabled'` 等。PMS の `parseAgencyCreditSettings` と同じ「おかしな値は制限しない側に倒す」規則にする。
- **仮押さえ（オンライン決済の支払待ち）も `core.stays` が `reserved` で存在するので自動的に `booked` に入る**。期限切れで `cancelled` になれば戻る（`rms_partner_expire_pending` の挙動を実装時に確認）。

#### (5) `rms_partner_create_booking` / `_rms_partner_emit_pms_event` の変更【提案】

既存関数を `create or replace` で差し替える（これまでの migration と同じやり方）。変更点:

1. 取引先の `pms_guest_id` / `booking_name_mode` / `credit_over_action` を読む。
2. **与信判定**（advisory lock の後・残室チェックの前後どちらでも可）:
   `pms_guest_id` があり、紐づけ先が `guest_type='group'` で、`credit_over_action <> 'ignore'` なら `rms_partner_credit_check(pms_guest_id, facility_id, 滞在が触る月[])` を呼ぶ。
   - 判定は「**この予約を足した後**の booked が上限を超えるか」。関数は現在の booked を返すので、呼び出し側で `booked + 今回の延べ室数（その月ぶん）` と `limit` を比べる。
   - `block` かつ超過 → `raise exception 'credit_over:<month>:<over>'`（`friendlyRpcError` に文言を足す）。
   - `warn` かつ超過 → 作成は続行し、`rms_partner_bookings.credit_result` に結果を残す。電文の `requests` 先頭に `{label:'与信', value:'○月の受付枠を △室 超えています'}` を足す（PMS の予約詳細に出る）。通知メール（`notifyEmails`）にも1行足す。
3. **名義**:
   - `guest`（従来）: 変更なし＋ **電文 `booker.guest_id = pms_guest_id`**（`booker.name` は従来どおり取引先名）。→ PMS 取込は `booker_guest_id` に入れる（import.ts 412 行は既に `p.booker.guest_id ?? null` を書いている。**PMS 側の変更なしで繋がる**）。
   - `partner`: `core.stays.guest_id = pms_guest_id`（旅行会社の顧客行）。**宿泊者の個人顧客行は作らない**（§9 未決 5）。電文の `guest` は旅行会社の行（`name` は `coalesce(corporate_name, name)`・kana は `coalesce(corporate_name_kana, name_kana)`）、`booker.guest_id = pms_guest_id`。**電文 `rooms[]` に部屋別の宿泊者名を足す**: `rooms[i].guest = {family_name, given_name, family_name_kana, given_name_kana, phone, email}`（1室目は入力された宿泊者、2室目以降は同じ名前＋「他」ではなく **1室目と同じ名前を入れる**。部屋ごとの名前入力は Phase 2 の画面改修で足す）。`requests` に `{label:'ご宿泊者', value:'山田 太郎 様（電話 …）'}` を足し、`stay.notes` 先頭にも同じ行を入れる（PMS の備考に残す）。`direct_booking_inbox.guest_name`（一覧表示用）は旅行会社名ではなく宿泊者名にする（現場が一覧で探すのは人の名前）。
4. `rms_partner_bookings` に `pms_guest_id` / `name_mode` / `credit_result` を書く。

#### (6) PMS 取込（autumn-pms `direct-booking/import.ts`）の変更【提案・Phase 2】

- `rooms[i].guest` があれば `core.stays.metadata.room_guest_family_name / room_guest_given_name / room_guest_name` に書く（`$lib/room-guest` の `joinRoomGuestName` 相当を使う。読み手は `room_guest_name` だけ見る規則）。
- `name_mode='partner'` のとき `representative_guest_id` は電文の `guest.guest_id`（＝旅行会社）になるので取込ロジックの変更は不要。重複疑いチェック（import.ts 589 行〜）は旅行会社の行に対して走るが、`guest_type` が group の行は候補から外す（`matchGuestCandidates` の挙動を実装時に確認）。
- 与信の集計 `loadAgencyRoomHistory` に **`booker_guest_id = 旅行会社` のグループも含める**（§5.3）。

### 5.3 与信の「利用額（室数）」の数え方【提案】

| 含めるもの | 理由 |
|---|---|
| 代表者＝旅行会社のグループ配下の全部屋（PMS 既存） | TL 経由・電話の旅行会社予約 |
| **予約者（booker_guest_id）＝旅行会社のグループ配下の全部屋（追加）** | 「宿泊者名で取る」取引先予約。これを含めないと取引先ページの予約が枠を食わない＝与信を反映する意味が無い |
| 取引先ページのオンライン決済の仮押さえ（支払待ち） | 在庫を押さえている（35 分で消える） |
| キャンセル・No Show・期限切れ | **含めない**（枠が戻る）。cancelled として別集計 |

- 取消時の戻しは「数えない」だけで実現する（戻し処理は要らない）。
- **PMS の手入力予約は advisory lock の外**で入るので、取引先ページの判定と同時に入ると枠を超えうる。PMS は警告のみなので許容する（PMS 側で止める仕様にはしない）。
- 取引先ページ同士の同時予約は `rms_partner_create_booking` の施設ロックで直列化される（既存のしくみ）。

### 5.4 RLS／権限

- `rms_partners` の新列は既存ポリシー（施設アクセスのあるスタッフ）のまま。`pms_guest_id` は非機微。
- `rms_partner_credit_check` は service_role のみ（取引先ページの判定は book のサーバが service_role で呼ぶ）。
- 管理画面の顧客検索（候補の表示）は book のサーバが service_role で `core.guests` を `tenant_id` ＋ `guest_type in ('group','corporate')` で絞って読む（返す列は `id, guest_type, corporate_name, name, corporate_name_kana, branch, legal_form, legal_form_position, guest_code, metadata->'pms'` に限定し、個人情報は返さない）。

---

## 6. 画面の変更

### 6.1 管理画面 `/admin/partners/[id]`（`routes/admin/partners/[id]/+page.svelte`）

「公開設定」の直下に **「PMS の顧客マスタとの紐づけ」** セクションを足す【提案】:

- 未紐づけ: 検索欄（旅行会社名・法人名・かな・顧客コードで `core.guests` を検索。種別は旅行会社／法人のみ）→ 候補一覧（種別バッジ・正式名称（法人格つき）・支店・顧客コード）→「この顧客に紐づける」。
- 紐づけ済み: 正式名称・種別・顧客コード・**PMS の顧客カルテへのリンク**（`https://<pms>/guests/<id>`・与信画面は `/guests/<id>/credit`）・「紐づけを外す」。
- **予約名義**（ラジオ・紐づけ済みのときだけ）: 「宿泊者名で取る（PMS の代表者＝お客様）」／「旅行会社名で取る（PMS の代表者＝この旅行会社・お客様は部屋別の宿泊者名）」。
- **与信**（紐づけ先が旅行会社のときだけ・読み取り表示＋挙動選択）:
  - PMS の設定の要約（`guests.creditOnSummary` と同じ文: 「過去3年の同月平均 +N%（最低 M 室/月）まで」／「未設定（室数の上限なし）」）。編集は PMS で（リンク）。
  - 超過時の挙動: 「受け付けない」（既定）／「受け付けて警告する（予約一覧と通知メールに印）」／「与信を見ない」。
  - 今後 12 か月の月別の上限・予約済み・残り（`rms_partner_credit_check` の結果をそのまま表に）。
- 「ご請求書（月次）」の宛名（`invoiceRecipientName`）が空のときのプレースホルダに、紐づけ先の正式名称（法人格つき）を出す【提案・§9 未決 10】。
- 予約一覧: 名義（宿泊者／旅行会社）と、与信の警告つきで受けた予約の印。

`+page.server.ts` の `save` アクションに `pmsGuestId` / `bookingNameMode` / `creditOverAction` を足し、`store.ts` の `PartnerSettingsInput` / `PartnerRow` / `PARTNER_COLUMNS` を拡張する。検索は新アクション `searchGuests`（または `GET /admin/partners/[id]/guests?q=`）。

### 6.2 取引先ページ `/p/[token]/book`（予約入力・確認）

- 名義 `partner` のとき: 宿泊者欄の見出しはそのまま「ご宿泊者（代表者）」。確認画面と完了画面に「ご予約名義: ○○株式会社（部屋の宿泊者名: 山田 太郎 様）」の1行を足す。入力項目は増やさない（Phase 2 後半で「部屋ごとの宿泊者名」を任意入力に）。
- 与信（`credit_over_action <> 'ignore'` のとき）:
  - 見積（`/book/quote`）で `rms_partner_credit_check` を呼び、**超過する月があれば**:
    - `block`: 「この日程は、御社の受付枠（○月）に達しているためお受けできません。お電話またはメールでお問い合わせください」と出し、予約ボタンを無効にする。
    - `warn`: 「御社の受付枠（○月）を超えますが、このままお申し込みいただけます（宿で確認のうえご連絡することがあります）」と出す。
  - **残り室数の数字は出さない**（§9 未決 3・推奨）。
  - 確定（`/book/reserve`）は RPC 内の判定が最終（見積後に枠が埋まったときは RPC のエラー文言で返す）。
- 予約一覧 `/p/[token]/bookings`: 名義の表示を足す（旅行会社名義のときは「○○株式会社（山田 太郎 様）」）。

### 6.3 確認メール・通知メール（`lib/server/partners/mail.ts`・`booking-extras.ts`）

- 取引先へのメール: 「ご予約名義」行を追加（partner のときだけ）。
- 宿への通知（`notifyEmails`）: 与信警告つきで受けた予約には件名または本文先頭に「【与信超過】」を付ける。

### 6.4 PMS 側（autumn-pms）

| 変更 | 必須か | 内容 |
|---|---|---|
| なし | — | 名義 `guest` ＋ `booker.guest_id` は **現行の import.ts でそのまま `booker_guest_id` に入る** |
| 与信集計に booker を含める | Phase 3 で推奨 | `lib/server/agency-credit.ts` の `loadAgencyRoomHistory` / `loadAgencyCreditList` で `representative_guest_id` に加え `booker_guest_id` も読む。`agency-credit.ts` 冒頭のコメント（何を数えるか）も更新 |
| 部屋別の宿泊者名の取込 | Phase 2 | `rooms[i].guest` → `core.stays.metadata.room_guest_*` |
| 予約詳細に「取引先ページの予約（名義: …）」 | 任意 | `book_requests` に既に取引先行が出るので最低限は不要 |

---

## 7. 段階的な導入計画

### Phase 1 — 紐づけと予約者の連携（小・安全）

**内容**: §5.2 (1)(2)(3) の列と `merge_guests` の追記、管理画面の紐づけ UI（§6.1 の検索・紐づけ・解除のみ）、RPC で `booker.guest_id = pms_guest_id` を電文に載せる、`rms_partner_bookings.pms_guest_id` を書く。名義は `guest` 固定、与信は `ignore` 固定（列は作るが UI は出さない）。

**効果**: PMS の紹介実績（顧客分析＞紹介）に取引先予約が数えられる。顧客カルテから「この旅行会社が取った予約」を逆引きできる。

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
- [ ] 月次請求書の宛名・金額が Phase 1 前と変わらない

### Phase 2 — 予約名義「旅行会社名で取る」

**内容**: `booking_name_mode` の UI、RPC の名義分岐（§5.2 (5) 3.）、電文 `rooms[i].guest`、PMS 取込の部屋別宿泊者名（§5.2 (6)）、確認メール・予約一覧の名義表示、`direct_booking_inbox.guest_name` を宿泊者名に。

**テストチェックリスト（Phase 2）**
- [ ] 紐づけ無しの取引先では名義のラジオが出ない（または「宿泊者名」固定で変更不可）
- [ ] 名義を「旅行会社名」にして予約 → PMS の予約詳細の代表者が旅行会社、部屋別の名前欄に宿泊者名（姓・名）が入っている
- [ ] 同じ予約で、PMS の新着予約一覧（受信箱）の表示名が宿泊者名になっている
- [ ] 食事伝票・部屋割り表に部屋別の宿泊者名が出る（`room_guest_name` を読む既存機能で）
- [ ] PMS の請求書の宛名が旅行会社（正式名称・法人格つき）になる。取引先払いの予約では宿泊料金の明細ロックと発行ガードが従来どおり効く
- [ ] 宿泊者の個人顧客行が **作られない**（`core.guests` に増えない）。※未決 5 の結論によって逆になる
- [ ] 名義を「宿泊者名」に戻して予約 → 従来どおり（代表者＝宿泊者・予約者＝旅行会社）
- [ ] 取引先ページの予約一覧・確認メール・完了画面に名義の行が出る（旅行会社名義のときだけ）
- [ ] 2室以上の予約で、全部屋に部屋別の宿泊者名が入る
- [ ] 旅行会社名義の予約を取消 → PMS 側もキャンセルになり、部屋別の名前は残る
- [ ] 紐づけを外した後は名義が自動的に「宿泊者名」に戻り、予約できる（DB の整合）

### Phase 3 — 与信枠（室数）の反映

**内容**: `rms_partner_credit_check`（§5.2 (4)）、RPC 内の判定（§5.2 (5) 2.）、`credit_over_action` の UI、取引先ページの見積時メッセージ、通知メールの印、`credit_result` の保存と管理画面の印。PMS の集計に `booker_guest_id` を含める。

**テストチェックリスト（Phase 3）**
- [ ] PMS の旅行会社一覧で与信 ON・増加率 0%・最低枠 2 室にした旅行会社を紐づけ、管理画面に「過去3年の同月平均 +0%（最低 2 室/月）まで」と今後 12 か月の表が出る
- [ ] 表の「予約済み」が PMS の `/guests/[id]/credit` の月別の数と一致する（代表者・予約者の両方を含めた数）
- [ ] 超過時「受け付けない」: 残り 1 室の月に 2 室の予約 → 見積で「お受けできません」、予約ボタンが押せない
- [ ] 同じ条件で 1 室 → 予約できる。その後さらに 1 室 → 受け付けない（枠が減っている）
- [ ] 予約を取消 → 枠が戻り、再び 1 室予約できる
- [ ] 超過時「受け付けて警告」: 予約できる。確認画面に警告文、宿への通知メールに【与信超過】、管理画面の予約一覧に印、PMS の予約詳細の事前質問・要望に「与信」行
- [ ] 「与信を見ない」: 超過しても何も出ず予約できる
- [ ] PMS 側で与信 OFF にすると、取引先ページでは判定されない（設定は PMS が正）
- [ ] 月またぎ（1/31〜2/2）の 1 室予約は 1 月に 1 室・2 月に 1 室として数えられる（チェックアウト日は数えない）
- [ ] オンライン決済の仮押さえ（支払待ち）が枠を食い、35 分で期限切れになると戻る
- [ ] 名義「宿泊者名」の予約（予約者＝旅行会社）も枠に数えられる（PMS 側の集計変更後）
- [ ] 取引先ページに残り室数の数字が出ていない
- [ ] 2つの取引先（西和賀・男鹿）が同じ旅行会社を指しているとき、枠は施設ごとに別に数えられる
- [ ] PMS の `agency-credit.test.ts` と同じケースを SQL の関数で通し、上限・基準が一致する

### Phase 4（任意・未決 1 の結論次第）— 金額の与信

§7.4 参照。入金消込が前提なので、Phase 3 までを運用してから判断する。

### 7.4 金額の与信をやる場合の要旨【提案・参考】

- 枠の保存先: `core.guests.metadata.pms.credit_limit_yen`（PMS の旅行会社カルテに項目を足す。book は読むだけ）。PMS 側の変更が要る。
- 利用額 ＝ Σ（`rms_partner_bookings` で status=confirmed・billable な支払方法・未請求）の請求額 ＋ Σ（`rms_partner_invoices` で status=issued・未入金）の `billed_total`。
- **前提**: `rms_partner_invoices` に `paid_at` / `paid_amount` / `paid_note` を足し、管理画面に「入金を記録」操作を作る（freee の入金と二重管理になる点は要検討）。
- 超過時: 後払い（billable）だけ止め、オンライン決済は通す（与信リスクが無いため）。
- 取消時: 未請求の予約は利用額から自然に外れる。請求済みは請求書の取消（void）で外れる。

---

## 8. 影響範囲（触るファイルの見取り図）

| リポ | ファイル | Phase |
|---|---|---|
| autumn-shared | `supabase/migrations/<utc>_rms_partner_pms_guest_link.sql`（列・索引・`merge_guests` 追記・RPC 差し替え） | 1 |
| autumn-shared | `…_rms_partner_booking_name_mode.sql`（RPC・電文の名義分岐・`rooms[].guest`） | 2 |
| autumn-shared | `…_rms_partner_credit_check.sql`（判定関数・RPC 内の判定） | 3 |
| autumn-book | `lib/server/partners/store.ts`（`PartnerRow` / `PartnerSettingsInput` / `PARTNER_COLUMNS` / 顧客検索） | 1 |
| autumn-book | `routes/admin/partners/[id]/+page.server.ts` / `+page.svelte`（紐づけ UI・名義・与信） | 1〜3 |
| autumn-book | `lib/server/partners/booking.ts`（`friendlyRpcError` の与信文言・見積での判定・名義の表示） | 2〜3 |
| autumn-book | `routes/p/[token]/book/*`、`bookings/*`、`lib/server/partners/mail.ts`、`booking-extras.ts` | 2〜3 |
| autumn-book | `lib/partner-invoice.ts`（宛名の既定）※未決 10 | 1 |
| autumn-book | `HANDOFF.md`（テストチェックリスト追記）、`package.json` ×2（版上げ） | 各 |
| autumn-pms | `lib/server/direct-booking/import.ts`（`rooms[].guest` → `room_guest_*`） | 2 |
| autumn-pms | `lib/server/agency-credit.ts`、`lib/agency-credit.ts`（booker を数える・コメント更新） | 3 |

---

## 9. 未決事項（ユーザーに決めてもらう点）

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| 1 | **「与信枠」の意味** | A. PMS 既存の室数の枠（月別・延べ室数）を反映 ／ B. 金額の与信（未精算残高の上限）を新設 ／ C. 両方 | **A をまず**。B は入金消込（請求書の `paid_at`）が無いと成立しないので Phase 4 で再検討 |
| 2 | 超過時の既定の挙動 | 受け付けない ／ 警告して受ける ／ 支払方法で分ける（後払いだけ止める） | **受け付けない**を既定（取引先ページは無人なので人の判断を挟めない）。取引先ごとに「警告して受ける」に変えられる |
| 3 | 残り室数の数字を取引先に見せるか | 見せる ／ 見せない（「枠に達しています」のみ） | **見せない**（内部の判断基準を出さない。超えたら電話・メールへ誘導） |
| 4 | 予約名義は取引先ごとの固定か、予約ごとに選ばせるか | 取引先ごと ／ 予約ごと（確認画面で切替） | **取引先ごと**（設定が1箇所・PMS の運用も会社単位）。予約ごとは要望が出たら Phase 2 後半で |
| 5 | 旅行会社名義のとき、宿泊者を顧客台帳（個人）にも登録するか | 登録しない（部屋別の名前だけ） ／ 登録して `core.stays.guest_id` にも入れる | **登録しない**。TL 経由の旅行会社予約と同じ形にそろえる。必要なら PMS の「部屋ごとに顧客を紐づけ・新規登録」で後から人が付ける |
| 6 | 紐づけ対象の種別 | 旅行会社（group）のみ ／ 旅行会社＋法人（corporate） | **両方**。法人は名義・請求宛名に使う。与信は旅行会社のときだけ |
| 7 | 与信設定（増加率・最低枠）を book の管理画面からも編集できるようにするか | 読むだけ＋PMS へのリンク ／ 両方で編集 | **読むだけ**（`core.guests.metadata` の read-modify-write を2アプリでやらない） |
| 8 | 与信の集計に「予約者＝旅行会社」の予約（宿泊者名義の取引先予約）を含めるか | 含める（PMS 側の集計も変更） ／ 代表者＝旅行会社だけ（PMS 既存のまま） | **含める**。含めないと「宿泊者名で取る」設定の取引先では与信が一切効かない |
| 9 | 判定関数の置き場所 | `public.rms_partner_credit_check`（book 所有） ／ `pms.agency_credit_check`（共有・PMS も乗り換え） | **public で開始**、PMS の test ケースで数え方を一致させる。PMS が乗り換えるときに pms へ |
| 10 | 月次請求書の宛名の既定に、紐づけ先の正式名称（法人格つき）を使うか | 使う（`invoiceRecipientName` が空のとき） ／ 従来どおり取引先名 | **使う**。表記ゆれを PMS の顧客マスタに寄せられる |
| 11 | 同じ旅行会社を2施設の取引先が指すことを許すか | 許す ／ 1顧客1取引先 | **許す**（`rms_partners` は施設ごと・与信も施設ごと） |
| 12 | `merge_guests`（pms 関数）への追記のタイミング | Phase 1 で同時に ／ 後回し | **Phase 1 で同時に**（統合で紐づけが黙って消える事故を最初から防ぐ）。autumn-pms 側の未適用 migration を確認してから |

---

## 10. 補足（調査で分かった注意点）

- `rms_partners` は `public` スキーマ。autumn-book の CLAUDE.md の「book スキーマ専用」とは別に、取引先系は `public.rms_*` の慣例で続いている。本設計も `public` に足す（新スキーマは作らない）。
- `core.guests` に FK を張る新しい列（`rms_partners.pms_guest_id` / `rms_partner_bookings.pms_guest_id`）は、PMS の顧客統合 `pms.merge_guests` に付け替え行を足さないと統合時に `on delete set null` で消える（booker_guest_id と同じ事故）。
- 電文スキーマ `autumn.direct_booking/1` に項目を **足す**だけ（既存項目の意味は変えない）。これまでの追加（`payment.billed_to` 等）と同じ流儀。
- 与信の数え方で `pms.stay_nights` を読まないのは PMS 側の PostgREST 行上限対策。SQL 関数なら `core.stays` から `generate_series` で泊に展開すれば同じ結果になる。
- オンライン決済（Stripe）の取引先は与信（室数）の対象外にするか、という論点もあるが、室数の枠は在庫保護が目的なので支払方法で分けない（未決 2 で「支払方法で分ける」を選ぶなら別）。
