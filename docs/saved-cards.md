# マイページでのカード登録（保存カード）— 実装設計書

> 作成: 2026-10-07（autumn-book v0.101.0 時点）。同日 §9 を確定し実装（autumn-shared 20261007022727 / 20261007022730・未適用）
> 対象リポ: autumn-book（取引先ページ・公式サイト会員・決済部品）／autumn-shared（migration）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・行・表・列）を付ける。提案には【提案】を付ける。
> Stripe の仕様は 2026-10-07 に公式ドキュメント（docs.stripe.com）で確認した内容。実装時に API リファレンスで再確認すること（§10）。

---

## 1. 目的と範囲（ユーザー決定の整理）

| # | 決定 | 本書での扱い |
|---|---|---|
| D1 | Stripe Customer に支払方法を保存し、予約時に選べるようにする。Payment Element の保存済み決済手段（CustomerSession）方式 | §4（Stripe の方式）・§6（画面） |
| D2 | 取引先（`/p/[token]`）: カードは **取引先ごとに1組（1つの Stripe Customer）**。その取引先の全ユーザーが共有して使う。登録・削除は取引先ページの「アカウント」（マイページ相当）に **【2026-10-10 改定・docs/auth-hardening.md §5・S4・M2】登録・削除・既定の変更はマスタユーザーのみ＋本人確認（aal2）。予約時に保存カードを選んで確定するのは全ユーザーだが本人確認（aal2・12時間有効）が必要（未確認のセッションでは CustomerSession を出さず、Intent に共有 Customer を付けない＝Stripe が保存カードでの確定を断る）。カードの登録し直しも本人確認が必要。オフセッション請求は変更なし** | §5.1・§6.1 |
| D3 | 公式サイトの会員マイページ（`/account`）にも同時に実装（会員ごとの Customer） | §5.2・§6.2 |
| D4 | 予約ごとの同意（チェックアウト日決済の同意文など）と、カード有効期限チェック（`lib/partner-card.ts` の `cardExpiresBefore`・更新期間2か月）は維持。保存カードを選んだときも期限チェックを通す | §7.3 |
| D5 | 予約時決済（PaymentIntent）・デポジット・チェックアウト日決済（SetupIntent・`online_checkin`）すべてで保存カードを使える。オフセッション請求（`chargeDueBookings` 等）の現在の実装と整合 | §7 |
| D6 | 秘密鍵は Claude が扱わない（Cloudflare の環境変数は既にある） | §10（ユーザーの手作業） |

やらないこと（範囲外）:

- Stripe Link（既に `wallets.link: 'never'`・2026-09-26 指示）の有効化
- 管理画面（`/admin`）からの取引先・会員のカード操作（表示は任意・§6.3）
- 過去にチェックアウト日決済で登録したカード（予約ごとの Customer）の保存カードへの移行（§4.4）
- 会員の予約でのカードの「オフセッション請求」（公式サイトはチェックアウト日決済が無い。将来の課題）

---

## 2. 用語

| 用語 | 意味 | 実体 |
|---|---|---|
| Customer | Stripe の顧客オブジェクト。支払方法（PaymentMethod）を束ねる | Stripe `cus_…` |
| PaymentMethod（PM） | 保存されたカード | Stripe `pm_…`（`card.brand / last4 / exp_month / exp_year`） |
| CustomerSession | ブラウザの Payment Element に「この Customer の保存カードを見せてよい」と伝える短命の資格情報 | Stripe `customer_sessions`（`client_secret`・30 分で失効） |
| 共有 Customer（取引先） | 取引先1行（`public.rms_partners`）に1つ持つ Customer。その取引先の全ログインユーザーが使う | `rms_partners.stripe_customer_id`（新設・§5.1） |
| 会員 Customer | 公式サイトの会員（`book.members.user_id`）ごとに1つ持つ Customer | `book.member_payment_profiles.stripe_customer_id`（新設・§5.2） |
| 予約の Customer（現状） | チェックアウト日決済の予約ごとに作っている Customer | `rms_partner_bookings.stripe_customer_id`（既存） |
| 予約時決済 | 予約時にカードへ全額請求（PaymentIntent） | `payment_option='online'` |
| デポジット | 受付枠超過時の一部金（PaymentIntent・額は台帳 `deposit_amount`） | `payment_option='deposit_online'` |
| チェックアウト日決済 | 予約時にカード登録（SetupIntent・`usage=off_session`）・チェックアウト日に off-session 請求 | `payment_option='online_checkin'`（ID は互換のため据え置き） |

---

## 3. 現状（調査結果）

### 3.1 Stripe 呼び出しの所在

出典: `apps/web/src/lib/server/stripe.ts`

- SDK は使わず REST API（`https://api.stripe.com/v1`）を `fetch` で呼ぶ（`stripeFetch`・form-encoded・冪等キー対応）。Cloudflare Workers で軽く動かすため。
- 環境変数: `STRIPE_SECRET_KEY`（`sk_` / `rk_`）・`STRIPE_WEBHOOK_SECRET`・`PUBLIC_STRIPE_PUBLISHABLE_KEY`。`stripeKeyKind()` で種類判定、`inlinePaymentReady()` で画面に出せるか、`stripeTestMode()` でテスト／本番。
- 既存の関数: `createCustomer`（147 行）・`createPaymentIntent`（184 行・`payment_method_types: ['card']`・**customer を付けていない**）・`retrievePaymentIntent`・`createSetupIntent`（206 行・`customer` 必須・`usage: 'off_session'`）・`retrieveSetupIntent(id, expandPaymentMethod)`・`chargeSavedCard`（224 行・`customer + payment_method + off_session + confirm`）・`listRefunds`・`createRefund`・`verifyWebhook`・旧 Checkout の `retrieveCheckoutSession`。
- **無いもの**: CustomerSession の作成、Customer 配下の PaymentMethod の一覧・取り外し（detach）・更新、Customer の既定支払方法の設定。
- metadata の規約（`lib/server/payments/metadata.ts`）: Intent には必ず `app` / `purpose` / `flow='elements'` を付ける。取引先予約は `app='autumn-rms'`・`purpose='rms_partner_booking'`（移設前の値を据え置き・`stripe.ts` 23 行）、公式サイトは `app='autumn-book'`・`purpose='book_direct_booking'`。

### 3.2 Customer の作り方（現状）

出典: `lib/server/partners/booking.ts` 627〜667 行（`preparePartnerPayment`）

- **チェックアウト日決済（`online_checkin`）の予約でだけ**、予約1件につき Customer を作る。`name` は「宿泊者名（取引先名）」、`email` は予約者（担当者）か取引先の連絡先、metadata は `app / purpose / partner_booking_id / booking_code / partner_id`、冪等キー `rms-partner-customer-<予約id>`。作った id は `rms_partner_bookings.stripe_customer_id` に保存。
- 予約時決済（`online`）・デポジット（`deposit_online`）の PaymentIntent は **Customer なし**で作る（`preparePaymentIntent`・`lib/server/payments/intents.ts` 35 行）。
- 公式サイト（`lib/server/direct-payments.ts` 223 行 `prepareDirectPayment`）も PaymentIntent は Customer なし。会員（`book.members`）と Stripe Customer の対応表は **どこにも無い**。
- 結論: 現状の Customer は「予約の付属物」であり、「取引先」「会員」の単位では存在しない。保存カードには、取引先・会員の単位の Customer を新しく持つ必要がある（§5）。

