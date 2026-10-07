# 取引先予約の添付ファイル — 実装設計書

> 作成: 2026-10-07（autumn-book v0.101.0・autumn-pms v4.731.0 時点。読み取り調査のみ。実装・migration・DB 書き込みは未着手）
> 更新: 2026-10-07 §11 の N1〜N11 をすべて推奨案で確定（ユーザー決定）。§12 の A・B・C を実装（migration は未適用・PMS は未コミット）。実装で決めたことは §11.1
> 対象リポ: autumn-book（取引先ページ・管理画面）／autumn-shared（migration）／autumn-pms（取込・予約詳細・新着通知）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典（ファイル・表・列）を付ける。提案には【提案】を付ける。
> 前提の設計書: `docs/partner-pms-customer-link.md`（取引先予約 → PMS の電文の流れ・Phase 1〜3b）

---

## 1. 目的と範囲

ユーザー決定（2026-10-07）:

1. 取引先ページ（`/p/[token]`）の各予約に、**添付ファイルを複数**、ドラッグ＆ドロップまたはファイル選択で付けられる。予約入力時（`/p/[token]/book`）でも、後から予約一覧（`/p/[token]/bookings`）からでも。
2. PMS の予約詳細の添付ファイル（`pms.reservation_attachments`・Storage バケット `reservation-attachments`・`stay_group_id` 単位）に**連動**する。
3. **添付だけ更新されたときも PMS に通知する。** 取引先予約 → PMS の連携は `public._rms_partner_emit_pms_event`（schema `autumn.direct_booking/1`・`pms.direct_booking_inbox`）。
4. **PMS 取込前は Book 側で保管し、取込時に引き継ぐ。**

やること（範囲）:

- Book 側の台帳（新表）・保管（Storage）・アップロード／ダウンロード／削除の API と画面（取引先ページ・管理画面）
- 電文への添付情報の追加と、添付だけの更新を知らせる新しいイベント種別
- PMS 側の取込（写しの作成・同期）・新着通知・予約詳細の表示

やらないこと（範囲外）:

- 公式サイト（一般のお客様）の予約への添付
- PMS の添付機能そのものの作り直し（表・バケット・Edge Function は変えない。列を1つ足すだけ）
- ウイルススキャン基盤の導入（§9.5 に配慮事項と将来案だけ書く）
- 添付をメールに付けて送ること（PMS の既存の「事前応対メールの添付」は、写しの行を通じてそのまま使える）

---

## 2. 用語

| 用語 | 意味 | 実体 |
|---|---|---|
| 取引先予約 | 取引先ページから入った予約 | `public.rms_partner_bookings`（台帳）＋ `booking.bookings` ＋ `core.stays` |
| 予約グループ | PMS の予約の単位。予約詳細・添付・請求はこれ起点 | `pms.stay_groups`（`metadata.book_booking_id` で取引先予約と結ぶ） |
| PMS 添付 | PMS の予約詳細の「添付ファイル」欄のファイル | `pms.reservation_attachments` ＋ バケット `reservation-attachments` |
| Book 添付（本書で新設） | 取引先ページ／Book 管理画面で予約に付けたファイル | `public.rms_partner_booking_attachments`【提案】＋ 同じバケットの `partner-booking/` 配下 |
| 写し | 取込時に PMS 側に作る、Book 添付と同じ実体を指すメタ行 | `pms.reservation_attachments`（`source_key = 'rms_partner:<Book 添付 id>'`） |
| 電文 | 取引先予約 → PMS の JSON | `pms.direct_booking_inbox.payload`（`autumn.direct_booking/1`） |
| 取込 | PMS の cron が電文を `pms` に展開すること | `autumn-pms /api/cron/direct-booking-import` → `lib/server/direct-booking/import.ts` |
| 確認モード | Book のスタッフが取引先のアカウント無しで取引先ページを見る状態。書き込み禁止 | `lib/server/partners/preview.ts`・`portal.ts` の `denyPreviewWrite` |

---

## 3. 現状（調査結果）

### 3.1 PMS の添付ファイルの仕組み

出典: `autumn-shared/supabase/migrations/20260712070919_pms_reservation_attachments.sql`、`20260826022637_pms_correspondence_files.sql`、`20261006205712_pms_scheduled_mails.sql`、`autumn-pms/sveltekit/src/lib/server/attachments.ts`、`routes/reservations/[id]/+page.server.ts` 1916〜1960 行、`routes/reservations/[id]/+page.svelte` 1805〜1900 行・4166〜4255 行、`lib/autumn-shared/supabase/functions/pms-storage/index.ts`、`lib/i18n/messages/ja.ts` 352〜362 行

**表 `pms.reservation_attachments`**

| 列 | 型 | 備考 |
|---|---|---|
| id | uuid | |
| tenant_id / facility_id | uuid | FK（cascade） |
| stay_group_id | uuid | **FK なし**（履歴保持のため） |
| file_name | text | 元のファイル名（表示用） |
| mime_type | text | 例 `application/pdf` |
| byte_size | bigint | |
| storage_path | text | バケット内キー。例 `<facility_id>/<stay_group_id>/<uuid>.pdf` |
| uploaded_by | uuid | `auth.users.id`（TASKUL Mail 由来などは null） |
| metadata | jsonb | `'{}'` 既定。**任意の目印を置ける** |
| created_at | timestamptz | |

- 索引 `idx_reservation_attachments_group (stay_group_id, created_at)`。`updated_at` 無し（更新しない前提）。
- **RLS**: `private.is_superadmin() or private.has_facility_access(tenant_id, facility_id)`（for all）。`authenticated` に select/insert/update/delete を grant。service_role は RLS をバイパス。
- **バケット `reservation-attachments`**: 非公開。`file_size_limit` / `allowed_mime_types` は**設定なし**（migration では `public=false` だけ）。`storage.objects` のポリシーも付けていない＝**実体の読み書きは service_role 経由だけ**。
- **同じバケットを別の用途でも共用している前例**: 事前応対記録の添付（`pms.stay_correspondence_files`）は `correspondence/<facility_id>/<stay_group_id>/<correspondence_id>/<uuid>.<ext>` の接頭辞で同じバケットに置く。理由は「Storage の実体操作を代行する Edge Function（`pms-storage`）がバケット名を固定で持っているため、バケットを増やすと Edge 側の改修＋デプロイが必ず要る」（migration 冒頭コメント）。**本設計もこれに倣う（§5.2）。**
- `stay_correspondence_files` には **`source_key text` ＋ 部分一意索引 `(correspondence_id, source_key) where source_key is not null`** があり、外部（TASKUL Mail）からの取込を冪等にしている。`reservation_attachments` には無い。

**PMS アプリ側（`lib/server/attachments.ts`）**

- 実体操作の入口 `storagePut / storageSign / storageRemove / storageDownload`。service_role があれば直接、無ければ Edge Function `pms-storage`（バケット名固定・`x-pms-secret`）へ委譲。
- `uploadAttachment`: **1ファイル 20MB まで**（20 × 1024 × 1024）。添付先の予約が当施設のものかを `pms.stay_groups` で確かめてから実体 → メタの順に書き、メタに失敗したら実体を消す。キーは `<facility_id>/<stay_group_id>/<uuid>.<ext>`。
- **ファイル種別の制限は無い**（何でも上がる）。代わりに `safeContentType`: HTML / XHTML / SVG / XML / MHTML は Storage 上の Content-Type を `application/octet-stream` に落として「表示」させない（署名 URL を iframe・新規タブで開くため、Supabase のオリジンで動く保存型 XSS を防ぐ）。`isPreviewable` は PDF と `image/*` だけ（SVG は除外）。
- `loadAttachments(userClient, groupId, facilityId)`: `stay_group_id` ＋ **`facility_id`** で絞る（別施設から同じ group id で差し込まれた行を出さないため）。返す列は `id, file_name, mime_type, byte_size, storage_path, created_at`（**`metadata` は返していない**）。署名 URL は一覧では発行せず、クリック時に `/api/attachment-url?id=` で都度発行（1時間）。
- `deleteAttachment(userClient, {facilityId, id})`: メタ削除 → 実体削除。
- `loadAttachmentsForMail`: 事前応対メールの添付として、**この予約の添付のうち PDF・画像だけ・合計 8MB まで**（`lib/mail-attachments.ts` の `MAIL_ATTACHMENT_TOTAL_LIMIT_BYTES`）を base64 にして Edge Function `send-mail` に渡す。
- 予約メールの予約送信（`pms.scheduled_mails.attachment_ids`）は「送る時点で読み直し、消えていたら送らず failed」。

