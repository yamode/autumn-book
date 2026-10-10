# 取引先ページの団体予約（問い合わせ → 宿が回答 → 承諾で予約）— 設計書

> 作成: 2026-10-10（autumn-book v0.114.5 時点・読み取り調査のみ。コード・migration・DB 書き込みは未着手）
> 対象リポ: autumn-book（取引先ページ・管理画面）／autumn-shared（migration・DB 関数）／autumn-pms（変更なし・電文の受け側の確認のみ）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・表・列）を付ける。提案には【提案】を付ける。
> 関連: `docs/partner-pms-customer-link.md`（紐づけ・名義・与信・デポジット）、`docs/partner-multi-facility.md`（複数施設化・S1〜S7 済）、`docs/partner-booking-attachments.md`（添付）、`docs/auth-hardening.md`（aal2・service_role）、`docs/vip-member-page.md`（将来の種別 `member`＝特別会員）

---

## 1. 目的と範囲

ユーザー依頼（要旨）: 取引先ページ（`/p/[token]`）で、取引先の種類が **旅行会社**（`rms_partners.kind='agent'`）のときに **団体予約** を使えるようにする。旅行会社から来る次のような問い合わせを、UI で手早く次々入れられるようにしたい。

```
団体名：270413精華旅行社
日程：2026年04月15日（木）~ 1泊
人数：大人10名
客室数：5部屋
部屋タイプ：ジュニアスイート
宿泊条件：一泊朝夕食（18:30）
料金：ご回答をお願いします。
お支払い：ペイメントリング
交通機関：中型バス一台
```
（同じ条件で日付だけ 4/17 の件がもう1件並ぶ、という形で来る）

ユーザーが決めたこと（本書はこれを前提に設計する）:

| # | 決定 |
|---|---|
| D1 | **流れ＝問い合わせ → 宿が回答**。取引先は条件を送るだけ。宿が管理画面で可否（必要なら料金）を回答し、取引先が承諾すると予約になる。**PMS への登録は確定（承諾）時** |
| D2 | **料金＝取引先料金で自動計算**し、問い合わせ時点で取引先に見せる。宿の回答時に料金を変えられるかは設計で提案（既定は自動計算額のまま回答） |
| D3 | **複数件をまとめて送れる**。1件入れたら「複製して日付だけ変える」で次々足し、一括送信。団体名・条件は引き継ぐ |
| D4 | **支払方法・交通機関・夕食時間＝選択肢＋自由記入**。支払方法は取引先ごとに設定した候補（例: ペイメントリング・後払い）から選ぶ。交通機関・夕食時間は選択肢＋自由記入。PMS の予約メモに載せる |

やらないこと（範囲外）:

- 個人予約（既存の `/p/[token]/book`）の変更。団体予約は**別の入口**として足し、個人予約の画面・確定処理は触らない
- 団体予約のオンライン決済（Stripe）。団体は後払い・取引先の自由入力の支払方法だけ（§7.4・N3）
- 部屋割り・名簿の入力（添付ファイルで受ける・§7.7）
- PMS 側の画面変更（既存の電文で届く。団体の情報は要望・備考に載る）
- 特別会員（`kind='member'`・`docs/vip-member-page.md`）の実装。ただし種別の判定は矛盾しない形にする（§3.6・§8.1）

---

## 2. 用語

| 用語 | 意味 | 実体 |
|---|---|---|
| 旅行会社 | 取引先の種類 `agent`（表示「旅行会社・エージェント」） | `public.rms_partners.kind`（`store.ts` L65 `PartnerKind = 'agent' \| 'corporate' \| 'other'`。将来 `'member'` が増える） |
| 団体の問い合わせ（照会） | 取引先が送る「この条件で受けられるか」の1件。**1件＝1施設・1日程（チェックイン日＋泊数）・1部屋タイプ・1プラン** | 新表 `public.rms_partner_group_inquiries`（§5.1） |
| 束（バッチ） | 一括送信した複数の照会のまとまり（同じ団体名・条件で日付だけ違う等）。表示の単位であり、状態は照会ごとに独立 | 同表の `batch_id` |
| 回答 | 宿が照会に返すもの: 受けられる／条件付きで受けられる／受けられない。料金・一言・回答の有効期限を含む | 同表の `answer_*` 列 |
| 承諾 | 取引先が回答を受け入れること。この時点で既存の予約作成（`rms_partner_create_booking`）を呼び、台帳・PMS に予約ができる | `status='accepted'`・`booking_id` |
| 自動計算額 | 照会時点の取引先料金（`rms_partner_portal_prices` の最終料金）で計算した宿泊料金＋入湯税 | `quote_*` 列（スナップショット） |
| 回答額 | 宿が回答で示した料金（既定は自動計算額のまま） | `answer_total` 等 |
| 取引先予約（個人予約） | 既存の `/p/[token]/book` から入る予約 | `public.rms_partner_bookings` |

---

## 3. 現状（調査結果）

### 3.1 取引先の種類（kind）

- `public.rms_partners.kind text not null default 'agent' check (kind in ('agent','corporate','other'))`（autumn-shared `20260926025319_rms_partner_rate_portal.sql` L35）。
- Book 側: `PartnerKind` / `PARTNER_KIND_LABELS`（`lib/server/partners/store.ts` L65-66）、管理画面のフォームは `parsePartnerKind`（既定 `agent`・`staff-form.ts` L30）。
- **kind で機能を出し分けている箇所は現状ほぼ無い**（管理画面の見出し下に種類名を出すだけ・`admin/partners/[id]/+page.svelte` L804）。与信は kind ではなく「紐づけ先の PMS 顧客が `guest_type='group'`（旅行会社）か」で判定している（`docs/partner-pms-customer-link.md` §3.4）。
- 将来: `docs/vip-member-page.md` §4.1 が `kind='member'`（特別会員・表示名は 2026-10-10 に「特別会員」で確定）を追加する計画（未実装）。member では法人向けの欄（請求・与信・PMS 顧客の紐づけ・アカウント・API キー・覚書）を隠す方針。

### 3.2 取引先ページのメニュー構成

- `routes/p/[token]/+layout.svelte` L44-53 の `MENU` 定数（料金カレンダー・お部屋・プラン・料金表・予約一覧・覚書・アカウント）。「予約一覧」は `portal.bookingEnabled` のときだけ（`menu` の `$derived`）。
- メニュー切替の先出し（v0.109.0）は `MENU` に載っているパスだけが対象（`menuPathOf`）。新しいメニューは `MENU` に足せば同じ振る舞いになる。
- `portalHeader(partner, session)`（`portal.ts` L331）が画面へ渡す `portal`（取引先名・施設・bookingEnabled・ログインID・is_master・preview 等）。kind は今は渡していない。
- アカウントのタブ: `routes/p/[token]/account/`（マイページ・`cards`・`invoices`・`security`・`users`）。

### 3.3 個人予約の流れ（再利用する土台）

出典: `routes/p/[token]/book/+page.server.ts`、`book/reserve/+server.ts`、`lib/server/partners/booking.ts`、`lib/partner-booking.ts`

```
/p/[token]/book（load）
  quotePartnerBooking(db, partner, {roomCode, planCode, planName, checkIn, nights, rooms:[{adults}…]}, {credit:true})
    ├ loadPartnerRates（rms_partner_portal_prices → 最終料金。無理なら従来の計算）
    ├ roomTypeRemaining（RPC rms_partner_room_type_remaining・部屋タイプの残室の最小値）
    ├ bathTaxRule（pms.facility_billing_settings）
    └ partnerStayCredit（受付枠・与信。読めなければ null）
  → BookingQuote { rooms[{adults, nights[{date, unit_price}], subtotal}], total, bathTax, remaining, credit, paymentChoices, deposit … }

確定（後払い＝form action default／オンライン決済＝/book/reserve）
  createPartnerBooking(db, partner, {id, login_id}, input, {ip, origin, allowSavedCards})
    ├ 受付（facility_available・booking_enabled・支払方法 resolvePaymentOption・canBookFor・maxNights・maxRooms）
    ├ 宿泊者の検証（姓・電話必須）・質問の回答・男女内訳・予約者（booker）・交通手段・お迎え時間
    ├ quotePartnerBooking をもう一度（金額はサーバで決める）
    ├ RPC rms_partner_create_booking(p jsonb)   ← 施設 advisory lock・残室の数え直し・与信判定・台帳＋core.stays＋booking.bookings＋PMS 電文
    ├ attachBookingExtras（台帳 detail.booker / transport / perks）・snapshotCancelPolicy・saveBookerProfile
    └ logPartnerAccess('book') → sendBookingMails('new')（取引先: 予約者→ログインIDのメール→連絡先／宿: notifyEmails）
```