### 3.3 カード登録と有効期限チェック（現状）

出典: `booking.ts` 744〜756 行（`confirmPartnerIntent` の SetupIntent 分岐）、`lib/partner-card.ts`、autumn-shared `20260926082024_rms_partner_booking_checkin_charge.sql`（`rms_partner_mark_card_saved`）

- ブラウザの `confirmSetup` 完了後（または Webhook `setup_intent.succeeded`）に、SetupIntent を `expand=payment_method` で取り直し → `checkSetupIntent`（自分の用途・succeeded・customer と payment_method あり）→ **`cardExpiresBefore(pm.card, check_out_date)`（余裕2か月）で断る**（`status:'card_expiry'`・予約は支払待ちのまま）→ `rms_partner_mark_card_saved(p_customer, p_payment_method, p_card_label)` で確定。
- 同意: 入力欄の直下に `cardConsentText(facilityName, b)`（請求日・金額・内訳・キャンセル料の文）を出し、確定時に同じ文面を `card_consent_text / card_consent_at` に残す（`recordCardSaved` 836〜842 行）。SetupIntent の metadata にも `consent_text` を付ける。
- 予約一覧の「カードを登録し直す」（`canUpdateCard`・`resumePartnerPayment`）も同じ `preparePartnerPayment` を通る（Customer は予約の既存のもの）。
- 画面（`routes/p/[token]/book/+page.svelte` 186〜191 行）には「有効期限がチェックアウト日の月の2か月後以降のカード」の案内文がある（668 行）。

### 3.4 オフセッション請求（現状）

出典: `booking.ts` 871〜939 行（`chargeBooking`）、964〜988 行（`chargeDueBookings`）、1302〜1334 行（`chargeCancelFee`）、`routes/api/cron/partner-charge/+server.ts`

- `chargeDueBookings`: `status='confirmed' and payment_option='online_checkin' and payment_status='scheduled' and check_out_date <= 今日(JST)` を 50 件まで拾い、`chargeBooking` → `chargeSavedCard({ customer: b.stripe_customer_id, paymentMethod: b.stripe_payment_method_id, amount: chargeAmountOf(b) })`。冪等キーは `rms-partner-charge-<予約id>-<試行回数>`。`charge_attempts` の条件付き UPDATE で同時実行を防ぐ。
- キャンセル料のカード請求（`chargeCancelFee`）も同じ列を使う。
- つまり **請求は「台帳の `stripe_customer_id` ＋ `stripe_payment_method_id` の組」だけを見る**。Customer が予約ごとでも共有でも、この組が Stripe 上で有効（PM が Customer に attach されている）なら動く。→ 保存カードを使う設計では、予約の台帳に **共有 Customer の id と選んだ PM の id** を書けばオフセッション請求はそのまま動く（§7.2）。
- 注意: 共有 Customer から PM を **detach すると、その PM を参照している未請求の予約の請求が失敗する**（§7.5 で削除ガード）。

### 3.5 Webhook（現状）

出典: `routes/api/partner/stripe/webhook/+server.ts`、`lib/server/payments/webhook-route.ts`

- `payment_intent.succeeded` / `setup_intent.succeeded` は metadata の `flow='elements'` かつ `app` / `purpose` が自分のもの（取引先予約・公式サイト予約）だけ確定処理に回す。それ以外は `ignore` で 200。
- 新しい用途（マイページのカード登録）に別の `purpose` を付ければ、**Webhook は自動的に無視する**（予約が無いので確定処理は不要）。ブラウザからの確定の連絡だけで完結させる（§7.1）。

### 3.6 決済部品（現状）

出典: `lib/components/payment/StripePayment.svelte`、`types.ts`

- `@stripe/stripe-js` ^9.17.0（`pure` 版）。`s.elements({ mode:'payment', amount, currency, paymentMethodTypes:['card'], appearance, locale })` または `{ mode:'setup', setupFutureUsage:'off_session' }` で deferred intent。`elements.submit()` → 親の `prepare()`（Intent を作って client_secret）→ `confirmPayment` / `confirmSetup`（`redirect:'if_required'`）→ 親の `onconfirmed()`。
- `wallets: { link:'never' }`・`terms: { card:'never' }`・Express Checkout（Apple Pay / Google Pay）あり。
- **CustomerSession を渡す口が無い**（`customerSessionClientSecret` を `elements()` に渡していない）。`change` イベントは `e.complete` だけ使っている。

### 3.7 取引先ページの認証・プレビュー・「アカウント」画面（現状）

出典: `lib/server/partners/portal.ts`、`preview.ts`、`routes/p/[token]/account/*`、`lib/partner-account-roles.ts`

- 取引先は Supabase Auth を使わない独自セッション（`rms_partner_session` クッキー・`rms_partner_accounts` / `rms_partner_sessions`・service_role のみ）。`hooks.server.ts` で `/p/` 配下は `locals.user = null`。
- `requirePortalSession` / `requirePortalApi` が `denyPreviewWrite` を呼び、**確認モード（署名付きクッキー `rms_partner_preview`）では GET / HEAD 以外を 403** にする（`PREVIEW_DENIED_MESSAGE`）。
- 「アカウント」画面はタブ構成（`accountTabs(isMaster)`: 担当者情報 `''`・ご請求書 `invoices`・ユーザー管理 `users`〔マスタのみ〕）。`routes/p/[token]/account/+layout.svelte` がタブを描く。
- `rms_partners` は **施設ごとに1行**（同じ会社でも西和賀・男鹿で別行・`docs/partner-pms-customer-link.md` §3.3）。

### 3.8 公式サイト会員（現状）

出典: `lib/server/auth.ts`、`routes/(public)/account/+layout.server.ts`、`routes/(public)/account/+layout.svelte`、autumn-shared `20260611100200_book_members.sql`

- 会員は Supabase Auth（`MEMBER_SUPABASE = DATA_SOURCE==='supabase' && AUTH_MODE==='supabase'`）。`locals.user.role==='member'`・`book.members`（`user_id` = `auth.users.id`・1:1・**yamado-one と共有**・行の作成は `book.register_member` RPC 経由のみ）。
- マイページのナビ: 予約 `/account`・ポイント `/account/points`・お気に入り `/account/favorites`・コミュニティ `/account/community`・プロフィール `/account/profile`（文言は paraglide の `m.account_nav_*`・ja / en / zh-TW）。
- 予約確認（`routes/(public)/booking/hold/+page.svelte`）: 会員なら `data.member` が入り、カードは `StripePayment`（`mode='payment'`）をインライン表示。`/booking/pay`（`action=prepare`）が `prepareDirectPayment` → `preparePaymentIntent`（Customer なし）。
- 公式サイト予約には SetupIntent（後日請求）の流れが無い。保存カードは **予約時決済（PaymentIntent）でだけ**使う。

---

## 4. Stripe の方式（公式ドキュメントで確認した現行推奨）

### 4.1 保存カードの表示・選択 = CustomerSession ＋ Payment Element