**PMS の予約詳細の UI**（`+page.svelte` 4166〜4255 行）

- `<details id="attachments">` の中に「ファイルを選ぶ（multiple）」＋ ドラッグ＆ドロップ（画面のどこに落としても添付欄が開く・1836 行〜）＋ 一覧（アイコン・ファイル名・サイズ・プレビュー／ダウンロード／削除）。
- アップロードは form action `uploadAttachment`（`guardCapability('reservations:edit')`・複数ファイルを1リクエストで受け、1件でも失敗したらそこで止める）。削除は `deleteAttachment`（確認ダイアログ）。
- 文言: 「PDF・画像などを添付できます（20MBまで）。」「ここにファイルをドラッグしても添付できます」。
- 画面上部に件数バッジ（添付があることを折りたたみの外でも知らせる）。

### 3.2 取引先予約 → PMS の電文と取込

出典: `autumn-shared/supabase/migrations/20260907112816_pms_direct_booking_inbox.sql`、`20260926082024_rms_partner_booking_checkin_charge.sql`（`event` の CHECK 現行版）、`20261007002617_rms_partner_deposit.sql`（`_rms_partner_emit_pms_event` 現行版）、`autumn-pms/.../direct-booking/import.ts`、`direct-booking/types.ts`、`lib/server/arrivals.ts` 259〜295 行、`autumn-shared/docs/BOOK_PMS_DIRECT_BOOKING.md`

- `pms.direct_booking_inbox.event` の CHECK は現在 `('new', 'modified', 'cancelled', 'refunded', 'paid')`（制約名 `direct_booking_inbox_event_check`。増やすたびに drop → add してきた）。`unique (booking_id, sequence)` で冪等。
- `_rms_partner_emit_pms_event(p_partner_booking_id, p_event, p_extra)` は `booking.bookings.sync_version` を `for update` で +1 して採番し、**台帳・stays・guests・room_types から電文を丸ごと組み立てる**（`requests` は `_rms_partner_requests`、`rooms` は `stay_ids` の順）。許す event は `('new','cancelled','refunded','paid')`（`modified` は取引先予約では出していない）。service_role のみ実行可。
- **`new` が出るタイミング**: 後払い・自由入力の支払方法は `rms_partner_create_booking` の中（＝予約確定と同一トランザクション）。オンライン決済（`online` / `online_checkin` / `deposit_online`）は仮押さえ（`pending_payment`・35 分）の間は出さず、`rms_partner_mark_paid` / `rms_partner_mark_card_saved` で確定したときに出る。
- PMS の取込ループ `processDirectInbox`（import.ts 1197〜1325 行）: `status='received'` を `booking_id, sequence` 順に最大 N 件。`validatePayload`（schema・tenant/facility・booking_id・rooms・stay 日付のみ検査。**event の値は検査しない**）→ `stay_groups.metadata.book_last_sequence` より古い電文は skipped → `refunded`/`paid` は入金行の処理 → `cancelled` は `cancelDirectGroup` → **それ以外（`new`・`modified`）は `expandDirectBooking`**（予約グループ・泊行・部屋割り・請求書の丸ごと upsert）。
  - **⚠ 未知の event はこの `else` に落ちて `expandDirectBooking` が走る。** 新しいイベント種別を Book が出す前に、PMS 側の分岐を必ず先に出す（§12 のデプロイ順の根拠）。
- 取込は予約グループを `metadata->>'book_booking_id' = payload.booking.booking_id` で引く。取込後の予約グループは `metadata.book_last_sequence / book_last_event_id` を持つ。
- 新着通知（`arrivals.ts`）は `direct_booking_inbox` の `status in (imported, error)`（＋ cancelled の skipped）で `acknowledged_at is null` の行を出す。`DIRECT_EVENT_TO_CLASSIFICATION` で `new → NewBookReport`、`modified/paid → ModificationReport`、`cancelled/refunded → CancellationReport`。**未知の event は `NewBookReport`（新規予約）として表示される。** `refunded` / `paid` は取込時に `acknowledged_at` を入れて通知に出さない。
- `types.ts` の `DirectBookingPayload` に `attachments` 相当の項目は無い。

### 3.3 Book 側の既存資産（流用するもの）

出典: `autumn-book/apps/web/src/lib/server/partners/memorandum.ts`、`routes/p/[token]/memorandum/files/[id]/+server.ts`、`lib/server/partners/portal.ts`・`preview.ts`・`admin-client.ts`、`lib/server/partners/booking.ts`（`createPartnerBooking` 433〜600 行）、`routes/p/[token]/book/+page.server.ts`・`book/reserve/+server.ts`・`book/+page.svelte`、`routes/p/[token]/bookings/+page.server.ts`、`routes/admin/reservations/[code]/+page.server.ts`、`lib/server/partners/admin-reservations.ts`、`routes/api/cron/partner-charge/+server.ts`、`autumn-shared/.../20261001074722_rms_partner_memorandum_booker.sql`

- **覚書のファイル（`public.rms_partner_documents` ＋ バケット `partner-documents`）が、取引先ページのファイル機能の前例。** 20MB・100 件／取引先・**拡張子の許可リスト**（pdf, png, jpg, jpeg, gif, webp, heic, txt, csv, doc, docx, xls, xlsx, ppt, pptx, zip）で判定し、保存時の Content-Type もその表から決める（クライアントの値を信じない）。パスは `<partner_id>/<uuid>.<ext>`。ダウンロードは**サーバが中継**（署名 URL を外に出さない・`documentResponse` が `Content-Disposition`（RFC 5987）・`nosniff`・`no-store` を付け、画像と PDF だけ inline）。削除は取引先は自分が上げたものだけ（`onlyAccountId`）、スタッフは全部。取引先の削除時に実体をまとめて消す `removeAllPartnerDocumentFiles`。バケットは `file_size_limit=20971520` を migration で設定。
- **認証・権限**: 取引先ページは Supabase Auth を使わず、`requirePortalSession`（画面）／`requirePortalApi`（API）が「限定 URL のトークン → 取引先 → セッション」を確かめる。表と RPC は service_role 専用（`partnerServiceClient`）。**確認モード（preview）では `denyPreviewWrite` が GET/HEAD 以外を 403 で止める**（`portal.ts` 74〜75 行）。書き込みの入口をこの2関数に通せば、プレビューの書き込み禁止は自動で効く。
- **予約の流れ**: 後払いは `/book` の form action `default`（`parseBookingForm(FormData)` → `createPartnerBooking`）。オンライン決済は `/book/reserve`（同じフォームを `fetch` で POST → 仮押さえ → `client_secret`）→ Stripe → `/payment`（confirm）。どちらも `rms_partner_create_booking` RPC に `p`（jsonb）を渡す。RPC の後に TS が `attachBookingExtras`（台帳 `detail` のマージ）・`snapshotCancelPolicy` を行う。
- **予約一覧** `/p/[token]/bookings`: `listPartnerBookings(db, {partnerId, limit:300})` で取引先の全予約（子アカウントも同じ一覧）。取消は form action `cancel`。`checkedIn` は `core.stays.status` を Book が service_role で読んで判定（`booking.ts` 1149 行・`coreDb`/`pmsDb` のヘルパー 86〜87 行）＝ **Book が `core`/`pms` を読む前例あり**。
- **管理画面**: `/admin/reservations/[code]` が取引先予約の台帳（`loadPartnerLedgerForReservation`）を出し、取消・再請求の action を持つ。`/admin/partners/[id]/documents/[docId]` が覚書ファイルのダウンロード。
- **cron**: `/api/cron/partner-charge`（`CRON_SECRET`・POST）がチェックアウト日決済の請求を回す。掃除処理の相乗り先候補。
- `rms_partner_bookings.status` は `pending_payment / confirmed / cancelled / expired`。期限切れは `rms_partner_expire_pending`（SQL）が `expired` にする（Storage は触れない）。
- Cloudflare Pages（`adapter-cloudflare`・`wrangler.jsonc`）。`BODY_SIZE_LIMIT` のような設定は無い。

