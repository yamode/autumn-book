# 取引先を Book 内で唯一にし、施設ごとに分けない — 設計書

> 作成: 2026-10-07（autumn-book v0.101.0 時点・読み取り調査のみ。コード・migration・DB 書き込みは未着手。**当面は実装しない**）
> 改訂: 2026-10-07 — §10 の未決事項にユーザーの決定が出たため確定に書き換え（N3 月次請求書は全施設分を1枚に・N6 早期決済割と受付ルールは施設で設定可・他は推奨どおり）。影響する §3.3・§4.2・§5.1〜5.3・§6.2・§7.1・§7.11・§7.12・§9・§11・§13 を決定に合わせて直した
> 対象リポ: autumn-book（取引先ページ・管理画面）／autumn-shared（migration）／autumn-pms（影響の確認のみ）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・表・列）を付ける。提案には【提案】を付ける。
> 前提の設計書: `docs/partner-pms-customer-link.md`（紐づけ・名義・与信・デポジット）、`docs/saved-cards.md`（保存カード）、`docs/partner-booking-attachments.md`（添付）

---

## 1. 目的と範囲

ユーザー決定（2026-10-07）:

1. 取引先（現在 `public.rms_partners` は **施設ごとに1行**）を **Book 内で唯一の存在**にする。
2. 取引先ごとに **施設のオン／オフ** を設定する。オンの施設では、今と同じように販売プラン等の設定を、Book の管理画面で **施設を切り替えたうえで施設ごとに** 設定できる。
3. 取引先専用ページ（`/p/[token]`）では、複数施設がオンなら **画面上部で予約する施設を切り替え** られる。

やること（範囲）:

- 現行のデータモデルの洗い出しと「取引先共通」「施設ごと」への分類（§3・§4）
- 新しいデータモデル（`rms_partner_facilities`）と移行手順（§5・§6）
- 請求書・特商法・覚書・PMS 顧客マスタ・与信枠・Stripe Customer・権限・管理画面・取引先ページ・メールの扱い（§7）
- 段階的な移行計画・リスク・未決事項・実装の分割（§8〜§11）
- 並行実装中の保存カード・添付が統合を妨げないための注意（§12）

やらないこと（範囲外）:

- 今すぐの実装（本書は設計のみ）
- PMS 側の顧客マスタ・与信画面の変更（PMS の数え方は施設ごとで、そのまま使える・§7.4）
- テナントをまたぐ取引先（autumn は山人1テナント。マルチテナントの枠組みは `tenant_id` で既に守られている）

---

## 2. 用語

| 用語 | 意味 | 実体（現状） | 実体（本設計） |
|---|---|---|---|
| 取引先 | 取引先ページ（限定 URL）を持つ旅行会社・法人 | `public.rms_partners`（施設ごと1行） | `public.rms_partners`（**取引先で1行**） |
| 施設設定 | 取引先 × 施設ごとの販売条件（特別レート・プラン名・特典・通知先 等） | `rms_partners` の列・`booking_settings` の一部 | `public.rms_partner_facilities`（新設・取引先 × 施設で1行）【提案】 |
| オンの施設 | その取引先に販売する施設 | （行があれば販売） | `rms_partner_facilities.enabled = true` |
| 選択中の施設 | 取引先ページで今見ている・予約しようとしている施設 | （URL のトークン＝施設） | クッキー `rms_partner_facility` ＋ `?f=<slug>`（§7.8） |
| 取引先ユーザー | 取引先ページのログイン ID（マスタ／子） | `rms_partner_accounts` | 同じ（取引先に属する・施設を持たない） |
| 施設（Book） | `core.facilities` の行。山人は `yamado`（西和賀）と `oga` の2つ | `FACILITY_UUID`（`lib/server/supabase-data.ts`）・`BOOK_FACILITY_IDS` | 同じ |

---

## 3. 現状（調査結果）

### 3.1 PROD のデータ（2026-10-07・MCP 読み取り）

| 項目 | 値 |
|---|---|
| `rms_partners` | **2行・どちらも男鹿**（再春館製薬所 agent・テスト agent。両方 is_active・booking_enabled）。西和賀の行は無い |
| 施設をまたぐ同名の取引先 | **0**（同じ会社が2行になっているケースは現時点で無い） |
| 同じ `pms_guest_id` を指す取引先 | 0 |
| `rms_partner_accounts` | 2（`saishunkan`・`yamado`・どちらもマスタ） |
| `rms_partner_bookings` / `rms_partner_invoices` / `rms_partner_documents` | **0 / 0 / 0** |
| `rms_partner_api_keys` | 1 |
| `rms_partner_billing_settings` | 1（男鹿） |
| `rms_partners.stripe_customer_id` | **列が無い**（autumn-shared `20261007022727_rms_partner_stripe_customer` は main にあるが PROD 未適用） |
| `core.guests` の旅行会社・法人 | 16 件 |

→ **「既に2行ある同じ旅行会社の統合」は今は発生していない。** 統合の仕組み（§6.4）は将来のために設計しておくが、初回の移行は「1行ずつ取引先に昇格させ、施設設定を1つ作る」だけで済む（§6.2）。本番利用が始まる前に移行するほど安い。

### 3.2 `public.rms_partners` の列と、施設への依存

出典: `autumn-shared/supabase/migrations/20260926025319_rms_partner_rate_portal.sql`、`20260926054852_rms_partner_booking.sql`、`20261001074722_rms_partner_memorandum_booker.sql`、`20261006224655_rms_partner_pms_guest_link.sql`、`20261007022727_rms_partner_stripe_customer.sql`（未適用）、`autumn-book/apps/web/src/lib/server/partners/store.ts`（`PARTNER_COLUMNS`）

| 列 | 施設に依存するか | 根拠 |
|---|---|---|
| `id` / `tenant_id` | — | |
| **`facility_id`** | 本体 | NOT NULL・FK。RLS `rms_partners_all` は `private.has_facility_access(tenant_id, facility_id)`。索引 `(facility_id, is_active)` |
| `name` / `kind` / `contact_name` / `contact_email` / `note` | しない | 会社の属性 |
| `url_token`（unique） | しない | ページの鍵。今は「施設ごとの行」に付いているので同じ会社でも施設ごとに別 URL |
| `is_active` / `valid_from` / `valid_until` | しない（契約の有効期間） | |
| `max_days_ahead` / `show_inventory` / `include_advance` | **する**（施設の販売条件） | `rates.ts` 94〜100 行が `partner.facility_id` と組で読む |
| `pricing`（jsonb・特別レートのルール） | **する** | ルールの `planCodes` / `roomCodes` は施設のプラン・部屋コード（`lib/partner-pricing.ts`・`rms_partner_portal_source(p_facility)`） |
| `booking_enabled` | **する**（施設ごとに受け付けるか） | 全体のオン／オフも要る（§4） |
| `booking_settings`（jsonb） | **混在**（§4.2 で分ける） | `lib/partner-booking.ts` 255〜290 行 |
| `payment_method_id` → `pms.payment_methods` | **する**（PMS の支払方法は施設ごと） | RPC が `facility_id = v_partner.facility_id` で引く（`20261007002617` 381 行） |
| `memorandum` / `memorandum_updated_*` | しない（取引条件の本文は会社と1つ） | 施設で文面が違うなら本文内で書き分ける（§7.3） |
| `pms_guest_id` / `booking_name_mode` / `credit_over_action` | しない | `core.guests` はテナント単位（§7.4）。与信の **判定** は施設ごと（§7.5） |
| `stripe_customer_id` / `stripe_livemode` / `stripe_customer_created_at`（未適用） | しない | migration のコメントに「統合後は取引先で1つ」と明記済み |
| `created_by` / `updated_by` / `created_at` / `updated_at` | — | |

### 3.3 子テーブルと、施設への依存

出典: §3.2 と同じ migration、`20261001083643_rms_partner_invoices_sub_accounts.sql`、`20260926065713`・`20260926082024`・`20261006022716`・`20261007002617`（bookings の列）、`docs/partner-booking-attachments.md` §5.1

| 表 | `partner_id` | `facility_id` | 分類 | 備考 |
|---|---|---|---|---|
| `rms_partner_accounts`（ログイン ID） | あり | **無し** | **取引先共通** | `login_id` は **全体で一意**（`lower(login_id)`）。`is_master` / `booker_profile` / `created_by_account`。子ユーザーの自動 ID `autoChildLoginId` は **施設で接頭辞**（`portal-users.ts` 14 行・`oga` / `yamado`）→ 要変更 |
| `rms_partner_sessions` | （account 経由） | 無し | 取引先共通 | クッキー `rms_partner_session` の path は `/p/<token>`（`portal.ts` 22 行） |
| `rms_partner_api_keys` | あり | 無し | 取引先共通 | `GET /api/partner/v1/rates` は **キー → 取引先 → その施設** で料金を返す（`routes/api/partner/v1/rates/+server.ts`）→ 施設の指定が要る（§7.10） |
| `rms_partner_access_logs` | あり | 無し | 取引先共通 | `detail` に施設を書けば足りる |
| `rms_partner_bookings`（予約台帳） | あり | **あり** | **施設ごと（スナップショット）** | 予約は必ず1施設。`facility_id` は残す。`partner_name` / `pms_guest_id` / `name_mode` / `credit_result` / `deposit_amount` 等は予約時の写し |
| `rms_partner_invoices`（月次請求書） | あり | **あり（NOT NULL）** | **取引先ごと（決定 N3: 全施設分を1枚）** | 部分一意 `uq_rms_partner_invoices_issued (partner_id, period) where status='issued'` は「1取引先・1月・1枚」なので **そのまま使える**。`facility_id` は NULL 許容にし、明細の施設は `document` と新列 `facility_ids` で持つ（§7.1） |
| `rms_partner_billing_settings`（発行元） | — | **主キー** | **会社で1つにする** | PROD は男鹿の1行だけ（発行者「株式会社山人」・登録番号 `T3400001006564`・振込先 GMOあおぞら「カ）ヤマド」）。登録番号は法人に1つで施設で違わない。住所・TEL だけが施設の既定値（`invoices.ts` 208 行 `FACILITY_DEFAULTS`）。1枚に統合するので発行元もテナントで1つに（§7.1） |
| `rms_partner_documents`（覚書ファイル） | あり | **あり（NOT NULL）** | 取引先共通 | 覚書は会社と1つ。`facility_id` は NULL 許容にする（§7.3）。Storage パスは `<partner_id>/<uuid>` で施設を含まない |
| `rms_partner_booking_attachments`（予約の添付・設計中） | あり | あり | 施設ごと（予約に従う） | 予約に付くので予約の施設。パス `partner-booking/<facility>/<partner>/…`。**migration ファイルは 5 行のヘッダだけ（本文未作成）** |
| `book.member_payment_profiles`（会員の保存カード・設計中） | — | — | 無関係 | 会員は取引先と別 |