出典: docs.stripe.com `payments/save-customer-payment-methods`、`payments/accept-a-payment-deferred`、`api/customer_sessions/create`

- サーバで `POST /v1/customer_sessions` を `customer=<cus_…>` ＋ `components[payment_element][enabled]=true` ＋ `components[payment_element][features][...]` で作り、`client_secret` をブラウザへ渡す。ブラウザは `stripe.elements({ ..., customerSessionClientSecret })` で Elements を作ると、Payment Element に「保存済み」のカードが並び、選べるようになる。
- deferred intent（`mode / amount` で先に Elements を出し、確定時にサーバで Intent を作る方式＝現状の `StripePayment.svelte`）と **そのまま併用できる**。`elements.submit()` → サーバで Intent → `confirmPayment / confirmSetup`。保存カードが選ばれていれば Stripe.js がその PM で確定する（画面側の分岐は不要）。
- **Intent には CustomerSession と同じ `customer` を付けること**（PaymentIntent / SetupIntent の `customer` パラメータ）。付けないと保存カードでの確定に失敗する。
- `features`（実装時に再確認）:
  - `payment_method_redisplay: 'enabled'` … 保存カードを表示
  - `payment_method_redisplay_limit`（1〜10・既定 3）
  - `payment_method_allow_redisplay_filters`（`always` / `limited` / `unspecified` の配列・既定 `['always']`）
  - `payment_method_save: 'enabled'` … 「今後のために保存」チェックボックス（`mode='payment'` のとき）
  - `payment_method_save_usage: 'off_session'`（保存するカードの用途）
  - `payment_method_remove: 'enabled' | 'disabled'` … Element 内からの削除
- 保存した PM の `allow_redisplay` が `always` のものだけ表示される（既定）。`confirmSetup` / `confirmPayment` の `confirmParams.payment_method_data.allow_redisplay: 'always'` で、Element のチェックボックスの代わりに **自前の同意文に基づいて明示的に設定できる**（マイページ登録でこれを使う・§7.1）。
- `setup_future_usage` を PaymentIntent に指定すると保存の既定動作を上書きできるが、同じ取引で `payment_method_save_usage` と併用すると導入エラーになる（どちらか一方）。
- 「選択されたカードを検出する」: `paymentElement.on('change', e => e.value.payment_method)` で保存カードの選択を拾える（期限の事前警告に使える・§7.3）。
- CustomerSession の `client_secret` は **30 分で失効**し、1つの Elements インスタンスに対して使う。Elements を作り直すとき（`{#key payMode}` で再マウント等）は新しく取り直す（§6.4）。

### 4.2 保存カードの一覧・削除・既定（サーバ API）

- 一覧: `GET /v1/customers/{cus}/payment_methods?type=card`（または `GET /v1/payment_methods?customer=…&type=card`）。
- 削除: `POST /v1/payment_methods/{pm}/detach`。detach した PM はどの Intent でも使えなくなる（§3.4 の注意）。
- 既定: `POST /v1/customers/{cus}` の `invoice_settings[default_payment_method]=pm_…`。Payment Element は既定のカードを先頭に出す（docs: 「顧客にデフォルトの決済手段が設定されている場合は常に最初に表示」）。
- `allow_redisplay` / metadata の更新: `POST /v1/payment_methods/{pm}`（`allow_redisplay`・`metadata`）。
- 取り外しの前に `GET /v1/payment_methods/{pm}` で `customer` が自分の Customer と一致することを確かめる（他の Customer の PM を detach できないようにする・§8）。

### 4.3 オフセッション請求との関係

- 保存カードでチェックアウト日決済（SetupIntent・`usage=off_session`）を確定すると、SetupIntent の `payment_method` に選ばれた PM の id が入る。既存の `recordCardSaved` がそれを台帳に書くので、`chargeBooking` は変更なしで動く（§7.2）。
- 予約時決済の PaymentIntent に `customer` を付けても、返金（`createRefund`）・`charge.refunded` の同期は変わらない。

### 4.4 既存のカード（予約ごとの Customer）は保存カードに出ない

- 既存の SetupIntent で登録した PM は `allow_redisplay='unspecified'`（Payment Element 外で同意を取っているため Stripe は `unspecified` のまま）で、しかも予約ごとの Customer に付いている。共有 Customer の CustomerSession には出ない。
- **移行はしない**（【提案】）。保存カードは「マイページで登録したもの」と「予約時に保存を選んだもの（§9-N3 で有効化するなら）」だけ。既存予約の請求・カード登録し直しは従来どおり予約の Customer で続ける。

---

## 5. データモデル【提案】

### 5.1 取引先: `public.rms_partners` に共有 Customer を持つ

migration: `bash ~/.claude/new-migration.sh autumn-shared rms_partner_stripe_customer`（実 UTC 秒・キリ番禁止）

```sql
alter table public.rms_partners
  -- 取引先（施設ごとの1行）に1つの Stripe Customer。null = まだ作っていない（最初の登録時に作る）
  add column if not exists stripe_customer_id text,
  -- その Customer がテスト／本番どちらのキーで作られたか。キーの切替後に取り違えないため（§5.4）
  add column if not exists stripe_livemode boolean,
  add column if not exists stripe_customer_created_at timestamptz;

create unique index if not exists uq_rms_partners_stripe_customer
  on public.rms_partners (stripe_customer_id) where stripe_customer_id is not null;

comment on column public.rms_partners.stripe_customer_id is
  '取引先共有の Stripe Customer（保存カードの入れ物・2026-10-07）。予約ごとの rms_partner_bookings.stripe_customer_id とは別';
```

- RLS: `rms_partners` は施設アクセスのあるスタッフに読める（既存ポリシーのまま）。Customer id は秘密ではない（それだけでは請求できない）。書き込みは autumn-book のサーバ（service_role）だけ。
- 当面は `rms_partners` の行ごと（現状は施設ごとの行）に Customer を持つので、同じ旅行会社の西和賀用・男鹿用の取引先は別々の Customer になる。取引先の統合後は取引先で1つ（§9-N1）。Customer の名前・metadata・冪等キーは施設を前提にしない。
- 予約の台帳 `rms_partner_bookings.stripe_customer_id / stripe_payment_method_id / card_label` は **そのまま使う**（列は増やさない）。保存カードで確定した予約は、ここに共有 Customer の id と選んだ PM が入る。
- 同意・登録の記録は `rms_partner_access_logs`（既存・`logPartnerAccess`）に `action: 'card_profile_saved' | 'card_profile_removed' | 'card_profile_default'`、`detail: { pm, label, consentText }` で残す（新しい表は作らない）。

### 5.2 会員: `book.member_payment_profiles`（新設・service_role のみ）

migration: `bash ~/.claude/new-migration.sh autumn-shared book_member_payment_profiles`

```sql
create table if not exists book.member_payment_profiles (
  user_id            uuid primary key references book.members(user_id) on delete cascade,
  tenant_id          uuid not null references core.tenants(id),
  stripe_customer_id text not null,
  stripe_livemode    boolean not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists member_payment_profiles_customer_uidx
  on book.member_payment_profiles (stripe_customer_id);
alter table book.member_payment_profiles enable row level security;
-- ポリシー無し = service_role のみ（直販決済 book.direct_payments と同じ扱い）
drop trigger if exists set_updated_at on book.member_payment_profiles;
create trigger set_updated_at before update on book.member_payment_profiles
  for each row execute function core.set_updated_at();
```