### 3.4 Cloudflare Pages（Workers）でファイルを受けるときの制約

- Workers / Pages Functions の**リクエスト本文の上限は Free 100MB・Pro 200MB・Business 500MB**（Cloudflare Limits。実装前に現在のプランと Limits ページで再確認すること）。Worker の**メモリは 128MB**。
- SvelteKit の `request.formData()` は本文を**丸ごとメモリに載せる**。supabase-js の `storage.upload(path, File)` も中身をメモリに持つ。**1リクエストに 20MB 1ファイルなら問題ないが、複数ファイルを1リクエストで受けると 128MB に近づく。** → アップロードは **1リクエスト1ファイル**（§6.2）。
- 署名付きアップロード URL（`createSignedUploadUrl` → ブラウザが Storage に直接 PUT）なら Worker を通らないが、**サーバがファイル名・種別・サイズを検査できず、Content-Type もクライアント任せになる**。バケット側で `allowed_mime_types` / `file_size_limit` を付ければ守れるが、**バケットは PMS と共用**で、PMS は種別を制限していない（Office 文書も上がる）ため、共用バケットに `allowed_mime_types` を付けると PMS の添付が止まる。→ **v1 はサーバ中継**（§6.3 で比較）。

---

## 4. 設計方針（決定の解釈と、本書で決めること）

1. **Book 添付の正（source of truth）は Book の台帳 `public.rms_partner_booking_attachments`。PMS 側の行は「写し」。**
   「PMS 取込前は Book 側で保管し、取込時に引き継ぐ」を、**実体は最初から PMS と同じバケットに置き、取込時に PMS のメタ行（写し）を作る**と解釈する。実体のコピーは行わない（同じ `storage_path` を両方の行が指す）。PMS の既存機能（プレビュー・ダウンロード・事前応対メールの添付・予約送信）は写しの行を通じてそのまま使える。
2. **PMS 側の写し行は、PMS の取込ワーカーだけが作る・消す。Book は `pms.reservation_attachments` を書かない。** 受信箱の設計原則「ワーカーは電文だけで展開でき、book スキーマを読まない。book と pms の結合はこの契約1本」（`20260907112816` の列コメント）を守る。
3. **電文は項目を足すだけ**（既存項目の意味は変えない）。全イベントの電文に `attachments[]`（現在の全件）を載せ、添付だけの更新には新しい event `attachments` を出す。PMS は電文の全件リストに写しを一致させる（追加・削除）。
4. **PMS 側で取引先由来の添付は削除できない**（表示は「取引先ページから」と出す）。削除は取引先ページ（取引先）か Book の管理画面（スタッフ）から行い、PMS には同期で届く。理由: 写しを PMS で消しても Book の台帳と実体が残り、次の電文で復活する。双方向にすると「どちらが正か」を毎回判断することになる。
5. **アップロードは 1 リクエスト 1 ファイル・サーバ中継**（Cloudflare の本文・メモリ制限と、サーバ側の検査の両立）。
6. 既存の前例に合わせる: 表・RLS は `rms_partner_documents`、Storage の取り回しは PMS の `attachments.ts`、ダウンロード応答は `documentResponse`、権限は `requirePortalSession / requirePortalApi / requireStaffPartner`。

---

## 5. データモデル

### 5.1 Book の台帳 `public.rms_partner_booking_attachments`【提案】

```sql
create table if not exists public.rms_partner_booking_attachments (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references core.tenants(id) on delete cascade,
  facility_id          uuid not null references core.facilities(id) on delete cascade,
  partner_id           uuid not null references public.rms_partners(id) on delete cascade,
  -- 予約入力中（予約がまだ無い）のあいだは null（仮置き・§6.1）。確定時に RPC が結ぶ
  partner_booking_id   uuid references public.rms_partner_bookings(id) on delete cascade,
  file_name            text not null,                 -- 表示・ダウンロード名（safeFileName 済み）
  mime_type            text not null,                 -- 許可リストから決めた値（クライアントの値ではない）
  byte_size            bigint not null,
  storage_path         text not null unique,          -- reservation-attachments 内のキー（§5.2）
  uploaded_by_kind     text not null check (uploaded_by_kind in ('partner', 'staff')),
  uploaded_by_account  uuid references public.rms_partner_accounts(id) on delete set null,
  uploaded_by_staff    uuid,                          -- スタッフの auth.users.id
  uploaded_by_label    text,                          -- ログインID／スタッフ名のスナップショット
  note                 text,                          -- 任意の一言（例「名簿」「行程表」）
  created_at           timestamptz not null default now()
);
create index if not exists idx_rms_partner_booking_attachments_booking
  on public.rms_partner_booking_attachments (partner_booking_id, created_at);
-- 仮置き（未束縛）の掃除用
create index if not exists idx_rms_partner_booking_attachments_unbound
  on public.rms_partner_booking_attachments (created_at) where partner_booking_id is null;
alter table public.rms_partner_booking_attachments enable row level security;
grant all on public.rms_partner_booking_attachments to service_role;   -- 他ロールには何も grant しない（rms_partner_documents と同じ）
```

- 削除は物理削除（PMS の `reservation_attachments` と同じ・履歴は電文と `rms_partner_access_logs` に残す）。
- **`rms_partner_bookings` に2列**【提案】: `attachments_updated_at timestamptz`（台帳行の insert/delete トリガーで `now()`）、`attachments_notified_at timestamptz`（`attachments` 電文を出した時刻）。「変更があって未通知か」を `attachments_updated_at > coalesce(attachments_notified_at, '-infinity')` で判断する（§7.3 の一括通知と取りこぼし防止）。

### 5.2 実体の置き場（バケット・パス）【提案】

- **バケットは PMS と同じ `reservation-attachments`。** 接頭辞で分ける: `partner-booking/<facility_id>/<partner_id>/<uuid>.<ext>`
  - PMS の `loadAttachments` / 署名 URL / メール添付 / 予定メールは `storage_path` の文字列しか見ないので、接頭辞が違っても動く（事前応対記録の `correspondence/` と同じ）。
  - パスに**予約 id を含めない**のは、予約入力中の仮置き（予約がまだ無い）→ 確定時の束縛を「行の更新だけ」で済ませるため。
  - 別バケットにしない理由: PMS の Edge Function `pms-storage` がバケット名固定（§3.1）。別バケットだと PMS のローカル SSR（service_role 無し）から写しの実体を読めない。`partner-documents` も同じ理由で使わない。
- バケットの `file_size_limit` / `allowed_mime_types` は**変えない**（PMS の添付に影響する）。サイズ・種別の制限は Book のサーバで行う（§9.4）。migration では `insert into storage.buckets … on conflict do nothing` で存在だけ保証する（前例どおり）。

### 5.3 PMS の写し行の識別（`pms.reservation_attachments`）【提案・pms スキーマの変更 1 点】

```sql
alter table pms.reservation_attachments add column if not exists source_key text;
create unique index if not exists uq_reservation_attachments_source
  on pms.reservation_attachments (stay_group_id, source_key) where source_key is not null;
comment on column pms.reservation_attachments.source_key is
  '外部由来の添付の冪等キー。取引先予約（autumn-book）の添付は rms_partner:<rms_partner_booking_attachments.id>。手動アップロードは null。';
```