### 3.4 Book 側のコードで `partner.facility_id` に依存している箇所（見取り図）

出典: `grep facility lib/server/partners/*.ts`（2026-10-07）

| 領域 | ファイル・行 | 依存の中身 |
|---|---|---|
| 取引先の解決 | `store.ts` 774〜786（`withFacility` / `findPartnerByUrlToken`） | `PartnerContext = PartnerRow & { facility_slug, facility_name }`。トークン → 行 → **行の施設** を1回で確定 |
| 料金・残室 | `rates.ts` 65〜100・154 | `rms_partner_portal_source(p_facility)` ＋ `partner.pricing` |
| 紹介コンテンツ・規定 | `contents.ts` 13、`stay-page.ts` 32〜64 | `rms_partner_contents(p_facility)`・`rms_partner_plan_terms(p_facility)`・`sbFacilityByUuid` |
| 見積・予約 | `booking.ts` 163〜278・482・547・613 | 入湯税の規則・残室・毎回聞く項目の文言・キャンセル規定の写し・Stripe metadata の `facility` |
| 与信 | `store.ts` 449〜456（`partnerCreditCheck`）、`booking.ts` 215 | `rms_partner_credit_check(p_guest, p_facility, …)` |
| 請求書 | `invoices.ts` 全体（施設で絞る・発行元は施設・月末 cron は施設ループ） | |
| メール | `mail.ts` 27〜60、`booking.ts` 1606〜1688、`staff.ts` 154、`portal-users.ts` 64 | 差出人名＝施設名・Reply-To＝施設の予約用アドレス |
| 特商法 | `legal.ts` 38・96 | 文面に `facility_name` |
| 覚書ファイル | `memorandum.ts` 103・125 | insert に `facility_id` |
| 管理画面の入口 | `staff.ts` 67〜95、`store.ts` 209〜245（`listPartners` / `requireStaffPartner`） | `ab_fac` クッキー → `FACILITY_UUID` → 施設アクセスを `book.private_bath_contents_admin(p_facility)` で確認 → **取引先の `facility_id` が一致しなければ 404** |
| 管理画面の一覧・請求 | `routes/admin/partners/+page.server.ts` 16〜79、`invoices/+page.server.ts` | 施設の取引先だけ |
| 取引先ページの枠 | `portal.ts` 105〜117（`portalHeader`）、`routes/p/[token]/+layout.svelte` | ヘッダーに施設名・差し色（`partnerAccent(facilitySlug)`）・ホーム画面名 |
| 確認モード | `preview.ts` | クッキーは `partnerId` に署名（施設を含まない）→ 変更不要 |

### 3.5 DB 関数で施設を `rms_partners.facility_id` から取っている箇所

出典: `20261007002617_rms_partner_deposit.sql`（`rms_partner_create_booking` 現行版）

- `select * into v_partner from public.rms_partners where id = (p->>'partner_id')::uuid`（52 行）→ 以後 `v_partner.facility_id` で **施設ロック（316 行）・部屋タイプ（327 行）・残室（370 行）・支払方法（381 行）・stays / bookings / 台帳の `facility_id`（451〜495 行）・与信（530 行）** を決める。
- `_rms_partner_emit_pms_event` は台帳の `v_pb.facility_id` から施設を取る（631・677 行）→ 台帳に施設が残っていれば変更不要。
- `rms_partner_portal_source(p_facility)` / `rms_partner_contents(p_facility)` / `rms_partner_plan_terms(p_facility)` / `rms_partner_credit_check(p_guest, p_facility, …)` は **施設を引数で受ける**ので変更不要。

### 3.6 PMS 側（autumn-pms）の依存

出典: `grep rms_partner autumn-pms/sveltekit/src`

- PMS は `public.rms_partners` を **読んでいない**。取引先予約は電文（`autumn.direct_booking/1`・`facility_id` 入り）と `core.stays.metadata.rms_partner_id` / `channel_code='rms_partner'` でだけ知る。
- `core.guests` は **テナント単位**（`facility_id` 列なし・§7.4）。与信の集計 `lib/server/agency-credit.ts` は **施設ごと**に数える（Book の `rms_partner_credit_check` と同じ）。
- → **本設計で PMS の変更は不要**。

### 3.7 管理画面の施設切替（既存の仕組み）

出典: `routes/admin/+layout.server.ts`、`routes/admin/switch/+server.ts`、`lib/server/partners/staff.ts`

- 管理画面全体が **クッキー `ab_fac`（path `/admin`・1年）** で「今の施設」を1つ持つ。左上の切替で `/admin/switch?f=` → クッキー更新。
- 取引先の画面もこれに従い、**別施設の取引先は一覧へ戻す**（`requireStaffPartner`）。
- スタッフの施設アクセスは `core.memberships`（`facility_id` が null なら全施設）＋ cross-facility ロール（`private.has_facility_access`）。

---

## 4. 分類：取引先共通 と 施設ごと【提案】

### 4.1 列の分類

| 取引先共通（`rms_partners` に残す） | 施設ごと（`rms_partner_facilities` へ移す） |
|---|---|
| `name` / `kind` / `contact_name` / `contact_email` / `note` | `enabled`（**新**・この施設に販売するか） |
| `url_token`（1つ） | `pricing` |
| `is_active` / `valid_from` / `valid_until`（契約の有効期間） | `booking_enabled`（この施設で予約を受けるか） |
| `memorandum` / `memorandum_updated_*` | `max_days_ahead` / `show_inventory` / `include_advance` |
| `pms_guest_id` / `booking_name_mode` / `credit_over_action` | `payment_method_id`（PMS の支払方法・施設ごと） |
| | `facility_settings`（jsonb・§4.2 の施設ごとの部分＋共通の上書き〔N6〕） |
| `stripe_customer_id` / `stripe_livemode` / `stripe_customer_created_at` | `sort_order`（**新**・切替の並び。既定は施設の並び） |
| `booking_settings`（jsonb・§4.2 の共通の部分） | `created_at` / `updated_at` / `updated_by` |
| `primary_facility_id`（**新・任意**・既定の施設。null なら最初のオンの施設。§7.8） | |

### 4.2 `booking_settings`（jsonb）の分け方

出典: `lib/partner-booking.ts` 255〜312 行（`PartnerBookingSettings` と既定値）

| キー | 分類 | 理由 |
|---|---|---|
| `paymentOptions` / `customPaymentOptions` | **共通** | 支払条件は会社との契約。月末締めの請求は施設ごとに出すが「請求書払いか」は共通 |
| `invoiceRecipientName` / `invoiceDue` | 共通 | 宛名・期限は会社。請求書は全施設分1枚（N3） |
| `prepayDiscount` | **共通の既定＋施設で上書き**（決定 N6） | 施設で率を変えられる。施設側が未設定なら共通の値 |
| `leadDays` / `cutoffHour` / `maxRooms` / `maxNights` / `cancelDays` | **共通の既定＋施設で上書き**（決定 N6） | 受付ルール。施設側が未設定なら共通の値 |
| `options`（毎回聞く項目） | 共通 | 取引先向けの質問。施設の標準項目は別（`loadStandardFieldTexts(facility)`） |
| `notifyPartner` | 共通 | |
| `creditDeposit` / `creditDepositRemainder` | 共通 | デポジットの決め方は契約。判定は施設ごと（§7.5） |
| `showOfficialPerks` | **施設ごと** | 公式 HP の特典は施設のテンプレートに付く |
| `planNames`（プランコード → 名前） | **施設ごと** | プランコードは施設固有 |
| `perks`（特典・`planCodes` 付き・画像は `book-photos/partners/{施設UUID}/…`） | **施設ごと** | 対象プランが施設固有・画像の置き場も施設 |
| `notice`（予約画面の案内文） | **施設ごと**（空なら共通の文面にフォールバック） | 支払の案内は共通でも、施設の注意事項が入る |
| `notifyEmails`（宿側の通知先） | **施設ごと** | 施設の予約係が受ける |

実装は **`PartnerBookingSettings` を2つの型に割る**（`PartnerCommonSettings` と `PartnerFacilitySettings`）のではなく、**正規化関数 `normalizePartnerBookingSettings(common, facility)` が1つのオブジェクトに合成して返す**【提案】。既存コードは合成後の `partner.booking_settings` をそのまま読めるので、呼び出し側の変更を最小にできる（§7.9 の互換レイヤーと同じ発想）。保存だけが「どちらの jsonb に書くか」をキーで振り分ける。

**上書きの規則（決定 N6）**: `facility_settings` に **キーがあれば施設の値、無ければ共通の値**（`undefined` と「値あり」で区別。空文字や 0 を「未設定」と読まない）。`prepayDiscount` はオブジェクトごと上書き（`type` と `value` を別々に継承しない）。受付ルール5つ（`leadDays` / `cutoffHour` / `maxRooms` / `maxNights` / `cancelDays`）はキーごとに上書き。管理画面の施設タブでは各項目に「共通の既定を使う（値を表示）／この施設だけ変える」の切替を置き、「共通の既定を使う」に戻すとキーを削除する（§7.12）。

「施設ごとのみ（共通を持たない）」にしない理由: 1施設の取引先（現状すべて）で同じ値を施設タブに二重に入れることになり、共通の請求条件（`paymentOptions` 等）と置き場が分かれて分かりにくい。共通の既定＋上書きなら、既存の設定は共通にそのまま残り、施設タブは「変えたいときだけ」触る。

### 4.3 オン／オフの意味の整理

| スイッチ | 置き場 | 効き方 |
|---|---|---|
| 取引先の公開（`is_active` / `valid_from` / `valid_until`） | 共通 | 全施設・ログインも API も止まる（既存の `partnerUnavailableReason`） |
| 施設のオン／オフ（`enabled`） | 施設ごと | オフの施設は取引先ページの切替に出ない・料金も予約も API も出さない。**1つもオンが無い取引先はログインできるが「現在ご案内できる施設がありません」** |
| 予約受付（`booking_enabled`） | 施設ごと | 料金カレンダーは見せるが予約は受けない、を施設ごとに。「全施設いったん停止」は施設ごとに全部オフで行う |

→ 共通の親スイッチ（`booking_enabled_master`）は **作らない**（決定 N2。施設ごとの `booking_enabled` だけで足りる。増やすと「どこで止まっているか」が分かりにくい）。

---

## 5. データモデル案【提案】