- `book.members` に列を足さない理由: 表は yamado-one（モバイル会員アプリ）と共有しており、会員本人が読める RLS がある。Stripe の資格情報の入れ物は会員から直接見えない別表にしておく。
- 会員の退会（`withdrawn_at`・`20260711034711_book_member_withdrawal.sql`）時の扱い: 行は `on delete cascade` に任せる。Stripe 側の Customer の削除は **しない**（返金の履歴が消える）。→ §9-N6。
- 同意の記録: 会員側に `rms_partner_access_logs` に相当する表が無い。**PaymentMethod の `metadata`**（`app=autumn-book`, `purpose=book_member_card`, `member_user_id`, `consent_at`, `consent_version`）に残す【提案】。取引先側も同じ metadata を PM に付け、二重に残す（Stripe 側だけで追えるように）。

### 5.3 PostgREST の公開

- `book` スキーマは Data API に公開済み（CLAUDE.md）。`book.member_payment_profiles` は service_role クライアント（`partnerServiceClient()` → `.schema('book')`）で直接読み書きする（`direct-payments.ts` の `bookDb()` と同じ）。RPC は作らない（単純な 1 行の upsert / select のため）。

### 5.4 テスト／本番モードの取り違え防止

- Stripe の Customer / PM の id はテストモードと本番モードで別世界。保存した `stripe_customer_id` が今のキーのモード（`stripeTestMode()`）と違えば、**無いものとして扱い、作り直す**（上書き）。`stripe_livemode` 列はそのため。
- 実装は共通ヘルパー `resolveCustomer()`（§7.1）に集約し、各画面で判定を書かない。

---

## 6. 画面の変更【提案】

### 6.1 取引先ページ「アカウント」→ 新タブ「お支払いカード」（`/p/[token]/account/cards`）

`accountTabs()` に `{ path:'cards', label:'お支払いカード' }` を足す（担当者情報・ご請求書の次。ユーザー管理より前）。マスタ・子ユーザーのどちらにも出す（D2: 全ユーザーが共有）。

**表示（GET・`+page.server.ts` load）**
- 一覧: ブランド・下4桁・有効期限（MM/YY）・既定バッジ・登録日（PM の `created`）・「このカードを使っている未請求の予約」（§7.5）。
- 空のとき: 「登録されているカードはありません」。
- 説明文: 「ここで登録したカードは、御社の全ユーザーが予約時に選べます。**登録・削除はマスタユーザーのみ**。選んで確定するときは本人確認（メールの認証コード）が必要です。請求はご予約ごとの同意（画面の文面）に基づいて行います。カードの番号は Stripe が保管し、当サイトには保存されません。」（2026-10-10 改定・auth-hardening.md §5.1。子ユーザーには登録フォーム・削除・既定のボタンを出さず「カードの登録・削除は貴社のマスタユーザーが行えます」と案内）
- 確認モード（preview）: Customer を作らず（作成は書き込み）、「確認モードではカードを表示しません」。
- Stripe が使えない環境（`inlinePaymentReady()` false）: 「現在ご利用いただけません」。

**登録（「カードを追加する」ボタン → 同じ画面のモーダル）**
- `StripePayment`（`mode='setup'`・`express=false`〔Apple Pay 等は出さない・§9-N4〕・`consentText`=保存の同意文）。
- 同意文（保存時・登録の記録に残す）: 「このカードを御社のアカウントに保存し、今後のご予約でお支払方法として選べるようにします。保存したカードへの請求は、ご予約ごとの画面でご確認いただく内容（請求日・金額）への同意に基づいて行います。カードは『お支払いカード』からいつでも削除できます。」
- 流れ: `elements.submit()` → `POST /p/[token]/account/cards`（JSON `action:'prepare'`）→ SetupIntent（共有 Customer・`purpose='rms_partner_card'`）→ `confirmSetup({ confirmParams: { payment_method_data: { allow_redisplay: 'always' } } })` → `POST … action:'confirm'`（SetupIntent を取り直して検証・PM の metadata 更新・アクセスログ）→ 一覧を再読込。
- 同じカード（同じ fingerprint）の二重登録: Stripe は別 PM として受け付ける。`confirm` で一覧の `card.fingerprint` と比べ、同じなら新しい方を detach して「既に登録されています」（§9-N5）。

**削除**: 行の「削除」→ 確認ダイアログ → `action:'remove'`（form action・POST）。§7.5 のガードで、未請求の予約が参照していれば断る（予約番号を示す）。
**既定にする**: 行の「既定にする」→ `action:'set_default'`。Payment Element で先頭に出る。

### 6.2 公式サイト会員マイページ → 新ページ「お支払いカード」（`/account/cards`）

- ナビ（`(public)/account/+layout.svelte`）に `m.account_nav_cards()` を足す（ja「お支払いカード」/ en「Payment cards」/ zh-TW「付款卡片」。paraglide のメッセージ3言語を追加）。
- 画面構成は 6.1 と同じ（一覧・追加モーダル・削除・既定）。`StripePayment` の `locale` / `texts` は既存の公式サイトの差し替えを使う。
- API: `POST /account/cards`（form actions: `prepare` は JSON を返したいので `+server.ts` を `/account/cards/api` に分けるか、`/booking/pay` と同じく `+server.ts` 1本で `action` 分岐）。`locals.user.role==='member'` かつ `MEMBER_SUPABASE` のときだけ。デモ（`DATA_SOURCE='demo'`）では「この環境では使えません」。
- 会員の予約一覧（`/account`）・予約詳細には変更なし。

### 6.3 管理画面（任意・最小）

- `/admin/partners/[id]`: 「オンライン決済」セクションに「保存カード: N 枚（最終登録 日時）」を表示（読むだけ・Stripe を1回呼ぶ）。操作ボタンは置かない。
- `/admin/reservations/[code]` など会員側の表示は変更なし。

### 6.4 予約画面での選択

**取引先 `/p/[token]/book`（入力・確認）**
- 支払方法が `online` / `deposit_online` / `online_checkin` のいずれかで、取引先に共有 Customer があり保存カードが1枚以上あるとき、Payment Element の「保存済み」にカードが並ぶ（Stripe が描く。自前の一覧は作らない）。
- CustomerSession の取得: `StripePayment` のマウント時に親が `POST /p/[token]/payment`（`action:'customer_session'`）で取り、`customerSessionClientSecret` prop で渡す。**load で作らない**（30 分失効・`{#key payMode}` の再マウントで作り直すため、都度 POST）。確認モードは POST が 403 → `null` で従来どおり新規入力だけ。
- 「このカードを保存する」チェックボックス（`payment_method_save`）は **第1段階では出さない**（`payment_method_save:'disabled'`・§9-N3）。登録はマイページだけ。
- チェックアウト日決済の案内文（668 行）は維持。保存カードが選ばれ、`e.value.payment_method.card` の期限が `cardExpiresBefore(card, quote.checkOut)` に当たるときは、部品の下に「このカードは有効期限が近いため、このご予約には使えません。別のカードをお選びください」を**確定前に**出し、確定ボタンを止める（§7.3）。
- 予約一覧 `/p/[token]/bookings` のモーダル（お支払いへ進む・カードの登録へ進む・登録し直す）も同じ prop を渡す。