- 写し行の値: `storage_path` = Book 添付と同じ、`uploaded_by = null`、`source_key = 'rms_partner:<Book 添付 id>'`、`metadata = {source:'rms_partner', partner_attachment_id, partner_booking_code, uploaded_by_kind, uploaded_by_label, uploaded_at}`。
- `stay_correspondence_files.source_key` と同じ流儀（§3.1）。**列を足すだけで既存の行・RLS・grant は変えない。** autumn-pms の未適用 migration と競合しないか、着手前に `git pull` で確認する。
- 代替（列を足さない）: `metadata->>'partner_attachment_id'` で既存行を検索してから insert。冪等性が弱い（同時実行で二重になる）ので推奨しない。

### 5.4 電文（`autumn.direct_booking/1`）への追加【提案】

全イベントに **`attachments`（現在の全件）** を足す。`attachments` イベントだけ `attachment_change` も入る。

```jsonc
"attachments": [
  { "id": "<Book 添付 id>", "file_name": "名簿.xlsx", "mime_type": "application/vnd…sheet",
    "byte_size": 48213, "storage_path": "partner-booking/<facility>/<partner>/<uuid>.xlsx",
    "uploaded_by_kind": "partner", "uploaded_by_label": "jtb-sendai", "note": null,
    "uploaded_at": "2026-10-07T01:23:45.678Z" }
],
"attachment_change": {            // event='attachments' のときだけ。通知文の材料（同期には使わない）
  "added":   ["名簿.xlsx"],
  "removed": [],
  "by_kind": "partner",           // partner / staff
  "by_label": "jtb-sendai",
  "at": "2026-10-07T01:25:00.000Z"
}
```

- 組み立ては新しい DB 関数 `public._rms_partner_attachments_json(p_partner_booking_id) returns jsonb`（`partner_booking_id = p` の行を `created_at` 順に `jsonb_agg`。無ければ `'[]'`）。`_rms_partner_emit_pms_event` の `v_payload` に `'attachments', public._rms_partner_attachments_json(v_pb.id)` と `'attachment_change', case when p_event = 'attachments' then coalesce(p_extra,'{}') else null end` を足す。
- `_rms_partner_emit_pms_event` の許可 event に `'attachments'` を足す。`pms.direct_booking_inbox` の CHECK を `('new','modified','cancelled','refunded','paid','attachments')` に（制約を drop → add。前例 `20260926082024`）。
- `autumn-shared/docs/BOOK_PMS_DIRECT_BOOKING.md` §2.2 のスキーマに上記を追記する。

### 5.5 DB 関数（Book 側）【提案】

| 関数 | 役割 |
|---|---|
| `public._rms_partner_attachments_json(uuid)` | §5.4 |
| `public.rms_partner_create_booking(p)` の差し替え | `p->'attachment_ids'`（uuid[]）を受け、**電文を出す前に** `update rms_partner_booking_attachments set partner_booking_id = v_id where id = any(ids) and partner_id = p.partner_id and uploaded_by_account = p.account_id and partner_booking_id is null`。これで後払いの `new`（RPC 内で出る）にも添付が載る。最新版は `20261007002617_rms_partner_deposit.sql`。`git pull` 後に他の未適用 migration が同関数を触っていないか確認して、1ファイルで `create or replace` を丸ごと出す |
| `public.rms_partner_emit_attachments_event(p_partner_booking_id uuid, p_extra jsonb) returns uuid` | 台帳を `for update` で読み、**`booking.bookings.sync_version >= 1`（＝`new` を一度出している）のときだけ** `_rms_partner_emit_pms_event(id, 'attachments', p_extra)` を呼び、`attachments_notified_at = now()` を書く。`sync_version = 0`（仮押さえ中・未確定）なら何もせず null（後で出る `new` に全件が載る）。`status in ('cancelled','expired')` でも `sync_version >= 1` なら出す（PMS が取込済みの取消予約の写しを揃えるため） |
| 掃除用 `public.rms_partner_attachment_orphans(p_older_than interval) returns setof …` | §7.5 の cron が消す対象（未束縛で古い行・`expired` 予約の行）の `id, storage_path` を返す。実体の削除は Storage API なので TS 側 |

権限はすべて `revoke … from public, anon, authenticated; grant execute … to service_role`（前例どおり）。

---

## 6. Book 側の API とアップロードの流れ

### 6.1 予約入力時（`/p/[token]/book`）— 仮置き → 確定時に束縛【提案】

予約フォームの送信にファイルを混ぜない（本文が大きくなる・Stripe の流れ `/book/reserve` にも乗る・失敗時の扱いが複雑になる）。代わりに:

1. 画面の「添付ファイル」欄にドロップ／選択 → **その場で 1 ファイルずつ** `POST /p/[token]/book/attachments`（multipart・1 ファイル）→ 台帳に **`partner_booking_id = null`** の行を作って `{id, fileName, byteSize}` を返す。画面は hidden input `attachment_ids`（カンマ区切り）に id を積む。削除は `DELETE /p/[token]/book/attachments/[id]`（未束縛・自分のアカウントの行だけ）。
2. 確定（`/book` の default action／`/book/reserve`）で `parseBookingForm` が `attachment_ids` を読み、`createPartnerBooking` → RPC の `p.attachment_ids` に渡す。RPC が束縛してから `new` 電文を出す（§5.5）。
3. オンライン決済の仮押さえ（`pending_payment`）でも束縛は済んでいる。支払が終わって `mark_paid` → `new` が出るとき `_rms_partner_attachments_json` が全件を載せる。**支払わずに 35 分で `expired`** になった予約の添付は掃除（§7.5）。
4. 「入力に戻る」（`releasePendingBooking`）で仮押さえを解放した予約の添付は、そのまま `expired`/`cancelled` の予約に付いたままにし、掃除に任せる（画面は新しい入力から上げ直してもらう。未決 §11-N5）。
5. 確認画面（同じ `/book` の確認ステップ）にファイル名の一覧を出す。

### 6.2 予約一覧から（`/p/[token]/bookings`）【提案】

- 各予約の詳細欄に「添付ファイル」ブロック（§10.2）。
- `POST /p/[token]/bookings/[bookingId]/attachments`（multipart・1 ファイル）: `requirePortalApi` → 台帳の予約を `partner_id = partner.id` で引く（`getPartnerBooking`）→ 状態の検査（§9.3）→ 件数・サイズ・種別の検査（§9.4）→ 実体を `upload`（`upsert:false`）→ 行を insert（失敗したら実体を消す）→ `logPartnerAccess(action:'attachment_add')` → `{ok, attachment}`。
- `DELETE /p/[token]/bookings/[bookingId]/attachments/[attId]`: 予約・添付の所属（`partner_id`・`partner_booking_id`）を確かめ → 権限（§9.2）→ 行を delete → 実体を remove（失敗はログだけ）→ `logPartnerAccess(action:'attachment_remove')`。
- `POST /p/[token]/bookings/[bookingId]/attachments/notify`: 画面がまとめて（追加・削除のあと 1 回）呼ぶ。`rms_partner_emit_attachments_event` を呼ぶだけ。`attachment_change` の材料（追加・削除したファイル名）は画面が body で渡す（サーバは前回通知以降の差分を持たないため。嘘を書かれても同期には使わない）。
- `GET /p/[token]/bookings/[bookingId]/attachments/[attId]`: ダウンロード（サーバ中継・`documentResponse` と同じ応答・`PORTAL_HEADERS`）。確認モードでも GET なので通る（スタッフが見るだけ）。

### 6.3 サーバ中継 vs 署名付きアップロード URL（比較）

| | サーバ中継（**推奨・v1**） | 署名付きアップロード URL |
|---|---|---|
| 本文の経路 | ブラウザ → Worker → Storage | ブラウザ → Storage（Worker を通らない） |
| 上限 | Worker の本文・メモリ（§3.4）。**1 リクエスト 1 ファイル 20MB** なら十分 | Storage の上限のみ |
| 検査 | ファイル名・拡張子・サイズ・Content-Type をサーバが決められる | 事前にパスとトークンを渡すだけ。中身・種別は検査できない。Content-Type はクライアント任せ |
| 共用バケットとの相性 | 良い（バケット設定を変えない） | 悪い（`allowed_mime_types` を付けると PMS の添付に影響） |
| 実装 | 前例（`memorandum.ts`）の写しで済む | 2 段階（URL 発行 → 完了報告で `storage.from().list/info` による実在確認 → 行の作成）。失敗時の孤児が増える |
| 将来 | 20MB 超が必要になったら切替 | 動画など大きい物が要るときの選択肢 |