事実として確定していること:

- `rms_partner_create_booking` の `p` は **1つの部屋タイプ・1つのプラン**で `rooms[]`（部屋ごとの大人人数と泊ごとの単価）を受ける（`booking.ts` L577-616）。**単価は TS から渡す**（DB で再計算しない）。室数の上限（`maxRooms`）は TS だけが見ている（RPC は見ない。`20261009054024` の RPC 本体に `max_rooms` の検査なし）。
- RPC は**与信を自前で判定**し、超過かつ `credit_over_action='deposit'` で支払方法がオンライン決済・デポジット以外なら `credit_over_requires_deposit` で止める（`20261009054024` L489-530）。
- 予約名義（`booking_name_mode='partner'`）なら代表者＝旅行会社・部屋別の宿泊者名は `core.stays.metadata.room_guest_*`（`20261006230308`）。
- 予約の要望・備考: `p.options`（label/value の配列）が PMS の「事前質問・要望」に、`p.notes` が備考に入る（`20261007022950` L272・L319・L491）。予約者・交通手段・特典は `buildBookingExtras` → `options` の先頭（`booking.ts` L569-575）。
- 支払方法: 固定3種（`invoice_monthly` / `online` / `online_checkin`）＋取引先の自由入力 `custom_*`（最大5・`billable` で請求書の対象か）（`lib/partner-booking.ts` L15-60）。**「ペイメントリング」のような取引先固有の支払方法は `customPaymentOptions` そのもの**。
- 台帳 `rms_partner_bookings.status in ('pending_payment','confirmed','cancelled','expired')`（`20260926065713` L29）。
- 添付ファイル: 予約入力で仮置き → 確定時に RPC が束縛（`attachment_ids`）。予約一覧からも追加できる（`docs/partner-booking-attachments.md`）。
- 複数施設化は実装済み（`rms_partner_facilities`・`20261009054024`）。予約は `portalFacilityContext(db, selected, facility_id)` でフォームの施設に合わせた `PartnerContext` を作って確定する（`book/+page.server.ts` L142）。

### 3.4 料金の取り方

- `loadPartnerRates(db, partner, {from,to}, {rooms, guests})`（`lib/server/partners/rates.ts` L236）。まず `rms_partner_portal_prices`（RMS が先計算した最終料金・`rms_partner_prices`）、`ready=false` 等は従来の計算。`priceMode: 'precomputed' | 'live'`、`computedAt`。
- `PartnerRateDay.rooms[].plans[].pricesPerPerson[人数]` が「1名あたり」の単価（部屋タイプ × プラン × 人数）。**人数の段は大人1〜6**（`price_adult_1〜6`）。7名以上の部屋は料金が無い。
- 休館日（`day.closed`）・料金の無い日は見積が `ok:false` で止まる（`quotePartnerBooking`）。
- 月 JSON は KV で最長 20 分古い（`portal-month-cache.ts`）が、**見積・確定は毎回 DB**。

### 3.5 与信（受付枠）・PMS 顧客の紐づけ・名義

- `docs/partner-pms-customer-link.md` のとおり実装済み（Phase 1〜3b）。純関数 `lib/partner-credit.ts`、RPC `rms_partner_credit_check`、超過時の挙動 `credit_over_action`（`deposit` 既定 / `warn` / `ignore`）。
- 与信は**延べ室数（部屋×泊）の月別上限**。団体予約は 1 件で 5〜10 室を使うので、受付枠に最も効く。

### 3.6 将来の種別 `member`（特別会員）との関係

- `docs/vip-member-page.md` は `rms_partners.kind` に `'member'` を足し、同じ `/p/[token]` の部品で特別会員（VIP 顧客）の専用ページを出す計画。member では**団体予約・与信・月次請求・PMS 顧客の紐づけ・アカウント発行は使わない**（§4.1「使わない列」）。
- 本設計は `kind` を見て団体予約を出すので、**判定を「`agent` のとき出す」（許可リスト）にすれば `member` が増えても何もしなくて済む**。「`member` でないとき出す」（拒否リスト）にしない（§8.1）。

### 3.7 通知・監査の既存の仕組み

- メール: 取引先宛て `sendPartnerMail(db, facilityId, {to, subject, html, text})`（差出人名＝施設名・返信先＝施設の予約用アドレス）、宿宛て `sendFacilityNotice`（`lib/server/partners/mail.ts`）。宛先は施設ごとの `booking_settings.notifyEmails`（宿）、`partnerRecipients`（取引先: 予約者 → ログインIDのメール → 連絡先）。
- 管理画面に「新着」の仕組みは無い（宿の新着通知は PMS の受信箱＝電文が届いてから）。団体の照会は PMS に届く前の段階なので、**管理画面の一覧＋メール**で知らせる（§7.8）。
- 監査: `public.rms_partner_access_logs`（`channel in ('web','api','admin')`・`action`・`detail`・`ip`）。`logPartnerAccess`（`store.ts` L1286）。管理画面の取引先詳細に直近 50 件。
- 定期処理: `/api/cron/partner-charge`（毎時・`CRON_SECRET`）。チェックアウト日決済・添付の掃除・請求書の再試行が乗っている。期限切れの処理はここに足せる。

### 3.8 権限・セッション

- 取引先: 独自セッション（`rms_partner_sessions`・`aal`・`mfa_at`）。`requirePortalSession` / `requirePortalApi`（`portal.ts`）。マスタ／子（`is_master`）。aal2 の関所は保存カード等の高リスク操作だけ（`mfa.ts` `requireAal2` / `aal2ApiProblem`）。確認モード（`session.preview`）は書き込み 403。
- スタッフ: `staffPartnerScope(event, 'view' | 'edit')`（`staff.ts` L97）。管理者だけの操作は `role==='admin'` で縛る前例（与信設定・名義・紐づけ）。
- DB: `rms_partner_*` は **service_role 専用**（RLS ポリシー無し・`grant all … to service_role`）。Book のサーバが `admin-client.ts` の service_role クライアントで、限定URL＋セッション／スタッフの施設アクセスを確かめてから触る（`docs/auth-hardening.md`・`ADMIN_APP_OPS.md` §5）。新表も同じ扱いにする。

---

## 4. 全体の流れ【提案】

```
取引先（旅行会社・kind='agent'）                      宿（管理画面）
───────────────────────────────                     ─────────────────────────────
/p/<token>/group                                     /admin/group-inquiries
 ├ 新しい照会（フォーム・右に自動計算額・残室の目安）
 ├ 「この条件で日付を変えて追加」→ 下書きの束に積む（ブラウザ内）
 └ 「まとめて送信」 ──── submitted ────────────────▶ 新着一覧（メール通知・notifyEmails）
                                                      ├ 照会の詳細: 条件・自動計算額・泊ごとの残室・受付枠（与信）
                                                      └ 回答: 受けられる／条件付き／受けられない
                                                           料金（既定: 自動計算額）・一言・回答の有効期限
 回答メール（予約者→ログインID→連絡先） ◀──── offered / declined ──┘
 ├ 承諾 ──── accepted ──▶ rms_partner_create_booking（既存）→ 台帳・core.stays・booking.bookings・PMS 電文（new）
 │                         → 予約一覧（既存）に出る・予約確認メール（既存）・添付は予約一覧から
 ├ 辞退 ──── rejected
 └（期限が来たら）expired（cron）                      受けられない／承諾されず期限切れ → 一覧から消える（履歴には残る）
```