**公式サイト `/booking/hold`**
- 会員ログイン中で会員 Customer に保存カードがあれば同様に並ぶ。CustomerSession は `POST /booking/pay`（`action:'customer_session'`）で取る。非会員・デモは従来どおり。

---

## 7. サーバ処理【提案】

### 7.1 共通ヘルパー `lib/server/payments/saved-cards.ts`（新設）

```ts
// Customer の解決（無ければ作る・モード違いなら作り直す）
resolvePartnerCustomer(db, partner, { create: boolean }): Promise<string | null>
  // name: 取引先名（施設名）, email: partner.contact_email, metadata: { app:'autumn-rms', purpose:'rms_partner_card', partner_id, facility }
  // 冪等キー: `rms-partner-shared-customer-${partner.id}-${mode}`。作ったら rms_partners を UPDATE
resolveMemberCustomer(db, member: { userId, tenantId, name, email }, { create }): Promise<string | null>
  // metadata: { app:'autumn-book', purpose:'book_member_card', member_user_id }、冪等キー `book-member-customer-${userId}-${mode}`。book.member_payment_profiles を upsert
createCustomerSession(customer, { save: boolean }): Promise<{ clientSecret: string; expiresAt: number }>
listSavedCards(customer): Promise<SavedCard[]>   // { id, brand, last4, expMonth, expYear, isDefault, created, fingerprint }
prepareCardSetup(customer, metadata, idempotencyKey): Promise<PreparedIntent>   // createSetupIntent をそのまま
confirmCardSetup(intentId, expect: { app, purpose, refKey, refId }, customer): Promise<SavedCard>
  // retrieveSetupIntent(expand) → checkSetupIntent → customer 一致 → updatePaymentMethod(allow_redisplay:'always', metadata) → SavedCard
detachSavedCard(customer, pm): Promise<void>     // retrievePaymentMethod → pm.customer === customer でなければ 403
setDefaultCard(customer, pm): Promise<void>      // 同じ検証 → updateCustomer(invoice_settings.default_payment_method)
```

`lib/server/stripe.ts` に足す REST ラッパ: `createCustomerSession`・`listPaymentMethods`・`retrievePaymentMethod`・`updatePaymentMethod`・`detachPaymentMethod`・`updateCustomer`。`createPaymentIntent` に省略可能な `customer` を足す。`stripe.ts` の用途定数に `STRIPE_PURPOSE_PARTNER_CARD='rms_partner_card'`・`STRIPE_PURPOSE_MEMBER_CARD='book_member_card'` を足す（Webhook は purposes に含めないので無視される・§3.5）。

### 7.2 取引先の予約フロー（`booking.ts` `preparePartnerPayment` の変更）

| 支払方法 | 現状 | 変更後 |
|---|---|---|
| `online` / `deposit_online`（PaymentIntent） | Customer なし | `resolvePartnerCustomer(create:false)` が返れば `customer` を付けて作る（無ければ従来どおり Customer なし）。`isReusableIntent` に「既存 PI の `customer` が今回の customer と違えば使い回さない」を足す（`intents.ts`） |
| `online_checkin`（SetupIntent） | 予約ごとに Customer を作る | **共有 Customer があればそれを使う**。無ければ従来どおり予約ごとに作る（`rms-partner-customer-<予約id>`）。`rms_partner_bookings.stripe_customer_id` には使った Customer を書く |
| 確定（`confirmPartnerIntent`） | `checkSetupIntent` → 期限チェック → `rms_partner_mark_card_saved(p_customer, p_payment_method, …)` | 変更なし。保存カードで確定した SetupIntent の `payment_method` は保存カードの PM id、`customer` は共有 Customer。台帳にそのまま入る |
| オフセッション請求（`chargeBooking` / `chargeCancelFee`） | 台帳の `stripe_customer_id + stripe_payment_method_id` | **変更なし**（§3.4）。共有 Customer ＋ 保存 PM の組で請求できる |
| カードの登録し直し（`canUpdateCard` → `resumePartnerPayment`） | 予約の Customer で SetupIntent | 予約の Customer が共有 Customer なら保存カードから選び直せる。予約ごとの Customer（旧予約）は従来どおり |

- 予約時決済で「保存を選ばない新規カード」は `customer` 付き PI でも保存されない（`setup_future_usage` も `payment_method_save` も付けないため）。
- デポジット: 金額が `deposit_amount` になる以外は `online` と同じ（`intentAmountOf`・既存）。

### 7.3 期限チェック（D4）— 2段構え

1. **確定前（画面）**: Payment Element の `change` で `e.value.payment_method?.card`（`exp_month` / `exp_year`）が取れたら、`cardExpiresBefore(card, checkOutDate)` を**ブラウザでも**評価して警告・ボタン停止（`lib/partner-card.ts` は純関数でブラウザでも使える）。新規入力のカードは `change` に `card` が入らない（Stripe が保持）ため、この段階では分からない → 2 へ。
2. **確定後（サーバ）**: 既存の `confirmPartnerIntent` の `cardExpiresBefore` 判定（`card_expiry`）を **保存カードでも必ず通す**（SetupIntent を `expand=payment_method` で取り直すので、保存カードでも `card.exp_*` が読める）。`card_expiry` のときは予約は支払待ちのまま、「有効期限が近いため登録できません。別のカードをお選びください」（既存の文言）。
3. マイページ登録時は「請求日」が無いので期限チェックは **今日基準の `margin=0`**（切れているカードは登録不可）だけにする。予約時の2か月ルールは予約で判定する。
4. 予約時決済（PaymentIntent）は期限チェック不要（その場で請求されるため）。現状も行っていない。

### 7.4 同意（D4）

- チェックアウト日決済の同意文（`cardConsentText`・請求日・金額・内訳・キャンセル料）は **保存カードを選んでも同じ文面を同じ位置に出し**、`card_consent_text / card_consent_at` を同じように記録する（変更なし）。
- マイページの「保存の同意文」（§6.1）は、保存の同意であって請求の同意ではない。この区別を画面に明記する。
- 予約時決済・デポジットの事務手数料の注記（`adminFeeNotice`）は従来どおり。

### 7.5 削除ガード

- `detachSavedCard` の前に、取引先なら `rms_partner_bookings` を `stripe_payment_method_id = pm and status='confirmed' and payment_status in ('scheduled','charge_failed')`（＋キャンセル料の未請求 `cancel_fee_settlement='card' and cancel_fee_status is distinct from 'charged'`）で引き、1件でもあれば **削除を断る**（「予約番号 PB-… のお支払いに使われています。先に予約一覧から別のカードを登録し直してください」）。
- 会員側は公式サイトにオフセッション請求が無いので、ガードは不要（§9-N7 で将来に備えるか）。
- Stripe 側の `payment_method.detached` Webhook は購読しない（自分の操作だけで detach するため）。Stripe ダッシュボードから手で detach された場合は次回請求が失敗 → 既存の `charge_failed` → メール → 登録し直し、の流れで救う。