### 6.4 管理画面（スタッフ）【提案】

- `/admin/reservations/[code]`（取引先予約の台帳ブロック）に「添付ファイル」: 一覧・ダウンロード（`GET /admin/reservations/[code]/attachments/[attId]`）・アップロード（form action `uploadPartnerAttachment`・`uploaded_by_kind='staff'`）・削除（`deletePartnerAttachment`・スタッフは全件）。権限は既存の取消・再請求と同じ（施設アクセスのあるスタッフ。`loadPartnerLedgerForReservation` が確かめる範囲）。
- スタッフの追加・削除のあとも `rms_partner_emit_attachments_event` を呼ぶ（`by_kind:'staff'`）。
- `/admin/partners/[id]` の予約一覧には件数（📎 N）だけ出し、操作は予約詳細に集める。

---

## 7. PMS への同期

### 7.1 取込前（予約グループがまだ無い）

- Book の台帳と実体だけが存在する。取引先ページ・管理画面で見える。
- `new` 電文（後払いは RPC 内・オンライン決済は支払後）に `attachments[]` が載る。PMS が `new` を取り込むとき（`expandDirectBooking` の中・予約グループの upsert 後）に **写し行を作る**（§7.4）。
- `attachments` 電文は `sync_version >= 1` のときしか出ない（§5.5）ので、取込前の予約で「添付だけの電文」が受信箱に積まれることは無い。

### 7.2 取込後

- 追加・削除のたびに（画面がまとめて 1 回）`attachments` 電文。PMS は電文の `attachments[]` に写し行を一致させる: **電文にあって写しに無い → insert、写しにあって電文に無い（`source_key like 'rms_partner:%'` の行だけ）→ delete（メタのみ。実体は Book が消している）。** PMS で手動アップロードした行（`source_key is null`）は触らない。
- 取込は毎分の cron（受信箱に `received` がある施設だけ HTTP が飛ぶ）なので、**PMS への反映は最大 1 分程度の遅れ**。Book 側の画面に「PMS へは数分以内に反映されます」の注記（§10.2）。
- `new` を再取込した場合（`expandDirectBooking` の upsert 経路）も同じ同期を通す（冪等）。

### 7.3 削除時

| 誰が | どこで | 動き |
|---|---|---|
| 取引先 | 取引先ページ | Book の行と実体を即時削除 → `attachments` 電文 → PMS が写し行を消す。PMS の予約詳細では、同期までの最大 1 分ほど「写し行はあるが実体が無い」状態（プレビューが失敗する）。許容する |
| スタッフ | Book 管理画面 | 同上（`by_kind:'staff'`） |
| スタッフ | PMS 予約詳細 | **できない**（§4-4）。写し行の削除ボタンを出さず「取引先ページから登録。削除は Book の管理画面から」と案内（§8.3） |
| 予約の取消 | — | 添付は消さない（取消後も名簿等を参照することがある）。取消済み予約では**追加だけ不可**（§9.3） |

### 7.4 PMS 取込側の処理【提案・autumn-pms】

`lib/server/direct-booking/import.ts` に `syncPartnerAttachments(admin, fac, groupId, payload)` を足す:

1. `payload.attachments ?? []` を読む（`new` の旧電文には無いので `[]` 扱い）。
2. `pms.reservation_attachments` から `stay_group_id = groupId and facility_id = fac.facilityId and source_key like 'rms_partner:%'` を select。
3. 差分を取り、insert（`source_key='rms_partner:'+a.id`・`metadata` §5.3・`tenant_id/facility_id` は fac から）／delete（`id in (消す行)`）。一意索引で二重 insert は弾かれるので、`23505` は無視する。
4. 戻り値 `{added, removed}`。失敗は **取込全体を失敗にせず warning** として `error_message` に残す（部屋割りの未割当と同じ扱い）。

呼び出し箇所:

- `expandDirectBooking` の末尾（予約グループ確定後・`new` と `modified`）。
- `processDirectInbox` に **`row.event === 'attachments'` の分岐を `cancelled` より前に足す**: 予約グループを `book_booking_id` で引く → 無ければ `skipped`（「対応する予約グループがありません」・`acknowledged_at` を入れる）→ あれば同期 → `stay_groups.metadata.book_last_sequence / book_last_event_id` を更新 → `status='imported', stay_group_id, imported_at`。**`acknowledged_at` は入れない**（新着通知に出す＝ユーザー決定）。

### 7.5 掃除（孤児の実体を残さない）【提案】

- Book の cron（`/api/cron/partner-charge` に相乗り。1 日 1 回で十分）: `rms_partner_attachment_orphans('24 hours')` → 未束縛（`partner_booking_id is null`）で 24 時間以上前の行、`status='expired'` の予約の行（期限切れから 7 日後）を、**実体 → 行** の順に消す。
- 取引先の削除（`deletePartner`）: `removeAllPartnerDocumentFiles` と同様に、その取引先の Book 添付の実体をまとめて消す（行は FK cascade）。
- PMS 側は写しの実体を消さない（所有者は Book）。

---

## 8. PMS 側の変更点（autumn-pms）

### 8.1 型・検証（`lib/server/direct-booking/types.ts`）

- `DirectBookingEvent` に `'attachments'`。`DirectBookingPayload` に `attachments?: DirectBookingAttachment[] | null` と `attachment_change?: {...} | null`。
- `validatePayload` は変えない（`attachments` イベントの電文も `rooms` 等を持つので通る）。

### 8.2 取込（`import.ts`）

§7.4。`DIRECT_EVENT_TO_CLASSIFICATION`（`arrivals.ts`）に `attachments: 'ModificationReport'` を足し、通知の文面に `attachment_change` を使う（「添付ファイルが更新されました: 名簿.xlsx を追加（jtb-sendai）」）。arrivals の一覧がどの列で文面を出しているか（`error_message` を印として使っている箇所）は実装時に確認し、**必要なら新しい分類 `AttachmentReport` を増やして i18n を足す**（未決 §11-N6）。

### 8.3 予約詳細（`routes/reservations/[id]`）

- `loadAttachments` の select に `source_key, metadata` を足す（`AttachmentRow` にも）。
- 一覧で `source_key` が `rms_partner:` で始まる行は、ファイル名の横に「取引先ページから（ログインID／スタッフ名）」のバッジ、**削除ボタンを出さない**（代わりに title 属性で「取引先ページ／Book の管理画面から削除してください」）。サーバの `deleteAttachment` action でも `source_key` が付いた行は 400 で断る（画面は嘘をつきうる）。
- `uploadAttachment`・プレビュー・ダウンロード・事前応対メールの添付・予約送信は変更なし（写し行は普通の行として扱える）。
- 件数バッジ（上部）はそのまま（写しも数える）。

### 8.4 文言（`lib/i18n/messages/ja.ts` ほか）

`reservation.detail.attachmentFromPartner`（バッジ）、`reservation.detail.attachmentPartnerNoDelete`（案内）、新着通知の文面。多言語ファイルがあれば同じキーを足す。

---

## 9. 権限・安全

### 9.1 取引先トークン・セッション・確認モード

- すべての Book 添付 API は `requirePortalApi`（JSON）／`requirePortalSession`（画面）を通す。**確認モード（preview）は POST/DELETE が入口で 403**（`denyPreviewWrite`）。GET のダウンロードだけ通る。
- 取引先の限定 URL が無効（`partnerUnavailableReason`）なら既存どおり 403。

### 9.2 他の取引先の予約に触れない