- **予約・PMS・請求書・与信の数え方は既存の個人予約と完全に同じ**（承諾時に既存の RPC を呼ぶだけ）。団体予約のために台帳・電文・PMS を変えない。
- 照会の段階では**在庫を押さえない**（MVP）。承諾時に RPC が施設ロックの中で残室を数え直すので、売り越しは起きない。足りなければ承諾が止まり、宿に知らせる（§7.3）。仮押さえは後回し（§10・N6）。

---

## 5. データモデル【提案】

### 5.1 新表 `public.rms_partner_group_inquiries`（団体の照会・1件＝1日程）

- スキーマは **`public`・接頭辞 `rms_partner_`** にする【提案】。理由: `rms_partners` に FK を張る子表はすべて `public.rms_partner_*`（bookings / invoices / documents / attachments / facilities / passkeys …）で、RLS 無し・service_role 専用の運用も揃っている。`book` スキーマは公式サイト（anon/authenticated で読む）側の表に使われている。→ **要確認 N1**（プロジェクト CLAUDE.md の「`book` スキーマで完結」との整理）。

```sql
create table if not exists public.rms_partner_group_inquiries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references core.tenants(id) on delete cascade,
  facility_id     uuid not null references core.facilities(id) on delete cascade,
  -- 取引先を消しても履歴は残す（名前はスナップショット）
  partner_id      uuid references public.rms_partners(id) on delete set null,
  partner_name    text not null,
  account_id      uuid references public.rms_partner_accounts(id) on delete set null,
  submitted_by    text,                                   -- 送信したログインID（スナップショット）
  -- 一括送信の束（表示のまとまり。状態は行ごと）
  batch_id        uuid not null,
  batch_seq       integer not null default 1,             -- 束の中の並び（1〜）
  inquiry_code    text not null unique,                   -- GI-2026-000001（表示・メール用。採番は sequence）
  -- 状態（§6）
  status          text not null default 'submitted'
                  check (status in ('submitted','offered','declined','accepted','rejected','withdrawn','expired')),
  -- 団体の条件
  group_name      text not null,                          -- 団体名（例: 270413精華旅行社）
  room_type_id    uuid,
  room_code       text not null,
  room_name       text not null,
  plan_code       text not null,
  plan_name       text not null,                          -- PMS のプラン名（照合用・元の名前）
  plan_display_name text,                                 -- 取引先向けのプラン名（表示用スナップショット）
  meal_type       text,
  check_in_date   date not null,
  check_out_date  date not null,
  nights          integer not null check (nights between 1 and 30),
  room_count      integer not null check (room_count between 1 and 100),
  adult_total     integer not null check (adult_total between 1 and 600),
  rooms           jsonb not null default '[]'::jsonb,     -- 部屋ごとの大人人数 [{adults}] （均等割の結果・取引先が直せる）
  payment_option  text not null,                          -- invoice_monthly / custom_*（Stripe 系は不可・§7.4）
  payment_label   text not null,                          -- 照会時点の表示名
  extras          jsonb not null default '{}'::jsonb,     -- {transport:{choice,other}, dinner_time:{choice,other}, note}
  booker          jsonb not null default '{}'::jsonb,     -- 予約者（PartnerBooker・氏名/部署/電話/メール）
  -- 自動計算（照会時点のスナップショット。計算できなければ quote_status に理由・金額は null）
  quote_status    text not null check (quote_status in ('ok','no_rate','closed','capacity','error')),
  quote_rooms     jsonb,                                  -- BookingQuote.rooms（泊ごとの単価）
  quote_total     integer,                                -- 宿泊料金（税込・入湯税別）
  quote_bath_tax  integer,
  quote_price_mode text,                                  -- precomputed / live
  quote_remaining integer,                                -- 照会時点の残室の最小値（目安）
  quote_credit    jsonb,                                  -- 照会時点の受付枠（与信）の判定（null=判定なし）
  -- 宿の回答
  answer          text check (answer in ('ok','conditional','declined')),
  answer_total    integer,                                -- 回答額（宿泊料金）。既定は quote_total
  answer_bath_tax integer,
  answer_rooms    jsonb,                                  -- 承諾時に RPC へ渡す rooms（泊ごとの単価）。既定は quote_rooms
  answer_message  text,                                   -- 取引先への一言（条件・代替案）
  answer_expires_at timestamptz,                          -- 回答の有効期限（過ぎたら expired）
  answered_at     timestamptz,
  answered_by     uuid,                                   -- スタッフ（auth.users.id）
  answered_by_name text,
  credit_override boolean not null default false,         -- 受付枠を超えていても宿が受けると決めた（§7.5）
  -- 承諾・辞退・取り下げ
  accepted_at     timestamptz,
  accepted_by     text,                                   -- ログインID
  booking_id      uuid references public.rms_partner_bookings(id) on delete set null,  -- 承諾でできた予約
  closed_at       timestamptz,                            -- rejected / withdrawn / expired / declined になった時刻
  closed_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create sequence if not exists public.rms_partner_group_inquiry_code_seq;
create index if not exists idx_rms_partner_group_inquiries_partner on public.rms_partner_group_inquiries (partner_id, created_at desc);
create index if not exists idx_rms_partner_group_inquiries_facility_status on public.rms_partner_group_inquiries (facility_id, status, check_in_date);
create index if not exists idx_rms_partner_group_inquiries_batch on public.rms_partner_group_inquiries (batch_id, batch_seq);
create index if not exists idx_rms_partner_group_inquiries_expires on public.rms_partner_group_inquiries (answer_expires_at) where status = 'offered';

alter table public.rms_partner_group_inquiries enable row level security;
-- ポリシー無し＝service_role のみ（Book のサーバが限定URL＋セッション／スタッフの施設アクセスを確かめてから触る）
revoke all on public.rms_partner_group_inquiries from public, anon, authenticated;
grant all on public.rms_partner_group_inquiries to service_role;
grant usage, select on sequence public.rms_partner_group_inquiry_code_seq to service_role;
```

- **1件＝1日程**にする理由: サンプルのように「同条件で日付だけ違う」ものは、宿の可否が日付ごとに分かれる（4/15 は可・4/17 は満室）。状態を行ごとに持たないと「一部だけ承諾」が表現できない。束は `batch_id` で見せる。
- 部屋タイプ・プランは 1 件につき 1 つ（既存 RPC の形に合わせる）。部屋タイプが混在する団体は**件を分けて同じ束に入れる**（§8.2）。
- `rooms` の部屋ごとの人数は、取引先が「大人10名・5室」と入れたら **均等割（2名×5室。割り切れなければ先頭から +1）** を既定にし、直したければ部屋ごとに直せる。料金は人数の段（1〜6名）で変わるので、ここが決まらないと自動計算できない。

### 5.2 新表 `public.rms_partner_group_inquiry_events`（履歴・監査）

```sql
create table if not exists public.rms_partner_group_inquiry_events (
  id          bigint generated always as identity primary key,
  inquiry_id  uuid not null references public.rms_partner_group_inquiries(id) on delete cascade,
  kind        text not null,            -- submitted / answered / accepted / rejected / withdrawn / expired / accept_failed / note
  actor_kind  text not null check (actor_kind in ('partner','staff','system')),
  actor_label text,                     -- ログインID or スタッフ名 or 'cron'
  detail      jsonb,                    -- 回答の内容・失敗の理由（残室不足 等）
  created_at  timestamptz not null default now()
);
create index if not exists idx_rms_partner_group_inquiry_events_inquiry on public.rms_partner_group_inquiry_events (inquiry_id, created_at);
alter table public.rms_partner_group_inquiry_events enable row level security;
revoke all on public.rms_partner_group_inquiry_events from public, anon, authenticated;
grant all on public.rms_partner_group_inquiry_events to service_role;
```

- 取引先ページの詳細にも「やりとり」として時系列で出す（宿の一言・承諾失敗の理由）。
- 加えて既存の `rms_partner_access_logs` にも `group_inquiry_*`（§9.3）を残す（管理画面のアクセスログで他の操作と並べて見るため）。

### 5.3 `rms_partners.booking_settings`（jsonb）に足すキー【提案】