### 7.6 会員の予約フロー（`direct-payments.ts` `prepareDirectPayment`）

- `memberUserId` があり `resolveMemberCustomer(create:false)` が返れば、PaymentIntent に `customer` を付ける（`preparePaymentIntent` に `customer` を通す）。それ以外は従来どおり。
- `confirmDirectIntent`・返金・Webhook は変更なし。
- CustomerSession は `/booking/pay`（`action:'customer_session'`）で返す（会員・`directPaymentsReady()`・Customer あり、のときだけ）。

### 7.7 API ルート一覧

| ルート | メソッド・action | 入口の検証 | 処理 |
|---|---|---|---|
| `/p/[token]/account/cards` | GET（load） | `requirePortalSession` | 一覧（preview は Stripe を呼ばない） |
| `/p/[token]/account/cards` | POST form `remove` / `set_default` | `requirePortalSession`（preview 403） | §7.5 ガード → detach／既定 → アクセスログ |
| `/p/[token]/account/cards/api` | POST JSON `prepare` / `confirm` | `requirePortalApi`（preview 403） | SetupIntent（共有 Customer・`purpose='rms_partner_card'`・`refKey='partner_id'`）／確定・`allow_redisplay`・metadata・ログ |
| `/p/[token]/payment` | POST JSON `customer_session`（追加） | `requirePortalApi` | 共有 Customer があれば CustomerSession（`payment_method_save:'disabled'`・`payment_method_remove:'disabled'`）。無ければ `{ ok:true, clientSecret:null }` |
| `/account/cards` | GET（load） | `(public)/account/+layout.server.ts`（会員） | 一覧 |
| `/account/cards` | POST form `remove` / `set_default` | 会員・`MEMBER_SUPABASE` | detach／既定 |
| `/account/cards/api` | POST JSON `prepare` / `confirm` | 会員 | SetupIntent（会員 Customer・`purpose='book_member_card'`・`refKey='member_user_id'`） |
| `/booking/pay` | POST form `customer_session`（追加） | 会員・`directPaymentsReady()` | CustomerSession |

`StripePayment.svelte` の変更: props に `customerSessionClientSecret?: string | null`・`allowRedisplay?: 'always' | null`（setup の `confirmParams.payment_method_data.allow_redisplay`）・`onsavedcardchange?: (card: { id, brand, last4, expMonth, expYear } | null) => void`（`change` の `e.value.payment_method`）を足す。`elements()` の引数に `customerSessionClientSecret` を通す。既存の呼び出し（取引先予約・公式サイト予約）は props 未指定で従来どおり動く。

---

## 8. セキュリティ

| 論点 | 対策 |
|---|---|
| 取引先トークンの権限 | カードの表示・登録・削除は `requirePortalSession` / `requirePortalApi` を通ったセッション（ログイン済みの取引先）だけ。Customer は `partner.id` から引く（リクエストの値で Customer を指定させない） |
| 他取引先のカードを使えないこと | (a) CustomerSession は自分の取引先の Customer でしか作らない。(b) `prepare`（Intent 作成）はサーバが `customer` を決める。(c) `confirm` では SetupIntent / PaymentIntent を取り直し、`customer` が自分の Customer と一致しなければ `unknown`（`checkSetupIntent` に customer の期待値を足す）。(d) detach / 既定は `retrievePaymentMethod` で `pm.customer` を確かめる（PM id を他取引先のものに差し替えても 403） |
| 確認モード（preview） | 既存の `denyPreviewWrite` で POST は全て 403。GET の load でも **Customer を作らない**（作成は Stripe への書き込み）。CustomerSession の POST も 403 → 画面は保存カード無しで動く |
| 会員 | `locals.user.role==='member'` ＋ `MEMBER_SUPABASE`。Customer は `user_id` から引く。`book.member_payment_profiles` は service_role のみ |
| 秘密鍵 | 既存の `STRIPE_SECRET_KEY` をそのまま使う。新しい環境変数は不要。制限付きキー（`rk_`）を使っている場合は Customer Sessions / Payment Methods の **書き込み**権限が要る（§10） |
| Webhook | 新しい purpose（`rms_partner_card` / `book_member_card`）は `routeStripeEvent` の purposes に含めないので `ignore`。予約の確定処理に紛れ込まない。`payment_intent.succeeded` の処理は PI に `customer` が付いても `checkPaymentIntent`（app / purpose / refId / 金額）で従来どおり検証 |
| Intent の使い回し | `isReusableIntent` に customer の一致を足す（customer 無しの古い PI を customer 付きで確定しない） |
| CustomerSession の漏えい | `client_secret` は 30 分で失効・公開可能キーと組でしか使えず、サーバ側の操作（detach・既定）はできない（`payment_method_remove:'disabled'` にすれば Element からの削除も不可）。取引先ページの応答は既存の `PORTAL_HEADERS`（`no-store`・`no-referrer`） |
| PCI | カード番号は Payment Element（Stripe の iframe）だけが扱う。当サイトの DB に入るのは `pm_…`・ブランド・下4桁・有効期限（表示用）だけ（現状と同じ） |
| レート | `prepare` の冪等キー: 取引先 `rms-partner-card-si-${partner.id}-${accountId}-${Date.now()}` は冪等にならないので、`${partner.id}-${sessionId}-${n}`（画面が持つ連番）か、単に毎回新しい SetupIntent を作る（未使用の SI は無害）。推奨: 毎回新規・冪等キー無し（§9-N8） |

---

## 9. 決定事項（2026-10-07 確定・ユーザー決定）

N1〜N11 はすべて推奨案で確定した（2026-10-07 ユーザー決定）。N1 は同日の追加前提（取引先の統合）を反映。

| # | 論点 | 確定 |
|---|---|---|
| N1 | 同じ旅行会社の西和賀用・男鹿用の取引先（`rms_partners` 2行）でカードを共有するか | **当面は `rms_partners` の行ごと（現状は施設ごとの行）。取引先の統合後は取引先で1つ。** 取引先は将来 Book 内で唯一になり、施設はオン/オフの設定になる（2026-10-07 ユーザー決定・統合の実装は当面しない）。保存カードの Customer は「取引先に1つ」とし、Customer の名前・metadata・冪等キー・画面の文言で施設を前提にしない（`facility` は metadata に参考情報として入れるだけ） |
| N2 | 削除・既定変更ができる人 | **全ユーザー**（登録と削除の権限を分けない）。削除は §7.5 のガードで事故を防ぎ、アクセスログに誰が消したかを残す |
| N3 | 予約時決済で「このカードを保存する」チェックボックス（`payment_method_save`）を出すか | **第1段階は出さない**（`payment_method_save:'disabled'`）。登録はマイページだけ。第2段階で `payment_method_save:'enabled'`＋`payment_method_save_usage:'off_session'` を足す |
| N4 | マイページ登録で Apple Pay / Google Pay を出すか | **出さない**（`express=false`）。予約画面の Express Checkout は従来どおり |
| N5 | 同じカードの二重登録 | **弾く**（fingerprint が同じなら新しい方を detach して「既に登録されています」） |
| N6 | 会員退会時の Stripe Customer | **残す**（返金・明細の履歴のため）。`book.member_payment_profiles` の行は cascade で消える。保存 PM の detach を退会処理に足すのは第2段階 |
| N7 | 会員側の削除ガード | **不要**（公式サイトに後日請求が無い）。作るときは §7.5 と同じ形 |
| N8 | マイページ登録の SetupIntent の冪等キー | **毎回新規（キー無し）** |
| N9 | CustomerSession の `payment_method_redisplay_limit` | **10** |
| N10 | 管理画面に保存カードの枚数を出すか（§6.3） | **出す（枚数と最終登録日だけ）**。操作はさせない |
| N11 | 取引先の共有 Customer の `email` | **取引先の連絡先（`contact_email`）**。Stripe の領収書メールは送らない設定のまま（§10） |