- 予約は必ず `getPartnerBooking(db, partner.id, bookingId)`（`partner_id` 条件つき）で引く。添付は `id` ＋ `partner_id` ＋ `partner_booking_id` の 3 条件で引く。別の取引先の id を渡されても 404。
- 仮置き（未束縛）の行は `partner_id` ＋ `uploaded_by_account = session.id` ＋ `partner_booking_id is null` で引く。RPC の束縛も同じ条件（他人の仮置きを自分の予約に結べない）。
- 削除の権限【提案】: 取引先は **自分のアカウントで上げたもの、またはマスターアカウント（`is_master`）なら同じ取引先の全件**。スタッフ（Book 管理画面）は全件。覚書ファイルの `onlyAccountId` より少し広い（予約の取消は誰でもできるため・未決 §11-N3）。
- PMS 側の写し行は PMS の RLS（施設アクセス）で守られる（従来どおり）。

### 9.3 予約の状態による制限【提案】

| 予約の状態 | 追加 | 削除 | 閲覧・ダウンロード |
|---|---|---|---|
| `confirmed`（チェックイン前） | ○ | ○ | ○ |
| `confirmed`（チェックイン済み・`checkedIn`） | ○（当日の追加資料があり得る） | ○ | ○ |
| `pending_payment`（支払待ち） | ○（確定前に揃えられる） | ○ | ○ |
| `cancelled` | × | ○（取引先は自分の分・スタッフは全件） | ○ |
| `expired` | × | ×（掃除に任せる） | ○（7 日後に消える旨） |
| チェックアウトから 90 日超 | ×（未決 §11-N4） | × | ○ |

### 9.4 ファイル種別・サイズ・件数【提案】

- **拡張子の許可リスト**（覚書ファイルと同じ表から **zip を外す**）: pdf, png, jpg, jpeg, gif, webp, heic, txt, csv, doc, docx, xls, xlsx, ppt, pptx。`mime_type` はこの表の値（クライアントの `file.type` は使わない）。HTML / SVG / XML / 実行形式 / マクロ付き Office（xlsm・docm）は上がらない。
- **1 ファイル 20MB**（PMS・覚書と同じ）。**1 予約 10 件・合計 50MB**。空ファイル（0 バイト）は断る。
- ファイル名は `safeFileName`（パス区切り・制御文字を除く・120 文字）。保存キーは uuid（ファイル名を使わない）。
- 同じ名前のファイルを二度上げても別の行（PMS と同じ。上書きしない）。
- PMS の事前応対メールに添付するときは PMS の既存判定（PDF・画像のみ・合計 8MB）が効く。

### 9.5 ウイルス等への配慮

- Supabase Storage にスキャン機能は無い。Book / PMS とも**宿のスタッフが開く**ファイルなので、取引先（契約先）が上げる前提でも次を守る:
  - 種別の許可リスト（上記）。ブラウザで実行されうる型（HTML・SVG・XML）と実行形式・マクロ付き Office を受けない。
  - Content-Type はサーバが決める。Book のダウンロードは `x-content-type-options: nosniff`・画像と PDF 以外は `attachment`（`documentResponse`）。PMS は署名 URL で Supabase のオリジンから開くが、許可リストの型だけなので `safeContentType` の対象（HTML 等）は入らない。
  - Office 文書はブラウザで開かず保存される（Word / Excel の保護ビューに任せる）。
  - 取引先ごとに誰が上げたか（`uploaded_by_label`・アクセスログ `attachment_add/remove`）を残す。
- 将来（任意）: Edge Function からの ClamAV（別ホスト）での非同期スキャン → 疑わしい行に `quarantined` を立てて PMS に同期しない。本書では設計しない。

---

## 10. 画面の案

### 10.1 取引先ページ・予約入力 `/p/[token]/book`

- 左カラムの「備考」の下に **「添付ファイル（任意）」**: 点線の枠「ここにファイルをドロップ、または［ファイルを選ぶ］」。選ぶ／落とすと 1 件ずつ上がり、行が増える（ファイル名・サイズ・×）。進行中は「アップロード中…」。失敗は行の下に赤字（理由: 種別・サイズ・件数）。
- 許可の説明: 「PDF・画像・Word・Excel・PowerPoint・CSV・テキスト（1 ファイル 20MB・10 件まで）。名簿・行程表・配車表などをお付けください。」
- 確認画面: 「添付ファイル: 名簿.xlsx（48KB）、行程表.pdf（1.2MB）」の行。
- 完了画面・確認メール（取引先）・宿への通知メール: 「添付ファイル: 名簿.xlsx, 行程表.pdf（取引先ページ／PMS でご確認ください）」の 1 行（ファイルは添付しない）。

### 10.2 取引先ページ・予約一覧 `/p/[token]/bookings`

- 各予約の詳細（`<dl>`）の末尾に **「添付ファイル（N）」**: 一覧（アイコン・名前・サイズ・上げた人・日時・［ダウンロード］［削除］）＋ ドロップ枠（追加できる状態のときだけ）。
- 追加・削除のあとに画面が `notify` を 1 回呼び、「宿（PMS）へは数分以内に反映されます」のトースト。
- 取消済み: 一覧とダウンロードのみ。
- 確認モード: ドロップ枠・削除ボタンを出さない（入口で 403 になるが、画面でも出さない）。

### 10.3 Book 管理画面 `/admin/reservations/[code]`

- 取引先予約の台帳ブロックに「添付ファイル」: 一覧（誰が・いつ）・ダウンロード・アップロード（スタッフ）・削除（確認ダイアログ）。「PMS の予約詳細にも同じファイルが出ます（取込後・数分以内）」。
- `/admin/partners/[id]` の予約一覧: 📎 N。

### 10.4 PMS 予約詳細

- 既存の添付欄に写し行が混ざって出る。バッジ「取引先ページから（jtb-sendai）」。削除ボタン無し。
- 新着通知: 「添付ファイル更新」の行（ファイル名・誰が）。クリックで予約詳細の添付欄へ（`openAttachments` 相当の既存の仕組み）。

---

## 11. 決定事項（2026-10-07 ユーザー決定: N1〜N11 はすべて推奨案で確定）

| # | 論点 | 選択肢 | 確定 |
|---|---|---|---|
| N1 | 実体の置き場 | A. PMS と同じバケット `reservation-attachments` の `partner-booking/` 配下／B. `partner-documents`／C. 新バケット | **A で確定**（§5.2。PMS の Edge Function・メール添付・予定メールがそのまま使える） |
| N2 | PMS 側での削除 | A. できない（Book が正）／B. できる（PMS が消したら Book 側も消える＝Book が PMS の状態を読む） | **A で確定**（§4-4。双方向にすると正の判断が毎回要る。B は PMS が Book の表を書くか、Book が `pms` を読んで整合を取る必要がある） |
| N3 | 取引先側の削除権限 | A. 自分が上げたものだけ（覚書と同じ）／B. 自分の分＋マスターは全件／C. 同じ取引先なら誰でも | **B で確定**（§9.2。実装では「マスターの全件」は取引先が上げたものに限り、宿（スタッフ）が付けたものは取引先からは消せない） |
| N4 | 追加できる期限 | A. チェックアウト後も無期限／B. チェックアウトから 90 日／C. チェックアウトまで | **B で確定**（請求・精算の資料を後から付けることがある。無期限は古い予約への誤添付の温床） |
| N5 | 「入力に戻る」（仮押さえ解放）後の添付 | A. 掃除に任せる（新しい入力で上げ直し）／B. 未束縛に戻して次の予約に引き継ぐ | **A で確定**（単純。B は束縛の付け替えで別予約に混ざる事故が起きうる。画面は解放時に添付欄を空にして上げ直しを案内する） |
| N6 | PMS 新着通知の分類 | A. `ModificationReport` に相乗り（文面だけ添付用）／B. 新分類 `AttachmentReport` | **A で確定**（一覧の見分けが足りなければ B） |
| N7 | 添付の追加・削除で宿へメールを出すか | A. 出さない（PMS 新着通知で足りる）／B. `notifyEmails` に出す | **A で確定**。予約の確認メールにはファイル名の行だけ（§10.1） |
| N8 | 1 予約の件数・合計 | 10 件・50MB／20 件・100MB | **10 件・50MB で確定**。足りなければ上げる（DB 上限ではなくサーバ定数） |
| N9 | zip を許すか | 許す（覚書と同じ）／許さない | **許さないで確定**（中身を検査できない。名簿・行程表は xlsx/pdf で足りる） |
| N10 | 有効化の仕方 | A. 環境変数 `PARTNER_BOOKING_ATTACHMENTS`（全体）／B. 取引先ごとの `booking_settings.attachments`／C. 両方 | **A で確定**（デプロイ順の保険。§12）。取引先ごとの ON/OFF は要望が出てから |
| N11 | 削除した添付の履歴 | 物理削除のみ／`deleted_at` の論理削除 | **物理削除で確定**（PMS と同じ。アクセスログ・電文に残る） |