### 5.1 新表 `public.rms_partner_facilities`

migration: `bash ~/.claude/new-migration.sh autumn-shared rms_partner_facilities`（実 UTC 秒・キリ番禁止）。スキーマは取引先系の慣例どおり `public`（`docs/partner-pms-customer-link.md` §10）。

```sql
create table if not exists public.rms_partner_facilities (
  partner_id        uuid not null references public.rms_partners(id) on delete cascade,
  facility_id       uuid not null references core.facilities(id) on delete cascade,
  tenant_id         uuid not null references core.tenants(id) on delete cascade,
  -- この施設に販売するか（取引先ページの切替・料金・予約・API すべての入口）
  enabled           boolean not null default true,
  -- 以下は rms_partners から移す列（意味・既定値は従来どおり）
  booking_enabled   boolean not null default false,
  max_days_ahead    integer not null default 365 check (max_days_ahead between 1 and 730),
  show_inventory    boolean not null default true,
  include_advance   boolean not null default true,
  pricing           jsonb not null default '{}'::jsonb,
  payment_method_id uuid references pms.payment_methods(id) on delete set null,
  -- booking_settings のうち施設ごとの部分（planNames / perks / notice / notifyEmails / showOfficialPerks）と、
  -- 共通の既定を施設で上書きするキー（prepayDiscount / leadDays / cutoffHour / maxRooms / maxNights / cancelDays・N6。キーが無ければ共通の値）
  facility_settings jsonb not null default '{}'::jsonb,
  sort_order        integer not null default 0,
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (partner_id, facility_id)
);
create index if not exists idx_rms_partner_facilities_facility on public.rms_partner_facilities (facility_id, enabled);
alter table public.rms_partner_facilities enable row level security;
-- 読みは施設アクセスのあるスタッフ（rms_partners と同じ流儀）。書きは service_role（Book のサーバ）だけ
create policy rms_partner_facilities_select on public.rms_partner_facilities for select
  using (private.is_superadmin() or private.has_facility_access(tenant_id, facility_id));
grant select on public.rms_partner_facilities to authenticated;
grant all on public.rms_partner_facilities to service_role;
-- set_updated_at トリガー（core.set_updated_at）
```

- `tenant_id` を持たせるのは RLS と、`rms_partners.tenant_id` との一致をトリガーで検査するため（施設がテナントの施設であることも検査）。
- **主キーは (partner_id, facility_id)**。同じ施設に2行は作れない。

### 5.2 `public.rms_partners` の変更

```sql
alter table public.rms_partners
  -- 施設は rms_partner_facilities へ。移行期間は残し（NULL 許容）、Phase C で落とす
  alter column facility_id drop not null,
  add column if not exists primary_facility_id uuid references core.facilities(id) on delete set null;
-- RLS を施設単位からテナント単位＋「オンの施設のどれかにアクセスがある」に
drop policy if exists rms_partners_all on public.rms_partners;
create policy rms_partners_select on public.rms_partners for select
  using (private.is_superadmin()
      or exists (select 1 from public.rms_partner_facilities pf
                  where pf.partner_id = rms_partners.id and private.has_facility_access(pf.tenant_id, pf.facility_id)));
```

- `rms_partners` への **書き込みは service_role だけ**（現状も Book のサーバが service_role で書いている・`admin-client.ts`）。`for all` を `for select` に狭めても実害は無いが、PMS 等の他アプリが `authenticated` で書いていないことを着手時に確認する（§3.6 では読んでもいない）。
- 列の削除（`facility_id` / `pricing` / `booking_enabled` / `max_days_ahead` / `show_inventory` / `include_advance` / `payment_method_id`）は **Phase C**（§8）。それまでは **`rms_partner_facilities` が正・`rms_partners` の旧列は読まない**（二重管理にしない。バックフィル後は旧列を更新しない）。

### 5.3 子テーブルの変更

| 表 | 変更 |
|---|---|
| `rms_partner_invoices` | 部分一意索引 `(partner_id, period) where status='issued'` は **そのまま**（1取引先・1月・1枚）。`facility_id` を NULL 許容に（統合後の請求書は null）。`facility_ids uuid[] not null default '{}'`（載せた予約の施設・管理画面の施設絞り込み用）と索引 `gin(facility_ids)` を足す。`document` の形は version 2（§7.1 の紙面） |
| `rms_partner_billing_settings` | **会社で1つ**にする。新表 `public.rms_partner_invoice_issuer`（`tenant_id` 主キー・列は今の `rms_partner_billing_settings` と同じ: `issuer_name` / `issuer_address` / `issuer_tel` / `registration_number` / `bank_account` / `note` / `auto_issue`）を作り、既存の男鹿の1行を写してバックフィル（§6.2）。旧表は Phase D で削除（§7.1） |
| `rms_partner_documents` | `facility_id` を NULL 許容に。既存行はそのまま（施設は記録として残る）。新規は null（§7.3） |
| `rms_partner_accounts` | 変更なし（任意: §7.7 の `allowed_facility_ids uuid[]`） |
| `rms_partner_bookings` / `rms_partner_booking_attachments` | 変更なし（施設の写しを持つ） |
| `rms_partner_url_token_aliases`（**新**） | 旧トークンの互換（§6.3）。`token text primary key, partner_id uuid, replaced_at timestamptz` |

### 5.4 DB 関数の変更

| 関数 | 変更 |
|---|---|
| `rms_partner_create_booking(p)` | **`p.facility_id` を必須で受ける**。`rms_partner_facilities` を `(partner_id, facility_id)` で読み `enabled and booking_enabled` を検査（無ければ `facility_not_enabled`）。以後の `v_partner.facility_id` / `v_partner.pricing` / `v_partner.payment_method_id` / `v_partner.booking_settings` の参照を施設設定（合成後）に置き換える。`booking_settings` の合成（共通 ‖ 施設）は SQL 側にも `_rms_partner_effective_settings(p_partner, p_facility) returns jsonb` を作り、TS の `normalizePartnerBookingSettings` と **同じ規則**にする（Phase 3b の `_rms_partner_deposit_amount` と `depositAmountOf` を両側で揃えたのと同じ流儀） |
| `rms_partner_credit_check` / `rms_partner_portal_source` / `rms_partner_contents` / `rms_partner_plan_terms` | 変更なし（施設を引数で受ける） |
| `_rms_partner_emit_pms_event` / `rms_partner_cancel_booking` / `mark_*` | 変更なし（台帳の `facility_id`） |
| `rms_partner_merge(p_target, p_source)`（**新**） | §6.4 |
| `pms.merge_guests` | 変更なし（`rms_partners.pms_guest_id` の付け替えは Phase 1 で済み） |

---

## 6. 移行手順【提案】

### 6.1 方針

- **データは「昇格」で足りる**（§3.1）。今の各行を「取引先1行 ＋ 施設設定1行」に機械的に分ける。手で直すものは無い。
- **トークン・URL は変えない**（既存の取引先が持つ `url_token` をそのまま取引先のトークンにする）。
- **ログインユーザーもそのまま**（`rms_partner_accounts.partner_id` は変わらない）。
- 統合（同じ会社の2行を1つに）は **将来2行できてしまった場合のための道具**として用意し、初回移行では使わない。

### 6.2 バックフィル（Phase A の migration 内・1トランザクション）

```sql
insert into public.rms_partner_facilities
  (partner_id, facility_id, tenant_id, enabled, booking_enabled, max_days_ahead, show_inventory, include_advance,
   pricing, payment_method_id, facility_settings, sort_order)
select id, facility_id, tenant_id, true, booking_enabled, max_days_ahead, show_inventory, include_advance,
       pricing, payment_method_id,
       -- booking_settings から施設ごとのキーだけ抜く
       jsonb_strip_nulls(jsonb_build_object(
         'planNames', booking_settings->'planNames', 'perks', booking_settings->'perks',
         'notice', booking_settings->'notice', 'notifyEmails', booking_settings->'notifyEmails',
         'showOfficialPerks', booking_settings->'showOfficialPerks')),
       0
from public.rms_partners
on conflict do nothing;
update public.rms_partners set primary_facility_id = facility_id where primary_facility_id is null;
-- booking_settings から施設ごとのキーを落とす（共通の部分だけ残す）。
-- N6 の上書きキー（prepayDiscount・受付ルール）は共通に残す（施設側は空＝共通の既定を使う）
update public.rms_partners
   set booking_settings = booking_settings - 'planNames' - 'perks' - 'notice' - 'notifyEmails' - 'showOfficialPerks';
-- 請求書の発行元を会社で1つに（N3）: 既存の施設ごとの設定のうち、保存済みで振込先のある行を写す（複数あれば更新日の新しい方）
insert into public.rms_partner_invoice_issuer (tenant_id, issuer_name, issuer_address, issuer_tel, registration_number, bank_account, note, auto_issue, updated_by)
select distinct on (tenant_id) tenant_id, issuer_name, issuer_address, issuer_tel, registration_number, bank_account, note, auto_issue, updated_by
  from public.rms_partner_billing_settings order by tenant_id, (bank_account is not null and bank_account <> '') desc, updated_at desc
on conflict do nothing;
```

- 検証: 件数一致（`rms_partners` と `rms_partner_facilities` が同数）、`pricing` の jsonb が等しいこと、`booking_settings` のキー集合、`rms_partner_invoice_issuer` が1行で登録番号・振込先が男鹿の設定と同じ。
- 発行元の住所・TEL: 男鹿の行の住所（男鹿）がそのまま写る。**1枚の請求書に出す会社の住所は本社（西和賀）が自然**なので、移行後に管理画面で住所・TEL を直す（§7.1・運用。TEL は `invoices.ts` の既定 `0197-82-2222` を提案）。
- 旧列（`rms_partners.pricing` 等）は Phase C まで **残すが更新しない**。

### 6.3 トークン・URL の互換

- 昇格ではトークンが変わらないので **互換の問題は無い**。
- 統合（§6.4）で片方のトークンを捨てるときだけ、`rms_partner_url_token_aliases` に旧トークンを入れ、`findPartnerByUrlToken` が **別名なら本トークンへ 303**（path を保って `/p/<new>/calendar?f=<旧行の施設 slug>`）。クッキー（セッション・確認モード）は path が `/p/<旧token>` なので持ち越せない → **再ログイン**になる（取引先に事前に案内）。別名は 180 日で掃除（任意）。

### 6.4 統合 `rms_partner_merge(p_target, p_source)`（将来の道具）

同じ会社が西和賀用・男鹿用の2行になっているときに、`p_source` を `p_target` に吸収する。service_role のみ・1トランザクション。