### 9.1 実装で決めたこと（2026-10-07・設計からの差分）

- `StripePayment.svelte` の CustomerSession は、文字列の prop ではなく **取得関数 `customerSession?: () => Promise<string | null>`** で受ける。部品のマウントのたびに呼ぶので、`{#key payMode}` の再マウント・モーダルの開き直しで必ず新しい secret を使う（§6.4・§14）。失敗・確認モード（POST 403）は `null` で従来どおり。
- 予約画面の有効期限の事前警告は、`change` の `e.value.payment_method` に `card` が無い型定義のため、`customer_session` の応答に **保存カードの id と有効期限の一覧**（`cards`）を付け、選ばれた id から引く（`selectedCardExpiresBefore`）。
- `customer_session`（取引先）は予約 id を受け、予約の Customer が予約ごとのもの（旧予約）なら出さない（`savedCardCustomerFor`）。Intent に付く Customer と CustomerSession の Customer を必ずそろえるため。
- チェックアウト日決済で共有 Customer を使う予約に **新しいカード**を入力すると、そのカードも共有 Customer に付く（SetupIntent の仕様）。`allow_redisplay` は `unspecified` のままなので、マイページの一覧・予約画面の「保存済み」には出ない（一覧は `allow_redisplay='always'` だけ）。
- `confirmPartnerIntent` の SetupIntent の検証に「台帳の `stripe_customer_id` と一致」を足した（§8 (c)）。
- 最初に保存した1枚は自動で既定にする（Payment Element の先頭に出る）。
- DB の列が未適用の環境では、読み取りは「Customer なし」として従来どおり動く（予約画面に保存カードが出ないだけ）。登録しようとしたときだけ「現在ご利用いただけません」。

---

## 10. Stripe ダッシュボード側で必要な設定（ユーザーが手でやる作業）

1. **キーの権限（制限付きキー `rk_` を使っている場合のみ）**: 「開発者 → API キー → 制限付きキー」で、既存の PaymentIntents / SetupIntents / Customers / Refunds の書き込みに加えて **Customer Sessions: 書き込み**、**Payment Methods: 書き込み** を付ける。`sk_` を使っていれば不要。`stripeKeyKind()` が `restricted` を返すかで判別できる。
2. **Webhook**: 追加のイベント登録は **不要**（`setup_intent.succeeded` は既に登録済み。新用途は `ignore` で 200 を返す）。
3. **メール送信設定（任意確認）**: 「設定 → 顧客メール」で「支払い方法の保存時」に Stripe がメールを送る設定が **OFF** であること（自前の画面で案内するため・既定 OFF）。
4. **Link**: 既存のまま（部品側で `link:'never'`）。ダッシュボードで Link を切る必要はない。
5. **テスト**: テストモードのキーで `4242 4242 4242 4242`（登録・既定・削除）、`4000 0000 0000 0002`（拒否）、有効期限を近くしたカード（期限チェック）、`4000 0025 0000 3155`（3D セキュア要）で確認。テストモードで作った Customer は本番キーに切り替えると無効になる（§5.4 で自動的に作り直す）。
6. **本番切替後**: 取引先・会員の Customer は本番で初めてカードを登録したときに作り直される。テストモードの Customer を手で消す必要はない。

---

## 11. テストチェックリスト（HANDOFF.md に転記する）

### 取引先ページ「お支払いカード」
- [ ] アカウント → 「お支払いカード」タブが出る（マスタ・子ユーザーの両方）。初回は「登録されているカードはありません」
- [ ] 「カードを追加する」→ モーダルで 4242 を登録 → 一覧にブランド・下4桁・有効期限・登録日。`rms_partners.stripe_customer_id` が入り、Stripe の Customer に PM が付いている（`allow_redisplay=always`・metadata に `partner_id`）
- [ ] 同じ取引先の別ユーザーでログイン → 同じカードが一覧に出る
- [ ] 同じカードをもう一度登録 → 「既に登録されています」（一覧は1枚のまま）
- [ ] 有効期限切れのカード（テスト用）→ 登録できない
- [ ] 2枚目を登録 → 「既定にする」→ 予約画面の保存済みで先頭に出る
- [ ] 「削除」→ 確認 → 一覧から消え、Stripe でも detach されている。アクセスログに `card_profile_removed`
- [ ] チェックアウト日決済でそのカードを使った未請求の予約があるとき、削除が断られ予約番号が示される
- [ ] 確認モード（管理画面の「確認ページを開く」）: 一覧は「確認モードでは表示しません」・追加・削除のボタンが無い／POST が 403。`rms_partners.stripe_customer_id` が作られていない
- [ ] Stripe の鍵が無い環境: 「現在ご利用いただけません」で落ちない

### 取引先ページの予約で保存カードを使う
- [ ] 予約時決済（`online`）: カード入力欄に「保存済み」の一覧が出る → 選んで確定 → 予約確定・Stripe の PaymentIntent に `customer` が付き、`payment_method` が保存 PM
- [ ] デポジット（`deposit_online`）: 同様に保存カードで支払える（額は `deposit_amount`）
- [ ] チェックアウト日決済（`online_checkin`）: 保存カードを選び、同意文が入力欄の直下に出る → 確定 → 台帳の `stripe_customer_id` が共有 Customer・`stripe_payment_method_id` が保存 PM・`card_label`・`card_consent_text / at` が入る
- [ ] 同じ予約のチェックアウト日に cron（`/api/cron/partner-charge?wait=1`）で請求が通る（`rms_partner_mark_charged`・PMS に paid 電文）
- [ ] 保存カードの有効期限がチェックアウト日の月から2か月以内のとき: 選んだ時点で警告・確定不可。サーバ側でも `card_expiry` になる（画面の警告を無理に抜けた場合）
- [ ] 新規カードを入力して確定 → 保存されない（マイページの一覧に増えない・N3）
- [ ] 保存カードが無い取引先 → 従来どおり新規入力だけ（「保存済み」の見出しが出ない）
- [ ] 予約一覧の「カードを登録し直す」（請求失敗の予約）→ 保存カードから選べる → 登録し直し後にその場で請求
- [ ] 別の取引先の PM id を `remove` / `set_default` に送る → 403（curl で確認）
- [ ] Webhook 配信履歴: マイページ登録の `setup_intent.succeeded` が 200（`ignored: not_ours`）
- [ ] 取消・返金: 保存カードで払った予約の取消で、既存どおり一部返金・事務手数料の扱い