### 11.1 実装で決めたこと（2026-10-07・設計からの補足と差分）

- migration: autumn-shared `20261007022950_rms_partner_booking_attachments`（A-1）・`20261007022953_pms_reservation_attachments_source_key`（A-2）。
- `rms_partner_bookings.attachments_notified_at` は `rms_partner_emit_attachments_event` だけでなく **`_rms_partner_emit_pms_event` が電文を出すたびに記録する**（どの電文も添付の全件を運ぶため）。`rms_partner_emit_attachments_event` は `attachments_updated_at <= attachments_notified_at`（前回の電文から変化なし）なら出さない＝画面の二重送信・cron の知らせ直しで二重に出さない。
- 掃除の対象（`rms_partner_attachment_orphans`）: 24 時間以上前の仮置きと、**PMS へ一度も送らずに終わった予約**（`expired`、または `sync_version = 0` のまま `cancelled`＝支払前にやめた仮押さえ）の添付で、終わってから 7 日を過ぎたもの。cron は「仮置きのまま（`partner_booking_id is null`）／予約がまだ期限切れ・取消」を条件に**行を先に消し（returning で確定した行だけ）、その行の実体を消す**（一覧を読んだ後に確定で束縛された添付を消さない）。
- 予約入力を開くと、このログインIDの仮置き（24 時間以内・未束縛）を欄に出す（そのまま使う・消すができる）。件数・合計の上限も、この 24 時間以内の仮置きで数える。
- `_rms_partner_emit_pms_event` は台帳の行も `for update` でロックする。アップロードは content-length が 21MB を超えれば本文を読まずに 413。HEIC は inline にせず保存させる。PMS は未知の event を展開せず `error` にする。
- PMS は電文に `attachments` キーが**無い**とき（旧版・公式サイト予約）は写しを触らない（`[]` 扱いで消すことはしない）。`storage_path` は `partner-booking/<その施設>/` で始まるものだけ写す。
- PMS の `attachments` 電文は、写しが既に揃っていた（追加・削除が 0）なら新着通知に出さない（`acknowledged_at` を入れる）。予約詳細の「確認完了」（`acknowledgeModifications`）で直販受信箱の `attachments` 行も確認済みにする。
- Book の管理画面の添付操作（追加・削除・ダウンロード・通知）は、form action ではなく JSON API（`/admin/reservations/[code]/attachments/**`）。取引先ページと同じ部品（`PartnerAttachments.svelte`）を使うため。権限は**閲覧の権限（施設アクセスのあるスタッフ）**で通す（名簿等の現場資料で、金額・資格情報を扱わないため。取消・再請求＝管理者のみ、より広い）。
- 掃除と知らせ直しは `/api/cron/partner-charge` に相乗り（毎時。Stripe 未設定でも掃除は行う）。`PARTNER_BOOKING_ATTACHMENTS=false` のあいだも掃除（実体と行の削除）は行い、知らせ直しだけ止める。

---

## 12. 実装の分割とデプロイ順

### 12.1 デプロイ順（重要）

```
① autumn-shared migration（A-1・A-2）→ main 直 push → PROD 自動適用（CLAUDE.md の運用・schema_migrations を確認）
② autumn-pms（C-1〜C-3）→ デプロイ   ← Book より先。'attachments' が未対応の PMS に届くと expandDirectBooking に落ちる（§3.2）
③ autumn-book（B-1〜B-5）→ `PARTNER_BOOKING_ATTACHMENTS=false` でデプロイ → 本番で PMS の対応を確認 → true に
```

- ① の後・② の前でも、`new` 電文に `attachments: []` が足されるだけで PMS は未知のキーを無視する（`validatePayload` は最小限）。安全。
- ① の `rms_partner_create_booking` の差し替えは `p.attachment_ids` が無ければ何もしない（既存の Book からの呼び出しと互換）。

### 12.2 作業単位（Opus エージェントに渡す粒度）

**A. autumn-shared（migration・2 ファイル）**

| # | 内容 | 出典・注意 |
|---|---|---|
| A-1 `rms_partner_booking_attachments` | §5.1 の表・索引・grant、`rms_partner_bookings` の 2 列＋トリガー、`_rms_partner_attachments_json`、`_rms_partner_emit_pms_event` の差し替え（event 追加・`attachments` / `attachment_change`）、`direct_booking_inbox` の CHECK、`rms_partner_create_booking` の差し替え（`attachment_ids` の束縛）、`rms_partner_emit_attachments_event`、`rms_partner_attachment_orphans`、バケットの存在保証 | `bash ~/.claude/new-migration.sh autumn-shared rms_partner_booking_attachments`。関数の最新版は `20261007002617`。`git pull` してから作る |
| A-2 `pms_reservation_attachments_source_key` | §5.3 の列と部分一意索引・コメント | `pms` スキーマ。autumn-pms の未適用 migration を確認。A-1 とは別ファイル（pms 側の変更を独立に追えるように） |
| 検証 | `supabase migration list --linked`・`information_schema.columns` で列の実体・`_rms_partner_emit_pms_event` の電文に `attachments` が出ること（既存予約で `select public._rms_partner_attachments_json(id)` が `[]`） | |

**B. autumn-book（5 単位・互いに独立にレビューできる）**

| # | 内容 | 触るファイル |
|---|---|---|
| B-1 台帳・Storage の純関数とサーバ関数 | `lib/server/partners/booking-attachments.ts`（新規: 型・許可リスト・`uploadBookingAttachment` / `listBookingAttachments` / `downloadBookingAttachment` / `deleteBookingAttachment` / `bindStagedAttachments` / `notifyAttachments` / `cleanupOrphanAttachments`）、`lib/partner-attachments.ts`（新規: 純関数＝検証・サイズ表示・権限判定）＋ `partner-attachments.test.ts`、`store.ts` の `PartnerBookingRow` に `attachments_updated_at / attachments_notified_at`、`PARTNER_BOOKING_COLUMNS` | 覚書の `memorandum.ts` を雛形にする |
| B-2 取引先ページ API | `routes/p/[token]/book/attachments/+server.ts`・`[id]/+server.ts`、`routes/p/[token]/bookings/[id]/attachments/+server.ts`・`[attId]/+server.ts`・`notify/+server.ts` | すべて `requirePortalApi`。確認モードのテストを書く |
| B-3 予約入力・確定 | `book/+page.svelte`（ドロップ枠・hidden `attachment_ids`）、`booking-form.ts`（`attachmentIds` の解析）、`booking.ts`（RPC の `p.attachment_ids`・確認／完了・メールの行）、`mail.ts`／`bookingSummaryLines` | §6.1・§10.1 |
| B-4 予約一覧・管理画面 | `bookings/+page.server.ts`・`+page.svelte`（一覧・ドロップ・削除・notify）、`admin/reservations/[code]/+page.server.ts`・`+page.svelte`・`attachments/[attId]/+server.ts`、`admin-reservations.ts`、`admin/partners/[id]` の件数 | §6.2・§6.4・§10.2・§10.3 |
| B-5 掃除・フラグ・版上げ | `api/cron/partner-charge` に掃除、`deletePartner` の実体削除、環境変数 `PARTNER_BOOKING_ATTACHMENTS`、`HANDOFF.md`（テストチェックリスト）、`package.json` ×2（MINOR） | §7.5・§12.1 |