1. 前提検査: 同じ `tenant_id`・`p_source` の施設設定が `p_target` に **無い施設**であること（同じ施設が両方にあれば例外 `facility_conflict`。先に片方の施設設定を手で消す）。両取引先に **同じ月の `issued` の請求書が無い**こと（あれば例外 `invoice_conflict`。1取引先・1月・1枚の索引に当たるため・§7.1）。
2. `rms_partner_facilities`: `p_source` の行の `partner_id` を `p_target` に付け替え。
3. 子表の `partner_id` を付け替え: `rms_partner_accounts`・`rms_partner_api_keys`・`rms_partner_access_logs`・`rms_partner_bookings`・`rms_partner_invoices`・`rms_partner_documents`（`facility_id` はそのまま）・`rms_partner_booking_attachments`。
4. 共通の列: `p_target` の値を優先。`p_source` にだけある値（`pms_guest_id`・`memorandum`・`contact_email`・`booking_settings` のキー）は **`p_target` が空のときだけ** 埋める。`booking_settings.paymentOptions` / `customPaymentOptions` は **和集合**（`custom_*` の id 衝突は source 側を `custom_<新uuid>` に振り直して台帳 `payment_option` も書き換える）。
5. `url_token`: `p_target` のものを残し、`p_source` のトークンを `rms_partner_url_token_aliases` へ。
6. Stripe Customer: `p_target` の `stripe_customer_id` を残す。`p_source` の Customer に付いた保存カードは **移せない**（Stripe は PaymentMethod を別 Customer に付け替えられない）→ 統合前に画面で「男鹿用ページで登録したカードは使えなくなります。統合後に登録し直してください」と出し、`p_source` の Customer の PM を detach する。**チェックアウト日決済で `p_source` の Customer を参照している未請求の予約があれば統合を断る**（`rms_partner_bookings.stripe_customer_id = source.stripe_customer_id and payment_status in ('scheduled','charge_failed')`。`docs/saved-cards.md` §7.5 の削除ガードと同じ）。
7. ログイン ID: `login_id` は全体一意なので衝突しない。同じ人が2つ持つ（`saishunkan-oga` 等）ことは許す。マスタは両方ともマスタのまま（管理者が後で整理）。
8. `p_source` を削除（cascade で残骸が消える。`rms_partner_documents` の Storage 実体は `partner_id` を付け替えてあるので消さない。`deletePartner` の `removeAllPartnerDocumentFiles` を **通さずに** `delete from rms_partners` する）。
9. アクセスログに `partner_merged`（source の id・名前・施設）を残す。

管理画面: `/admin/partners/[id]` の「危険な操作」に「別の取引先をこの取引先に統合」（候補は **同テナント・施設が重ならない** 取引先。管理者のみ・確認ダイアログで上の 6 の注意を出す）。

---

## 7. 論点ごとの設計【提案】

### 7.1 請求書（決定 N3: 全施設分を1枚にまとめ、明細は施設別にグルーピング）

出典: `lib/partner-invoice.ts`（`InvoiceDocument` / `InvoiceLine` / `invoiceTotals` / `groupStatementLines` / `statementPage` / `invoicePage`）、`lib/server/partners/invoices.ts`（`loadBillingSettings` 246〜・`loadTargetBookings` 360〜・`partnersWithBookings` 912〜・月末 cron 985〜）、PROD `rms_partner_billing_settings`（§3.3）、autumn-pms `lib/server/freee/*`（施設の `settings.section_id`）

#### 発行単位・一意性・番号

- **「取引先 × 月」で1枚**。その月にチェックアウトした **全施設** の予約を載せる。
- 部分一意索引 `uq_rms_partner_invoices_issued (partner_id, period) where status='issued'` は **変更なし**（既に「1取引先・1月・1枚」の形）。取消 → 再発行の流れも従来どおり。
- 請求書番号 `PI-YYYYMM-NNNNN`（全体の連番 `rms_partner_invoice_no_seq`）は従来どおり。
- `rms_partner_invoices.facility_id` は NULL 許容にし、統合後の請求書は **null**。載せた予約の施設を `facility_ids uuid[]` に持つ（管理画面で「今の施設が載っている請求書」を絞るため）。
- `loadTargetBookings` は `partner_id` だけで絞り（`facility_id` の条件を外す）、`check_out_date` の範囲は従来どおり。

#### 発行元（発行者・住所・TEL・登録番号・振込先）— 会社で1つ

調べた事実: 発行者は「株式会社山人」の1法人で、**適格請求書発行事業者の登録番号は法人に1つ**（`T3400001006564`・PROD の男鹿の行・HANDOFF v0.56.0）。施設で違うのは `invoices.ts` の既定値（住所・TEL）だけ。振込先も PROD は会社名義（「カ）ヤマド」）の1口座。

- 発行元の設定を **テナントで1つ**（`rms_partner_invoice_issuer`・§5.3）にする。1枚の請求書に振込先を2つ書くと取引先が迷うため、**振込先は1つ**。施設ごとに口座を分けたい場合は本設計の決定（1枚にまとめる）と両立しないので、要望が出たら「施設ごとに発行」へ戻す判断になる（§10-N3 の注記）。
- 紙面の発行者欄: 会社名・本社住所・TEL・登録番号（施設名は出さない。どの施設の利用かは明細の施設グループで分かる）。
- 管理画面「請求書の設定」（`/admin/partners`）は施設に依らない共通の設定になる（`ab_fac` を切り替えても同じ内容）。`auto_issue` も会社で1つ。

#### 紙面（`InvoiceDocument` version 2）

- `InvoiceLine` に **`facilityId` / `facilityName`** を足す（予約の `rms_partner_bookings.facility_id` から。取消の行・デポジット不足分・事務手数料を含む返金しない額の行も **その予約の施設**に帰属）。
- `InvoiceDocument.facilities: { id, name, totals: InvoiceTotals }[]`（施設ごとの小計。載っている施設だけ・施設の並び順）。`totals`（全体）は従来どおり。
- **消費税の端数処理は請求書1枚で1回**（`invoiceTotals` の `tax10 = floor(taxable10 × 10/110)`）を維持する。施設小計の `tax10` は「参考」で、施設小計の消費税の合計が全体の消費税と **1円ずれうる**ことを紙面の注記に書く（適格請求書の要件は「税率ごとの区分合計と消費税額」で、施設別の消費税は要件外）。
- 1枚目「ご請求書」: 請求明細の表を **施設の見出し行（施設名）→ その施設の対象行 → 施設小計行（10%対象税込・入湯税・キャンセル料・ご請求額）** の順に並べ、最後に全体の合計・税率ごとの区分（従来どおり）。
- 2枚目以降「ご利用明細書」: グループを **施設 → お支払方法（ご請求の対象を先）** の2階層にする（`groupStatementLines` に施設のキーを足す）。施設の見出し（`.grp` と同じ見た目で一段大きく）と施設小計行、全体の合計。
- **載っている施設が1つだけの請求書は、施設の見出し・小計を省略**して従来と同じ紙面にする（1施設の取引先は見た目が変わらない）。
- `renderInvoiceHtml` は `document.version` で分岐し、**発行済みの version 1 の紙面はそのまま描ける**ようにする（`document` に固定して持つ設計のため、再描画で変わらない）。

#### freee での突合（施設別の売上計上）

- 調べた事実: Book は請求書を freee に送っていない（取引先予約の freee 連携は範囲外・`docs/partner-pms-customer-link.md` §1）。施設別の売上は **PMS が freee に送る取引に施設の `section_id`（freee の部門）を付けて**計上している（autumn-pms `lib/server/freee/*` の `settings.section_id`）。
- 請求書を1枚にしても、**売上は PMS 側で施設（部門）ごとに freee に立つ**ので、施設別の売上計上は崩れない。崩れるのは **入金の消込**（取引先からの振込が1本で、売掛は部門ごとに2本）。
- 対策【提案】: (a) 請求書の `document.facilities[].totals`（施設小計）を管理画面の請求書一覧・詳細に出し、**入金時に部門ごとの売掛金へ按分する額**を読めるようにする。(b) 管理画面の請求書一覧に「施設別小計の CSV 出力」（期間・取引先・施設・10%対象税込・入湯税・キャンセル料・請求額）を足し、freee の入金登録（1振込を2行の消込に分ける）の手元資料にする。(c) Book → freee の自動連携は引き続き範囲外（`/freee-bs-*` 系の突合スキルで月末に合わせる運用）。
- PMS 側の「取引先払い」（`billed_to_partner`）の請求書ガード・明細ロックは施設ごとの予約に付いているので変更なし。

#### 既存の施設ごとの請求書との移行

- PROD の請求書は **0 件**（§3.1）なので、実データの移行は無い。
- 仕組みとしての規則: 発行済み（`facility_id` が入っている version 1）の請求書は **そのまま有効**（取消・ダウンロード・再送は従来どおり）。統合後の発行は、その取引先・その月に **施設ごとの請求書が issued で残っていれば発行を断る**（「○月は施設ごとの請求書（PI-…）が発行済みです。取り消してから1枚にまとめて発行してください」）。索引 `(partner_id, period)` が自動的にこれを保証する（昇格直後は取引先1行＝旧行なので衝突しない）。
- 統合（§6.4）で `p_source` の請求書を `p_target` に付け替えると、同じ月に `issued` が2枚になり索引に当たる → **統合は、両取引先に同じ月の `issued` が無いことを前提検査に入れる**（あれば片方を取消してから）。

#### 発行・送信・cron

- 月末 cron（`runMonthEndInvoices`）は **施設ループをやめ、テナントの取引先ループ**にする（`partnersWithBookings(db, period, today)` は `rms_partner_bookings` を `check_out_date` の範囲だけで引き、`partner_id` を集める）。発行元が無い／振込先が空なら **全取引先を止めて1通の通知**（宛先は各施設の `notifyEmails` ではなく、発行元設定の通知先〔新列 `notify_emails`〕か、既定の施設の `notifyEmails`）。
- 送信メール: 差出人名は **発行者名（株式会社山人）**、Reply-To は `primary_facility_id` の施設の予約用アドレス（§7.11）。宛先（連絡先・マスタ・予約者）は従来どおり。
- 取引先ページ「アカウント → ご請求書」: 一覧は従来どおり1つ。行に載っている施設名（`facility_ids` から）を小さく出す。
- 管理画面 `/admin/partners/invoices`（予定請求）: **取引先ごとに1行・施設別小計の列**（`ab_fac` で「今の施設の予約を含む取引先」に絞れるが、金額は全施設）。取引先詳細の「請求書」は **共通セクション**（施設タブの外）に置く（§7.12）。
- 宛名（`invoiceRecipientName` → 紐づけ先の正式名称 → 取引先名）は共通・変更なし。