### 公式サイト会員
- [ ] `/account/cards` がナビに出る（ja / en / zh-TW）。非会員は `/auth/login` へ
- [ ] カードの登録・既定・削除ができ、`book.member_payment_profiles` に1行
- [ ] 予約確認（`/booking/hold`）で会員ログイン中なら「保存済み」が出て、選んで支払える（PaymentIntent に `customer`）。非会員・デモでは出ない
- [ ] 早期決済割・ポイント利用・3D セキュアの流れが保存カードでも従来どおり
- [ ] デモ環境（`DATA_SOURCE=demo`）で `/account/cards` を開いても落ちない（「この環境では使えません」）

### 共通
- [ ] テストキー → 本番キーに切り替えた環境で、テストの `stripe_customer_id` が残っていてもエラーにならず、本番で作り直される
- [ ] 既存の決済（保存カード無し）のテストチェックリスト（HANDOFF.md「同じ画面で払う」の項）が従来どおり通る（回帰）
- [ ] スマホ（375px）でカード一覧・モーダルが横にはみ出さない

---

## 12. 実装の分割案（Opus エージェントに渡す粒度）

依存: A → B → (C ∥ D) → E。A と B は同じ人でもよい。

### A. 土台（autumn-shared migration ＋ Stripe REST ラッパ）
- autumn-shared: `…_rms_partner_stripe_customer.sql`（§5.1）、`…_book_member_payment_profiles.sql`（§5.2）。`new-migration.sh` で実 UTC 秒。main 直 push → `supabase migration list --linked` で適用確認（CLAUDE.md の流れ）。
- autumn-book `lib/server/stripe.ts`: `createCustomerSession`・`listPaymentMethods`・`retrievePaymentMethod`・`updatePaymentMethod`・`detachPaymentMethod`・`updateCustomer`・`createPaymentIntent` の `customer`（省略可）・用途定数2つ。
- `lib/server/payments/intents.ts`: `preparePaymentIntent` に `customer`、`verify.ts` `isReusableIntent` / `checkSetupIntent` に customer の一致。既存テスト（`payments.test.ts`）に追記。
- 受け入れ: `npm run check`・`npm test` が通る。既存の決済の流れは挙動不変。

### B. 共通ヘルパー＋決済部品
- `lib/server/payments/saved-cards.ts`（§7.1）＋純関数部分（`SavedCard` の整形・fingerprint 重複判定・期限判定の呼び出し）のテスト。
- `lib/components/payment/StripePayment.svelte`: `customerSessionClientSecret`・`allowRedisplay`・`onsavedcardchange` の3 props（§7.7）。`types.ts` に型。
- 受け入れ: props 未指定で既存画面が変わらない（鍵なし環境での表示確認）。

### C. 取引先側
- `lib/partner-account-roles.ts` `accountTabs` に `cards`。`routes/p/[token]/account/cards/+page.server.ts`・`+page.svelte`・`cards/api/+server.ts`（§6.1・§7.7）。
- `routes/p/[token]/payment/+server.ts` に `customer_session`。`booking.ts` `preparePartnerPayment`（§7.2）。
- `routes/p/[token]/book/+page.svelte`・`bookings/+page.svelte`: CustomerSession の取得と prop、期限の事前警告（§7.3）。
- 管理画面の枚数表示（§6.3・N10）。
- 受け入れ: §11「取引先」の項目。

### D. 会員側
- `routes/(public)/account/cards/+page.server.ts`・`+page.svelte`・`cards/api/+server.ts`。ナビとメッセージ（ja / en / zh-TW）。
- `routes/(public)/booking/pay/+server.ts` に `customer_session`、`direct-payments.ts` `prepareDirectPayment` に customer（§7.6）、`hold/+page.svelte` に prop。
- 受け入れ: §11「公式サイト会員」の項目。

### E. 仕上げ（親が行う）
- HANDOFF.md に本機能の節とテストチェックリスト（§11）を追記。`package.json` ×2 の版上げ（MINOR）。コミットメッセージは日本語・版つき。
- 本番（テストキー）での通し確認は、鍵を持つユーザーが §11 を流す。

---

## 13. 影響範囲（触るファイルの見取り図）

| リポ | ファイル | 分割 |
|---|---|---|
| autumn-shared | `supabase/migrations/…_rms_partner_stripe_customer.sql`・`…_book_member_payment_profiles.sql` | A |
| autumn-book | `lib/server/stripe.ts`・`lib/server/payments/intents.ts`・`verify.ts`・`payments.test.ts` | A |
| autumn-book | `lib/server/payments/saved-cards.ts`（新）・`saved-cards.test.ts`（新）・`lib/components/payment/StripePayment.svelte`・`types.ts` | B |
| autumn-book | `lib/partner-account-roles.ts`・`routes/p/[token]/account/cards/**`（新）・`routes/p/[token]/payment/+server.ts`・`lib/server/partners/booking.ts`・`routes/p/[token]/book/+page.svelte`・`routes/p/[token]/bookings/+page.svelte`・`routes/admin/partners/[id]/+page.server.ts`／`+page.svelte` | C |
| autumn-book | `routes/(public)/account/cards/**`（新）・`routes/(public)/account/+layout.svelte`・`messages/{ja,en,zh-TW}.json`・`routes/(public)/booking/pay/+server.ts`・`lib/server/direct-payments.ts`・`routes/(public)/booking/hold/+page.svelte` | D |
| autumn-book | `HANDOFF.md`・`package.json`・`apps/web/package.json` | E |

---

## 14. 補足（調査で分かった注意点）

- `rms_partner_bookings.stripe_customer_id` は列名が同じでも意味が「予約の Customer」から「予約に使った Customer（共有のことも予約ごとのことも）」に広がる。コメント（migration の `comment on column`）で明記する。
- `prepareSetupIntent` は既存 SI の `customer` が引数と一致するときだけ使い回す（`intents.ts` 53〜54 行）。共有 Customer に切り替えた予約で、旧 SI（予約ごとの Customer）が残っていても自動的に作り直される。
- `StripePayment.svelte` の `{#key payMode}` 再マウントのたびに CustomerSession を取り直す（30 分失効・1 Elements に 1 secret）。取り直しに失敗しても `null` で従来どおり動くこと（Stripe docs: 「エラーが発生した場合、CustomerSession の client secret はオプションなので指定する必要はない」）。
- Payment Element の「保存済み」でカードを選ぶと、`elements.submit()` 後の `confirmPayment` は保存 PM で確定する。Apple Pay / Google Pay（Express Checkout）は別経路で、保存カードとは無関係。
- 共有 Customer の `email` を取引先の連絡先にすると、Stripe の設定次第で領収メールが取引先に届く。現状と同じ（予約ごとの Customer も `email` を入れている）。
- `cardExpiresBefore` は「有効期限が読めなければ通す」（`partner-card.ts` 9 行・32 行）。保存カードは PM に `exp_*` が必ずあるので、保存カードの方が判定が確実になる。
- 取引先ページは `/p/<token>` 配下で会員の `locals.user` を持ち込まない（`hooks.server.ts`）。取引先の共有 Customer と会員 Customer が混ざる経路は無い。