**C. autumn-pms（3 単位）**

| # | 内容 | 触るファイル |
|---|---|---|
| C-1 型と取込 | `direct-booking/types.ts`（event・payload）、`import.ts`（`syncPartnerAttachments`・`attachments` 分岐・`expandDirectBooking` 末尾）＋ `partner-attachments.test.ts`（差分の純関数） | §7.4・§8.1・§8.2 |
| C-2 新着通知 | `arrivals.ts`（分類・文面）、i18n | §8.2・N6 |
| C-3 予約詳細 | `attachments.ts`（select に `source_key, metadata`・`deleteAttachment` の拒否）、`routes/reservations/[id]/+page.server.ts`（action の拒否）・`+page.svelte`（バッジ・削除ボタン非表示）、i18n、版上げ | §8.3・§8.4 |

---

## 13. テストチェックリスト（HANDOFF.md に転記する）

### 取引先ページ（予約入力）
- [ ] 予約入力でファイルをドロップ／選択すると 1 件ずつ上がり、行に名前・サイズが出る。× で消える
- [ ] pdf / xlsx / jpg は上がる。zip / html / svg / exe / xlsm は理由つきで断られる。0 バイトも断られる
- [ ] 21MB のファイルは断られる。11 件目は断られる（10 件まで）。合計 50MB 超も断られる
- [ ] 後払いで予約 → 台帳の行が予約に束縛され、PMS の予約詳細に取込後「取引先ページから（ログインID）」のバッジつきで出る。プレビュー・ダウンロードできる
- [ ] オンライン決済（予約時決済・デポジット・チェックアウト日決済）で予約 → 支払完了後に PMS に出る（`new` 電文の `attachments` に載っている）
- [ ] 支払わずに 35 分放置 → 予約は `expired`。添付は取引先ページに「期限切れ」で見え、掃除（翌日の cron）で実体と行が消える
- [ ] 確認画面・完了画面・確認メール（取引先）・宿への通知メールに「添付ファイル: …」の行（ファイルは添付されない）
- [ ] 別のタブで同じアカウントの仮置きファイルを、別の予約に混ぜられない（`attachment_ids` に他人・他予約の id を入れても束縛されない）

### 取引先ページ（予約一覧）
- [ ] 予約一覧の詳細に添付の一覧（誰が・いつ）。ダウンロードで元のファイル名（日本語）で保存される。画像・PDF はブラウザで開く
- [ ] 後から追加 → トースト → 1 分以内に PMS の予約詳細に出る。PMS の新着通知に「添付ファイル更新」の行
- [ ] 削除 → 取引先ページから即消え、1 分以内に PMS からも消える。PMS の新着通知に「削除」の行
- [ ] 子アカウントが上げたファイルを別の子アカウントは消せない。マスターは消せる
- [ ] 取消済み予約: 追加できない（ドロップ枠が出ず、API 直叩きも 400）。削除・ダウンロードはできる
- [ ] 確認モード（管理画面の「確認ページを開く」）: 一覧とダウンロードはできる。追加・削除・notify は 403（画面にも出ない）
- [ ] 別の取引先の予約 id・添付 id を URL に入れても 404

### Book 管理画面
- [ ] `/admin/reservations/[code]` の取引先予約に添付の一覧・ダウンロード・アップロード（スタッフ名が残る）・削除
- [ ] スタッフの追加・削除も PMS に同期され、新着通知に「スタッフ名」で出る
- [ ] `/admin/partners/[id]` の予約一覧に 📎 件数

### PMS
- [ ] 写し行に削除ボタンが無い。`deleteAttachment` を直接送っても 400
- [ ] PMS で手動アップロードした添付は、Book の同期で消えない（電文に無くても残る）
- [ ] 写し行を事前応対メールの添付に選べる（PDF・画像のみ・8MB）。予約送信にも選べ、Book 側で削除されていたら failed になる
- [ ] `new` の再取込（受信箱の再処理）で写しが二重にならない（一意索引）
- [ ] `attachments` 電文が予約グループの無い予約に来たら `skipped`（通知には出ない）
- [ ] 取引先ページからの予約の取消後も PMS の添付は残る

### 運用・掃除
- [ ] 取引先を削除 → その取引先の Book 添付の実体がバケットから消える
- [ ] `PARTNER_BOOKING_ATTACHMENTS=false` では取引先ページ・管理画面に添付欄が出ず、API は 404

---

## 14. 影響範囲（触るファイルの見取り図）

| リポ | ファイル | 単位 |
|---|---|---|
| autumn-shared | `supabase/migrations/<実UTC秒>_rms_partner_booking_attachments.sql` | A-1 |
| autumn-shared | `supabase/migrations/<実UTC秒>_pms_reservation_attachments_source_key.sql` | A-2 |
| autumn-shared | `docs/BOOK_PMS_DIRECT_BOOKING.md` §2.2（電文のスキーマに `attachments` / `attachment_change` / event `attachments`） | A-1 |
| autumn-book | `lib/server/partners/booking-attachments.ts`（新規）、`lib/partner-attachments.ts`（新規）＋テスト、`store.ts` | B-1 |
| autumn-book | `routes/p/[token]/book/attachments/**`、`routes/p/[token]/bookings/[id]/attachments/**` | B-2 |
| autumn-book | `routes/p/[token]/book/+page.svelte`、`lib/server/partners/booking-form.ts`、`booking.ts`、`mail.ts` | B-3 |
| autumn-book | `routes/p/[token]/bookings/+page.server.ts`・`+page.svelte`、`routes/admin/reservations/[code]/**`、`lib/server/partners/admin-reservations.ts`、`routes/admin/partners/[id]/+page.svelte` | B-4 |
| autumn-book | `routes/api/cron/partner-charge/+server.ts`、`lib/server/partners/store.ts`（`deletePartner`）、`HANDOFF.md`、`package.json` ×2 | B-5 |
| autumn-pms | `lib/server/direct-booking/types.ts`、`import.ts`＋テスト | C-1 |
| autumn-pms | `lib/server/arrivals.ts`、`lib/i18n/messages/*.ts` | C-2 |
| autumn-pms | `lib/server/attachments.ts`、`routes/reservations/[id]/+page.server.ts`・`+page.svelte`、`package.json` | C-3 |

---

## 15. 補足（調査で分かった注意点）

- `pms.reservation_attachments.stay_group_id` に FK が無いのは履歴保持のため。写し行も同じ（予約グループが消えても行が残る）。掃除は Book 側の所有物（実体）だけを対象にし、PMS の行は PMS の既存運用に任せる。
- PMS の `loadAttachments` は `facility_id` でも絞る。写し行の `facility_id` は電文の `facility_id`（＝取引先の施設）にする。同じ旅行会社を西和賀・男鹿の 2 つの取引先が指していても（Phase 1 決定 #11）、添付は取引先（施設）ごとに分かれる。
- `_rms_partner_emit_pms_event` は `booking.bookings` を `for update` で採番するので、`attachments` 電文も他の事象と直列化される。取引先が連続でファイルを上げても、画面が最後に 1 回 `notify` を呼ぶ設計（§6.2）なら電文は 1 本。取りこぼし（画面が `notify` を呼べなかった）は `attachments_updated_at > attachments_notified_at` の予約を掃除の cron が拾って出す（§5.1・§7.5）。
- 取引先予約の `modified` は Book から出していない（変更は取消→再予約）。添付の同期を `expandDirectBooking` にも入れておくのは、将来 `modified` を出したときと、受信箱の `new` 再処理のため。
- Cloudflare の本文上限・Worker のメモリ（§3.4）は実装前に Limits ページで再確認する。1 リクエスト 1 ファイル（20MB）なら Free プランでも収まる想定。
- バケットが PMS と共用のため、Supabase ダッシュボードで `reservation-attachments` の `file_size_limit` / `allowed_mime_types` を**後から付けない**こと（付けると PMS の Office 添付が止まる）。