列は増やさず `PartnerBookingSettings`（`lib/partner-booking.ts`）に足し、`normalizeBookingSettings` で既定を埋める。**取引先共通**（`rms_partners.booking_settings`）に置く（施設ごとに変える理由が無い。複数施設化の分類 §4.2 の「共通」側）。

| キー | 型 | 既定 | 意味 |
|---|---|---|---|
| `groupInquiryEnabled` | boolean | **`true`**（kind=agent のとき意味を持つ） | 団体予約メニューを出すか。管理画面で切れる |
| `groupMaxRooms` | number | 30 | 1 件の室数の上限（個人予約の `maxRooms` は見ない） |
| `groupMaxNights` | number | 7 | 1 件の泊数の上限 |
| `groupMaxBatch` | number | 20 | 一括送信の件数の上限 |
| `groupLeadDays` | number | 3 | 受付締切: チェックイン日の N 日前まで照会できる（個人予約の `leadDays` より長め） |
| `groupTransportChoices` | string[] | `['大型バス1台','中型バス1台','マイクロバス1台','JR','自家用車']` | 交通機関の選択肢（＋「その他」自由記入は常にある） |
| `groupDinnerTimeChoices` | string[] | `['17:30','18:00','18:30','19:00']` | 夕食開始時間の選択肢（＋「その他」） |
| `groupAnswerDays` | number | 7 | 回答の有効期限の既定（宿が回答時に変えられる） |

- 支払方法の候補は**新しいキーを作らない**。既存の `paymentOptions` から **Stripe 系（`online` / `online_checkin`）を除いたもの**が団体の候補（§7.4）。「ペイメントリング」は管理画面の「支払方法と請求条件」で自由入力の支払方法として登録すればよい（今の仕組みのまま）。

### 5.4 既存 RPC `rms_partner_create_booking` への追加【提案・DB 関数の変更】

承諾時の予約作成は既存 RPC を呼ぶ。足すのは次の 2 つの入力キーだけ（無ければ従来どおり）。

| `p` のキー | 意味 | 使うところ |
|---|---|---|
| `group` jsonb `{inquiry_id, inquiry_code, group_name, batch_id}` | 団体の照会からの予約。台帳 `detail.group` に写す。電文の `requests` の先頭に「団体: 団体名（照会 GI-…）」、`booking.bookings.metadata.rms_partner_group_inquiry_id` | 一覧・PMS の要望欄・後追い |
| `credit_override` boolean | 宿が「受付枠を超えても受ける」と決めた（§7.5）。true なら超過でも `credit_over_requires_deposit` を出さず、`credit_result` に `overridden:true` を記録し、滞在の備考に【受付枠超過・宿承認】 | 与信判定 |

- 加えて `rms_partner_group_inquiries.booking_id` の束縛と `status='accepted'` は、**RPC の中ではなく Book のサーバで RPC 成功後に UPDATE** する（RPC の変更を最小にする）。失敗（RPC が例外）なら照会は `offered` のまま、events に `accept_failed` を残す。
- 二重承諾の防止: UPDATE を `where id=? and status='offered'` で先に `accepting`… とはせず（状態を増やさない）、**サーバで `pg_advisory_xact_lock` は使えない**ので、承諾 API は「`status='offered'` かつ `booking_id is null` の行を `update … set status='accepted', accepted_at=now() where status='offered' returning *` で先に取り（1 行取れなければ 409）→ RPC → 失敗なら `status='offered'` に戻す」の順にする（楽観ロック）。

### 5.5 migration ファイル

autumn-shared `supabase/migrations/` に 1 本（`bash ~/.claude/new-migration.sh autumn-shared rms_partner_group_inquiry` で実秒生成。下の名前は仮）。

- `20261010044819_rms_partner_group_inquiry.sql`（仮）
  1. §5.1 の表・sequence・索引・grant
  2. §5.2 の表・索引・grant
  3. `updated_at` の更新トリガー（既存の `rms_partner_*` と同じ関数があれば流用。無ければ小さな trigger 関数を同梱）
  4. `rms_partner_create_booking` の `create or replace`（§5.4。**最新版 `20261009054024` を丸ごとコピーして 2 か所足す**。着手直前に `git pull` して最新版を確認）
  5. `_rms_partner_emit_pms_event` は変えない（`requests` は `_rms_partner_requests(v_pb.id)` が `detail` から組み立てるため、`detail.group` を読む 1 行だけ `_rms_partner_requests` に足す。これも `create or replace`）

> 要確認 N1 で `book` スキーマに置く判断になった場合はファイル名を `…_book_partner_group_inquiry.sql`、表名を `book.partner_group_inquiries` にし、`rms_partners` への FK はそのまま張れる（同一 DB）。ただし service_role 専用の運用は同じにする。

---

## 6. 状態遷移【提案】

```
（ブラウザ内の下書き）──送信──▶ submitted ──宿が回答──▶ offered（受けられる／条件付き）──承諾──▶ accepted（予約確定・booking_id）
                                   │                       │  ├──辞退──▶ rejected
                                   │                       │  └──期限──▶ expired（cron）
                                   │                       └（承諾に失敗: 残室不足など）→ offered のまま＋events.accept_failed・宿へ通知
                                   ├──宿が回答──▶ declined（受けられない）
                                   └──取引先が取り下げ──▶ withdrawn
offered ──取引先が取り下げ──▶ withdrawn
```

| 状態 | 表示（取引先） | 表示（宿） | 次にできること |
|---|---|---|---|
| submitted | 回答待ち | 新着 | 宿: 回答／取引先: 取り下げ |
| offered | 回答あり（受けられます／条件付き）＋料金＋期限 | 回答済み・承諾待ち | 取引先: 承諾・辞退・取り下げ／宿: 回答の修正（期限の延長・料金の訂正。events に残す） |
| declined | 受けられません | 回答済み | （終了） |
| accepted | 予約確定（予約コードへのリンク） | 予約へ | 以後は予約一覧側（取消は予約の取消） |
| rejected | 辞退しました | 辞退 | （終了） |
| withdrawn | 取り下げました | 取り下げ | （終了） |
| expired | 期限切れ | 期限切れ | 取引先: 「同じ条件でもう一度照会」（複製） |

- 「下書き」はサーバに置かない（MVP）。ブラウザの `localStorage` に束を保存し、送信で初めてサーバへ（§8.2）。別端末からの続きは後回し（N7）。
- 承諾後に予約を取消しても照会は `accepted` のまま（予約側の `cancelled` を一覧で併記）。
- 期限切れは cron（毎時）で `offered and answer_expires_at < now()` を `expired` に。取引先・宿へメールはしない（一覧で分かる・N8）。

---

## 7. 論点ごとの設計【提案】

### 7.1 料金の自動計算

- 照会の保存時（送信時）にサーバで `quotePartnerBooking(db, partner, {roomCode, planCode, planName, checkIn, nights, rooms}, {credit: true})` を**そのまま呼ぶ**（個人予約と同じ関数・同じ最終料金）。結果を `quote_*` に写す。
- 入力画面でも同じ値を見せるため、既存の `/p/[token]/book/quote`（POST・JSON）を**そのまま使う**（`BookingTarget` の形は同じ）。団体用の別 API は作らない。ただし `maxRooms` の検査は見積にはない（`createPartnerBooking` 側だけ）ので、室数 30 でも見積は返る。
- 計算の式（個人予約と同じ・`quotePartnerBooking`）:
  - 宿泊料金 ＝ Σ部屋 Σ泊 `pricesPerPerson[その部屋の大人数] × 大人数`
  - 入湯税 ＝ `pms.facility_billing_settings.bath_tax_amount × 大人の合計 × 泊数`（有効なとき）
  - 予約時決済割引（`prepayDiscount`）は**付けない**（団体はオンライン決済を使わないため）