### 7.2 特商法（取引先ページの表記）

出典: `legal.ts` 37〜96 行（`partnerTokushoho(partner)`。文面に `facility_name`・支払方法・請求書の期限・取消期限・デポジット）

- 支払方法・取消期限・デポジットは **共通**、事業者名・住所・施設名は **施設ごと**。
- 表記ページは **選択中の施設の表記**を出す（§7.8 の切替に従う）。ページ上部に「他の施設の表記: 山人-yamado-」のリンク（`?f=`）。
- 代替: 1ページに全施設の事業者欄を並べる（推奨しない。長くなり、予約画面からのリンクで「どの施設の話か」が曖昧になる）。

### 7.3 覚書（memorandum）・覚書ファイル

- **本文は取引先で1つ**（会社との取引条件）。施設で条件が違うときは本文内に「■ 西和賀」「■ 男鹿」の見出しで書き分ける（運用）。
- ファイルは取引先共通。`rms_partner_documents.facility_id` は NULL 許容にし、新規は null。一覧に施設の列は出さない。
- 将来「施設ごとの覚書」が要るなら `rms_partner_facilities.memorandum` を足す（今は作らない）。

### 7.4 PMS 顧客マスタ（`core.guests`）— テナント単位

出典: `information_schema.columns`（`core.guests` に `facility_id` 無し・`tenant_id` のみ）、`docs/partner-pms-customer-link.md` §3.1

- `core.guests` は **テナント単位**。西和賀・男鹿で同じ顧客行を共有する。→ `pms_guest_id` は取引先共通でよく、**本設計で最も相性が良い**。
- Phase 1 の決定 #11「同じ旅行会社を2施設の取引先が指すことを許す」は、統合後は **自然に1取引先 → 1顧客**になる。一意制約は引き続き張らない（統合前の2行も許す）。
- `rms_partner_bookings.pms_guest_id` / `name_mode` は予約の写し。変更なし。
- `pms.merge_guests` の付け替え（`rms_partners.pms_guest_id`）は Phase 1 で済み。変更なし。

### 7.5 与信枠（受付枠）

出典: `20261007000239_rms_partner_credit_check.sql`、autumn-pms `lib/server/agency-credit.ts`

- 与信の **設定**（`core.guests.metadata.pms.credit_enabled / growth_rate / min_rooms`）は顧客＝テナント単位で1組。**判定と上限**は `rms_partner_credit_check(p_guest, p_facility, …)` が施設ごとに数える（基準実績も施設ごと）。→ 取引先が2施設オンでも **枠は施設ごとに別**（PMS と同じ）。
- Book 側の変更: `partnerCreditCheck(partner, …)` が `partner.facility_id` を渡している箇所を **選択中の施設**に。管理画面の「今後 12 か月の表」は施設タブの中（施設ごと）に出す。与信の設定（ON/OFF・増加率・最低枠）は共通セクションに1つ（全施設に効くことを注記）。
- `credit_over_action` / `creditDeposit` は共通（§4）。
- PMS 取込前の予約を数える条件（`core.stays.metadata.rms_partner_id` ＋ `facility_id`）は、`rms_partner_id` が統合後も取引先 id なので変更不要。統合（§6.4）で `p_source` の id が消えるため、`core.stays.metadata.rms_partner_id = p_source` の行は **数えられなくなる** → 統合時に `update core.stays set metadata = jsonb_set(metadata, '{rms_partner_id}', to_jsonb(p_target::text)) where metadata->>'rms_partner_id' = p_source::text`（`core` の更新。`booking.bookings.metadata.rms_partner_id` も同様）を統合関数に含める。

### 7.6 Stripe Customer（取引先で1つ）

出典: `docs/saved-cards.md` §5.1・§9-N1、`20261007022727_rms_partner_stripe_customer.sql`（未適用）、`lib/saved-cards.ts`（未コミット）

- 保存カードの設計は既に「取引先で1つ・施設を前提にしない」で書かれている（migration のコメント・`saved-cards.ts` 冒頭）。**本設計で列の移動は不要**（`rms_partners` に残す）。
- Customer の `name` は取引先名、`metadata` は `partner_id`（施設は入れない）。`description` 等に施設名を入れる案は採らない。
- 予約の `rms_partner_bookings.stripe_customer_id` は予約ごとの写し。変更なし。
- 統合時の扱いは §6.4-6。

### 7.7 権限（施設ごとのユーザー制限は要るか）

- **取引先ユーザー**（`rms_partner_accounts`）: 今は取引先に属し、施設を持たない。「男鹿担当は男鹿だけ予約できる」制限は **作らない**（決定 N5。要望が出たときの形だけ書く）。作るなら `allowed_facility_ids uuid[]`（null = 全施設）を足し、切替・料金・予約・API の入口で検査する。マスタは常に全施設。
- **Book のスタッフ**: 管理画面の編集は管理者のみ（`canEditPartners`）。施設アクセスは `has_facility_access` が施設単位なので、**共通設定（名前・支払条件・紐づけ・覚書）を変えられるのは「オンの施設すべてにアクセスがある管理者」**、施設設定はその施設にアクセスがある管理者、とする。`staffPartnerScope` を「選択中の施設」で検査する今の形に、共通設定の保存だけ「全オン施設の検査」を足す（`book.private_bath_contents_admin(p_facility)` を施設ごとに呼ぶ）。山人は現状 2 施設・管理者は全施設なので実運用では効かないが、仕組みとして持つ。

### 7.8 取引先ページ（`/p/[token]`）の施設切替 — URL 設計と選択の保持

#### 選択肢

| 案 | 形 | 長所 | 短所 |
|---|---|---|---|
| A. クッキー＋クエリ（**推奨**） | URL は今のまま `/p/<token>/calendar`。選択はクッキー `rms_partner_facility`（path `/p/<token>`・1年）。`?f=<slug>` が付けばそれを採用してクッキーも更新。切替は `POST /p/<token>/facility`（`f`・`next`）→ 303 | **既存のリンク・メール内 URL・ルート・`/p/${token}/…` の全リンクが無変更**。1施設の取引先は何も変わらない | URL だけでは施設が分からない（共有リンクは `?f=` を付ける）。SSR のキャッシュは元々 `no-store` なので問題なし |
| B. パスに施設 | `/p/<token>/<slug>/calendar` | URL が自己記述的 | 全ルートの移動・全リンクの書き換え・1施設の取引先も URL が変わる・旧 URL のリダイレクト層が要る。確認モード・セッションのクッキー path も見直し |
| C. 施設ごとにトークン | `/p/<token-yamado>` と `/p/<token-oga>`（今と同じ見え方） | 変更が最小 | 「画面上部で切り替える」決定に合わない（別ページへ飛ぶだけ）。ログインが施設ごとに切れる |

→ **A を採用**【提案】。B は「公式サイトのように施設 URL を分けたい」要望が出たときに、A の上に薄く足せる（`/p/<token>/<slug>/...` → `?f=` に書き換える rewrite を hooks に置くだけ）。

#### 選択の決め方（`resolvePortal` の中）

1. `?f=<slug>` があり、その施設がオン → それ（クッキーも更新）。オフ・不明なら無視。
2. クッキー `rms_partner_facility` が有効なオン施設 → それ。
3. `primary_facility_id`（オンなら）→ それ。
4. オンの施設の先頭（`sort_order`・施設の並び）。
5. オンが1つも無い → `facility = null`。料金・予約・お部屋・プランは「現在ご案内できる施設がありません」。アカウント・覚書・予約一覧・請求書は見られる。

#### 画面

- **ヘッダー**（`+layout.svelte`）: 施設名の位置を、オンが2つ以上なら **セグメント切替**（「山人-yamado- ｜ 山人-oga-」・現在地を太字・差し色もその施設に）に。1つなら今のまま施設名の表示。切替は `POST /p/<token>/facility` で `next` に現在のパス（`/book` の入力途中は確認ダイアログ「入力内容が消えます」）。
- **施設ごとに変わるページ**: 料金カレンダー・お部屋・プラン・予約入力（`/book`・`/book/quote`・`/book/reserve` は **hidden `facility_id`** を持ち、サーバは「選択中の施設」ではなく **フォームの施設**で見積・確定する。切替直後の二重送信で施設がずれないように）。
- **全施設をまとめるページ**: 予約一覧（施設の列・絞り込み「すべて／西和賀／男鹿」・既定はすべて。取消・支払・添付は予約の施設で動く）、ご請求書（全施設分1枚・行に載っている施設名）、アカウント（担当者情報・ユーザー管理・お支払いカード）、覚書。
- **メールの中のリンク**: 予約確認・取消・請求失敗のリンクは `?f=<その予約の施設 slug>` を付ける（`/p/<token>/bookings?f=oga`）。
- **ホーム画面名（`apple-mobile-web-app-title`）**: 2施設なら「山人 取引先ページ」、1施設なら施設名。
- **確認モード**（管理画面の「確認ページを開く」）: 管理画面の施設タブからの起動時に `?f=` を付ける。

### 7.9 Book サーバの互換レイヤー（変更量を抑える要）

`PartnerContext` は今 `PartnerRow & { facility_slug, facility_name }` で、取引先ページ・予約・メール・請求書の **ほぼ全関数が `partner.facility_id` / `partner.pricing` / `partner.booking_settings` / `partner.facility_name` を読む**（§3.4）。これを全部「取引先と施設の2引数」に直すと変更が広い。

【提案】`resolvePortal` が **「選択中の施設で合成した `PartnerContext`」** を返す:

```ts
type PartnerContext = PartnerCommonRow            // rms_partners（共通）
  & PartnerFacilityRow                              // rms_partner_facilities（選択中の施設）: facility_id, pricing, booking_enabled, …
  & { facility_slug: string; facility_name: string; booking_settings: PartnerBookingSettings /* 合成後 */
      facilities: { id, slug, name, enabled, bookingEnabled }[]  /* 切替用 */ };
```

- 既存コードの `partner.facility_id` 等は **そのまま動く**。変えるのは、合成を作る `store.ts`（`withFacility` → `withFacilityContext(partnerRow, facilityRow)`）と、施設を選ぶ `portal.ts`、保存先を振り分ける管理画面の `save` だけ。
- 予約・取消・請求・メールのように **台帳の予約から施設が決まる処理**は、`partner` ではなく `booking.facility_id` で合成し直す（`contextForBooking(db, partnerRow, booking)`）。今 `AnyPartner`（`booking.ts` 863 行）で `facility_name` を任意にしている箇所がこれに当たる。
- 管理画面も同じ: `requireStaffPartner(db, facilityId, partnerId)` は「取引先がこの施設でオン」を検査し、合成した `PartnerContext` を返す（施設タブ＝`ab_fac`）。