- 計算できないとき（`ok:false`）も**照会は送れる**（サンプルの「料金：ご回答をお願いします」がこの形）。理由を `quote_status` に残す:

  | `quote_status` | 起きる条件 | 取引先への表示 | 宿の回答 |
  |---|---|---|---|
  | `ok` | 全泊に料金あり | 自動計算額（1名あたり × 人数 × 泊、合計、入湯税） | 既定は自動計算額 |
  | `no_rate` | その日・その人数の段に料金が無い（暦の未設定日・「不可」の日・7名以上の部屋） | 「料金は宿からの回答でご案内します」 | **料金の入力が必須**（§7.2） |
  | `closed` | 休館日 | 「休館日が含まれます。宿にご確認ください」 | 既定は「受けられない」 |
  | `capacity` | 部屋の定員（`pms.room_types.capacity_max`）を超える人数の部屋がある | 入力段階で止める（送れない） | — |
  | `error` | 料金の読み出しに失敗 | 「料金は宿からの回答でご案内します」 | 料金の入力が必須 |

- 子ども: 取引先予約は大人のみ（既存どおり・`BookingTarget.rooms[].adults`）。団体に子どもがいる場合は備考に書く運用（N4）。
- 人数の段は 1〜6 名/室。「大人10名・客室5部屋」→ 2名×5室。「大人11名・5部屋」→ 3名×1室＋2名×4室（先頭から +1）。部屋ごとの人数は取引先が直せる（例: 3-3-2-2-1）。

### 7.2 宿の回答で料金を変えられるか（D2・推奨案）

**推奨: 変えられるが、既定は自動計算額のまま。変更は管理者（`role='admin'`）だけ。**

- 回答画面の料金欄は自動計算額が入った状態で出す。変更方法は 2 つ:
  1. **1名あたりの単価（税込・入湯税別）を部屋タイプ × 人数の段ごとに上書き**（例: 2名1室 22,000 → 20,000）。泊ごとの単価にそのまま入れ、`answer_rooms` を組み立て直す
  2. **合計を直接入力** → 人泊で均等に割って 1 円未満を切り捨て、端数は最初の部屋の最初の泊に寄せる（PMS の明細＝単価×人数と合計が一致するように）
- `no_rate` / `error` のときは料金の入力が必須（空のまま「受けられる」にできない）。
- 回答額は `answer_total` / `answer_bath_tax` / `answer_rooms` に残し、**承諾時はこれを RPC に渡す**（料金は宿の約束。承諾までの間に RMS で料金が変わっても追随しない）。入湯税は承諾時に `bathTaxRule` で再計算せず `answer_bath_tax` を使う。
- スタッフ（`role='staff'`）は回答できるが料金は自動計算額のまま（変えたいときは管理者へ）。→ 要確認 N2。

### 7.3 在庫（残室）

- 照会時: `quotePartnerBooking` の `remaining`（部屋タイプの残室の最小値）を `quote_remaining` に写し、取引先には**「空室の目安: 残り N 室」**（`show_inventory` がオンの施設だけ・個人予約と同じ条件）、宿には泊ごとの残室（`rms_partner_room_type_remaining` を回答画面の load で読む）を出す。
- 照会・回答の段階では**在庫を押さえない**（MVP）。宿が「受けられる」と回答しても、他の販路で先に売れれば承諾時に RPC が `room_type_sold_out`（既存の `friendlyRpcError`）で止める。
  - そのとき: 照会は `offered` のまま、events に `accept_failed{reason}`、宿へメール「承諾できませんでした（残室不足）」、取引先の画面には「満室のため確定できませんでした。宿からご連絡します」。宿は回答を「受けられない」に変えるか、別の部屋タイプで新しい照会を案内する。
- 在庫を回答時に押さえる（仮押さえ・`core.stays reserved` を期限付きで作る）のは後回し（§10・N6）。既存の `pending_payment`（35 分）の仕組みを 7 日に伸ばして使えるが、満室表示・与信・掃除の影響を見てから。

### 7.4 支払方法

- 候補 ＝ 取引先の `paymentOptions` のうち `invoice_monthly` と `custom_*`（Stripe 系は出さない）。1 つも無ければ団体予約メニューを出さない（管理画面に「団体予約には後払いか自由入力の支払方法が必要です」）。
- 「ペイメントリング」は自由入力（`customPaymentOptions`）。`billable` の意味（月次請求書で請求するか）も既存どおり。
- 承諾時の RPC: `payment_option` / `payment_label` に照会の値、`await_payment=false`（即確定）。

### 7.5 与信（受付枠）との関係

- 照会時: `quotePartnerBooking(…, {credit:true})` の `credit` を `quote_credit` に写し、取引先には既存の文言（「御社の受付枠 …このご予約で残り M 室」）を出す。超過していても**照会は送れる**（宿が判断する）。
- 回答画面（宿）: 月ごとの上限・予約済み・この照会ぶん・残りを表に出し、超過なら赤字で「受付枠を N 室超えます」。
- 承諾時の RPC は与信を再判定する。超過時の挙動が `deposit` の取引先は、後払いの承諾が `credit_over_requires_deposit` で止まる（既存）。団体はオンライン決済を使わないので、**宿が回答時に「受付枠を超えても受ける」にチェック（`credit_override=true`・管理者のみ）**して承諾時の RPC に渡し、デポジットを求めずに通す（§5.4）。チェック無しで超過なら承諾は止まり、取引先に「受付枠を超えるため宿が確認中です」と出し、宿へ通知。
- `warn` / `ignore` の取引先は既存どおり（止まらない・印だけ）。

### 7.6 承諾時の PMS 登録（既存の処理の再利用）

承諾 API（`/p/[token]/group/[id]/accept`・POST）はサーバで次を行う。**`createPartnerBooking` は使わず**、その中身のうち団体に要る部分だけを `acceptGroupInquiry` に組み立て直す（`createPartnerBooking` は個人予約のフォーム入力・見積のやり直し・maxRooms・Stripe を前提にしていて、団体では見積をやり直してはいけない＝回答額で確定するため）。

| 項目 | RPC `p` への入れ方 |
|---|---|
| 施設 | `facility_id` ＝ 照会の施設（`portalFacilityContext` で合わせた `PartnerContext`） |
| 部屋・プラン | 照会の `room_code / room_name / plan_code / plan_name / meal_type` |
| 日程 | `check_in / check_out` |
| rooms | `answer_rooms`（無ければ `quote_rooms`）。`[{adults, nights:[{date, unit_price}]}]`。男女内訳は無し |
| guest（代表者） | **名義が `partner`（旅行会社名義）**: 代表者＝旅行会社（RPC が自動）。部屋別の宿泊者名は `家族名=団体名`・`名=（空）`→ RPC は `room_guest_name` に「団体名」を入れる。**名義が `guest`**: `family_name=団体名`、`given_name='御一行'`、`phone`＝予約者（booker）の電話、`email`＝空（宿泊者へはメールしない既存方針）。→ 要確認 N5 |
| 予約者 | 照会の `booker`（`buildBookingExtras` で options の先頭へ・台帳 `detail.booker`） |
| 交通手段 | `extras.transport` を文字列に（「中型バス1台」「その他（○○）」）→ `transport` として options へ（個人予約と同じ行） |
| 夕食時間 | options に `{label:'夕食開始時間', value:'18:30'}` |
| 団体 | `group: {inquiry_id, inquiry_code, group_name, batch_id}`（§5.4）→ options 先頭「団体: 270413精華旅行社（照会 GI-2026-000001）」 |
| 備考 | `notes` ＝ 照会の `extras.note` ＋ 宿の `answer_message`（「宿からの回答: …」）を改行で連結（1000 字まで） |
| 支払 | `payment_option / payment_label`、`await_payment=false`、`bath_tax=answer_bath_tax`、`prepay_discount=0` |
| 与信 | `credit_override` |
| 添付 | 渡さない（承諾後に予約一覧から追加・既存） |

- RPC 成功後: 照会を `accepted` に（`booking_id`・`accepted_at/by`）、`attachBookingExtras`（既存）、`snapshotCancelPolicy`（既存）、`logPartnerAccess('group_inquiry_accept')`、`sendBookingMails(…,'new')`（既存。取引先の予約確認メールと宿の通知）、events に `accepted`。
- 室数の上限: RPC は見ないので、サーバで `groupMaxRooms` を見る（照会の保存時に検査済み。承諾時は再検査しない）。
- 1 件の照会 ＝ 1 件の予約（予約コード PB-…）。束で 2 件承諾すれば予約も 2 件。月次請求書・取消・添付はすべて予約単位（既存）。
- PMS 側の変更は不要。団体名は要望欄・備考に載る。部屋別の宿泊者名は「団体名」（名簿は添付で）。

### 7.7 名簿・部屋割り

- 照会・承諾の段階では聞かない。承諾後に予約一覧の添付ファイル（既存・`PARTNER_BOOKING_ATTACHMENTS`）で名簿を上げる運用。承諾完了の画面・メールに「名簿は予約一覧の添付ファイルからお送りください」の一文（添付機能がオンのときだけ）。

### 7.8 通知

| タイミング | 宛先 | 既存の口 |
|---|---|---|
| 送信（束） | 宿: 施設の `notifyEmails`（照会の施設） | `sendFacilityNotice`。**束で 1 通**（件名「【団体照会】精華旅行社 2件（4/15・4/17）取引先名」・本文に各件の条件・自動計算額・残室の目安・管理画面のリンク） |
| 回答 | 取引先: 予約者 → ログインIDのメール → 連絡先（`partnerRecipients` と同じ順） | `sendPartnerMail`。1 件ずつ（束で同時に回答した場合は 1 通にまとめる・N9） |
| 承諾 | 取引先・宿 | 既存の予約確認メール（`sendBookingMails 'new'`）。件名に【団体】を足す（`detail.group` があるとき） |
| 承諾に失敗（残室不足・与信） | 宿 | `sendFacilityNotice`（件名「【団体照会】承諾できませんでした」） |
| 辞退・取り下げ | 宿 | `sendFacilityNotice`（1 通） |
| 期限切れ | （送らない） | — |

- 管理画面の「新着」: `/admin` のサイドバーに「団体照会」を足し、`submitted` の件数バッジ（施設アクセスの範囲）。管理画面の layout は既に取引先詳細のために `+layout.server.ts` を持つが、バッジは軽い count 1 本（`head:true, count:'exact'`）で済む。

### 7.9 権限

| 操作 | 取引先 | 宿 |
|---|---|---|
| 照会の作成・送信 | マスタ・子ともに可（個人予約と同じ）。確認モード（preview）は不可 | — |
| 一覧・詳細を見る | 全ユーザー（取引先の全件） | 施設の閲覧権限（`staffPartnerScope('view')`） |
| 取り下げ | 送信した本人かマスタ | — |
| 承諾・辞退 | 全ユーザー（予約と同じ扱い）。**aal2 は不要**（個人予約の後払い確定も aal2 不要・保存カードを使わない） | — |
| 回答（可否・一言・期限） | — | 施設の編集権限（`staffPartnerScope('edit')`）。staff でも可 |
| 回答の料金変更・受付枠超過の承認 | — | **管理者のみ**（`role==='admin'`） |

- `mfa_policy='always' / 'passkey_only'` の取引先は既存の関所がそのまま効く（`requirePortalSession` の mfaGate）。

### 7.10 取引先の種類（kind）と `member`

- 団体予約を出す条件（`groupInquiryAvailable(partner)`・純関数）: `partner.kind === 'agent' && booking_settings.groupInquiryEnabled && facility_available && booking_enabled(その施設) && 団体の支払方法の候補が 1 つ以上`。
- **許可リスト方式**（`kind === 'agent'` のときだけ）。`corporate` / `other` / 将来の `member`（特別会員）・`ambassador`（アンバサダー会員・`docs/vip-member-page.md` §12）では出ない。`docs/vip-member-page.md` §4.1 の「member で使わない列・機能」に本機能（`groupInquiry*`・団体予約メニュー・`/p/[token]/group/**`）を足す一文を、VIP 実装時に加える（本書からの申し送り）。`PARTNER_KIND_LABELS` の `member` の表示名は「特別会員」。
- 管理画面の取引先詳細に「団体予約」の節（§8.3）は kind=agent のときだけ出す。kind を agent 以外に変えると節が消え、設定は jsonb に残る（害なし）。
- サーバ側も `requireGroupInquiry(partner)` で同じ判定をして 404（メニューを隠すだけにしない）。

---

## 8. 画面【提案】

### 8.1 取引先ページ

**メニュー**: `MENU` に `['group', '団体予約']` を「予約一覧」の後ろに足す。表示条件は `portal.groupInquiry`（`portalHeader` に `groupInquiry: boolean` を足す。`kind` そのものは画面へ渡さない）。`PartnerPageSkeleton` に `group` の骨組みを 1 つ足す。

**`/p/[token]/group`（一覧）**
- 上部: 「新しい団体予約の照会」ボタン、状態タブ（回答待ち／回答あり／予約確定／終了）、施設の切替（2 施設以上のとき・既存の切替をそのまま）。
- 行: 団体名・日程（4/15（水）〜1泊）・部屋タイプ×室数・大人人数・プラン・支払方法・自動計算額（または「宿が回答」）・状態・回答期限。束ごとに左に細い帯を付けて同じ束を目で追えるように。
- 回答ありの行は行内に「承諾」「辞退」ボタン（確認ダイアログ付き）。詳細（`/group/[id]`）でやりとり（events）と回答の全文。
- 「同じ条件でもう一度」（複製して新規フォームへ）。

**`/p/[token]/group/new`（入力・一括送信）** — 手早く入れる工夫

- 2 ペイン。左にフォーム、右に「送る照会の束」（カート）。
- フォームの順（上から Tab で流れる）: 団体名 → 施設（2 施設以上のときだけ） → 部屋タイプ → プラン（宿泊条件。取引先向けのプラン名） → チェックイン日 → 泊数 → 大人人数 → 室数（人数を入れた瞬間に `ceil(人数 / 部屋タイプの capacity_max)` を自動で入れる・変更可） → 部屋ごとの人数（自動で均等割・開いて直せる） → 夕食開始時間（選択肢＋その他） → 支払方法（候補から・1 つなら固定） → 交通機関（選択肢＋その他） → 備考 → 予約者（マイページの既定・個人予約と同じ）。
- フォーム下部に**自動計算額のカード**（`/book/quote` を 400ms デバウンスで呼ぶ）: 「1名あたり ¥22,000 × 2名 × 1泊 × 5室 ＝ ¥220,000・入湯税 ¥1,500・空室の目安 残り 6 室・受付枠 残り 12 室」。計算できなければ理由（§7.1）。
- **「束に追加」**（Enter 相当・`Ctrl+Enter`）: 右の束に 1 行追加。フォームは**団体名・施設・部屋タイプ・プラン・泊数・人数・室数・夕食・支払・交通・予約者をそのまま残し、チェックイン日だけフォーカス**（カレンダーが開く）。これで「日付だけ変えて次」を最短にする。
- **「日付を変えて複製」**（束の各行の ⧉ ボタン・`Ctrl+D`）: その行の内容をフォームに戻し、チェックイン日を +1 日にして日付欄にフォーカス。
- 束の行はインラインで日付・室数・人数だけ直せる（他は複製して直す）。並び替え不要（日付順に自動）。
- **前回の条件の呼び出し**: フォーム上部「前回の内容を使う」→ 直近の送信（サーバの最新 batch）を読んで団体名以外を埋める。加えて束は `localStorage`（キー `ab:group-draft:<token>`）に自動保存し、閉じても残る（送信・クリアで消す）。
- **「N 件をまとめて送信」**（右下・固定）: 確認モーダル（表で全件・合計額）→ POST `/p/[token]/group/submit`（JSON）→ 一覧へ（`?done=batch`）。サーバで全件を検証（締切・上限・支払方法・定員）し、1 件でも不正なら全件送らず行番号つきで返す（部分送信にしない）。
- 入力の検証（純関数 `lib/partner-group.ts`）: 団体名 1〜60 字、泊数 1〜`groupMaxNights`、室数 1〜`groupMaxRooms`、大人 1〜（室数×capacity_max）、部屋ごとの人数の合計＝大人人数、チェックイン日 ≥ 今日＋`groupLeadDays` かつ公開範囲（`clampPartnerRange`）内、束 ≤ `groupMaxBatch`、同じ日程・部屋タイプの重複は警告（送れる）。
- スマホ: 右ペインは下に折りたたみ（「束 3 件」のバー）。