### 7.10 REST API（API キー）

- `GET /api/partner/v1/rates?facility=<slug>` を足す【提案】。オンの施設が1つなら省略可（その施設）。2つ以上で省略なら **400 `facility_required`**（施設一覧を `facilities` に入れて返す）。`GET /api/partner/v1/facilities`（オンの施設の `slug` / `name`）を足す（任意）。
- API キーは取引先共通のまま。

### 7.11 メール文面の施設名

- **予約・取消・請求失敗**: 差出人名＝**その予約の施設名**（`booking.facility_id` → `partnerMailSender(db, facilityId)`）。既に台帳の施設で送っているので変更は §7.9 の `contextForBooking` に乗せるだけ。
- **月次請求書**（全施設分1枚・N3）: 差出人名＝**発行者名（株式会社山人）**、Reply-To＝`primary_facility_id` の施設の予約用アドレス。件名は「【株式会社山人】○月分ご請求書（PI-…）」。1施設だけの請求書でも同じ（差出人を施設名にすると、2施設の月だけ差出人が変わって紛らわしい）。
- **パスワード設定リンク・子ユーザー作成のメール**（`staff.ts` 154、`portal-users.ts` 64）: 今は取引先行の施設名。統合後は「施設」が1つに決まらないので、**`primary_facility_id` の施設名**を差出人にし、本文は「山人（山人-yamado-・山人-oga-）取引先ページ」のようにオンの施設を列挙【提案】。1施設ならその施設名（今と同じ）。
- 宿への通知先 `notifyEmails` は施設設定（§4.2）なので、予約の施設の宛先に届く。

### 7.12 管理画面 `/admin/partners`

- **一覧**: 「今の施設（`ab_fac`）でオンの取引先」を既定にし、「すべての取引先を表示」のトグル（テナント全体・施設バッジ付き）。新規作成は「今の施設でオン・他はオフ」で作る。
- **詳細 `/admin/partners/[id]`**: 上から
  1. 共通: 取引先名・種別・連絡先・限定 URL・公開期間・公開／停止・PMS 顧客マスタとの紐づけ（名義・与信設定・超過時の挙動・デポジット）・支払方法と請求条件（`paymentOptions` / 自由入力 / 宛名 / 期限）・**早期決済割と受付ルールの共通の既定**（N6）・覚書・ログイン ID・API キー・保存カード枚数・**請求書（全施設分1枚・プレビュー／発行／再送／取消・施設別小計）**（N3）・アクセスログ・削除／統合
  2. **施設タブ**（オン／オフを含む。既定のタブは `ab_fac` の施設）: オン／オフ・予約受付・特別レート（ルール編集＋プレビュー）・残室表示・先行案内・何日先まで・PMS の支払方法・プラン名（取引先向け）・特典・案内文・宿側の通知先・公式特典・**早期決済割と受付ルールの上書き**（各項目に「共通の既定を使う〔値を表示〕／この施設だけ変える」・N6）・与信の今後 12 か月の表・確認ページを開く（`?f=`）・予約一覧（この施設）
- `ab_fac` を切り替えると施設タブが変わるだけで、詳細から一覧へ戻さない（今の `requireStaffPartner` の 404 は「この施設でオンでない取引先」に限る。オフの施設タブも表示はでき、オンにできる）。
- 施設設定の保存（`savePartnerFacility`）と共通設定の保存（`savePartner`）を別アクションにする（片方の保存でもう片方の未保存の編集が消えないように。Phase 2〜3b で紐づけ・名義・与信を「押した時点で保存」にした流儀に合わせる）。

---

## 8. 段階的な移行計画【提案】

| Phase | 内容 | 利用者から見える変化 | 戻せるか |
|---|---|---|---|
| **A. DB（互換・読み替えなし）** | `rms_partner_facilities` 作成・バックフィル（§6.2）・`rms_partner_url_token_aliases`・`rms_partner_invoices` の `facility_id` NULL 許容と `facility_ids`・`rms_partner_invoice_issuer` とバックフィル・`rms_partner_documents.facility_id` NULL 許容・`rms_partner_create_booking` が `p.facility_id` を受ける（**無ければ従来どおり `rms_partners.facility_id`**）・`_rms_partner_effective_settings`（N6 の上書き規則を含む） | 無し | 可（表を落とすだけ） |
| **B. Book の読み替え** | §7.9 の合成 `PartnerContext`・`store.ts` の読み書きを新表へ・`normalizePartnerBookingSettings(common, facility)`（上書き規則）・管理画面の施設タブ（§7.12）・保存の振り分け・API の `facility` パラメータ・**請求書を取引先×月の1枚に（§7.1: 発行元を会社で1つ・紙面 version 2・cron の取引先ループ・予定請求の施設別小計）**。取引先ページは **まだ1施設固定**（`primary_facility_id`） | 管理画面の見た目が変わる。請求書の発行元設定が共通になる。取引先ページは変わらない | 可（コードを戻す。A の表は残しても無害） |
| **C. 取引先ページの切替** | §7.8 のクッキー・`?f=`・ヘッダーの切替・予約入力の hidden 施設・予約一覧の施設列・請求書一覧の施設名・メールの `?f=`・特商法の切替 | 2施設オンの取引先に切替が出る | 可 |
| **D. 統合と旧列の削除** | `rms_partner_merge`・管理画面の統合操作（§6.4）・`rms_partners` の旧列削除（`facility_id` / `pricing` / `booking_enabled` / `max_days_ahead` / `show_inventory` / `include_advance` / `payment_method_id`）・`rms_partner_billing_settings` の削除・RLS 差し替え（§5.2）・`rms_partner_create_booking` のフォールバック削除 | 無し | 列削除後は不可（バックアップ） |
| E（任意） | 取引先ユーザーの施設制限（§7.7）・施設ごとの覚書・API `facilities` | | |

**実施の時期**: 本番の取引先予約が 0 件・取引先 2 件の今が最も安い。保存カード・添付の実装が落ち着いてから A→B を一気に行い、C は「2施設で売る取引先が実際に出る」まで待ってもよい（1施設の取引先には C の変更が見えない）。

---

## 9. リスク

| リスク | 影響 | 対策 |
|---|---|---|
| `rms_partner_create_booking` の書き換え（施設設定の合成を SQL と TS の両方で持つ） | 見積と確定で額・条件がずれる | `_rms_partner_effective_settings` と `normalizePartnerBookingSettings` を同じ規則にし、Phase 3b と同様に両側のテストに同じケースを入れる。A の段階では `p.facility_id` 省略時に従来経路を残す |
| 旧列と新表の二重管理 | どちらが正か分からなくなる | バックフィル後は **旧列を書かない**（`store.ts` の UPDATE から外す）。Phase D で落とす |
| `PartnerContext` の合成を忘れた経路（例: cron・Webhook・請求失敗メール）が `rms_partners.facility_id`（null になりうる）を読む | 施設名が空・RPC に null | Phase B で `grep facility_id` の全箇所（§3.4）を `contextForBooking` に寄せる。Phase D で列を落とすと型で検出できる |
| 施設切替の直後に予約入力の施設がずれる | 別施設の部屋で見積・確定 | `/book` 系は **フォームの `facility_id`** で動かし、見積の応答に施設を含めて確認画面に出す（§7.8） |
| 請求書を1枚にまとめる（N3）と発行元が会社で1つになる | 施設ごとに口座を分けたい・施設名入りの請求書が欲しい、という要望と衝突する。消費税は1枚で1回の端数処理なので施設小計の消費税と1円ずれる | 発行者欄に施設名を出さず、明細の施設グループと施設小計で施設を示す。紙面に端数の注記。要望が出たら「施設ごとに発行」へ戻す判断（§10-N3 の注記） |
| freee の入金消込（1振込・部門2本の売掛） | 経理の手作業が増える | 施設別小計を管理画面と CSV で出す（§7.1）。Book → freee の自動連携は範囲外のまま |
| version 1（施設ごと）の発行済み請求書 | 紙面の再描画・取消・再送で壊れる | `document.version` で描画を分岐。PROD は 0 件なので実害は無いが、DEV のテスト行で確認 |
| N6 の上書きキーが空文字や 0 で「未設定」と誤読される | 共通の既定に戻ったつもりが施設の値が残る（逆も） | 「キーの有無」で判定し、管理画面は「共通の既定を使う」でキーを削除する。純関数のテストに 0・空・未定義のケースを入れる |
| 統合で保存カードが失われる | 取引先の再登録 | §6.4-6 の案内・未請求の予約があれば断る |
| 統合で `core.stays.metadata.rms_partner_id` が旧 id のまま | 与信の取込前カウントが落ちる・PMS の「取引先払い」判定 `source='rms_partner'` は id を見ないので無事 | 統合関数で `core.stays` / `booking.bookings` の metadata を付け替え（§7.5） |
| RLS の変更（`rms_partners` を for select に） | 他アプリが `authenticated` で書いていれば止まる | 着手前に autumn-pms / autumn-rms / yamado-one で `rms_partners` の書き込みが無いことを確認（§3.6 では読みも無い） |
| `autoChildLoginId` の接頭辞が施設 | 統合後に `oga-xxx` と `yamado-xxx` が混在 | 接頭辞を取引先の短縮名（`name` のローマ字か `login_id` のマスタの接頭辞）に変える。既存 ID は変えない |
| `isBookFacility` の範囲外の施設 | 施設設定を作れてしまう | `rms_partner_facilities` の insert を Book のサーバで `FACILITY_UUID` の範囲に限る（今の `withFacility` と同じ） |

---

## 10. 決定事項（2026-10-07・ユーザー回答）