### 8.2 束と部屋タイプの混在

- 「ジュニアスイート 3 室＋スタンダード 2 室」は 2 件に分けて同じ束へ（フォームで部屋タイプを変えて「束に追加」）。承諾も 2 件（予約も 2 件）。一覧では束の帯で並ぶ。

### 8.3 管理画面

**`/admin/group-inquiries`（一覧・全取引先）**
- サイドバー「団体照会」＋新着バッジ。フィルタ: 状態（既定: 回答待ち＋回答済み）・施設・取引先・期間。
- 行: 受付日時・取引先・団体名・施設・日程・部屋タイプ×室数・人数・自動計算額・残室の目安・受付枠の判定（超過なら赤）・状態・回答期限。束はまとめて 1 枚のカード（件ごとの行＋束に対する「全件を受けられるにする」の一括ボタン）。

**`/admin/group-inquiries/[id]`（詳細・回答）**
- 左: 条件（取引先・団体名・日程・部屋・プラン・人数・部屋ごとの人数・夕食・支払・交通・備考・予約者）、やりとり（events）。
- 右: **在庫**（泊ごとの残室・`rms_partner_room_type_remaining`）、**料金**（自動計算の内訳・`priceMode` と計算時刻）、**受付枠**（月ごとの表・超過なら赤）。
- 回答フォーム: 受けられる／条件付きで受けられる／受けられない、料金（既定は自動計算額。管理者は §7.2 の 2 方式で変更）、一言（取引先に見える・条件付きのときは必須）、回答の有効期限（既定 `groupAnswerDays` 日後）、「受付枠を超えても受ける」（超過のときだけ・管理者のみ）。送信で `offered` / `declined` ＋ メール。
- 回答済みの修正: 期限の延長・一言の追記・料金の訂正（管理者）。events に残る。承諾済みは変更不可（予約側で）。

**取引先詳細 `/admin/partners/[id]`（kind=agent のとき「団体予約」の節）**
- `groupInquiryEnabled`・上限（室数・泊数・束）・締切日数・交通機関の選択肢・夕食時間の選択肢・回答期限の既定。既存の「共通の設定」のフォームの中（保存は「保存する」）。
- この取引先の照会の直近 20 件（一覧へのリンク）。
- 2,550 行の `+page.svelte` を膨らませないため **別部品 `lib/components/admin/PartnerGroupSettings.svelte`** にして差し込む（画面担当のファイル分担・§11）。

---

## 9. サーバ側の構成【提案】

### 9.1 新しいファイル

| ファイル | 役割 |
|---|---|
| `lib/partner-group.ts`（純関数・テスト付き） | 型（`GroupInquiry` / `GroupInquiryStatus` / `GroupDraftItem`）、`groupInquiryAvailable(partner)`、`splitAdultsEvenly(total, rooms)`、`validateGroupDraft(items, settings, bounds, capacity)`、状態遷移の可否 `canAccept / canWithdraw / canAnswer`、文言（状態名・回答メール本文の行）、`groupPaymentChoices(settings)`（Stripe 系を除く）、`groupSettingsOf(bookingSettings)` |
| `lib/server/partners/group-inquiries.ts` | `listGroupInquiries(db, partnerId, filter)`、`getGroupInquiry`、`submitGroupBatch(db, partner, account, items, meta)`（検証 → 1 件ずつ `quotePartnerBooking` → INSERT → events → 宿へメール 1 通）、`withdrawGroupInquiry`、`answerGroupInquiry(db, staff, id, answer)`（権限・料金の組み立て → UPDATE → events → 取引先へメール）、`acceptGroupInquiry(db, partner, account, id, meta)`（§5.4 の楽観ロック → RPC → 後処理）、`rejectGroupInquiry`、`expireGroupInquiries(db)`（cron）、`latestGroupBatch(db, partnerId, accountId)`（前回の条件） |
| `lib/server/partners/group-mail.ts` | 束の受付通知（宿）・回答通知（取引先）・承諾失敗（宿）の本文組み立て（`sendFacilityNotice` / `sendPartnerMail` を呼ぶ） |
| `routes/p/[token]/group/+page.server.ts` / `+page.svelte` | 一覧 |
| `routes/p/[token]/group/new/+page.server.ts` / `+page.svelte` | 入力・束・送信（`/book/quote` を再利用） |
| `routes/p/[token]/group/submit/+server.ts` | POST（JSON）一括送信 |
| `routes/p/[token]/group/[id]/+page.server.ts` / `+page.svelte` | 詳細（やりとり）・承諾／辞退／取り下げは form action |
| `routes/admin/group-inquiries/+page.server.ts` / `+page.svelte` | 宿の一覧 |
| `routes/admin/group-inquiries/[id]/+page.server.ts` / `+page.svelte` | 詳細・回答 |
| `lib/components/PartnerGroupDraftList.svelte` / `PartnerGroupQuoteCard.svelte` / `admin/PartnerGroupSettings.svelte` | 部品 |

### 9.2 既存ファイルの変更（最小）

| ファイル | 変更 |
|---|---|
| `lib/partner-booking.ts` | `PartnerBookingSettings` に `groupInquiryEnabled` ほか §5.3 のキー・既定・`normalizeBookingSettings` の正規化。共通側のキーの一覧（複数施設化の振り分け）に追加 |
| `lib/server/partners/portal.ts` | `portalHeader` に `groupInquiry: boolean` |
| `routes/p/[token]/+layout.svelte` | `MENU` に `group`・表示条件 |
| `lib/components/PartnerPageSkeleton.svelte` | `group` の骨組み |
| `lib/server/partners/booking.ts` | `attachBookingExtras` / `buildBookingExtras` を export（団体から呼ぶ）。`bookingSummaryLines` に `detail.group` の「団体: …」行。`sendBookingMails` の件名に【団体】 |
| `routes/api/cron/partner-charge/+server.ts` | `expireGroupInquiries` を足す |
| `routes/admin/+layout.svelte`（サイドバー） | 「団体照会」＋バッジ |
| `routes/admin/partners/[id]/+page.svelte` / `+page.server.ts` | 「団体予約」の節（部品の差し込み・保存キーの追加） |
| `lib/server/partners/staff-form.ts` | `parsePartnerCommonForm` に §5.3 のキー |

### 9.3 監査（`rms_partner_access_logs` の action）

`group_inquiry_submit`（detail: batch_id・件数・inquiry_codes）/ `group_inquiry_withdraw` / `group_inquiry_accept`（booking_code）/ `group_inquiry_accept_failed`（reason）/ `group_inquiry_reject`（web）、`group_inquiry_answer`（channel `admin`・answer・total 変更の有無・credit_override）。管理画面のアクセスログの日本語名の表に追加。

### 9.4 機能フラグ

- 環境変数 `PARTNER_GROUP_INQUIRY`（既定 off・添付の `PARTNER_BOOKING_ATTACHMENTS` と同じ流儀）。off のあいだはメニュー・管理画面に出さず、API は 404。本番で migration 適用 → 動作確認 → on。

---

## 10. 段階分け【提案】

| 段階 | 内容 |
|---|---|
| **MVP（今回）** | 表 2 本・RPC の 2 キー、取引先の一覧／入力（束・複製・自動計算・前回の条件・localStorage の下書き）／送信／承諾・辞退・取り下げ、宿の一覧／詳細／回答（料金変更は管理者）／受付枠超過の承認、メール（受付・回答・承諾失敗）、期限切れ cron、取引先詳細の設定節、監査、機能フラグ |
| 後回し A | 回答時の仮押さえ（在庫を期限まで押さえる・N6） |
| 後回し B | 束の一括回答の細かい制御（件ごとに違う料金を一括で）、回答のテンプレート文、サーバ側の下書き（別端末で続き・N7） |
| 後回し C | 子ども料金・添い寝（取引先予約全体が大人のみのため、個人予約と一緒に） |
| 後回し D | 名簿の構造化（部屋別の宿泊者名を照会側で入力して `room_guest_name` に流す） |
| 後回し E | 取引先 REST API（`/api/partner/v1`）からの照会投入 |

---

## 11. 実装を 2 エージェントに分ける案（競合しないファイル分担）

**契約（先に決めてから並行）**: `lib/partner-group.ts` の型と関数名、`lib/server/partners/group-inquiries.ts` の export 名と引数・返り値（§9.1 のとおり）。画面側はこの契約だけを見て作り、サーバ側ができるまではモックで動かす。

| 担当 | ファイル |
|---|---|
| **A: DB／サーバ** | autumn-shared の migration（§5.5）、`lib/partner-group.ts`（＋ `partner-group.test.ts`）、`lib/server/partners/group-inquiries.ts`、`group-mail.ts`、`lib/partner-booking.ts`（設定キー）、`lib/server/partners/booking.ts`（export・件名・summary 行）、`lib/server/partners/portal.ts`（`portalHeader`）、`lib/server/partners/staff-form.ts`、`routes/api/cron/partner-charge/+server.ts`、`routes/p/[token]/group/submit/+server.ts`、各 `+page.server.ts`（取引先・管理画面）の load/actions |
| **B: 画面** | `routes/p/[token]/group/**` の `+page.svelte`、`routes/admin/group-inquiries/**` の `+page.svelte`、部品（`PartnerGroupDraftList` / `PartnerGroupQuoteCard` / `admin/PartnerGroupSettings`）、`routes/p/[token]/+layout.svelte`（MENU）、`PartnerPageSkeleton.svelte`、`routes/admin/+layout.svelte`（サイドバー）、`routes/admin/partners/[id]/+page.svelte`（部品の差し込み 10 行程度） |

- `+page.server.ts` を A、`+page.svelte` を B に割るので同じディレクトリでも衝突しない。`routes/admin/partners/[id]/+page.server.ts` の保存キーの追加（数行）は A。
- 完了後に親がレビュー・結合・バージョン上げ（MINOR）・HANDOFF.md にテストチェックリスト追記。

---

## 12. 要確認（ユーザーに聞く・各々に推奨案）

| # | 論点 | 推奨 |
|---|---|---|
| N1 | 新表の置き場所: `public.rms_partner_group_inquiries`（既存の取引先表と同じ）か、プロジェクト規約の `book` スキーマか | **`public.rms_partner_*`**。取引先の子表はすべてここ・service_role 専用の運用も同じ。ファイル名は `…_rms_partner_group_inquiry.sql` |
| N2 | 宿の回答で料金を変えられる人 | **管理者のみ変更可・スタッフは自動計算額のまま回答**（与信・名義と同じ線） |
| N3 | 団体の支払方法にオンライン決済（Stripe）・デポジットを含めるか | **含めない**（後払い・自由入力のみ）。必要なら後回し |
| N4 | 子ども・添い寝のいる団体 | **備考で受ける**（取引先予約全体が大人のみ）。子ども料金は後回し C |
| N5 | 代表者（宿泊者）の名前の入れ方。名義 `guest` の取引先で `family_name=団体名・given_name='御一行'`、電話＝予約者 | **推奨どおり**。名義 `partner` の取引先は代表者＝旅行会社・部屋別の名前は団体名 |
| N6 | 宿が「受けられる」と回答した時点で在庫を押さえるか | **MVP は押さえない**（承諾時に RPC が確かめる・満室なら宿へ通知）。仮押さえは後回し A |
| N7 | 下書き（束）の保存場所 | **ブラウザ（localStorage）だけ**。別端末で続きは後回し B |
| N8 | 期限切れ・辞退・取り下げのメール | 期限切れは**送らない**、辞退・取り下げは**宿へ 1 通** |
| N9 | 束を同時に回答したときの取引先へのメール | **1 通にまとめる**（件ごとの可否と料金を表で） |
| N10 | 団体予約の既定（kind=agent の取引先で最初からオンか） | **オン**（`groupInquiryEnabled=true`）。ただし環境変数のフラグが on になるまで出ない |
| N11 | 回答の有効期限の既定 | **7 日**（取引先ごとに変更可・回答時にも変更可） |
| N12 | 室数の上限の既定 `groupMaxRooms` | **30**（男鹿・西和賀の総室数以内。施設の部屋タイプの室数を超える値は入力時に警告） |
| N13 | 受付枠（与信）を超えた照会を**送信の時点で**止めるか | **止めない**（宿が判断・回答で「受付枠を超えても受ける」を管理者が付ける） |
| N14 | 承諾の操作に本人確認（aal2）を求めるか | **求めない**（個人予約の後払い確定と同じ。金額が大きいので求めたい場合は `mfa_policy` を `always` にする運用で足りる） |
| N15 | 1 件の予約に部屋タイプの混在を許すか（RPC の変更が要る） | **許さない**（件を分けて同じ束に）。PMS の予約も部屋タイプごとに分かれる方が扱いやすい |

---

## 13. テストチェックリスト（HANDOFF.md へ転記する元・実装時に更新）

#### 取引先ページ（団体予約）
- [ ] kind=agent・団体予約オン・後払いか自由入力の支払方法がある取引先にだけメニュー「団体予約」が出る。corporate / other では出ない（URL 直打ちも 404）
- [ ] 大人 11 名・5 室で部屋ごとの人数が 3-2-2-2-2 になり、合計が合わないと送れない。定員超えは送れない
- [ ] 自動計算額が料金カレンダーの「1室合計」と一致する（1名あたり × 人数 × 泊 × 室）。入湯税の額が合う
- [ ] 料金の無い日（暦の未設定・7名以上）でも「料金は宿からの回答で」として送れる
- [ ] 「束に追加」でフォームの条件が残り、日付欄にフォーカスが移る。`Ctrl+D` で日付 +1 の複製
- [ ] 束を 3 件入れて画面を閉じ、開き直すと残っている。送信すると消える
- [ ] 「前回の内容を使う」で直近の送信の条件（団体名以外）が入る
- [ ] まとめて送信 → 一覧に 3 件・同じ束の帯・状態「回答待ち」。宿へメール 1 通（件名に件数）
- [ ] 回答あり → メールが予約者に届く。一覧で「承諾」→ 予約一覧に PB-… が増え、PMS の予約詳細の要望欄に「団体: 団体名（照会 GI-…）」「夕食開始時間」「交通手段」、備考に宿の回答文。支払方法が照会のもの
- [ ] 旅行会社名義の取引先で承諾 → 代表者＝旅行会社・部屋別の名前が団体名。宿泊者名義なら代表者「団体名 御一行」
- [ ] 回答の後に他販路で満室 → 承諾が止まり「満室のため確定できませんでした」。照会は回答ありのまま。宿へメール
- [ ] 期限を過ぎた回答が 1 時間以内に「期限切れ」になり承諾できない。「同じ条件でもう一度」で複製できる
- [ ] 子ユーザーが送った照会を別の子ユーザーは取り下げられない。マスタは取り下げられる
- [ ] 確認モード（管理画面の「確認ページを開く」）では送信・承諾ができない（表示だけ）
- [ ] 2 施設の取引先で、施設を切り替えると照会の施設が変わり、料金・残室がその施設のもの

#### 管理画面
- [ ] サイドバー「団体照会」に回答待ちの件数。施設アクセスの無い施設の照会は見えない
- [ ] 詳細に泊ごとの残室・自動計算の内訳・受付枠の月別表。超過は赤字
- [ ] スタッフは回答できるが料金欄は変えられない。管理者は 1 名単価／合計で変えられ、回答額が取引先に出る
- [ ] 受付枠超過（deposit の取引先）で「受付枠を超えても受ける」無しの回答 → 取引先の承諾が止まる。チェック付きなら通り、予約一覧に「受付枠超過」の印・PMS の備考に【受付枠超過・宿承認】
- [ ] 束の「全件を受けられるにする」で複数件が一度に回答済みになり、取引先へのメールが 1 通
- [ ] 取引先詳細（agent）に「団体予約」の節。オフにするとメニューが消える。other に変えると節が消える
- [ ] アクセスログに `group_inquiry_*` が日本語で出る
- [ ] `PARTNER_GROUP_INQUIRY=false` ではメニュー・サイドバー・API（404）とも出ない。cron は落ちない