| # | 論点 | 決定 | 本文への反映 |
|---|---|---|---|
| N1 | 取引先ページの施設の持ち方 | **A. クッキー＋`?f=`**（推奨どおり） | §7.8 |
| N2 | 予約受付の親スイッチ `booking_enabled_master` | **作らない**（推奨どおり） | §4.1・§4.3 |
| N3 | 月次請求書 | **全施設分を1枚にまとめる。明細は施設別にグルーピング（施設ごとの小計）**（推奨と異なる） | §3.3・§5.3・§6.2・§7.1（発行元は会社で1つ・登録番号は法人に1つ・振込先は1つ・紙面 version 2・freee は PMS の部門で売上が立ち入金消込は施設別小計で按分・一意性は `(partner_id, period)` のまま・既存の施設ごとの請求書は version 1 として残す）・§7.11・§7.12・§8・§9・§11・§13。**注記**: 施設ごとに口座を分けたい要望が出た場合は「1枚にまとめる」と両立しないので、そのときは施設ごとの発行へ戻す判断になる |
| N4 | 覚書 | **共通1つ**（推奨どおり） | §7.3 |
| N5 | 取引先ユーザーの施設制限 | **作らない**（推奨どおり） | §7.7 |
| N6 | 早期決済割（`prepayDiscount`）・受付ルール（`leadDays` / `cutoffHour` / `maxRooms` / `maxNights` / `cancelDays`） | **施設ごとに設定できるようにする**（推奨と異なる）。持ち方は **取引先共通の既定＋施設で上書き**（推奨。理由は §4.2） | §4.2・§5.1・§6.2・§7.12・§11・§13 |
| N7 | 旧 `rms_partners.facility_id` | **Phase D まで NULL 許容で残し、既定の施設は `primary_facility_id`**（推奨どおり） | §5.2 |
| N8 | 管理画面の一覧の既定 | **`ab_fac` の施設で絞る＋「すべて」トグル**（推奨どおり） | §7.12 |
| N9 | 1つもオンが無い取引先 | **ログイン可・料金と予約だけ案内文**（推奨どおり） | §7.8 |
| N10 | 統合で `is_master` が2人以上 | **そのまま**（推奨どおり） | §6.4 |
| N11 | API の `facility` 省略時（2施設オン） | **400 `facility_required`**（推奨どおり） | §7.10 |
| N12 | Phase C の時期 | **A/B と同時に作り、2施設オンの取引先でだけ現れる**（推奨どおり） | §8 |

### 10.1 決定で新たに出た細部（未決・推奨つき）

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| M1 | 1枚の請求書の発行者欄の住所・TEL | 本社（西和賀）／既定の施設（`primary_facility_id`）／両施設を併記 | **本社（西和賀）を発行元設定に入れる**（会社で1つの設定なので取引先によらず同じ。施設の連絡先は明細の施設見出しに小さく出す） |
| M2 | 発行元が未設定・振込先が空のときの通知先 | 発行元設定に `notify_emails` を持つ／既定の施設の `notifyEmails` | **発行元設定に `notify_emails`**（施設に依らない通知なので置き場を施設設定にしない） |
| M3 | 施設小計の消費税の扱い | 施設小計にも消費税を出す（1円ずれうる）／施設小計は税込と入湯税だけ・消費税は全体のみ | **施設小計は税込・入湯税・キャンセル料・請求額だけ**（消費税は全体で1回。freee の按分は税込額で行える） |
| M4 | 予定請求（`/admin/partners/invoices`）の絞り込み | `ab_fac` の施設の予約を含む取引先だけ／全取引先 | **`ab_fac` で絞る＋「すべて」**（一覧の既定 N8 と同じ流儀。金額は常に全施設） |
| M5 | 施設別小計の CSV（freee 用） | 作る／作らない | **作る（Phase B の請求書作業に含める・小さい）** |
| M6 | N6 の上書きの単位（`prepayDiscount`） | オブジェクトごと／`type` と `value` を別々に | **オブジェクトごと**（`type='none'` を施設だけに置けるように） |

---

## 11. 実装の分割案（Opus エージェントに渡す粒度）

依存: S1 → S2 → (S3 ∥ S4 ∥ S5) → S6 → S7。S1 と S2 は同じ人でもよい。

| # | 内容 | 触るもの | 受け入れ |
|---|---|---|---|
| **S1 autumn-shared migration（Phase A）** | `rms_partner_facilities`・バックフィル・`rms_partner_url_token_aliases`・`rms_partner_invoices` の `facility_id` NULL 許容と `facility_ids`・`rms_partner_invoice_issuer` とバックフィル・documents NULL 許容・`_rms_partner_effective_settings`（N6 の上書き規則）・`rms_partner_create_booking` の `p.facility_id`（省略時フォールバック） | `supabase/migrations/<実UTC秒>_rms_partner_facilities.sql`（`git pull` 後・`new-migration.sh`。関数の最新版を確認して 1 ファイルで `create or replace`） | `migration list --linked` 両側に version・件数一致・既存の予約フローが `p.facility_id` 無しで通る・発行元が1行 |
| **S2 store と合成（Phase B 前半）** | `store.ts`: `PartnerCommonRow` / `PartnerFacilityRow` / 合成 `PartnerContext`・`listPartnerFacilities`・`savePartnerFacility`・新表の読み書き、`lib/partner-booking.ts`: `normalizePartnerBookingSettings(common, facility)`（キーの有無で上書き・N6）＋ `splitPartnerBookingSettings`（保存時の振り分け）＋テスト（0・空・未定義のケース）、`portal.ts`: 施設の選択（§7.8 の決め方。UI はまだ）、`booking.ts`: `contextForBooking` | `lib/server/partners/store.ts`・`portal.ts`・`booking.ts`・`lib/partner-booking.ts`＋テスト | 1施設の取引先で全画面・全メールが従来どおり（回帰）。`grep "partner.facility_id"` の全箇所が合成経由 |
| **S3 管理画面（Phase B 後半）** | 一覧のトグル・詳細の共通／施設タブ・早期決済割と受付ルールの「共通の既定を使う／この施設だけ変える」・保存アクションの分離・確認ページの `?f=`・統合は S6 | `routes/admin/partners/**`・`staff.ts`・`staff-form.ts`＋テスト | §13 の管理画面の項目 |
| **S4 取引先ページ（Phase C）** | ヘッダーの切替・`POST /p/[token]/facility`・クッキー・`?f=`・`/book` の hidden 施設・予約一覧の施設列・請求書一覧の施設名・特商法の切替・ホーム画面名 | `routes/p/[token]/**`・`legal.ts`・`portal.ts` | §13 の取引先ページの項目 |
| **S5 請求書（N3・Phase B）** | `partner-invoice.ts`: `InvoiceLine.facilityId/facilityName`・`InvoiceDocument` version 2（`facilities[].totals`）・施設 → 支払方法の2階層グループ・施設小計・1施設なら従来の紙面・version 1 の描画維持＋テスト。`invoices.ts`: 発行元を `rms_partner_invoice_issuer` から・`loadTargetBookings` の施設条件を外す・`facility_ids`・同月に version 1 が issued なら断る・cron の取引先ループ・通知先 `notify_emails`・差出人は発行者名。管理画面: 請求書の設定を共通に・予定請求の施設別小計と CSV・取引先詳細の請求書を共通セクションへ | `lib/partner-invoice.ts`＋テスト・`lib/server/partners/invoices.ts`・`invoice-pdf.ts`・`routes/admin/partners/+page.server.ts`・`invoices/**`・`routes/admin/partners/[id]/invoices/**`・`routes/p/[token]/account/invoices/**` | §13 の請求書の項目 |
| **S5b API・メール** | `/api/partner/v1/rates` の `facility`・`/facilities`・メール内リンクの `?f=`・設定メールの差出人（`primary_facility_id`）・`autoChildLoginId` | `routes/api/partner/v1/**`・`mail.ts`・`portal-users.ts`・`staff.ts` | §13 の API・メールの項目 |
| **S6 統合（Phase D 前半）** | `rms_partner_merge`（migration）・管理画面の統合操作・保存カードのガードと案内・`core.stays` / `booking.bookings` の metadata 付け替え | autumn-shared 1 本・`routes/admin/partners/[id]`・`store.ts` | DEV で2行を作って統合 → 子表・トークン別名・与信カウントが正しい |
| **S7 仕上げ（Phase D 後半・親が行う）** | 旧列・`rms_partner_billing_settings` の削除・RLS 差し替え・フォールバック削除・HANDOFF.md（本節とチェックリスト）・`package.json` ×2（**MAJOR**: データモデルの後方互換を壊す） | autumn-shared 1 本・`HANDOFF.md`・`package.json` | `npm run check`・`npm test`・本番で §13 を流す |

依存の補足: S5（請求書）は S2 の合成に依存しない（台帳の `facility_id` と発行元の新表だけを読む）ので、S2 と並行できる。

---

## 12. 並行実装中の機能が統合を妨げないための注意

### 12.1 保存カード（`docs/saved-cards.md`・未コミットの `lib/saved-cards.ts`・`booking.ts` 差分・migration `20261007022727`）

- **そのままで良いこと**: Customer は `rms_partners` の行に1つ・`metadata` は `partner_id`・冪等キー `rms-partner-shared-customer-${partner.id}-${mode}`。施設を前提にしていない（migration のコメントも「統合後は取引先で1つ」）。
- **守ること**:
  1. `resolvePartnerCustomer(db, partner, …)` は **`partner.id` と `partner.name` / `contact_email` だけ**を使い、`partner.facility_id` / `facility_name` を Customer の `name` / `description` / `metadata` に **入れない**（入れると統合後に「男鹿の Customer」が残る）。
  2. Customer の `email` は取引先の連絡先（N11）。施設の予約用アドレスにしない。
  3. 「お支払いカード」タブの一覧・削除ガード（§7.5 の `rms_partner_bookings` 検索）は `partner_id` で引く。`facility_id` で絞らない（統合後は2施設の予約が同じカードを使う）。
  4. アクセスログの `detail` に施設を書かない（カードは取引先のもの）。
  5. Stripe の Webhook・`checkSetupIntent` の `customer` 一致は台帳の値で検査する（済み・`booking.ts` 差分 753 行）。統合で Customer が変わっても台帳の写しで動く。
  6. **統合のガード**（§6.4-6）が要るので、`rms_partner_bookings.stripe_customer_id` を「取引先共有か予約ごとか」で区別できるように、**共有 Customer を使った予約は `card_label` か `detail` に `shared_customer: true` を残す**か、`rms_partners.stripe_customer_id` と比較して判定する（後者で足りる。列は増やさない）。

### 12.2 添付ファイル（`docs/partner-booking-attachments.md`・migration `20261007022950` は本文未作成）

- **そのままで良いこと**: 台帳 `rms_partner_booking_attachments` は `partner_booking_id` で予約に付き、`facility_id` は予約の施設の写し。Storage パス `partner-booking/<facility_id>/<partner_id>/<uuid>` は予約の施設で切る（統合後も予約は1施設）。電文は台帳の施設で出る。
- **守ること**:
  1. 仮置き（`partner_booking_id is null`）の行の `facility_id` は、**予約入力画面の施設**（§7.8 の hidden `facility_id`）から取る。`partner.facility_id`（統合後は「選択中」で、入力途中に切り替わりうる）を読まない。確定時の束縛（RPC）で `facility_id` が予約の施設と一致することを検査する（不一致なら束縛しない・掃除に回す）。
  2. 掃除（孤児）・取引先削除時の一括削除は `partner_id` で引き、`facility_id` で絞らない。
  3. `rms_partner_create_booking` の差し替え（`p.attachment_ids` の束縛）は、本設計の差し替え（`p.facility_id`）と **同じ関数**を触る。先に入った方の最新版を `git pull` で確かめて 1 ファイルで `create or replace` する（両設計書に同じ注意あり）。
  4. PMS の写し行は `facility_id` を電文から取る（設計どおり）。変更不要。
  5. 添付の件数を管理画面の予約一覧（`/admin/partners/[id]`）に出すとき、一覧が施設タブの中に入る（§7.12）。`partner_id` ＋ `facility_id` で引く形にしておくと移動が楽。

### 12.3 共通

- 新しい RPC・列・索引に **「取引先 × 施設で一意」が要るもの**（請求書の既存索引のように）を足すときは、最初から `facility_id` を含める。
- 新しいコードで `partner.facility_id` を読むときは、**「予約・請求書から決まる施設」なら台帳の `facility_id`**、「画面の施設」なら `PartnerContext`（合成後）の `facility_id` と、どちらかを意識して書く（§7.9 の `contextForBooking` に乗せやすい）。
- 取引先の「名前」「連絡先」「ログイン ID」「Customer」「紐づけ先」「請求書（1枚）」は取引先共通。これらを施設で分けるような列・キーを新設しない。
- 添付・保存カードの設計で **請求書の `facility_id`** を参照する箇所があれば（例: 請求書の添付・請求書ごとのカード請求）、統合後は null になりうる（§7.1）ので `facility_ids` か明細の施設を見る。

---

## 13. テストチェックリスト（実装時に HANDOFF.md へ転記する）

### DB・移行
- [ ] Phase A 適用後、`rms_partner_facilities` が `rms_partners` と同数・`pricing` と `facility_settings` の中身が元の行と一致
- [ ] `rms_partners.booking_settings` から `planNames` / `perks` / `notice` / `notifyEmails` / `showOfficialPerks` が消え、他のキーは残っている
- [ ] 既存の予約フロー（後払い・予約時決済・デポジット・チェックアウト日決済）が Phase A 直後（Book 未変更）でも通る
- [ ] `rms_partner_invoice_issuer` が1行で、登録番号・振込先が従来の男鹿の設定と同じ。住所・TEL を本社に直せる

### 請求書（全施設分1枚・N3）
- [ ] 西和賀・男鹿の両方にチェックアウトのある月 → 取引先に請求書が **1枚**。ご請求書の明細が施設の見出し → 行 → 施設小計（10%対象税込・入湯税・キャンセル料・請求額）の順で、最後に全体の合計と税率ごとの区分
- [ ] 全体の消費税が「請求書1枚で1回の切り捨て」のまま（施設小計の合算と1円ずれても全体が正・注記が出る）
- [ ] ご利用明細書が 施設 → お支払方法（ご請求の対象を先）の2階層で、施設小計・全体の合計が合う
- [ ] 1施設だけの月は施設の見出し・小計が出ず、従来の紙面と同じ
- [ ] 取消の行・デポジット不足分・事務手数料を含む返金しない額が、その予約の施設のグループに入る
- [ ] 発行者欄に会社名・住所・TEL・登録番号・振込先が1組（施設名は出ない）。PDF が A4 で崩れない
- [ ] 月末 cron: 取引先ごとに1枚発行・送信。差出人名が発行者名、Reply-To が既定の施設の予約用アドレス。発行元の振込先が空なら全取引先を止めて `notify_emails` に1通
- [ ] 同じ取引先・同じ月に施設ごとの請求書（version 1・DEV のテスト行）が issued で残っていると、1枚の発行が理由つきで断られる。取消すると発行できる
- [ ] version 1 の発行済み請求書をダウンロード・再送・取消しても紙面が変わらない
- [ ] 管理画面「請求書の設定」が `ab_fac` を切り替えても同じ内容（共通）。予定請求の一覧に取引先ごとの行と施設別小計の列、CSV が出る（期間・取引先・施設・税込・入湯税・キャンセル料・請求額）
- [ ] 取引先ページ「ご請求書」の行に載っている施設名が出る。PDF が従来どおり開ける

### 早期決済割・受付ルールの施設上書き（N6）
- [ ] 施設タブで「共通の既定を使う」のままなら共通の値（表示される）で見積・受付締切が動く
- [ ] 男鹿だけ早期決済割を 5% → 男鹿の予約時決済だけ 5% 割引、西和賀は共通のまま。特商法・予約入力の割引の表示も施設ごとに変わる
- [ ] 男鹿だけ `cancelDays` を 3 → 男鹿の予約だけ画面から取消せる期限が変わる。`leadDays` / `cutoffHour` / `maxRooms` / `maxNights` も同様
- [ ] 「共通の既定を使う」に戻すと `facility_settings` からキーが消え、共通の値に戻る（0 や空を入れても「未設定」にはならない）
- [ ] 共通の既定を変えると、上書きしていない施設だけ変わる

### 管理画面
- [ ] 一覧: `ab_fac` の施設でオンの取引先だけ。「すべて」で他施設の取引先も施設バッジ付きで出る
- [ ] 新規作成: 今の施設でオン・他はオフ
- [ ] 詳細: 共通セクションと施設タブ。`ab_fac` を切り替えると既定のタブが変わり、一覧へ戻されない
- [ ] 施設タブでオン／オフ・予約受付・特別レート・プラン名・特典・案内文・通知先・早期決済割と受付ルールの上書きを保存 → その施設の取引先ページにだけ反映。もう一方の施設は変わらない
- [ ] 共通セクション（名前・支払方法・請求条件・早期決済割と受付ルールの既定・紐づけ・与信設定・覚書）の保存 → 両施設の取引先ページに反映（上書きしている施設はその値のまま）
- [ ] 取引先詳細の「請求書」が共通セクションにあり、施設タブを切り替えても同じ請求書（全施設分）が出る
- [ ] 施設設定の保存で共通の未保存の編集が消えない（逆も）
- [ ] スタッフ（閲覧のみ）はどちらも変えられない
- [ ] 「確認ページを開く」が施設タブの施設で開く
- [ ] 統合: 同じ施設が重なる取引先は候補に出ない。統合後に子表・トークン別名・保存カードの案内・アクセスログ

### 取引先ページ
- [ ] 1施設オンの取引先: 画面が従来と同じ（切替が出ない・URL 同じ）
- [ ] 2施設オン: ヘッダーに切替。切り替えると料金カレンダー・お部屋・プラン・予約入力がその施設に。差し色・ホーム画面名が変わる
- [ ] 切替の選択が再読み込み・再ログイン後も保たれる（クッキー）。`?f=oga` 付きのリンクで開くと男鹿になり、以後も男鹿
- [ ] 予約入力の途中で切替 → 確認ダイアログ。確定した予約の施設が入力時の施設（別タブで切り替えても変わらない）
- [ ] 予約一覧に両施設の分が施設の列付きで出る。取消・支払・添付は予約の施設で動く
- [ ] 特商法の表記が選択中の施設の事業者で出て、他施設へのリンクがある
- [ ] オンが1つも無い取引先: ログインでき、料金・予約は案内文。アカウント・覚書は使える
- [ ] 施設をオフにした直後、その施設を見ていた取引先が次の操作でもう一方の施設へ切り替わる（オフの施設で予約できない）
- [ ] 旧トークン（統合で捨てた方）で開く → 本トークンへ 303・再ログインの案内

### API・メール
- [ ] `GET /api/partner/v1/rates`: 1施設なら従来どおり。2施設で `facility` 無しは 400・`facility=oga` で男鹿の料金
- [ ] 予約確認・取消・請求失敗メールの差出人名がその予約の施設名。本文のリンクに `?f=`
- [ ] 設定リンクのメール（2施設オン）の差出人が既定の施設・本文にオンの施設の列挙
- [ ] 宿への通知が予約の施設の `notifyEmails` に届く（もう一方の施設の宛先には届かない）
- [ ] 与信の残り室数が施設ごとに別に出る（PMS の `/guests/<id>/credit` と施設ごとに一致）

---

## 14. 補足（調査で分かった注意点）

- 取引先系は `public.rms_*`（autumn-rms からの移設）で、autumn-book の CLAUDE.md の「`book` スキーマ専用」とは別の慣例。本設計も `public` に足す（`docs/partner-pms-customer-link.md` §10 と同じ判断）。
- `rms_partners_all` の RLS は施設単位だが、Book は service_role で読み書きし、スタッフの施設アクセスはアプリ側（`staff.ts`）で RPC を使って確かめている。RLS の書き換えは「万一 `authenticated` で読まれたとき」の守りで、動作には効かない。
- `rms_partner_accounts.login_id` は全体で一意（取引先ごとではない）。統合でも衝突しない代わりに、子ユーザーの自動 ID（施設接頭辞）を見直す必要がある。
- `rms_partner_sessions` のクッキー path が `/p/<token>` なので、トークンが変わらない限りセッションは統合後も生きる。確認モードのクッキーも `partnerId` 署名で施設を含まない。
- PMS は `rms_partners` を読まず、電文と `core.stays.metadata.rms_partner_id` だけを見る。PMS 側の変更は不要だが、統合で id が消えるときは metadata の付け替えが要る（§7.5）。
- 保存カードの migration（`20261007022727`）は main にあるが PROD 未適用（2026-10-07 時点で列が無い）。添付の migration（`20261007022950`）はヘッダ 5 行だけで本文が無い。どちらも本設計の migration（`rms_partner_facilities`）より前のタイムスタンプになるので、適用順は自然に「保存カード → 添付 → 本設計」になる。本設計の `rms_partner_create_booking` 差し替えは、添付側の差し替え（`p.attachment_ids`）を取り込んだ最新版の上に作る。
- `rms_partner_portal_source` の isolate 内キャッシュ（`rates.ts` 66 行・`施設|期間`）は施設単位なので、切替で混ざらない。`contents.ts` のキャッシュも施設単位。
- 請求書（N3）: 適格請求書の登録番号は法人に1つ（`T3400001006564`）で、PROD の発行元設定は男鹿の1行だけ。Book は freee に送らず、施設別の売上は PMS が freee の部門（`section_id`）で立てる。1枚にまとめても売上の施設別計上は変わらず、変わるのは入金の消込（1振込を部門ごとの売掛に按分）だけ。現行の一意索引 `(partner_id, period) where issued` は「1取引先・1月・1枚」なので統合後にそのまま使える。
