# 予約確認メール・非会員キャンセル・予約管理実データ化 設計書（BOOKING_CANCEL_MAIL）

- 対象: `autumn-shared/supabase/migrations/`（DB オブジェクト追加・既存 RPC の本体差し替え）／`autumn-shared/supabase/functions/send-booking-mail/`（新規 Edge Function）／`autumn-book/apps/web/src/routes/(public)/booking/**`（完了画面の文言・キャンセルページ新設）／`autumn-book/apps/web/src/routes/admin/reservations/**`・`admin/members/[id]`（実データ化）／`apps/web/src/lib/server/admin-app-data.ts`（アダプタ追加）
- 作成: 2026-09-07（設計担当）／実装は別エージェント
- 関連: `docs/ADMIN_APP_OPS.md`（管理画面の実装パターン・§5 RPC 規約・§6 環境ガード）、yamado-one `docs/BOOKING_UX.md`（文言の品位・中高年配慮・§0.4 RPC 実シグネチャ）、yamado-one `docs/DESIGN.md` §2 A2/§3（`book.notifications` outbox と `send-push` drainer）
- Supabase: `opkocyapzmsjzhbwlguh`（`book` / `booking` / `core` / `pms` スキーマ。2026-09-07 の実測値を本書の根拠にしている）
- 本番ドメイン: 現状 `https://autumn-book.pages.dev`（独自ドメイン未移行）。メール内リンクの生成元は §3.6 の 1 変数に集約し、移行時にそこだけ変える

---

## 0. 実装者が最初に読む要約

### 0.1 何を作るのか

| # | 対象 | 現状 | 作るもの |
|---|---|---|---|
| ① | 予約確認メール | **送信処理がどこにも無い**。完了画面は「確認メールを {email} 宛にお送りしました」と表示だけしている | `book.mail_outbox`（メール専用 outbox）＋ pg_cron `book_mail_outbox_drain`（2 分毎）＋ Edge Function `send-booking-mail`（claim → 本文生成 → 施設別 SMTP 送信 → 結果記録）。`confirm_booking` / `cancel_booking` の中で outbox に積む |
| ② | 非会員のキャンセル | `cancel_booking` は `auth.uid()` 必須。非会員は自分でキャンセルできない | 予約ごとに**推測不能なトークン**を発行し、確認メールのリンク `/booking/cancel?t=<token>` から予約内容・キャンセル料を見て、ボタン 1 つで取消できるページ。anon から呼べる `guest_booking_by_token` / `guest_cancel_booking` RPC |
| ③ | 管理画面の予約管理 | `/admin/reservations` はインメモリ demo（`store.ts`）だけを読み、**実予約が 1 件も出ない** | `book.admin_list_bookings` / `admin_booking_detail` / `admin_cancel_booking` / `admin_resend_booking_mail` / `admin_rotate_cancel_token` を新設し、`ADMIN_SUPABASE` 分岐で実データ化。予約の取消は **book 管理画面が正式窓口**（PMS では消さない） |

### 0.2 主要な設計判断（詳細は各章）

| # | 判断 | 章 |
|---|---|---|
| 1 | メールの outbox は **`book.notifications` を共用せず、`book.mail_outbox` を新設**する。notifications は `member_user_id NOT NULL`・type CHECK・会員 own-row select（アプリ通知センター）という「会員宛アプリ内通知」の構造で、非会員メールを載せると制約もポリシーも壊す。**pending→processing→sent/failed ＋ claim RPC ＋ 2 分毎 cron ＋ Edge Function** という運用パターンだけを揃える | §3.1 |
| 2 | 積むタイミングは **`confirm_booking` / `cancel_booking` の中（同一トランザクション）**。テーブルトリガーは OTA 取込（`core.stays` は 70,686 行・`source` に `ota/direct/filemaker`）にも発火して誤送信の温床になる。別 RPC は SvelteKit のリダイレクト直前で呼び漏れが起きる | §3.2 |
| 3 | 送信は既存 `send-mail`（単発・同期・text/plain 1 パート・`verify_jwt:true`）を叩かず、**drainer 型の新 Edge Function `send-booking-mail`** を作る。SMTP／MIME 実装は `send-mail/mime.ts` を `_shared/` に移して共用し、HTML＋テキストの `multipart/alternative` を追加する | §3.4 |
| 4 | テンプレートは **コード（Edge Function 内）に持つ**。`pms.mail_templates` はスタッフが手で送る `{{差込}}` 付き定型文で、HTML も自動送信の文脈も持たない。運用者が変えたいのは連絡先・チェックイン時刻・キャンセル規定であり、それらは DB（`core.facilities` / `book.v_facilities` / `book.rank_cancel_policies`）から差し込む | §3.5 |
| 5 | キャンセル用トークンは **32 バイト乱数 → base64url（43 文字）を URL に載せ、DB には SHA-256 ハッシュのみ保存**。1 予約 1 トークン（再送でも同じリンク）、有効期限は**チェックイン日の 23:59 JST**、取消実行・失効・スタッフによる再発行で無効化。予約番号（`YB-2026-001001` 連番）は URL に載せない | §4.1 |
| 6 | キャンセル実行前に**同一ページ内の二段確認**を置く（キャンセル料を明示して「キャンセルを確定する」）。不可逆かつ料金が発生し得る操作を「リンクを開いた瞬間」に実行してはならない（メーラーのプレビュー・リンク先読みで自動実行される事故を防ぐ＝GET で副作用を起こさない） | §4.4 |
| 7 | `cancellation_policy_snapshot = []` は「無料」ではなく「プラン個別規定なし → 会員ランク（非会員は standard）の規定表にフォールバック」。DB `book._cancel_fee` が既にそう動いており、standard 行には標準料率（不泊 100%…14 日前 10%）が投入済み。**画面もメールも DB の計算結果だけを表示し、クライアント側の `computeCancelFee`（store.ts のデモ実装）は使わない** | §4.3 |
| 8 | `cancel_booking` の本体を `book._cancel_booking_core` に切り出し、`cancel_booking`（会員・スタッフ）／`guest_cancel_booking`（トークン）／`admin_cancel_booking`（管理者・`_require_admin`）の 3 入口を**同じ核**に通す。キャンセルメールの enqueue は核の中で 1 回だけ行う | §4.2 / §5.3 |
| 9 | 管理画面の一覧は **`core.stays` 起点**（`booking.bookings` は直販分しか無い）。既定は直販（`source='autumn_booking'`）のみ、「すべて（閲覧）」は日付窓 ＋ 200 件上限。OTA 予約の取消ボタンは出さない（OTA は OTA 側で取消・PMS 取込） | §5.2 |
| 10 | 会員／非会員は `booking.bookings.metadata->>'member_user_id'` で判別。サイト／アプリは `metadata.guest.client`（`'web'`/`'app'`）で判別できるよう、**`p_guest` に `client` キーを足す**（RPC シグネチャ変更なし。未設定はサイト扱い） | §5.2 |
| 11 | メール内リンクの生成元は Edge Function の環境変数 `BOOK_SITE_BASE_URL` 1 つ。独自ドメイン移行時は `supabase secrets set` で差し替えるだけ（DB・SvelteKit 側は無変更） | §3.6 |

### 0.3 前提となる実測値（2026-09-07・設計の根拠）

| 項目 | 実測 | 備考 |
|---|---|---|
| 直販予約（`core.stays.source='autumn_booking'`） | **1 件** `YB-2026-001001`（テスト・`booking-test@yamado.co.jp`・10/07 1 泊 2 名・¥69,300・`member_user_id: null`・`cancellation_policy_snapshot: []`） | 本番で実物の形を見る唯一のサンプル |
| `booking.bookings` | 1 件（上記） | OTA・電話予約は `core.stays` のみで `bookings` 行を持たない |
| `core.stays` 全体 | 70,686 件。`source`: `autumn_booking / direct / filemaker / ota`。`status`: `reserved / checked_out / cancelled`。今日以降の reserved 1,352 件 | 管理画面「すべて」の母集団 |
| `core.stays.status` CHECK | `reserved / checked_in / checked_out / cancelled / no_show` | |
| `booking.bookings.status` CHECK | `pending / confirmed / modified / cancelled / no_show` | |
| `pms.mail_settings` | yamado: `sv14189.xserver.jp:465 SSL` / `reservation@yamado.co.jp` / from_name `山人-reservation-`。oga: 同ホスト / `reservation@oga.yamado.co.jp` / from_name `山人-oga-`。両方 `is_active=true`・パスワードあり | 差出人名の不揃い（`山人-reservation-`）は §3.5 で扱う |
| `core.facilities` | yamado: `0197-82-2222` / `info@yamado.co.jp` / `岩手県和賀郡西和賀町湯川52-71-10`。oga: `0185-47-7776` / `info@oga.yamado.co.jp` / `秋田県男鹿市船川港台島字鵜ノ崎62-29` | メール署名の差込元。郵便番号は無い（`CLAUDE.md` の会社情報で補う → §3.5） |
| `book.v_facilities` | `checkin_time` / `checkout_time` / `phone` / `address_public` / `access` あり | チェックイン時刻の差込元 |
| `book.rank_cancel_policies` | 4 ランクとも `不泊100% / 当日80% / 3日前50% / 10日前30% / 14日前10%` | `[]` フォールバック先 |
| pg_cron（book） | `book_notifications_drain */2`・`book_release_expired_holds * * * * *`・`book_stay_notifications_enqueue 0 1`・`book_finalize_checkout 0 3`・rms 同期 2 本 | drain の書き方をそのまま踏襲 |
| Vault | `book_send_push_url` / `book_send_push_secret` あり。send-mail 用は無し | `book_send_booking_mail_url` / `_secret` を新規投入 |
| Edge Functions | `send-mail` v16 `verify_jwt:true`／`send-push` v13 `verify_jwt:false`／他 8 本 | 新 EF は send-push と同じ `--no-verify-jwt` ＋ 共有シークレット |
| `core.stays` のトリガー | `stays_release_rooms_on_cancel`（cancelled/no_show で `pms.stay_nights.room_id` を解放）・`trg_audit_stays`・`trg_stays_updated_at` | メール送信トリガーは無い |
| `booking.bookings` のトリガー | `trg_bookings_updated_at` のみ | 同上 |
| `book.members` / `book.notifications` | 1 名 / 0 件 | |
| `/admin` にログインできるアカウント | `hikaru.s@yamado.co.jp` のみ（`app_metadata.role=admin` ＋ `core.memberships.tenant_admin`） | ADMIN_APP_OPS §0.3 と同じ |

### 0.4 既存の実装パターン（踏襲するもの）

- 管理画面の書き込みは **`SECURITY DEFINER` RPC（`book._require_admin` / `_require_staff` ガード・`admin_audit_logs` 内蔵）**を cookie 束縛の authenticated クライアントから呼ぶ。service_role を SvelteKit に持ち込まない（ADMIN_APP_OPS §5.1）。
- 実データ／デモの分岐は `ADMIN_SUPABASE`（`auth.ts:31`）。既存画面（`/admin/reservations`）は `/admin/members` と同じく**二本立てを維持**（ADMIN_APP_OPS §6.4）。
- RPC 例外の文言化は `admin-app-data.ts` の `mapRpcError()`（`RPC_MESSAGES` 配列に追記）。
- outbox の運用は `book.notifications` と同形: `status` 遷移・`claim_*` RPC（`for update skip locked`）・processing 10 分超の回収・pg_cron `net.http_post` ＋ Vault ガード（`20260703001400`）。
- 公開側の予約フローは cookie（`ab_book_sid` / `ab_book_draft` / `ab_book_last`）で anon 予約を運ぶ（`supabase-data.ts:2180-2263`）。完了画面は `ab_book_last` から復元する（`complete/[code]/+page.server.ts:9-45`）。
- 二段確認 UI は `confirming` state（`admin/mail/new/+page.svelte`・ADMIN_APP_OPS §3.1）。
- 見た目: 管理面は ADMIN_APP_OPS §0.4 の Tailwind クラス。公開面は `booking/complete` の `rounded-2xl border border-stone-200 bg-white p-8` カード・`font-display text-brand-900` 見出し・`bg-brand-800` 主ボタン。

---

## 1. 現状の事実確認（自分で読んで確認したこと）

### 1.1 メール送信が存在しないこと

| 確認箇所 | 事実 |
|---|---|
| `autumn-shared/supabase/migrations/20260711051616_book_confirm_booking_guest_name.sql:12-211` | `book.confirm_booking(uuid,text,jsonb,integer,text,uuid)` の全文。`core.guests`（67-82）→ `core.stays`（146-154）→ `booking.bookings`（168-186）→ `book.point_ledger`（188-196）→ `member_coupons`（198-202）→ `holds` を `converted`（204）。**メール・通知に関する行は無い**。予約番号は `'YB-' || 年 || '-' || lpad(nextval('book.booking_code_seq'), 6, '0')`（139-140）＝連番 |
| 同 `:176-185` | `booking.bookings.metadata` に `booking_code / hold_id / guest（p_guest そのまま）/ member_user_id / points_used / points_earned / coupon / price_snapshot / locale` を保存。**ゲストの email は `metadata.guest.email` と `core.guests.email` の 2 箇所**にある（`v_email` は小文字化済み・54 行目で書式検証済み） |
| `20260711083740_book_rank_cancel_policies.sql:142-248` | `book.cancel_booking(text,boolean,text)` の現行本体。`auth.uid()` が staff（`private.has_facility_access`）または owner（`book.members.guest_id = stays.guest_id`）でなければ `forbidden`（172-175）。`revoke … from public, anon`（247）。メール処理無し |
| 同 `:50-98` | `book._cancel_fee(snapshot, total, checkin, as_of, rank)`。snapshot が `[]`（または `{rules:[]}`）なら `book.rank_cancel_policies` の当該ランク → 無ければ standard の rules を使う（71-81）。`rules_source: 'plan' | 'rank'` を返す |
| 同 `:103-136` | `book.compute_cancel_fee(text,date)` も staff/owner 必須（122-125）。anon は呼べない |
| `20260711093334_book_cancel_policy_standard.sql:33-43` | 4 ランクへ標準料率投入済み。`days_before: -1` 行＝チェックイン日を過ぎた reserved の取消は不泊 100% |
| 本番 `pg_trigger`（`core.stays` / `booking.bookings` / `book.notifications` / `book.holds`） | `stays_release_rooms_on_cancel`・`trg_audit_stays`・`trg_stays_updated_at`・`trg_bookings_updated_at` の 4 本のみ。メール送信トリガーは無い |
| 本番 `pms.mail_templates`（19 件） | yamado: 予約返信 / JR 案内 ×2 / キャンセル規定 / お祝い OP / 料金案内 / 雪椿ベッド案内 / リコンファーム / CXL 料入金お礼。oga: 予約返信 / 送迎案内 / お祝い OP ×2 / 源泉工事 / 料理長コース / 観光案内 / 部屋タイプ / 英語確認 / アレルギー確認 / 料金のお知らせ。**すべてスタッフが手で送る返信定型文**（`{{顧客名}}` 等の差込）。自動送信の実装は無い |
| `autumn-book/apps/web/src/routes/(public)/booking/complete/[code]/+page.svelte:35` | `m.complete_email_sent({ email: b.guest.email })` ＝ ja.json:244 `"確認メールを {email} 宛にお送りしました。"`。**表示と実態が食い違っている** |
| `autumn-book/apps/web/src/routes/admin/reservations/[code]/+page.server.ts:34-37` | `resend` action は `// デモ：本実装は確定メールの再送（Resend）` のコメントで `{ resent: true }` を返すだけ |
| yamado-one `src/app/(tabs)/book/done.tsx:119` | 「ご予約の確認・キャンセルはマイページの『ご予約の確認』から行えます。」。アプリはメールに言及していない（会員限定のため、確認メールは「届けば嬉しいもの」であり導線の前提ではない） |

### 1.2 メール送信の土台

| 確認箇所 | 事実 |
|---|---|
| `autumn-shared/supabase/functions/send-mail/index.ts:1-25, 212-280` | 入力 `{facilityId, to, subject, body, replyTo?, cc?, attachments?}`。`x-send-mail-secret` ヘッダで `SEND_MAIL_SECRET` と一致比較（213-217）。`pms.mail_settings` を service_role で読み（229-242）、`buildMimeMessage` で電文生成（253-263）→ `sendSmtp`（272）。**1 リクエスト 1 通の同期 API**。本番は `verify_jwt:true`（＝呼び出しに anon JWT も要る） |
| 同 `:6-10`、`mime.ts`（254 行） | MIME は自前。件名 RFC2047・本文 UTF-8 base64。添付があるときだけ `multipart/mixed`。**`text/html` や `multipart/alternative` は無い** |
| 同 `:125-165` | `SmtpConn` ＋ `sendSmtp`（465 SSL 直結／587 STARTTLS・AUTH LOGIN・ドットスタッフィング）。`write()` は書き切るまで回す（2026-08-18 の教訓） |
| `20260712045903_pms_mail_settings_templates.sql:11-27` | `pms.mail_settings`（1 施設 1 行・`unique(facility_id)`・`password` は Edge Function のみ参照）。RLS は `has_facility_access` |
| 本番 `pms.mail_settings` | §0.3 のとおり両施設 `is_active=true`・465/SSL・パスワードあり |
| autumn-pms `sveltekit/src/lib/autumn-shared/…/send-mail/index.ts:4` | PMS は SvelteKit サーバから `x-send-mail-secret` 付きで直接叩く（cron ではない） |

### 1.3 既存 outbox（`book.notifications`）の構造

| 確認箇所 | 事実 |
|---|---|
| `20260703001300_book_notifications.sql:11-29` | `member_user_id uuid not null references book.members`・`type check in ('news','coupon','reminder','thanks','custom')`・`dedupe_key text unique`・`status check in ('pending','processing','sent','failed')`・`scheduled_at / claimed_at / sent_at / read_at` |
| 同 `:57-63` | `grant select … to authenticated` ＋ policy `notifications_own_select (member_user_id = auth.uid())`＝**アプリの通知センターがこのテーブルを直接読む** |
| 同 `:120-142` | `claim_pending_notifications(p_limit)`: `pending and scheduled_at <= now()` を `for update skip locked` で `processing` に更新して返す。service_role 専用 |
| `20260703001400_book_stay_notification_crons.sql:35-38, 95-113` | processing 10 分超の回収は `enqueue_stay_notifications()`（日次）の中。drain cron は Vault `book_send_push_url` が無ければ `where exists` で no-op |
| `send-push/index.ts:132-148, 158-165` | 認可は `Authorization` ヘッダと `BOOK_SEND_PUSH_SECRET` の定数時間比較（119-130）。service_role クライアント（book スキーマ）で `claim_pending_notifications` |

### 1.4 公開側（autumn-book）の予約フローと cookie

| 確認箇所 | 事実 |
|---|---|
| `booking/hold/+page.server.ts:35-86` | `DATA_SOURCE==='supabase'` で `sbGetHoldMapped` → `v_plans/v_room_types/v_facilities`。会員なら `sbMyProfile` でプリフィル。フォーム項目は `familyName/givenName/…/phone/email/arrival/shuttle/notes`（ja.json:205-213） |
| `booking/payment/+page.server.ts:83-112` | `sbConfirmBooking(holdId, sid, draft.guest, { client, pointsUsed, locale })` → `setLastBooking(cookies, …)` → `clearBookingDraft` → 303 `/booking/complete/<code>` |
| `supabase-data.ts:412-440` | `confirmBooking()` は会員なら authenticated client、ゲストは anon `supa()`。`p_guest` は `GuestInfo` をそのまま渡す |
| `supabase-data.ts:2180-2263` | `ab_book_sid`（24h）/ `ab_book_draft`（30 分）/ `ab_book_last`（30 分・httpOnly）。**anon で予約を再取得する RPC が無い**ため完了画面は cookie 復元（`complete/[code]/+page.server.ts:10-12`。cookie が無い・code 不一致なら 404） |
| `(public)/account/reservations/[code]/+page.server.ts:44-118, 120-135` | 会員のキャンセルは `sbMyReservations` で本人予約を引き、`sbComputeCancelFee` でプレビュー（`rulesSource` が rank なら `sbListRankCancelPolicies` で rules を補完）→ `sbCancelBookingAsMember`。エラーは `m.error_cannot_cancel()` 一律 |
| `supabase-data.ts:1982-1994` | `normalizeCancellationPolicy()` が `[]` を rules 0 件に正規化（BOOKING_UX §0.4 と同じ知見） |
| `apps/web/src/lib/server/claim-rate-limit.ts` | レート制限の既存モジュール（110 行）。トークン照会の連打対策に流用する（§4.5） |

### 1.5 管理画面（`/admin/reservations`）

| 確認箇所 | 事実 |
|---|---|
| `admin/reservations/+page.server.ts:1-21` | `store.bookings`（Map）を `currentFacility.id`（`'f-nishiwaga'` 等の demo ID）で filter。`status / channel（既定 'autumn_booking'）/ q` |
| `admin/reservations/+page.svelte:13-35, 37-72` | フィルタフォーム（ステータス・チャネル「直販のみ／すべて（OTA含む・閲覧）」・検索）と 7 列テーブル。末尾注記「部屋割り・チェックイン操作・現場帳票は PMS で行います」 |
| `admin/reservations/[code]/+page.server.ts:6-21, 23-38` | staff は連絡先マスク（12）。`cancel` action は admin 限定・理由必須（29）・`store.cancelBooking`。`resend` はダミー |
| `admin/reservations/[code]/+page.svelte:54-84` | 右カラムに「確定メールを再送」「キャンセル処理」（`showCancel` → 施設都合チェック・適用キャンセル料・理由入力・実行） |
| `admin/+layout.server.ts:13-14` | `currentFacility` は `store.facilities`（demo ID）。実 UUID へは `FACILITY_UUID`（`supabase-data.ts:79-82`: `'f-nishiwaga' → 1000…0001`, `'f-oga' → 1000…0002`）で変換 |
| `admin/members/[id]/+page.server.ts:3-8` | 「予約履歴 … 会員軸で他人の予約を引く管理 RPC が未整備（/admin/reservations で会員名検索する）」と明記して空にしてある |
| `20260907061853_book_admin_app_ops.sql:198-213` | `admin_list_member_coupons` は `b.metadata->>'booking_code'` で予約番号を引く（ADMIN_APP_OPS §10-2 の未決が解決済み） |
| 同 `:229-278` | `admin_list_members` は `_require_staff` ＋ `v_is_admin` で email をマスク。`p_limit` 上限 1000 |
| autumn-pms `sveltekit/src/routes/reservations/+page.server.ts:109-113` | PMS 一覧は `pms.stays_with_group_guest`（`p_statuses: ['reserved','checked_in','checked_out']`）。**cancelled は一覧から消える** |
| autumn-pms `reservations/cancel-dialog.svelte:1-8` | PMS のキャンセルは「手で消すのは例外操作」として理由・担当者必須。本書の運用方針（予約サイト経由は book 側で取消）と整合する |
| `20260718003000_pms_room_night_unique_and_reconcile.sql:72-94` | `core.stays.status` が cancelled/no_show になると `pms.stay_nights.room_id` を解放するトリガー。**book 側の `cancel_booking` が `core.stays` を cancelled にすれば PMS の部屋割りは自動で解放される** |

### 1.6 版の食い違い（実装者への注意）

`autumn-book/apps/web/package.json` の `version` は `0.9.1` だが、`HANDOFF.md` の最終更新は `v0.36.0`（アプリ運用管理画面）。**HANDOFF 側の採番に合わせて次を `v0.37.0` とし、package.json も同時に直す**（§8）。

---

## 2. 全体方針

### 2.1 3 つを 1 本にまとめる理由

- 確認メール（①）は、非会員がキャンセルに辿り着く**唯一の導線**（②）を運ぶ。トークンはメールに載って初めて意味を持つ。
- キャンセル（②③）は会員・非会員・管理者のどの入口からでも同じ核（`_cancel_booking_core`）を通り、その核がキャンセルメール（①）を積む。
- 管理画面（③）は「メールが届いたか」「トークンを再発行するか」「取消するか」を運用者が判断する場所。①②の可視化と操作を置く先が無いと、失敗が誰にも見えない。

### 2.2 責務分担（book 管理画面 vs PMS）

ユーザー決定: 予約サイト（アプリ含む）経由の予約は、PMS から取り消さない（各 OTA と同じ扱い）。現場は部屋移動・料金変更等の操作はするが、予約データそのものを消さない。

| 責務 | book 管理画面（`/admin/reservations`） | PMS（`autumn-pms /reservations`） |
|---|---|---|
| 直販予約（サイト・アプリ）の**一覧・詳細・検索** | ✅ 正式窓口。会員／非会員・メール送信状況・キャンセルリンクの状態を見る | 閲覧のみ（`stays_with_group_guest` に載る。現場帳票・部屋割りのため） |
| 直販予約の**取消** | ✅ `admin_cancel_booking`（施設都合の免除・理由必須・監査ログ・キャンセルメール自動送信・在庫戻し・ポイント／クーポン巻き戻し） | ❌ 行わない。`cancel-dialog` は電話予約等の例外用として残す |
| 直販予約の**変更**（日程・人数・プラン） | 会員はマイページ／アプリの `amend_booking`（既存）。管理画面からの変更 UI は本書の範囲外（§10） | 部屋移動・料金変更・食事時間等の**現場操作**。`core.stays.status` を `checked_in / checked_out` に進める |
| OTA・電話予約の取消 | ❌ ボタンを出さない（OTA は OTA 側で取消 → TL リンカーン → PMS 取込） | 例外操作として可（既存） |
| キャンセル料の**請求・入金管理** | 表示のみ（`cancellation_fee`） | 既存運用（`CXL料入金お礼` テンプレ等） |
| 整合性の担保 | `cancel_booking` が `core.stays.status='cancelled'` を書く → PMS のトリガーが部屋割りを解放 → PMS 一覧から消える | PMS が `checked_in` にした予約は book 側で `not_cancellable`（取消不可）になる |

原則: **予約データの SoT は `core.stays` ＋ `booking.bookings`（1 つ）**。book 管理画面は「予約の入口と出口（取消）」、PMS は「滞在の中身」を扱う。

### 2.3 やらないこと（範囲の遮断）

- オンライン決済・返金処理（現地決済のみ。キャンセル料の請求はメールで「別途ご連絡」と案内し、実務は施設運用）
- 予約変更のメール（`amend_booking` 経由の変更通知は §10 の将来課題。本書は確認・キャンセルの 2 種類のみ）
- リコンファーム／リマインドの自動メール（アプリ push は既存。メール版は将来）
- 多言語メール（`metadata.locale` は保存済み。v1 は日本語固定・§10）
- OTA 予約への確認メール（OTA が送る）
- `pms.mail_templates` との統合（用途が違う。§3.5）

---

## 3. 予約確認メールの自動送信

### 3.1 outbox を `book.notifications` と共用するか

| 観点 | 共用（不採用） | `book.mail_outbox` 新設（**採用**） |
|---|---|---|
| 宛先 | `member_user_id uuid NOT NULL references book.members` — 非会員は表現できない。NULL 許容にすると `notifications_own_select` の意味が変わる | `to_email text` ＋ `booking_id`。会員かどうかを問わない |
| type | CHECK `news/coupon/reminder/thanks/custom`。追加すると `send-push` が未知 type を Expo に送ろうとする（`send-push/index.ts:202-222` は type を見ない） | `kind` を別 CHECK で持つ |
| 読み手 | authenticated の own-row select ＝ **アプリの通知センターに出る**。メール行が混ざると「未読通知」として表示される | staff select のみ。会員には見せない |
| drainer | `claim_pending_notifications` を `send-push` が 2 分毎に全件 claim する。メール行を混ぜると Expo 送信に失敗し `failed` に落とされる | 独自 `claim_pending_mail` を `send-booking-mail` が claim |
| ペイロード | `title/body/data` | `subject/body_text/body_html`＋施設（SMTP 解決）＋リトライ回数 |
| 揃えるもの | — | **status 遷移・claim の `for update skip locked`・processing 回収・cron の Vault ガード・EF の定数時間比較認可**（運用の見え方を同じにする） |

結論: テーブルは分け、**運用パターンだけを完全に揃える**。管理画面のキュー表示（§5.4）も notifications と同じ「待機／処理中／失敗」の見せ方にする。

### 3.2 どのタイミングで積むか

| 案 | 評価 |
|---|---|
| A. `booking.bookings` / `core.stays` の AFTER INSERT/UPDATE トリガー | 不採用。`core.stays` は OTA 取込（`tl-lincoln`）・FileMaker 移行・PMS の手入力でも insert/update される（`source` 実測 4 種）。「直販だけ」を判定する条件をトリガーに書くと、判定漏れ＝**他社経由の客に自社確認メールを誤送信**する事故になる。また `booking.bookings.metadata` の `guest.email` に依存した判定を DDL に埋めるのは脆い |
| B. SvelteKit / アプリが `confirm_booking` の後に別 RPC `enqueue_booking_mail` を呼ぶ | 不採用。`payment/+page.server.ts:93-111` は RPC 成功 → cookie 書込 → `redirect(303)` と続き、途中で例外・タイムアウトが起きると**予約は成立したのにメールだけ積まれない**。呼び出し元が 2 つ（Web・アプリ）あり片方で呼び忘れる |
| C. **`confirm_booking` の中で同一トランザクションに insert**（採用） | 予約成立とメール積みが原子的。呼び出し元を問わない（Web・アプリ・将来の管理画面代行予約）。`confirm_booking` は `CREATE OR REPLACE` で本体差し替えの前例が 3 回ある（`20260612000200` → `20260704000200` → `20260711051616`）。**シグネチャは変えない**（6 引数・yamado-one の型定義と `supabase-data.ts:421-428` に影響しない） |

同様に、キャンセルメールは `_cancel_booking_core` の中で積む（§4.2）。

**`confirm_booking` に足す処理（本体末尾・`update book.holds set status='converted'` の直前）**

```sql
  -- 予約確認メール（book.mail_outbox へ。送信は send-booking-mail が 2 分以内に行う）
  -- キャンセル用トークンをここで発行し、raw 値は outbox の payload にだけ置く（送信後に消す・§4.1）
  v_cancel_token := book._issue_booking_token(v_booking_id, 'guest_cancel', v_hold.checkin_date, v_hold.tenant_id);
  insert into book.mail_outbox (tenant_id, facility_id, booking_id, kind, to_email, locale, dedupe_key, payload)
  values (v_hold.tenant_id, v_hold.facility_id, v_booking_id, 'booking_confirmation', v_email, p_locale,
          'booking_confirmation:' || v_booking_id,
          jsonb_build_object('cancel_token', v_cancel_token, 'client', coalesce(p_guest->>'client', 'web')))
  on conflict (dedupe_key) do nothing;
```

`p_guest->>'client'` は §5.2 の「サイト／アプリ判別」用。`metadata.guest` に p_guest がそのまま保存されるので、追加キーは自動的に残る。

### 3.3 `book.mail_outbox` スキーマ

```sql
create table book.mail_outbox (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenants(id),
  facility_id   uuid not null references core.facilities(id),   -- pms.mail_settings（差出人）を引く鍵
  booking_id    uuid references booking.bookings(id) on delete set null,
  kind          text not null check (kind in ('booking_confirmation', 'booking_cancelled')),
  to_email      text not null,
  locale        text not null default 'ja',
  dedupe_key    text unique,                 -- 'booking_confirmation:<booking_id>' / 'booking_cancelled:<booking_id>' / 'resend:<uuid>'
  payload       jsonb not null default '{}'::jsonb,   -- {cancel_token, client, waived, reason_for_guest}。cancel_token は送信後に消す
  status        text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  scheduled_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  last_error    text,
  subject       text,                        -- 送信時に EF が保存（何を送ったかの記録・再送は新しい行）
  body_text     text,
  requested_by  uuid,                        -- 管理画面からの再送時の actor（自動は null）
  created_at    timestamptz not null default now()
);
create index mail_outbox_queue_idx   on book.mail_outbox (status, scheduled_at);
create index mail_outbox_booking_idx on book.mail_outbox (booking_id, created_at desc);
```

- `body_html` は保存しない（HTML はテキストと同じ内容の装飾であり、監査には `body_text` で足りる。行サイズを抑える）。
- `body_text` にはキャンセルリンク（トークン入り）が含まれる。スタッフはこの行を読めるが、**スタッフは元々 `cancel_booking` を呼べる**ため権限の拡大にはならない（§7.4）。チェックアウト後 90 日で `body_text` を NULL にする週次 cron を置く（§6.3）。
- `dedupe_key` は自動分だけ固定文字列、再送は `'resend:' || gen_random_uuid()`（毎回新しい行＝履歴になる）。

### 3.4 Edge Function `send-booking-mail`（drainer）

| 項目 | 決定 |
|---|---|
| 置き場 | `autumn-shared/supabase/functions/send-booking-mail/index.ts`＋`templates.ts`（本文生成・純関数）＋`templates.test.ts` |
| 共有コード | `send-mail/mime.ts` と `SmtpConn/sendSmtp` を `functions/_shared/smtp.ts` `_shared/mime.ts` へ移し、`send-mail` からも import する（`send-mail` の挙動は変えない。`mime.test.ts` はそのまま通ること）。`buildMimeMessage` に `html?: string` を足し、あるときは `multipart/alternative`（text/plain → text/html の順）で組む。添付ありの場合は `multipart/mixed` の中に `alternative` を入れ子にする（本書では添付を使わないが、構造は壊さない） |
| 認可 | `send-push` と同じ: `Authorization` ヘッダ ＝ `BOOK_SEND_BOOKING_MAIL_SECRET` を定数時間比較（`send-push/index.ts:119-130` の `timingSafeEqualStr` を `_shared/auth.ts` へ）。デプロイは `supabase functions deploy send-booking-mail --no-verify-jwt` |
| 環境変数（`supabase secrets set`） | `BOOK_SEND_BOOKING_MAIL_SECRET`（cron 用共有秘密）／`BOOK_SITE_BASE_URL`（§3.6）。`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` は自動注入 |
| 呼び出し | pg_cron `book_mail_outbox_drain`（`*/2 * * * *`）。Vault `book_send_booking_mail_url` / `book_send_booking_mail_secret` が無ければ no-op（`20260703001400:95-113` と同形） |
| 処理 | 1) `claim_pending_mail(50)` 2) 各行について `mail_render_context(id)` で差込データ取得 → `templates.ts` で subject/text/html 生成 → `pms.mail_settings` を facility_id で取得 → SMTP 送信 → `sent`（`subject/body_text` 保存・`payload.cancel_token` を削除） 3) 失敗は行単位で catch: `attempts+1`、`attempts >= max_attempts` なら `failed`、そうでなければ `pending` に戻し `scheduled_at = now() + backoff(attempts)`、`last_error` に理由 4) 200 ＋ 集計 JSON（throw しない・`send-push` と同じ） |
| backoff | `attempts` 1→2 分、2→10 分、3→30 分、4→2 時間（5 回目で `failed`）。合計約 3 時間弱で諦め、管理画面に赤で出す |
| 1 通の失敗が他に波及しない | 行ごとに try/catch。SMTP 接続は行ごとに張り直す（同一施設でも。1 回 20〜50 通程度の想定で十分） |
| 二重送信の防止 | claim で `processing` に上げてから送る。**SMTP 250 受領後の DB 更新失敗**（ごく稀）だけは再送になり得る → 10 分回収で pending に戻り 2 通目が出る。これは「届かない」より軽い失敗として許容し、`last_error` に `sent_but_update_failed` を残す実装にする |
| processing 回収 | `claim_pending_mail` の先頭で `processing and claimed_at < now() - interval '10 minutes'` を pending へ（notifications は日次 enqueue に置いているが、メールは日次では遅すぎるので claim 側に置く） |

**`mail_render_context(p_outbox_id)` が返す jsonb（service_role 専用・SECURITY DEFINER）**

```jsonc
{
  "kind": "booking_confirmation",
  "to_email": "booking-test@yamado.co.jp",
  "locale": "ja",
  "payload": { "cancel_token": "…43文字…", "client": "web" },
  "booking": {
    "code": "YB-2026-001001", "status": "confirmed", "created_at": "2026-09-07T07:12:13+00:00",
    "check_in_date": "2026-10-07", "check_out_date": "2026-10-08", "nights": 1, "adult_count": 2,
    "total_amount": 69300, "discount": 0, "points_used": 0, "points_earned": 0,
    "cancellation_fee": null, "cancelled_at": null,
    "price_lines": [{ "date": "2026-10-07", "adults": 2, "unit_price": 34650, "subtotal": 69300 }],
    "notes": "自動テスト・確認後キャンセルします",
    "arrival": "", "shuttle": false,
    "is_member": false
  },
  "guest": { "name": "テスト予約 削除可", "kana": "テストヨヤク", "phone": "0197822222", "email": "…" },
  "facility": {
    "slug": "yamado", "name": "山人-yamado-",
    "phone": "0197-82-2222", "email": "info@yamado.co.jp",
    "postal_code": "029-5514", "address": "岩手県和賀郡西和賀町湯川52-71-10",
    "checkin_time": "15:00", "checkout_time": "11:00"
  },
  "plan": { "name": "シンプルステイプラン", "meal_plan": "素泊" },
  "room": { "name": "［離れ］ジャパニーズスイート■麓花坊◇雪椿-YUKITSUBAKI-■" },
  "cancel_policy": {
    "rules_source": "rank", "rank_code": "standard",
    "rules": [{ "days_before": 14, "rate": 0.10 }, { "days_before": 10, "rate": 0.30 },
              { "days_before": 3, "rate": 0.50 }, { "days_before": 0, "rate": 0.80 }, { "days_before": -1, "rate": 1.00 }],
    "note": "不泊100% / 当日80% / 3日前50% / 10日前30% / 14日前10%（15日以上前は無料）"
  },
  "cancel": { "waived": false, "fee": 0, "by": "guest_token" }   // booking_cancelled のときだけ
}
```

- `plan.name` は `booking.rate_plans.name`、`room.name` は `pms.room_types.name`（`v_plans` / `v_room_types` は公開済みしか返さないため直接引く）。装飾記号入りの名前はそのまま（旅館側の正式名称）。
- `facility.postal_code` は `core.facilities` に列が無いため、`metadata->>'postal_code'` を読み、無ければ EF 側の定数表（`yamado: 029-5514` / `oga: 010-0531`・`CLAUDE.md` 会社情報）で補う。実装時に `core.facilities.metadata` へ `postal_code` を入れておくのが望ましい（データ投入・DDL 不要）。
- `cancel_policy.rules` は `book._cancel_fee` と同じ引き方（snapshot が非空ならそれ、空なら `rank_cancel_policies` の当該ランク → standard）。会員は `members.rank_code`、非会員は `standard`。

### 3.5 テンプレートの持ち方

| 案 | 評価 |
|---|---|
| A. `pms.mail_templates` に「予約確認（自動）」を追加して `{{差込}}` 展開 | 不採用。(1) HTML が持てない（`body text`・改行のみ）(2) 差込語彙が「顧客名／チェックイン／泊数／人数」の 4〜5 語で、料金明細・規定表・リンクの**繰り返し構造**を表現できない (3) スタッフが誤って本文を書き換えると自動送信の全通に即反映され、取り返しがつかない (4) PMS 側の画面はそれを「返信用定型文」として一覧に出すため、用途違いの行が混ざる |
| B. **Edge Function 内の TypeScript テンプレート**（採用） | テキスト／HTML を同じデータから生成する純関数。`templates.test.ts` で「実データ（§0.3 のサンプル）を通した出力」を固定できる。運用者が変えたい値（電話・住所・チェックイン時刻・規定）は DB から差し込むので、文面の骨格以外にコード変更は要らない |
| C. `book.mail_templates` を新設して HTML＋テキスト＋差込 DSL を管理画面で編集 | 不採用。現時点で編集者は 1 名・種類は 2 通。管理画面と DSL を作るコストに見合わない。必要になったら B の関数を DB 文字列に置き換える（§10） |

**差出人名の統一**: `pms.mail_settings.from_name` は yamado が `山人-reservation-`、oga が `山人-oga-`。自動送信メールは受信者が「どこから来たか」を差出人名で判断するため、**EF 側で `from_name` を `core.facilities.name`（`山人-yamado-` / `山人-oga-`）で上書き**する（`mail_settings.from_name` は PMS 手動送信の既存挙動を変えないためそのまま）。

**Reply-To**: 付けない。差出人 `reservation@…` は PMS の受信箱取込（`fetch-mail-inbox`・`pms.mail_inbox`）の対象であり、返信はそのまま現場に届く。本文に「このメールにご返信いただけます」と書く。

### 3.6 メール内リンクの生成（独自ドメイン移行時に変わる箇所）

| 項目 | 決定 |
|---|---|
| ベース URL | EF の環境変数 **`BOOK_SITE_BASE_URL`**（例 `https://autumn-book.pages.dev`）。末尾スラッシュ無し。未設定なら EF は 500 を返し、cron は `last_error='BOOK_SITE_BASE_URL is not configured'` で `failed` にせず pending のまま（設定漏れで通数を消費しない） |
| キャンセルリンク | `${BOOK_SITE_BASE_URL}/booking/cancel?t=${cancel_token}` |
| 予約詳細リンク（会員のみ） | `${BOOK_SITE_BASE_URL}/account/reservations/${code}`（ログインが要るため非会員には出さない。アプリ会員には「アプリのマイページ」と書く） |
| 施設ページ | `${BOOK_SITE_BASE_URL}/yamado/${facility.slug}`（既存の `/[brand]/[facility]` ルート。brand slug は `book.v_facilities.brand_slug` を使う） |
| 独自ドメイン移行時にやること | 1) `supabase secrets set BOOK_SITE_BASE_URL=https://<新ドメイン>` 2) 何も再デプロイしない（EF は起動時に env を読む）3) **既に送ったメールのリンクは旧 URL のまま**なので、Cloudflare Pages の `pages.dev` から新ドメインへの 301（`_redirects` またはダッシュボード）を残す。トークンはドメインに依存しないため再発行不要 |
| SvelteKit 側 | `PUBLIC_SITE_URL` の追加は**不要**（リンクを作るのは EF だけ）。`/booking/cancel` は相対パスで完結 |

### 3.7 メール文面案（日本語・そのまま送れる完成度）

差込は `{…}`。金額は「¥69,300」形式（`toLocaleString('ja-JP')`）。日付は「2026年10月7日（水）」形式。文体は既存 `pms.mail_templates`「予約返信」（「賜りまして誠にありがとうございます」「確かに承りました」）に揃える。

#### 3.7.1 予約確認メール — 件名

```
【{施設名}】ご予約を承りました（予約番号 {予約番号}）
```

#### 3.7.2 予約確認メール — テキスト版

```
{氏名} 様

このたびは{施設名}にご宿泊のご予約を賜りまして、誠にありがとうございます。
下記のとおり、ご予約を確かに承りました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ご予約内容
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
予約番号　　：{予約番号}
ご宿泊施設　：{施設名}
チェックイン：{チェックイン日}　{チェックイン時刻}より
チェックアウト：{チェックアウト日}　{チェックアウト時刻}まで
ご宿泊数　　：{泊数}泊
お部屋　　　：{客室名}
プラン　　　：{プラン名}
ご人数　　　：大人{人数}名
{到着予定行}{送迎行}{ご要望行}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ご宿泊料金（税込）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{明細行: 10月7日（水）　¥34,650 × 2名 ＝ ¥69,300}
{クーポン行: クーポン割引　−¥2,000}
{ポイント行: ポイント利用　−600pt}
──────────────────────────────
当日お支払い額　　¥{現地でのお支払額}
──────────────────────────────
お支払いはご滞在当日、現地にて承ります（事前のお支払いはございません）。
{ポイント付与行: ※ご宿泊後に {付与pt}pt を付与いたします。}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ キャンセル規定
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{規定行: ・14日前から　　　ご宿泊料金の10%}
{規定行: ・10日前から　　　ご宿泊料金の30%}
{規定行: ・3日前から　　　ご宿泊料金の50%}
{規定行: ・当日　　　　　　ご宿泊料金の80%}
{規定行: ・ご連絡なく不泊　ご宿泊料金の100%}
（15日以上前のお取り消しはキャンセル料をいただいておりません）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ご予約の取り消し
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ご予定が変わりました際は、下記のページからお手続きいただけます。
ページを開くとご予約内容とキャンセル料が表示され、ボタンを押すだけでお取り消しが完了いたします。

　{キャンセルURL}

※このリンクは {氏名} 様専用です。他の方には転送なさらないようお願いいたします。
※ご宿泊当日以降はページからのお取り消しができません。お電話にてご連絡くださいませ。
{会員行: ※ご予約内容の確認・変更は、マイページ（またはアプリ）からも行えます。}

ご不明な点がございましたら、このメールにそのままご返信いただくか、
下記までお気軽にお問い合わせくださいませ。
当日はどうぞお気をつけてお越しください。
スタッフ一同、{氏名} 様のご到着を心よりお待ちしております。

──────────────────────────────
{施設名}
〒{郵便番号} {住所}
TEL {電話番号}
{メールアドレス}
{施設ページURL}
──────────────────────────────
このメールは、{施設名}の公式予約サイトでご予約いただいた方へ自動でお送りしています。
お心当たりのない場合は、お手数ですが上記までお知らせください。
```

差込の規則:
- `{到着予定行}` は `arrival` があるときだけ `到着予定　　：{時刻}ごろ` の 1 行。`{送迎行}` は `shuttle=true` のとき `送迎　　　　：ご希望あり（詳細は追ってご案内いたします）`。`{ご要望行}` は `notes` があるとき `ご要望　　　：{notes}`（改行はそのまま）。いずれも無ければ行ごと出さない。
- `{明細行}` は `price_lines` の日付ごと。連泊は複数行。
- `{クーポン行}` / `{ポイント行}` / `{ポイント付与行}` は値が 0 のとき出さない。
- `{規定行}` は `cancel_policy.rules` を `days_before` 降順に並べ、`days_before = 0` は「当日」、`-1` は「ご連絡なく不泊」、それ以外は「{n}日前から」。rules が 0 件（将来 standard が空に戻された場合）は見出しごと出さず「キャンセル料についてはお問い合わせください」の 1 行にする。
- `{会員行}` は `is_member=true` のときだけ。`client='app'` なら「アプリのマイページ」、`'web'` なら「マイページ（{予約詳細URL}）」。

#### 3.7.3 予約確認メール — HTML 版

テキスト版と**同じ情報を同じ順序**で。装飾はネイビー（`#1B2A4A`）の見出しとゴールド（`#C9A86A`）の罫線のみ。本文 16px・行間 1.7（中高年の可読性）。画像・外部 CSS・Web フォントは使わない（メーラーでブロックされる／表示が崩れる）。テーブルは `role="presentation"` の 1 カラム。

```html
<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>【{施設名}】ご予約を承りました</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Hiragino Mincho ProN','Yu Mincho',serif;color:#222;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e2da;">
  <tr><td style="padding:28px 32px 20px;border-bottom:2px solid #C9A86A;">
    <p style="margin:0;font-size:13px;letter-spacing:.2em;color:#8a8577;">YAMADO</p>
    <p style="margin:6px 0 0;font-size:22px;color:#1B2A4A;">{施設名}</p>
  </td></tr>
  <tr><td style="padding:28px 32px 8px;font-size:16px;line-height:1.7;">
    <p style="margin:0 0 16px;">{氏名} 様</p>
    <p style="margin:0 0 8px;">このたびは{施設名}にご宿泊のご予約を賜りまして、誠にありがとうございます。</p>
    <p style="margin:0;">下記のとおり、ご予約を確かに承りました。</p>
  </td></tr>

  <tr><td style="padding:16px 32px 0;">
    <p style="margin:0 0 8px;font-size:15px;color:#1B2A4A;border-left:4px solid #C9A86A;padding-left:10px;">ご予約内容</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;line-height:1.7;">
      <tr><td width="34%" style="padding:6px 0;color:#6b675c;vertical-align:top;">予約番号</td><td style="padding:6px 0;font-size:20px;font-weight:bold;letter-spacing:.06em;color:#1B2A4A;">{予約番号}</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">ご宿泊施設</td><td style="padding:6px 0;">{施設名}</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">チェックイン</td><td style="padding:6px 0;">{チェックイン日}　{チェックイン時刻}より</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">チェックアウト</td><td style="padding:6px 0;">{チェックアウト日}　{チェックアウト時刻}まで</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">ご宿泊数</td><td style="padding:6px 0;">{泊数}泊</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">お部屋</td><td style="padding:6px 0;">{客室名}</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">プラン</td><td style="padding:6px 0;">{プラン名}</td></tr>
      <tr><td style="padding:6px 0;color:#6b675c;">ご人数</td><td style="padding:6px 0;">大人{人数}名</td></tr>
      <!-- {到着予定行}{送迎行}{ご要望行}: 同じ tr 構造で条件出力 -->
    </table>
  </td></tr>

  <tr><td style="padding:20px 32px 0;">
    <p style="margin:0 0 8px;font-size:15px;color:#1B2A4A;border-left:4px solid #C9A86A;padding-left:10px;">ご宿泊料金（税込）</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;line-height:1.7;">
      <!-- {明細行}: <tr><td>10月7日（水）　¥34,650 × 2名</td><td align="right">¥69,300</td></tr> -->
      <!-- {クーポン行}{ポイント行}: 同構造・金額は「−¥2,000」 -->
      <tr><td colspan="2" style="border-top:1px solid #e5e2da;padding-top:8px;"></td></tr>
      <tr><td style="padding:4px 0;font-weight:bold;">当日お支払い額</td><td align="right" style="padding:4px 0;font-size:20px;font-weight:bold;color:#1B2A4A;">¥{現地でのお支払額}</td></tr>
    </table>
    <p style="margin:8px 0 0;font-size:14px;color:#6b675c;">お支払いはご滞在当日、現地にて承ります（事前のお支払いはございません）。</p>
    <!-- {ポイント付与行} -->
  </td></tr>

  <tr><td style="padding:20px 32px 0;">
    <p style="margin:0 0 8px;font-size:15px;color:#1B2A4A;border-left:4px solid #C9A86A;padding-left:10px;">キャンセル規定</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:16px;line-height:1.7;">
      <!-- {規定行}: <tr><td style="padding:2px 16px 2px 0;">14日前から</td><td>ご宿泊料金の10%</td></tr> -->
    </table>
    <p style="margin:6px 0 0;font-size:14px;color:#6b675c;">15日以上前のお取り消しはキャンセル料をいただいておりません。</p>
  </td></tr>

  <tr><td style="padding:24px 32px 0;">
    <p style="margin:0 0 8px;font-size:15px;color:#1B2A4A;border-left:4px solid #C9A86A;padding-left:10px;">ご予約の取り消し</p>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.7;">ご予定が変わりました際は、下記のボタンからお手続きいただけます。ページを開くとご予約内容とキャンセル料が表示され、ボタンを押すだけでお取り消しが完了いたします。</p>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#1B2A4A;border-radius:6px;">
      <a href="{キャンセルURL}" style="display:inline-block;padding:14px 28px;font-size:16px;color:#ffffff;text-decoration:none;">ご予約の取り消しページを開く</a>
    </td></tr></table>
    <p style="margin:12px 0 0;font-size:13px;color:#6b675c;word-break:break-all;">ボタンが押せない場合はこちらをブラウザに貼り付けてください：<br>{キャンセルURL}</p>
    <p style="margin:12px 0 0;font-size:14px;color:#6b675c;line-height:1.7;">※このリンクは {氏名} 様専用です。他の方には転送なさらないようお願いいたします。<br>※ご宿泊当日以降はページからのお取り消しができません。お電話にてご連絡くださいませ。</p>
    <!-- {会員行} -->
  </td></tr>

  <tr><td style="padding:28px 32px 8px;font-size:16px;line-height:1.7;">
    <p style="margin:0 0 8px;">ご不明な点がございましたら、このメールにそのままご返信いただくか、下記までお気軽にお問い合わせくださいませ。</p>
    <p style="margin:0;">当日はどうぞお気をつけてお越しください。<br>スタッフ一同、{氏名} 様のご到着を心よりお待ちしております。</p>
  </td></tr>

  <tr><td style="padding:20px 32px 28px;border-top:1px solid #e5e2da;font-size:14px;line-height:1.8;color:#444;">
    <p style="margin:0;font-size:16px;color:#1B2A4A;">{施設名}</p>
    <p style="margin:4px 0 0;">〒{郵便番号} {住所}<br>TEL <a href="tel:{電話番号(ハイフン無し)}" style="color:#1B2A4A;">{電話番号}</a><br><a href="mailto:{メールアドレス}" style="color:#1B2A4A;">{メールアドレス}</a><br><a href="{施設ページURL}" style="color:#1B2A4A;">{施設ページURL}</a></p>
    <p style="margin:14px 0 0;font-size:12px;color:#8a8577;">このメールは、{施設名}の公式予約サイトでご予約いただいた方へ自動でお送りしています。お心当たりのない場合は、お手数ですが上記までお知らせください。</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>
```

HTML 生成時の必須処理: **すべての差込値を HTML エスケープ**する（氏名・ご要望・客室名の `■◇` 等は文字参照不要だが、`<>&"` は必ず）。テキスト版はエスケープしない。

#### 3.7.4 キャンセル受付メール — 件名

```
【{施設名}】ご予約のお取り消しを承りました（予約番号 {予約番号}）
```

#### 3.7.5 キャンセル受付メール — テキスト版

```
{氏名} 様

{施設名}でございます。
下記のご予約のお取り消しを、確かに承りました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ お取り消しになったご予約
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
予約番号　　：{予約番号}
ご宿泊施設　：{施設名}
チェックイン：{チェックイン日}
ご宿泊数　　：{泊数}泊　／　お部屋：{客室名}
ご人数　　　：大人{人数}名
お取り消し日時：{取消日時（JST）}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ キャンセル料
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{料金なし: キャンセル料はいただいておりません。}
{料金あり: ご宿泊料金 ¥{総額} の {料率}% にあたる ¥{キャンセル料} を申し受けます。
お支払い方法につきましては、当館より別途ご連絡を差し上げます。}
{免除: 当館の都合によるお取り消しのため、キャンセル料はいただきません。ご迷惑をおかけし申し訳ございません。}
{ポイント行: ※ご利用いただいたポイント {pt}pt はお戻ししております。}
{クーポン行: ※ご利用のクーポンは再びお使いいただけます（有効期限内に限ります）。}

またの機会にご利用いただけますことを、心よりお待ち申し上げております。
ご不明な点がございましたら、このメールにそのままご返信いただくか、下記までお問い合わせくださいませ。

──────────────────────────────
{施設名}
〒{郵便番号} {住所}
TEL {電話番号}
{メールアドレス}
──────────────────────────────
```

- `{料率}` は `metadata.cancel_rank_benefit.rate × 100`（整数）。免除（`waived=true`）のときは料率・金額行を出さず `{免除}` 文だけ。
- 「当館の都合」の文言は `payload.reason_for_guest` が `'facility'` のときのみ。管理画面で免除にチェックしたときに自動で `'facility'` を入れる（§5.3）。理由テキスト（監査用）はメールに載せない。
- HTML 版は §3.7.3 と同じ骨格（見出し 2 つ・ボタン無し）。

#### 3.7.6 完了画面の文言修正（`messages/ja.json:244`）

現状「確認メールを {email} 宛にお送りしました。」→ **「確認メールを {email} 宛にお送りします。数分以内に届かない場合は、迷惑メールフォルダをご確認ください。」**。en / zh-TW も同趣旨に直す（`complete_email_sent` キーは維持）。加えて完了画面の非会員向け枠に 1 行: `ご予約の取り消しは、確認メールに記載のリンクから行えます。`（新キー `complete_cancel_hint`）。

---

## 4. 非会員向けキャンセル（トークン ＋ フォーム）

### 4.1 トークン設計

#### 4.1.1 前提となる脅威

- 予約番号は `YB-{年}-{6 桁連番}`（`confirm_booking:139-140`）。`YB-2026-001001` の次は `001002`。URL に予約番号だけを載せると**総当たりで他人の予約を閲覧・取消**できる。
- メールは転送される（家族・旅行会社）。共有 PC の履歴に URL が残る。メーラーのリンク先読み（Outlook Safe Links・Gmail のプレビュー）が URL を GET する。

#### 4.1.2 方式の比較

| 案 | 仕組み | 評価 |
|---|---|---|
| A. 予約番号 ＋ メールアドレス（または電話下 4 桁）入力 | URL に予約番号、フォームで本人確認 | 不採用。予約番号は連番で、メールアドレスは `core.guest_identities` の名寄せキー＝**漏れやすい既知情報の組合せ**。総当たりに対する耐性が低く、ユーザー要望「パラメータ入り URL でボタンを押すだけ」にも反する |
| B. 署名付き URL（HMAC、状態を持たない） | `code + expires` を秘密鍵で署名し URL に付与 | 不採用。失効（使用済み・スタッフによる無効化）ができない。鍵の置き場所が DB か EF かで検証側が割れる。鍵ローテーションで全リンクが死ぬ |
| C. **ランダムトークン・DB にハッシュ保存**（採用） | 32 バイト乱数を base64url 化して URL へ。DB は SHA-256 のみ | 推測不能（256 bit）。失効・使用済み・再発行を行単位で管理できる。DB 読み出しが漏れても raw が無いため即悪用できない。実装は `extensions.gen_random_bytes` / `extensions.digest`（pgcrypto・Supabase 既定で有効）だけ |

#### 4.1.3 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| 生成 | `encode(extensions.gen_random_bytes(32), 'base64')` を base64url（`+/` → `-_`、`=` 除去）に変換。43 文字 | URL セーフ・十分なエントロピー。`search_path=''` なので `extensions.` 修飾必須 |
| 保存 | `book.booking_access_tokens.token_hash = encode(extensions.digest(raw, 'sha256'), 'hex')`。raw は保存しない | DB ダンプ・スタッフ閲覧から raw を守る。照合はハッシュの等価比較（`unique` インデックス） |
| raw の一時置き場 | `book.mail_outbox.payload.cancel_token`。**送信成功時に EF が `payload - 'cancel_token'` で削除** | raw が必要なのはメール本文を作る瞬間だけ。ただし `body_text` にリンクとして残る（§3.3・§7.4） |
| 1 予約 1 トークンか都度発行か | **1 予約 1 有効トークン**。再送メールにも同じリンクを載せる。管理画面の「リンクを再発行」だけが旧トークンを失効させ新トークンで再送する | 客が 2 通のメールを持ったとき「古い方が使えない」混乱を避ける。漏洩が疑われるときはスタッフが明示的に切り替える |
| 有効期限 | `expires_at = (check_in_date + 1) 00:00 JST`（＝チェックイン日の 23:59 まで） | 当日以降の取消は不泊扱い（100%）で、自己申告で処理させるより電話で状況を聞く運用が適切。変更（`amend_booking`）で日程が動いた場合は `_amend` 側で `expires_at` を更新する（§10 に注記。v1 は変更時に管理画面から再発行） |
| 失効条件 | (1) `used_at` が入る（取消実行）(2) `revoked_at` が入る（再発行・スタッフ操作）(3) `expires_at < now()` (4) 予約が `reserved` でなくなる（トークン自体は残るが RPC が `not_cancellable` を返す） | |
| 閲覧の記録 | `last_seen_at` と `view_count` を `guest_booking_by_token` が更新 | 管理画面で「リンクが開かれた」が分かる。漏洩時の兆候（取消前に何十回も開かれている等）にもなる |
| 漏洩時の被害範囲 | 予約 1 件の**閲覧（氏名・日程・施設・料金・電話とメールは下 4 桁マスク）と取消**。他の予約・個人情報・会員情報には到達しない。取消すると本人に受付メールが届くため、不正取消は即座に本人が気づける | 予約番号連番方式なら「全予約」だったものが「1 件」に縮む |
| 用途 | `purpose = 'guest_cancel'` 固定。将来「予約内容の確認だけ」「変更」に広げるときは purpose を増やす | |

```sql
create table book.booking_access_tokens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references core.tenants(id),
  booking_id    uuid not null references booking.bookings(id) on delete cascade,
  purpose       text not null check (purpose in ('guest_cancel')),
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_by    uuid,                -- 再発行時の actor（自動発行は null）
  last_seen_at  timestamptz,
  view_count    integer not null default 0,
  created_at    timestamptz not null default now()
);
create index booking_access_tokens_booking_idx on book.booking_access_tokens (booking_id, created_at desc);
alter table book.booking_access_tokens enable row level security;
-- authenticated へは何も grant しない（照会は RPC だけ。スタッフ向けにも hash を見せない）
grant all on book.booking_access_tokens to service_role;
```

### 4.2 RPC（anon から呼べる 2 本 ＋ 核の切り出し）

| RPC | 実行者 | 役割 |
|---|---|---|
| `book.guest_booking_by_token(p_token text) → jsonb` | anon / authenticated | トークン照合 → 予約サマリ・キャンセル料プレビュー・取消可否と理由を返す。`view_count` を更新。**副作用はこれだけ**（GET で叩かれても予約は変わらない） |
| `book.guest_cancel_booking(p_token text) → jsonb` | anon / authenticated | トークン照合 → `_cancel_booking_core(..., p_by := 'guest_token')` → `used_at` 記録 → 結果返却 |
| `book._cancel_booking_core(p_booking_code, p_waive_fee, p_reason, p_by, p_actor) → jsonb` | 内部（`revoke from public, anon, authenticated`） | 現行 `cancel_booking` 本体（`20260711083740:164-244`）から**権限判定を除いた**部分。末尾でキャンセルメールを outbox に積む。`p_by` は `'member' \| 'staff' \| 'guest_token' \| 'admin'` で `metadata.cancelled_by` に記録 |
| `book.cancel_booking(...)`（既存・本体差し替え） | authenticated | 権限判定（staff / owner・`reason_required`）だけ残し、核を呼ぶ。**シグネチャ不変** |

**`guest_booking_by_token` の戻り**

```jsonc
{
  "ok": true,
  "booking": { "code": "YB-2026-001001", "facility_name": "山人-yamado-", "facility_slug": "yamado",
               "check_in_date": "2026-10-07", "check_out_date": "2026-10-08", "nights": 1, "adult_count": 2,
               "room_name": "…", "plan_name": "…", "total_amount": 69300,
               "guest_name": "テスト予約 削除可", "phone_masked": "***-****-2222", "email_masked": "bo***@yamado.co.jp",
               "status": "reserved", "is_member": false },
  "fee": { "rate": 0.1, "fee": 6930, "rules_source": "rank", "rank_code": "standard", "as_of": "2026-09-23",
           "rules": [ … ] },
  "cancellable": true,
  "reason": null            // 不可のとき: 'token_expired' | 'token_used' | 'token_revoked' | 'already_cancelled' | 'checked_in' | 'checked_out' | 'past_checkin' | 'not_found'
}
```

- トークン不一致・不在は `{ "ok": false, "reason": "not_found" }`。**存在の有無で応答時間や文言を変えない**（列挙対策）。
- `past_checkin`: `current_date > check_in_date`（JST）かつ reserved。`checked_in` / `checked_out`: `core.stays.status`。`already_cancelled`: `cancelled / no_show`。
- `fee` は `book._cancel_fee(snapshot, total, check_in, current_date(JST), rank)`。非会員は `standard`、会員（`metadata.member_user_id` あり）はその会員の現在ランク（`compute_cancel_fee` と同式）。

**`guest_cancel_booking` の判定順序**

1. トークン照合（不在 → `not_found`）
2. `revoked_at` / `used_at` / `expires_at` → それぞれ `token_revoked` / `token_used` / `token_expired`
3. `_cancel_booking_core` が `not_cancellable` を返したら、`guest_booking_by_token` と同じ理由コードに変換して返す（`already_cancelled` 等）
4. 成功: `used_at = now()`、戻り `{ ok: true, booking_code, cancellation_fee, rate, waived: false }`

同時実行: `_cancel_booking_core` が `core.stays` を `for update` で取るため、二重クリック・別タブ同時押下は片方が `not_cancellable`（`already_cancelled`）になる。ページは両方とも「取り消し済み」表示に収束させる（§4.4）。

### 4.3 `cancellation_policy = []` のときの扱い

- 実データは全プランが `[]`（ADMIN_APP_OPS §0.3）。DB `_cancel_fee` は `[]` → `rank_cancel_policies`（非会員は standard）に落ちる。standard には標準料率が入っている（§0.3）。
- したがって **「`[]` ＝ 無料」ではない**。画面・メールは必ず DB の `fee` と `rules` を表示し、`rules_source` が `rank` なら「当館の基本キャンセル規定」、`plan` なら「このプランのキャンセル規定」と見出しを変える。
- `rank_cancel_policies.standard.rules` が空に戻された場合だけ「キャンセル料はかかりません」になる。これは運用上の設定であり、コードで防がない（管理画面 `/admin/cancel-policies` の責務）。
- autumn-book 側の `store.computeCancelFee`（デモ）・`CancelPolicyNote`（プラン表示用）は本機能では使わない。`normalizeCancellationPolicy` の rules 0 件表示に引きずられて「無料」と出す実装をしないこと。

### 4.4 画面仕様 — `/booking/cancel`（公開・anon）

| 項目 | 決定 |
|---|---|
| ルート | `apps/web/src/routes/(public)/booking/cancel/+page.server.ts` / `+page.svelte`。共通ヘッダー（`/booking/*` と同じ `(public)` レイアウト）。`+page.server.ts` で `DATA_SOURCE !== 'supabase'` のときは「この環境では利用できません」（demo 実装は作らない・ADMIN_APP_OPS §6.1 と同じ理由） |
| 入口 | `GET /booking/cancel?t=<token>`。load で `guest_booking_by_token` を anon `supa()` で呼ぶ。トークンは**フォームの hidden**で action に渡し、URL には残さない設計にする（詳細下記） |
| 副作用 | GET は `view_count` 更新のみ。取消は `POST ?/cancel`（`use:enhance`）。メーラーの先読みで取消が走らない |
| ヘッダ | `<meta name="robots" content="noindex,nofollow">`・`<meta name="referrer" content="no-referrer">`（施設ページ等へのリンクにトークン入り URL が Referer で漏れない）。`+page.server.ts` から `Cache-Control: no-store` |
| 履歴対策 | load 成功時に `history.replaceState` で `?t=` を落とし `/booking/cancel`（トークン無し）に書き換える。トークンは `data.token` としてページ状態にだけ保持し、リロードすると「リンクをもう一度開いてください」表示になる。共有 PC の履歴・スクリーンショットに URL が残るのを最小化する。**ただし replaceState の前に SSR 済みの内容が描画されるため、初回表示までの URL 露出は避けられない**（受容・§7） |
| 二段確認 | 主ボタン「この予約を取り消す」→ 同一ページ内に確認パネル（キャンセル料を再掲・「取り消しは元に戻せません」）→ 「取り消しを確定する」。ブラウザ `confirm()` は使わない（スマホで文言が読みにくい・中高年配慮） |

#### ワイヤーフレーム — 取消可能

```
┌──────────────────────────────────────────────────────────────┐
│ ご予約の取り消し                                    山人-yamado-  │
├──────────────────────────────────────────────────────────────┤
│ テスト予約 削除可 様                                             │
│ 下記のご予約を取り消すことができます。内容をご確認ください。          │
│                                                              │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 予約番号        YB-2026-001001                          │   │
│ │ ご宿泊施設      山人-yamado-                             │   │
│ │ チェックイン    2026年10月7日（水）                        │   │
│ │ チェックアウト  2026年10月8日（木）・1泊                   │   │
│ │ お部屋          ［離れ］ジャパニーズスイート…雪椿           │   │
│ │ プラン          シンプルステイプラン                      │   │
│ │ ご人数          大人2名                                  │   │
│ │ ご宿泊料金      ¥69,300（税込・現地払い）                  │   │
│ │ ご連絡先        ***-****-2222 ／ bo***@yamado.co.jp       │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ キャンセル料（本日 2026年9月23日 時点）                           │
│ ┌────────────────────────────────────────────────────────┐   │
│ │  ¥6,930                                                │   │ ← 24px・navy・太字
│ │  ご宿泊料金の 10%（チェックイン 14日前）                   │   │
│ │  ▸ 当館の基本キャンセル規定を見る                          │   │ ← details/summary で規定表を開閉
│ └────────────────────────────────────────────────────────┘   │
│ ※キャンセル料のお支払い方法は、当館より別途ご連絡いたします。       │
│                                                              │
│ ┃      この予約を取り消す      ┃                               │ ← bg-brand-800・高さ 52
│                                                              │
│ 取り消さない場合は、このページを閉じてください。                    │
│ ご不明な点は 0197-82-2222 までお電話ください。                     │
└──────────────────────────────────────────────────────────────┘

（主ボタン押下後・同じ位置に差し替え）
│ ┌── 本当に取り消しますか？ ──────────────────────────────┐   │ bg-amber-50 border-amber-200
│ │ 取り消しは元に戻せません。                                │   │
│ │ キャンセル料 ¥6,930 を申し受けます。                        │   │ （¥0 のとき「キャンセル料はかかりません。」）
│ │ 取り消し後、確認のメールを bo***@yamado.co.jp 宛にお送りします。│   │
│ │   [ 戻る ]            [ 取り消しを確定する ]               │   │ 確定＝bg-red-600・送信中は disabled「お手続き中…」
│ └────────────────────────────────────────────────────────┘   │
```

#### ワイヤーフレーム — 完了

```
│ ✔ ご予約を取り消しました                                        │
│ 予約番号 YB-2026-001001 のお取り消しを承りました。                  │
│ キャンセル料 ¥6,930 ／ お支払い方法は当館より別途ご連絡いたします。   │ （¥0 なら「キャンセル料はかかりません。」）
│ 受付のメールを bo***@yamado.co.jp 宛にお送りしました。              │
│ またのご利用を心よりお待ちしております。                            │
│ [ 山人-yamado- のページへ ]                                       │
```

#### 実行できないケースの表示（`reason` 別）

| reason | 見出し | 本文 | 導線 |
|---|---|---|---|
| `not_found` | このリンクは無効です | お手数ですが、確認メールに記載のリンクをもう一度お開きください。リンクを正しく開いても表示される場合は、お電話にてご連絡ください。 | 施設電話（両施設・`facility` が分からないため 2 件並記） |
| `token_expired` | お取り消しの受付期間を過ぎています | ご宿泊当日以降のお取り消しは、お電話にて承ります。 | 施設電話 |
| `token_used` / `already_cancelled` | このご予約は取り消し済みです | 予約番号 {code} は既にお取り消しを承っております。 | 施設ページ |
| `token_revoked` | このリンクは使えなくなりました | 新しいリンクをメールでお送りしている場合があります。届いていない場合はお電話にてご連絡ください。 | 施設電話 |
| `checked_in` / `checked_out` | このご予約はご滞在済みです | ご宿泊ありがとうございました。 | 施設ページ |
| `past_checkin` | お取り消しの受付期間を過ぎています | （`token_expired` と同文） | 施設電話 |
| RPC 例外（ネットワーク等） | 手続きを完了できませんでした | しばらく時間をおいて、もう一度お試しください。繰り返し表示される場合はお電話にてご連絡ください。 | 施設電話。**確定ボタンを再度押せる**（取消が実際に成立していれば次は `already_cancelled` → 完了相当の表示） |
| 環境が demo | この画面は本番専用です | — | — |

`token_used` と `already_cancelled` を同じ見出しにするのは、客にとって差が無いため。管理画面では区別して見せる（§5.3）。

#### 文言（`messages/ja.json` に追加するキー）

```json
"gcancel_title": "ご予約の取り消し ｜ {facility}",
"gcancel_heading": "ご予約の取り消し",
"gcancel_intro": "{name} 様\n下記のご予約を取り消すことができます。内容をご確認ください。",
"gcancel_fee_heading": "キャンセル料（本日 {date} 時点）",
"gcancel_fee_line": "ご宿泊料金の {rate}%（チェックイン {days}日前）",
"gcancel_fee_today": "ご宿泊料金の {rate}%（チェックイン当日）",
"gcancel_fee_none": "キャンセル料はかかりません",
"gcancel_rules_rank": "当館の基本キャンセル規定を見る",
"gcancel_rules_plan": "このプランのキャンセル規定を見る",
"gcancel_fee_note": "キャンセル料のお支払い方法は、当館より別途ご連絡いたします。",
"gcancel_btn": "この予約を取り消す",
"gcancel_confirm_heading": "本当に取り消しますか？",
"gcancel_confirm_irreversible": "取り消しは元に戻せません。",
"gcancel_confirm_fee": "キャンセル料 {fee} を申し受けます。",
"gcancel_confirm_mail": "取り消し後、確認のメールを {email} 宛にお送りします。",
"gcancel_back": "戻る",
"gcancel_submit": "取り消しを確定する",
"gcancel_submitting": "お手続き中…",
"gcancel_keep": "取り消さない場合は、このページを閉じてください。",
"gcancel_phone": "ご不明な点は {phone} までお電話ください。",
"gcancel_done_heading": "ご予約を取り消しました",
"gcancel_done_body": "予約番号 {code} のお取り消しを承りました。",
"gcancel_done_fee": "キャンセル料 {fee} ／ お支払い方法は当館より別途ご連絡いたします。",
"gcancel_done_mail": "受付のメールを {email} 宛にお送りしました。",
"gcancel_done_thanks": "またのご利用を心よりお待ちしております。",
"gcancel_to_facility": "{facility} のページへ",
"gcancel_err_not_found_h": "このリンクは無効です",
"gcancel_err_not_found": "お手数ですが、確認メールに記載のリンクをもう一度お開きください。リンクを正しく開いても表示される場合は、お電話にてご連絡ください。",
"gcancel_err_expired_h": "お取り消しの受付期間を過ぎています",
"gcancel_err_expired": "ご宿泊当日以降のお取り消しは、お電話にて承ります。",
"gcancel_err_used_h": "このご予約は取り消し済みです",
"gcancel_err_used": "予約番号 {code} は既にお取り消しを承っております。",
"gcancel_err_revoked_h": "このリンクは使えなくなりました",
"gcancel_err_revoked": "新しいリンクをメールでお送りしている場合があります。届いていない場合はお電話にてご連絡ください。",
"gcancel_err_stayed_h": "このご予約はご滞在済みです",
"gcancel_err_stayed": "ご宿泊ありがとうございました。",
"gcancel_err_generic_h": "手続きを完了できませんでした",
"gcancel_err_generic": "しばらく時間をおいて、もう一度お試しください。繰り返し表示される場合はお電話にてご連絡ください。",
"gcancel_reload_h": "リンクをもう一度お開きください",
"gcancel_reload": "安全のため、このページはメールのリンクからのみ開けます。"
```

en / zh-TW は ja からの機械翻訳を仮置きしてよい（サイトの多言語対応はコンテンツ翻訳層が別途ある。メール本文は日本語固定）。

### 4.5 濫用対策（レート制限）

- `guest_booking_by_token` / `guest_cancel_booking` は 43 文字の乱数照合なので総当たりは現実的でないが、**無駄な DB 負荷とログ汚染**を避けるため、SvelteKit 側で `claim-rate-limit.ts` の仕組みを流用し、同一 IP で **10 回/分** を超える照会を 429（「しばらく時間をおいてお試しください」）にする。実装は既存モジュールの API に合わせる（実装者が `claim-rate-limit.ts` を読んで判断。KV バインドが必要なら `wrangler.jsonc` の `AB_CONFIG` を流用）。
- RPC 側にも `pg_sleep` 等の遅延は入れない（サーバ資源を攻撃者に消費させない）。

---

## 5. 管理画面の予約管理を実データ化する

### 5.1 方針

- **既存 2 画面（一覧・詳細）を `ADMIN_SUPABASE ? RPC : store` の二本立て**にする（`/admin/members` と同じ・ADMIN_APP_OPS §6.4）。新規ルートは作らない。
- 表示の主語は `core.stays`（OTA も含む）。操作（取消・再送・リンク再発行）は **`booking.bookings` 行がある直販予約だけ**。
- staff は閲覧のみ（連絡先マスク・操作ボタン非表示・action は `fail(403)`）。DB 側も `admin_cancel_booking` / `admin_resend_booking_mail` / `admin_rotate_cancel_token` は `_require_admin`。

### 5.2 一覧 `/admin/reservations`

#### ワイヤーフレーム

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 予約管理 — 山人-yamado-                                                            │
│ 予約サイト・アプリからのご予約の確認と取り消しはここで行います。部屋割り・チェックインは PMS。 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ メール送信  待機 0 ／ 失敗（24h） 0   最終送信 9/07 16:12   ●正常                    │ ← 直販フィルタ時のみ表示
├──────────────────────────────────────────────────────────────────────────────────┤
│ [ステータス: すべて ▾] [経路: 直販（サイト・アプリ）▾] [チェックイン: 2026-09-07 〜 2026-12-31] │
│ [検索: 予約番号・氏名・カナ・メール          ] [絞り込む]                              │
├──────────┬────────────┬──────────┬────┬──────────────┬────────┬──────┬────────┬──────┤
│ 予約番号  │ ゲスト      │ チェックイン│ 泊 │ 部屋          │ 金額    │ 経路  │ メール  │ 状態  │
├──────────┼────────────┼──────────┼────┼──────────────┼────────┼──────┼────────┼──────┤
│ YB-2026- │ テスト予約  │ 10/07(水) │ 1  │ ［離れ］…雪椿 │ ¥69,300│ サイト│ ✔ 送信済│ 予約済│
│ 001001   │ 削除可      │           │    │              │        │ 非会員│        │      │
│ YB-2026- │ 山田 太郎   │ 10/12(月) │ 2  │ …            │ ¥138,600│アプリ│ ⚠ 失敗 │ 予約済│
│ 001002   │ 会員        │           │    │              │        │ 会員  │        │      │
│ （経路: すべて のとき）                                                                │
│ 一休 12345│ 佐藤 花子   │ 10/09(金) │ 1  │ …            │ —      │ 一休  │ —      │ 予約済│
├──────────┴────────────┴──────────┴────┴──────────────┴────────┴──────┴────────┴──────┤
│ 該当 2 件（直販）／ 表示は 200 件まで。それ以上は期間を絞ってください。                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

| 列 | 取得元 |
|---|---|
| 予約番号 | 直販: `bookings.metadata->>'booking_code'`。OTA 等: `stays.reservation_code`（無ければ `stay_id` 先頭 8 桁） |
| ゲスト | `core.guests.name` ＋ 2 行目に「会員／非会員」（`metadata->>'member_user_id'` の有無）。OTA は名前のみ |
| 経路 | 直販: `metadata.guest->>'client'` が `'app'` なら「アプリ」、それ以外「サイト」。OTA 等: `booking.channels.name`（`stays.channel_code` → `channels.code`）または `stays.source` |
| メール | `mail_outbox` の当該 booking・`kind='booking_confirmation'` の最新行: `sent` ✔／`pending·processing` ⏳／`failed` ⚠。OTA は「—」 |
| 状態 | `stays.status` を「予約済（reserved）／チェックイン済／宿泊済（checked_out）／キャンセル／不泊」で表示 |
| 金額 | 直販は `bookings.total_amount`。OTA は「—」（`bookings` 行が無い） |

フィルタの既定: 経路「直販」・ステータス「すべて」・チェックイン「今日 〜 今日＋120 日」。経路「すべて」のときは同じ日付窓で `core.stays` 全 source（最大 200 件・`limit` 超過時は注記）。

**RPC**: `book.admin_list_bookings(p_facility_id uuid, p_status text, p_source text, p_q text, p_checkin_from date, p_checkin_to date, p_member_user_id uuid, p_limit int, p_offset int)`（§6.2）。`p_source` は `'autumn_booking'`（既定）または `null`（すべて）。`p_member_user_id` は会員詳細の予約履歴用（§5.5）。

### 5.3 詳細 `/admin/reservations/[code]`

#### ワイヤーフレーム（直販・admin）

```
┌ 予約管理 / YB-2026-001001 ──────────────────────────────────────────────────────────┐
│ YB-2026-001001                                                      [予約済]         │
│ 施設 山人-yamado-  ／ 経路 サイト（非会員） ／ 受付 2026-09-07 16:12                    │
│ チェックイン 2026年10月7日（水）15:00〜 ・1泊 ／ お部屋 …雪椿 ／ プラン シンプルステイ    │
│ ゲスト テスト予約 削除可（テストヨヤク）大人2名 ／ 連絡先 0197822222 booking-test@…      │
│ 到着予定 — ／ 送迎 なし ／ 連絡事項 自動テスト・確認後キャンセルします                    │
│ 金額 ¥69,300（クーポン −¥0・ポイント利用 0pt・付与予定 0pt）／ 現地払い                  │
│ キャンセル規定 基本規定（standard）：14日前10% / 10日前30% / 3日前50% / 当日80% / 不泊100%│
│ 本日時点のキャンセル料 ¥6,930（10%）                                                    │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ メール                                                                               │
│  9/07 16:14  予約確認   送信済（宛先 booking-test@yamado.co.jp）        [送信内容を見る] │
│  9/07 16:12  予約確認   失敗 5回（SMTP: 535 Authentication failed）     [送信内容を見る] │
│                                                            [予約確認メールを再送する]    │
│ 取り消しリンク                                                                        │
│  有効（10/07 23:59 まで）・最終閲覧 9/20 10:31・閲覧 3 回          [リンクを無効化して再発行] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ 変更履歴（amend_booking）  なし                                                        │
│ 監査ログ  9/07 16:20 hikaru.s resend_booking_mail                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
右カラム（操作・admin かつ reserved かつ直販のときのみ）
│ ┌ 操作 ───────────────────────────────┐
│ │ [キャンセル処理]                       │
│ │  → □ 施設都合（キャンセル料を免除する）  │
│ │    適用キャンセル料: ¥6,930             │
│ │    理由（必須・監査ログ）[            ]  │
│ │    ⓘ お客様へキャンセル受付メールを     │
│ │      自動送信します（理由は載りません） │
│ │    [実行] [戻る]                       │
│ └───────────────────────────────────┘
│ ⓘ 部屋割り・チェックイン操作は PMS で行います。
```

| 操作 | action | RPC | 監査 action | メール |
|---|---|---|---|---|
| キャンセル | `?/cancel` | `book.admin_cancel_booking(p_booking_code, p_waive_fee, p_reason)` | `cancel_booking`（核が記帳。`by='admin'`） | 核が `booking_cancelled` を積む。`waive=true` なら `payload.reason_for_guest='facility'` |
| 予約確認メール再送 | `?/resend` | `book.admin_resend_booking_mail(p_booking_code, p_kind := 'booking_confirmation')` | `resend_booking_mail` | 新しい outbox 行（`dedupe_key='resend:'||uuid`）。有効トークンがあればそれを payload に載せる（**raw が無い**ため… §下記） |
| リンク再発行 | `?/rotateToken` | `book.admin_rotate_cancel_token(p_booking_code)` | `rotate_cancel_token` | 旧トークン `revoked_at`、新トークン発行、`booking_confirmation` を再送（新リンク入り） |
| 送信内容を見る | GET `/admin/reservations/[code]?mail=<outbox_id>` | `mail_outbox` を authenticated select（staff policy） | — | `subject` / `body_text` をモーダル表示 |

**再送とトークンの関係（重要）**: 送信済みトークンの raw は DB に無い（ハッシュのみ）。したがって「再送」は次のどちらかになる。

| 案 | 評価 |
|---|---|
| A. 再送＝常に新トークンを発行し旧を失効 | 客の手元の古いメールのリンクが死ぬ。「届かなかったから再送」の場面では古いメールは存在しないので実害は無いが、「届いたが念のため再送」では混乱する |
| B. **再送は `payload.cancel_token` が残っている間（未送信・失敗中）だけ同じ raw を使い、送信済みなら新トークンで再発行して送る**（採用） | 失敗（`failed`）からの再送は同じリンク。成功後の再送は必然的に再発行になる → UI では「送信済みのメールを再送すると、取り消しリンクは新しいものに切り替わります（古いリンクは無効になります）」と明示する |

つまり `admin_resend_booking_mail` は内部で「未送信の raw が残っていればそれ、無ければ `_rotate` して新 raw」と分岐する。ボタンは 1 つ（「予約確認メールを再送する」）で、送信済みのときだけ確認パネルに上記注記を出す。「リンクを無効化して再発行」は漏洩疑い時の明示操作として別ボタンに残す。

**staff 表示**: 連絡先マスク（既存 `+page.server.ts:12` と同じ）。「送信内容を見る」は本文にメールアドレスとリンクが含まれるため **admin のみ**。

**OTA 予約の詳細**: 同じルートで `stays` の内容だけ表示し、操作カラムは「OTA 経由のご予約は OTA 側で取り消してください（PMS へ自動反映）」の注記。

### 5.4 メール送信状況の可視化

| 場所 | 内容 | RPC |
|---|---|---|
| `/admin/reservations` ヘッダ帯 | 待機（pending＋processing）／失敗（24h）／最終送信／滞留判定（pending の最古が 10 分超なら赤「滞留」） | `book.admin_mail_queue_status()`（`admin_notification_queue_status` と同形） |
| `/admin/reservations/[code]` | 当該予約の outbox 行一覧 | `mail_outbox` を `booking_id` で select（staff policy） |
| `/admin/app` のアラート | `failed` が 1 件以上 → error「予約メールの送信に失敗した予約が n 件あります → 予約管理」 | `admin_app_dashboard` の jsonb に `mail: {failed_24h, pending}` を足す（既存 RPC の `CREATE OR REPLACE`・ADMIN_APP_OPS §4.4 のしきい値表に 1 行追加） |

失敗の原因は `last_error` に SMTP 応答（例 `535 Authentication failed`・`RCPT TO: 550 …`）をそのまま入れる。宛先不正（550/553）は `max_attempts` を待たず**即 failed**（再送しても同じ）。

### 5.5 `/admin/members/[id]` の予約履歴

- `admin_list_bookings(p_member_user_id := <id>, p_source := 'autumn_booking', p_checkin_from := null, p_checkin_to := null, p_limit := 50)` で会員の直販予約を新しい順に。列は 予約番号／施設／チェックイン／泊数／金額／状態。行クリックで `/admin/reservations/[code]`。
- 既存コメント（`members/[id]/+page.server.ts:3-4`「会員軸で他人の予約を引く管理 RPC が未整備」）を削除し、`admin-app-data.ts` に `adminListBookings()` を足す。
- 会員の `guest_id` 経由で OTA 予約（`core.stays.guest_id` 一致）も引けるが、v1 は直販のみ（名寄せ精度の検証が別途必要・§10）。

### 5.6 `mapRpcError` への追記

| RPC 例外文字列 | 表示文言 |
|---|---|
| `not_cancellable` | `この予約は取り消せない状態です（既に取消済み・チェックイン済み等）。PMS の状態を確認してください。` |
| `reason_required` | `キャンセル理由を入力してください（監査ログに記録されます）。` |
| `not_direct_booking` | `OTA・電話経由の予約は管理画面から取り消せません。` |
| `mail_not_found` | `再送対象のメールが見つかりません。` |
| `token_not_found` | `この予約には取り消しリンクがありません（先に再発行してください）。` |

---

## 6. 追加が必要な DB オブジェクト（autumn-shared に作る）

### 6.1 migration ファイル

1 本にまとめる（作成は必ずヘルパー経由・実 UTC 秒。**本リポジトリ（yamado-one / autumn-book）には作らない**）:

```bash
bash ~/.claude/new-migration.sh autumn-shared book_booking_mail_and_guest_cancel
# → autumn-shared/supabase/migrations/<UTC秒>_book_booking_mail_and_guest_cancel.sql
```

適用: autumn-shared `main` への push で自動適用（GitHub 連携・yamado-one HANDOFF 2026-07-02）。手動なら `supabase db push --linked`。適用後 `supabase migration list --linked` で version を確認。

**置換前の必須確認**（M6 の教訓・yamado-one HANDOFF）: `confirm_booking` / `cancel_booking` は `CREATE OR REPLACE` で本体を差し替えるため、事前に PROD の実シグネチャを確認する。

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'book' and p.proname in ('confirm_booking', 'cancel_booking');
-- 期待: confirm_booking(p_hold_id uuid, p_session_id text, p_guest jsonb, p_points_used integer, p_locale text, p_member_coupon_id uuid)
--       cancel_booking(p_booking_code text, p_waive_fee boolean, p_reason text)        ← 2026-09-07 実測と一致
```

### 6.2 一覧

| 種別 | 名前 | 用途 | ガード |
|---|---|---|---|
| table | `book.mail_outbox` | メール outbox（§3.3） | RLS: staff select（`has_facility_access`）・service_role all |
| table | `book.booking_access_tokens` | キャンセル用トークン（§4.1） | RLS: service_role のみ（authenticated に grant 無し） |
| fn | `book._issue_booking_token(p_booking_id, p_purpose, p_checkin, p_tenant) → text` | raw トークン生成・hash 保存・raw を返す | 内部専用 |
| fn | `book._token_lookup(p_token) → book.booking_access_tokens` | hash 照合（見つからなければ null） | 内部専用 |
| fn | `book._enqueue_booking_mail(p_booking_id, p_kind, p_payload, p_dedupe, p_requested_by) → uuid` | outbox insert（宛先・施設は booking から引く） | 内部専用 |
| fn | `book._cancel_booking_core(p_booking_code, p_waive_fee, p_reason, p_by, p_actor) → jsonb` | キャンセルの核（§4.2） | 内部専用 |
| rpc（差替） | `book.confirm_booking(…6 引数)` | 末尾でトークン発行 ＋ outbox insert | 既存どおり anon/authenticated |
| rpc（差替） | `book.cancel_booking(text, boolean, text)` | 権限判定 → 核 | 既存どおり authenticated |
| rpc | `book.guest_booking_by_token(p_token text) → jsonb` | 非会員の予約閲覧＋料金プレビュー | anon, authenticated |
| rpc | `book.guest_cancel_booking(p_token text) → jsonb` | 非会員の取消 | anon, authenticated |
| rpc | `book.claim_pending_mail(p_limit int) → setof book.mail_outbox` | drainer の claim（processing 回収込み） | service_role |
| rpc | `book.mail_render_context(p_outbox_id uuid) → jsonb` | 差込データ一式（§3.4） | service_role |
| rpc | `book.mark_mail_result(p_outbox_id uuid, p_ok boolean, p_error text, p_subject text, p_body_text text, p_permanent boolean) → void` | 送信結果の反映（成功時 `payload - 'cancel_token'`・失敗時 backoff） | service_role |
| rpc | `book.admin_list_bookings(…)` | 一覧・検索・会員履歴（§5.2） | `_require_staff` |
| rpc | `book.admin_booking_detail(p_booking_code text) → jsonb` | 詳細（連絡先は admin のみ非マスク・outbox 行・トークン状態・監査 tail） | `_require_staff` |
| rpc | `book.admin_cancel_booking(p_booking_code, p_waive_fee, p_reason) → jsonb` | 管理者の取消（核へ・`by='admin'`） | `_require_admin` |
| rpc | `book.admin_resend_booking_mail(p_booking_code, p_kind) → uuid` | 再送（§5.3 の分岐） | `_require_admin` |
| rpc | `book.admin_rotate_cancel_token(p_booking_code) → uuid` | 失効＋再発行＋再送 | `_require_admin` |
| rpc | `book.admin_mail_queue_status() → jsonb` | キュー状態 | `_require_staff` |
| rpc（差替） | `book.admin_app_dashboard()` | `mail` 集計を追加 | 既存 |
| cron | `book_mail_outbox_drain`（`*/2 * * * *`） | EF 呼び出し（Vault ガード） | — |
| cron | `book_mail_outbox_purge`（`30 18 * * 0` ＝ 日曜 JST 03:30） | チェックアウト後 90 日の `body_text` を NULL に | — |

すべて `language plpgsql security definer set search_path = ''`、`revoke execute … from public, anon; grant execute … to authenticated, service_role;` の既存規約。内部関数は authenticated からも revoke。`book._admin_tenant()` / `_require_admin` / `_require_staff` は `20260907061853` で定義済み。

### 6.3 SQL 骨子

```sql
-- =============================================================================
-- book: 予約確認メール outbox ／ 非会員キャンセルトークン ／ 予約管理 admin RPC
-- 設計書: autumn-book/docs/BOOKING_CANCEL_MAIL.md §6
-- =============================================================================

-- ---- 1. テーブル -------------------------------------------------------------
create table book.mail_outbox ( … §3.3 のとおり … );
alter table book.mail_outbox enable row level security;
grant select on book.mail_outbox to authenticated;
create policy mail_outbox_staff_select on book.mail_outbox
  for select to authenticated using (private.has_facility_access(tenant_id, facility_id));
grant all on book.mail_outbox to service_role;

create table book.booking_access_tokens ( … §4.1.3 のとおり … );

-- ---- 2. 内部ヘルパー ----------------------------------------------------------
create or replace function book._issue_booking_token(
  p_booking_id uuid, p_purpose text, p_checkin date, p_tenant uuid, p_actor uuid default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_raw text; v_hash text;
begin
  -- 既存の有効トークンは失効（1 予約 1 有効トークン）
  update book.booking_access_tokens set revoked_at = now()
   where booking_id = p_booking_id and purpose = p_purpose and revoked_at is null and used_at is null;
  v_raw := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  v_raw := rtrim(v_raw, '=');                                             -- base64url・43 文字
  v_hash := encode(extensions.digest(v_raw, 'sha256'), 'hex');
  insert into book.booking_access_tokens (tenant_id, booking_id, purpose, token_hash, expires_at, created_by)
  values (p_tenant, p_booking_id, p_purpose, v_hash,
          ((p_checkin + 1)::timestamp at time zone 'Asia/Tokyo'),        -- チェックイン日 23:59 JST まで
          p_actor);
  return v_raw;
end $$;
revoke execute on function book._issue_booking_token(uuid, text, date, uuid, uuid) from public, anon, authenticated;

create or replace function book._token_lookup(p_token text) returns book.booking_access_tokens
language sql stable security definer set search_path = '' as $$
  select t.* from book.booking_access_tokens t
  where p_token is not null and length(p_token) between 40 and 64
    and t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  limit 1
$$;
revoke execute on function book._token_lookup(text) from public, anon, authenticated;

create or replace function book._enqueue_booking_mail(
  p_booking_id uuid, p_kind text, p_payload jsonb default '{}'::jsonb,
  p_dedupe text default null, p_requested_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_b booking.bookings; v_id uuid; v_to text;
begin
  select * into v_b from booking.bookings where id = p_booking_id;
  if not found then raise exception 'not_found'; end if;
  v_to := lower(coalesce(v_b.metadata->'guest'->>'email', ''));
  if v_to = '' then raise exception 'mail_no_recipient'; end if;
  insert into book.mail_outbox (tenant_id, facility_id, booking_id, kind, to_email, locale, dedupe_key, payload, requested_by)
  values (v_b.tenant_id, v_b.facility_id, v_b.id, p_kind, v_to, coalesce(v_b.metadata->>'locale', 'ja'),
          coalesce(p_dedupe, p_kind || ':' || v_b.id), coalesce(p_payload, '{}'::jsonb), p_requested_by)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;   -- 既に積まれていれば null
end $$;
revoke execute on function book._enqueue_booking_mail(uuid, text, jsonb, text, uuid) from public, anon, authenticated;

-- ---- 3. confirm_booking 差し替え（20260711051616 の本体を丸ごとコピーし、次の 2 箇所を足す）----
--   declare に:  v_cancel_token text;
--   `update book.holds set status = 'converted'` の直前に §3.2 のブロック（_issue_booking_token → mail_outbox insert）
--   ※ p_guest->>'client' は 'web' | 'app'。未指定は 'web'。metadata.guest にそのまま残る。

-- ---- 4. キャンセルの核（20260711083740:164-244 から権限判定を除いた本体）------------------
create or replace function book._cancel_booking_core(
  p_booking_code text, p_waive_fee boolean, p_reason text, p_by text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_stay core.stays; v_booking booking.bookings;
  v_fee integer := 0; v_use integer; v_earn integer;
  v_mc_id uuid; v_mc book.member_coupons; v_coupon book.coupons;
  v_rank text; v_feejson jsonb := null; v_mail_payload jsonb;
begin
  select s.* into v_stay from core.stays s where s.reservation_code = p_booking_code for update;
  if not found then raise exception 'not_found'; end if;
  select b.* into v_booking from booking.bookings b where b.stay_id = v_stay.id for update;
  if not found then raise exception 'not_direct_booking'; end if;         -- OTA・電話予約には bookings 行が無い
  if v_booking.status = 'cancelled' or v_stay.status <> 'reserved' then
    raise exception 'not_cancellable';
  end if;

  if not p_waive_fee then
    select rank_code into v_rank from book.members where user_id = (v_booking.metadata->>'member_user_id')::uuid;
    v_feejson := book._cancel_fee(v_booking.cancellation_policy_snapshot, v_booking.total_amount,
                                  v_stay.check_in_date, (now() at time zone 'Asia/Tokyo')::date,
                                  coalesce(v_rank, 'standard'));
    v_fee := (v_feejson->>'fee')::integer;
  end if;

  update booking.bookings
     set status = 'cancelled', cancelled_at = now(), cancellation_fee = v_fee,
         metadata = metadata
                    || jsonb_build_object('cancelled_by', p_by, 'cancel_waived', p_waive_fee)
                    || case when v_feejson is not null then jsonb_build_object('cancel_rank_benefit', v_feejson) else '{}'::jsonb end,
         updated_at = now()
   where id = v_booking.id;
  update core.stays set status = 'cancelled', updated_at = now() where id = v_stay.id;   -- → PMS の部屋解放トリガー

  -- 在庫戻し／ポイント巻き戻し／クーポン復帰は 20260711083740:198-234 と同一（省略）

  -- 取消リンクを使用済みに（どの入口から取り消しても、以後リンクは使えない）
  update book.booking_access_tokens set used_at = coalesce(used_at, now())
   where booking_id = v_booking.id and purpose = 'guest_cancel' and revoked_at is null;

  -- キャンセル受付メール（施設都合免除のときだけ客向け理由コードを渡す。理由テキストは載せない）
  v_mail_payload := jsonb_build_object('waived', p_waive_fee, 'by', p_by,
                      'reason_for_guest', case when p_waive_fee then 'facility' else null end);
  perform book._enqueue_booking_mail(v_booking.id, 'booking_cancelled', v_mail_payload,
                                     'booking_cancelled:' || v_booking.id, p_actor);

  if p_by in ('staff', 'admin') then
    insert into book.admin_audit_logs (tenant_id, facility_id, actor, action, detail)
    values (v_stay.tenant_id, v_stay.facility_id, p_actor, 'cancel_booking',
            jsonb_build_object('booking_code', p_booking_code, 'fee', v_fee, 'waived', p_waive_fee,
                               'reason', p_reason, 'by', p_by, 'rank_benefit', v_feejson));
  end if;

  return jsonb_build_object('booking_code', p_booking_code, 'cancellation_fee', v_fee,
                            'rate', coalesce((v_feejson->>'rate')::numeric, 0), 'waived', p_waive_fee,
                            'rank_benefit', v_feejson);
end $$;
revoke execute on function book._cancel_booking_core(text, boolean, text, text, uuid) from public, anon, authenticated;

-- ---- 5. cancel_booking 差し替え（権限判定だけ残す・シグネチャ不変）---------------------------
create or replace function book.cancel_booking(p_booking_code text, p_waive_fee boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stay core.stays; v_is_staff boolean; v_is_owner boolean;
begin
  select s.* into v_stay from core.stays s where s.reservation_code = p_booking_code;
  if not found then raise exception 'not_found'; end if;
  v_is_staff := auth.uid() is not null and private.has_facility_access(v_stay.tenant_id, v_stay.facility_id);
  v_is_owner := auth.uid() is not null and exists (
    select 1 from book.members m where m.user_id = auth.uid() and m.guest_id = v_stay.guest_id);
  if not (v_is_staff or v_is_owner) then raise exception 'forbidden'; end if;
  if p_waive_fee and not v_is_staff then raise exception 'forbidden'; end if;
  if v_is_staff and not v_is_owner and coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  return book._cancel_booking_core(p_booking_code, p_waive_fee, p_reason,
                                   case when v_is_owner then 'member' else 'staff' end, auth.uid());
end $$;
revoke execute on function book.cancel_booking(text, boolean, text) from public, anon;
grant execute on function book.cancel_booking(text, boolean, text) to authenticated, service_role;

-- ---- 6. 非会員トークン RPC -----------------------------------------------------------
create or replace function book.guest_booking_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t book.booking_access_tokens; v_b booking.bookings; v_s core.stays; v_g core.guests;
        v_f core.facilities; v_fc record; v_rank text; v_fee jsonb; v_rules jsonb; v_reason text; v_today date;
begin
  v_t := book._token_lookup(p_token);
  if v_t.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update book.booking_access_tokens set last_seen_at = now(), view_count = view_count + 1 where id = v_t.id;

  select * into v_b from booking.bookings where id = v_t.booking_id;
  select * into v_s from core.stays where id = v_b.stay_id;
  select * into v_g from core.guests where id = v_s.guest_id;
  select * into v_f from core.facilities where id = v_s.facility_id;
  select slug, name, checkin_time, checkout_time into v_fc from book.v_facilities where facility_id = v_s.facility_id;
  v_today := (now() at time zone 'Asia/Tokyo')::date;

  v_reason := case
    when v_t.revoked_at is not null then 'token_revoked'
    when v_t.used_at is not null or v_b.status = 'cancelled' or v_s.status in ('cancelled','no_show') then 'already_cancelled'
    when v_s.status = 'checked_in'  then 'checked_in'
    when v_s.status = 'checked_out' then 'checked_out'
    when v_t.expires_at < now() or v_today > v_s.check_in_date then 'token_expired'
    else null end;

  select rank_code into v_rank from book.members where user_id = (v_b.metadata->>'member_user_id')::uuid;
  v_fee := book._cancel_fee(v_b.cancellation_policy_snapshot, v_b.total_amount, v_s.check_in_date, v_today, coalesce(v_rank,'standard'));
  -- 表示用 rules（_cancel_fee と同じ引き方）
  v_rules := coalesce(v_b.cancellation_policy_snapshot->'rules',
              case when jsonb_typeof(v_b.cancellation_policy_snapshot) = 'array' then v_b.cancellation_policy_snapshot else '[]'::jsonb end);
  if jsonb_array_length(v_rules) = 0 then
    select rules into v_rules from book.rank_cancel_policies where rank_code = coalesce(v_rank, 'standard');
  end if;

  return jsonb_build_object(
    'ok', true, 'cancellable', v_reason is null, 'reason', v_reason,
    'booking', jsonb_build_object(
      'code', v_b.metadata->>'booking_code', 'facility_name', v_f.name, 'facility_slug', v_f.slug, 'facility_phone', v_f.phone,
      'check_in_date', v_s.check_in_date, 'check_out_date', v_s.check_out_date,
      'nights', v_s.check_out_date - v_s.check_in_date, 'adult_count', v_s.adult_count,
      'room_name', (select name from pms.room_types where id = v_s.room_type_id),
      'plan_name', (select name from booking.rate_plans where id = v_b.rate_plan_id),
      'total_amount', v_b.total_amount, 'guest_name', v_g.name,
      'phone_masked', book._mask_phone(v_g.phone), 'email_masked', book._mask_email(lower(v_b.metadata->'guest'->>'email')),
      'status', v_s.status, 'is_member', (v_b.metadata->>'member_user_id') is not null),
    'fee', v_fee || jsonb_build_object('as_of', v_today, 'rules', coalesce(v_rules, '[]'::jsonb)));
end $$;
grant execute on function book.guest_booking_by_token(text) to anon, authenticated, service_role;

create or replace function book.guest_cancel_booking(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t book.booking_access_tokens; v_b booking.bookings; v_r jsonb;
begin
  v_t := book._token_lookup(p_token);
  if v_t.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_t.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'token_revoked'); end if;
  if v_t.used_at is not null   then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;
  if v_t.expires_at < now()    then return jsonb_build_object('ok', false, 'reason', 'token_expired'); end if;
  select * into v_b from booking.bookings where id = v_t.booking_id;
  begin
    v_r := book._cancel_booking_core(v_b.metadata->>'booking_code', false, null, 'guest_token', null);
  exception when others then
    if sqlerrm like '%not_cancellable%' then
      -- 状態に応じた理由コードへ（guest_booking_by_token と同じ判定を再利用）
      return jsonb_build_object('ok', false, 'reason', coalesce(book.guest_booking_by_token(p_token)->>'reason', 'already_cancelled'));
    end if;
    raise;
  end;
  return jsonb_build_object('ok', true) || v_r;
end $$;
grant execute on function book.guest_cancel_booking(text) to anon, authenticated, service_role;

-- _mask_phone: 末尾 4 桁以外を * に。_mask_email: ローカル部先頭 2 文字＋***＋@ドメイン。いずれも immutable な小関数。

-- ---- 7. drainer 用（service_role）------------------------------------------------------
create or replace function book.claim_pending_mail(p_limit integer default 50) returns setof book.mail_outbox
language plpgsql security definer set search_path = '' as $$
begin
  update book.mail_outbox set status = 'pending', claimed_at = null
   where status = 'processing' and claimed_at < now() - interval '10 minutes';   -- スタック回収
  return query
  with picked as (
    select id from book.mail_outbox
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at limit p_limit for update skip locked)
  update book.mail_outbox m set status = 'processing', claimed_at = now(), attempts = m.attempts + 1
  from picked where m.id = picked.id returning m.*;
end $$;
revoke execute on function book.claim_pending_mail(integer) from public, anon, authenticated;
grant execute on function book.claim_pending_mail(integer) to service_role;

create or replace function book.mark_mail_result(
  p_outbox_id uuid, p_ok boolean, p_error text, p_subject text, p_body_text text, p_permanent boolean default false
) returns void language plpgsql security definer set search_path = '' as $$
declare v_m book.mail_outbox;
begin
  select * into v_m from book.mail_outbox where id = p_outbox_id for update;
  if p_ok then
    update book.mail_outbox set status = 'sent', sent_at = now(), subject = p_subject, body_text = p_body_text,
           last_error = null, payload = payload - 'cancel_token' where id = p_outbox_id;
  elsif p_permanent or v_m.attempts >= v_m.max_attempts then
    update book.mail_outbox set status = 'failed', last_error = p_error where id = p_outbox_id;
  else
    update book.mail_outbox set status = 'pending', last_error = p_error, claimed_at = null,
           scheduled_at = now() + case v_m.attempts when 1 then interval '2 minutes' when 2 then interval '10 minutes'
                                                    when 3 then interval '30 minutes' else interval '2 hours' end
     where id = p_outbox_id;
  end if;
end $$;
revoke execute on function book.mark_mail_result(uuid, boolean, text, text, text, boolean) from public, anon, authenticated;
grant execute on function book.mark_mail_result(uuid, boolean, text, text, text, boolean) to service_role;

-- mail_render_context(p_outbox_id): §3.4 の jsonb を組む（bookings / stays / guests / facilities / v_facilities /
--   rate_plans / room_types / rank_cancel_policies / members を結合）。service_role 専用。本文は EF が作る。

-- ---- 8. 管理 RPC（20260907061853 の規約に揃える）-----------------------------------------
create or replace function book.admin_list_bookings(
  p_facility_id uuid, p_status text default null, p_source text default 'autumn_booking', p_q text default null,
  p_checkin_from date default null, p_checkin_to date default null, p_member_user_id uuid default null,
  p_limit integer default 200, p_offset integer default 0
) returns table (
  stay_id uuid, booking_id uuid, booking_code text, facility_id uuid, source text, channel_name text, client text,
  guest_name text, guest_kana text, is_member boolean, member_user_id uuid,
  check_in_date date, check_out_date date, nights integer, adult_count integer, room_name text, plan_name text,
  total_amount integer, stay_status text, booking_status text, cancellation_fee integer,
  mail_status text, mail_sent_at timestamptz, created_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_staff(v_tenant);
  return query
  select s.id, b.id, coalesce(b.metadata->>'booking_code', s.reservation_code),
         s.facility_id, s.source, ch.name,
         case when b.id is null then null else coalesce(b.metadata->'guest'->>'client', 'web') end,
         g.name, g.name_kana, (b.metadata->>'member_user_id') is not null, (b.metadata->>'member_user_id')::uuid,
         s.check_in_date, s.check_out_date, s.check_out_date - s.check_in_date, s.adult_count,
         rt.name, rp.name, b.total_amount, s.status, b.status, b.cancellation_fee,
         mo.status, mo.sent_at, s.created_at
  from core.stays s
  left join booking.bookings b on b.stay_id = s.id
  left join core.guests g on g.id = s.guest_id
  left join booking.channels ch on ch.code = s.channel_code and ch.tenant_id = s.tenant_id
  left join pms.room_types rt on rt.id = s.room_type_id
  left join booking.rate_plans rp on rp.id = b.rate_plan_id
  left join lateral (select status, sent_at from book.mail_outbox
                      where booking_id = b.id and kind = 'booking_confirmation'
                      order by created_at desc limit 1) mo on true
  where s.tenant_id = v_tenant
    and (p_facility_id is null or s.facility_id = p_facility_id)
    and (p_source is null or s.source = p_source)
    and (p_status is null or s.status = p_status)
    and (p_checkin_from is null or s.check_in_date >= p_checkin_from)
    and (p_checkin_to is null or s.check_in_date <= p_checkin_to)
    and (p_member_user_id is null or (b.metadata->>'member_user_id')::uuid = p_member_user_id)
    and (p_q is null or p_q = '' or g.name ilike '%'||p_q||'%' or g.name_kana ilike '%'||p_q||'%'
         or coalesce(b.metadata->>'booking_code', s.reservation_code) ilike '%'||p_q||'%'
         or (private.is_tenant_admin(v_tenant) and lower(b.metadata->'guest'->>'email') like '%'||lower(p_q)||'%'))
  order by s.check_in_date, s.created_at
  limit least(coalesce(p_limit, 200), 500) offset coalesce(p_offset, 0);
end $$;

-- admin_booking_detail: 上記 1 件 ＋ guest 連絡先（admin のみ非マスク）＋ price_snapshot ＋ coupon ＋ points ＋
--   cancel_policy（rules/source）＋ 本日時点の fee ＋ mail_outbox 行（id/kind/status/attempts/last_error/sent_at/to_email、
--   subject/body_text は admin のみ）＋ token（expires_at/used_at/revoked_at/last_seen_at/view_count。hash は返さない）＋
--   booking_amendments 件数 ＋ admin_audit_logs（booking_code 一致・直近 10 件）。

create or replace function book.admin_cancel_booking(p_booking_code text, p_waive_fee boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant();
begin
  perform book._require_admin(v_tenant);
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  return book._cancel_booking_core(p_booking_code, p_waive_fee, p_reason, 'admin', auth.uid());
end $$;

create or replace function book.admin_resend_booking_mail(p_booking_code text, p_kind text default 'booking_confirmation')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_b booking.bookings; v_s core.stays; v_raw text; v_id uuid;
begin
  perform book._require_admin(v_tenant);
  select s.* into v_s from core.stays s where s.reservation_code = p_booking_code;
  select b.* into v_b from booking.bookings b where b.stay_id = v_s.id;
  if v_b.id is null then raise exception 'not_direct_booking'; end if;
  if p_kind = 'booking_confirmation' then
    -- 未送信（pending/processing/failed）の行に raw が残っていればそれを使い、無ければ再発行（§5.3 案 B）
    select payload->>'cancel_token' into v_raw from book.mail_outbox
     where booking_id = v_b.id and payload ? 'cancel_token' order by created_at desc limit 1;
    if v_raw is null and v_s.status = 'reserved' then
      v_raw := book._issue_booking_token(v_b.id, 'guest_cancel', v_s.check_in_date, v_tenant, auth.uid());
    end if;
  end if;
  v_id := book._enqueue_booking_mail(v_b.id, p_kind,
            jsonb_build_object('cancel_token', v_raw, 'client', coalesce(v_b.metadata->'guest'->>'client','web'), 'resend', true),
            'resend:' || gen_random_uuid(), auth.uid());
  insert into book.admin_audit_logs (tenant_id, facility_id, actor, action, detail)
  values (v_tenant, v_s.facility_id, auth.uid(), 'resend_booking_mail',
          jsonb_build_object('booking_code', p_booking_code, 'kind', p_kind, 'outbox_id', v_id, 'token_rotated', v_raw is not null));
  return v_id;
end $$;

-- admin_rotate_cancel_token: _require_admin → _issue_booking_token（旧を失効）→ _enqueue_booking_mail(confirmation, resend:uuid)
--   → audit 'rotate_cancel_token'。reserved でなければ not_cancellable。
-- admin_mail_queue_status: {pending, processing, failed_24h, last_sent_at, oldest_pending_at, stuck: oldest_pending < now()-10min}

-- ---- 9. cron ------------------------------------------------------------------------
select cron.unschedule('book_mail_outbox_drain') where exists (select 1 from cron.job where jobname = 'book_mail_outbox_drain');
select cron.schedule('book_mail_outbox_drain', '*/2 * * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'book_send_booking_mail_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', (select decrypted_secret from vault.decrypted_secrets where name = 'book_send_booking_mail_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000)
  where exists (select 1 from vault.decrypted_secrets where name = 'book_send_booking_mail_url')
    and exists (select 1 from book.mail_outbox where status = 'pending' and scheduled_at <= now());  -- 空のときは EF を起こさない
$cron$);

select cron.unschedule('book_mail_outbox_purge') where exists (select 1 from cron.job where jobname = 'book_mail_outbox_purge');
select cron.schedule('book_mail_outbox_purge', '30 18 * * 0', $cron$
  update book.mail_outbox m set body_text = null
  from booking.bookings b join core.stays s on s.id = b.stay_id
  where m.booking_id = b.id and m.body_text is not null and s.check_out_date < current_date - 90;
$cron$);
```

`timeout_milliseconds` は 30 秒（SMTP は 1 通 1〜3 秒・50 通 claim の上限に合わせる。`send-push` の 10 秒より長い）。

**Vault 手動投入（migration 外・PROD で一度だけ）**:

```sql
select vault.create_secret('https://opkocyapzmsjzhbwlguh.supabase.co/functions/v1/send-booking-mail', 'book_send_booking_mail_url');
select vault.create_secret('<BOOK_SEND_BOOKING_MAIL_SECRET と同値>', 'book_send_booking_mail_secret');
```

---

## 7. セキュリティ考察

### 7.1 トークン

| 観点 | 対策 |
|---|---|
| 推測 | 256 bit 乱数。予約番号・メール・日付から導出しない |
| DB 漏洩 | hash のみ保存。raw は outbox `payload` に送信までの数分だけ存在し、送信後に削除 |
| URL 露出（履歴・Referer・スクショ） | `no-referrer`・`noindex`・`no-store`・`replaceState` で `?t=` を落とす（§4.4）。初回描画までの露出は残る（受容） |
| メーラーの先読み | GET は閲覧のみ。取消は POST。先読みで `view_count` が増えるのは許容（管理画面の「閲覧 n 回」は参考値と注記） |
| 転送・共有 | 本文に「専用リンク・転送しないで」を明記。取消時に本人へ受付メールが届き、不正取消は即発覚。被害は 1 予約の取消に限定 |
| 有効期限 | チェックイン日 23:59 JST。以降は電話対応 |
| 失効 | 取消実行・再発行・（将来）変更時に更新 |
| 列挙 | 不在も無効も同じ `not_found` 応答・同じ画面。RPC は `limit 1` の等価比較 1 回で応答時間が一定 |
| レート | SvelteKit 側 10 回/分/IP（§4.5） |

### 7.2 RPC の権限

- `guest_*` 2 本だけが anon 実行可。どちらもトークン照合を最初に行い、失敗時は予約の存在を示す情報を一切返さない。
- `_cancel_booking_core` / `_issue_booking_token` / `_enqueue_booking_mail` は authenticated からも `revoke`。管理画面・会員・アプリはすべて公開 RPC 経由。
- `admin_cancel_booking` は `_require_admin`（`core.memberships.tenant_admin`）。既存 `cancel_booking` の staff 経路（`has_facility_access`）は会員アプリ・マイページとの互換のため残すが、**autumn-book の管理画面は `admin_cancel_booking` だけを呼ぶ**（staff ロールの偽造 cookie で取消できない）。
- `has_facility_access(tenant, facility)` が `facility_id IS NULL` の `tenant_admin` 行を通すかは実装時に確認（`20260603000100_cross_facility_rls_access.sql`）。通さなければ `_cancel_booking_core` 経由の `admin_cancel_booking` は影響を受けないが、`compute_cancel_fee` のスタッフ判定に影響するため、詳細画面の fee プレビューは `admin_booking_detail` 内で `_cancel_fee` を直接呼ぶ設計にしてある。

### 7.3 メール

- 差込値の HTML エスケープ必須（§3.7.3）。ゲストの `notes`（自由入力）が HTML 版に入る。
- SMTP は施設別・パスワードは `pms.mail_settings` を service_role でのみ読む（既存 `send-mail` と同じ）。
- 宛先は `confirm_booking` が書式検証した `metadata.guest.email` のみ。管理画面から宛先を変えて送る機能は作らない（誤送信・なりすまし防止。宛先を直したいときは予約を取り直す）。
- 送信失敗の `last_error` に SMTP 応答を保存する。宛先メールアドレスは `to_email` 列にあるため、`last_error` に重複して書かない。

### 7.4 スタッフに見えるもの

| データ | staff | admin |
|---|---|---|
| 予約一覧・詳細（氏名・日程・金額） | ✅ | ✅ |
| 電話・メール | マスク | ✅ |
| `mail_outbox.subject / body_text`（リンク入り） | ❌（RPC が返さない） | ✅ |
| トークン hash | ❌ | ❌（誰にも見せない） |
| 取消・再送・再発行 | ❌ | ✅ |

`mail_outbox_staff_select` policy は行単位で staff にも select を許すが、SvelteKit は `admin_booking_detail` 経由でしか読まないため列は RPC で絞る。将来 Studio で staff が直接読む懸念があれば `grant select (id, kind, status, …)` の列 grant に切り替える。

### 7.5 GET に副作用を持たせない

`/booking/cancel?t=` の load は `guest_booking_by_token` だけを呼ぶ。`view_count` 更新は副作用だが予約状態には触れない。取消は必ず `POST ?/cancel` ＋ `use:enhance`。SvelteKit の form action は同一オリジンの POST のみ受けるため CSRF は既定で防がれる（`csrf.checkOrigin` 既定 true を切らないこと）。

---

## 8. 実装順序（各ステップで動く状態になる）

| Step | 内容 | 動く状態 | 版 |
|---|---|---|---|
| 0 | autumn-shared に §6 の migration（テーブル・内部関数・`confirm_booking` / `cancel_booking` 差替・guest RPC・drainer RPC・admin RPC・cron 2 本）→ main push → `supabase migration list --linked` で確認。Studio で `select book.guest_booking_by_token('x')` が `{ok:false, reason:'not_found'}` を返すこと、`YB-2026-001001` に対し `select book.admin_resend_booking_mail('YB-2026-001001')` が outbox 行を作ること（EF 未デプロイなので pending のまま）を確認 | DB 側完成。Vault 未投入のため cron は no-op | autumn-shared |
| 1 | `functions/_shared/{smtp,mime,auth}.ts` へ既存コードを移し、`send-mail` を import 差替（`mime.test.ts` グリーン）。`send-booking-mail/index.ts` ＋ `templates.ts`（**テキスト版のみ**）＋ `templates.test.ts`（§0.3 サンプルのスナップショット）。`supabase secrets set BOOK_SEND_BOOKING_MAIL_SECRET=… BOOK_SITE_BASE_URL=https://autumn-book.pages.dev` → `deploy --no-verify-jwt` → Vault 投入 → Step 0 で積んだ pending 行が 2 分以内に `sent` になり **`booking-test@yamado.co.jp` に確認メールが届く** | 予約確認メール（テキスト）が本番で送れる | — |
| 2 | `templates.ts` に HTML 版を追加し `multipart/alternative` で送る。Gmail（PC・スマホ）・iPhone 標準メール・Outlook で表示確認 | HTML＋テキストの確認メール | — |
| 3 | autumn-book: `/booking/cancel` ページ（load・action・文言・レート制限）。Step 1 のメールのリンクから `YB-2026-001001` を実際に取り消す（本番テスト予約の後始末を兼ねる）→ キャンセル受付メール到着を確認 | 非会員が自分で取消できる | v0.37.0 |
| 4 | autumn-book: `/admin/reservations` 一覧・詳細を `ADMIN_SUPABASE` で実データ化（`admin-app-data.ts` に `adminListBookings / adminBookingDetail / adminCancelBooking / adminResendBookingMail / adminRotateCancelToken / adminMailQueueStatus`、`mapRpcError` 追記）。`/admin/app` の mail アラート | 管理画面で実予約が見え、取消・再送・再発行ができる | v0.38.0 |
| 5 | `/admin/members/[id]` 予約履歴タブ／完了画面の文言修正（`complete_email_sent`・`complete_cancel_hint`）／yamado-one `booking.ts` の `confirm_booking` 呼び出しで `p_guest.client = 'app'` を渡す（アプリ側は 1 行） | 導線が閉じる | v0.38.1 ／ yamado-one v0.12.1 |
| 6 | `HANDOFF.md`（autumn-book）に §9 を転記、`package.json` version を HANDOFF と揃える、コミット `feat: 予約確認メール自動送信・非会員キャンセル・予約管理の実データ化 (v0.38.1)` | リリース可能 | — |

各ステップで `pnpm --filter @autumn-book/web check` をグリーンに保つ。**Step 1 が終わった時点で必ず実メールを 1 通受信して文字化け・差出人名・リンクを確認**してから Step 2 以降に進む（`send-mail` の denomailer 文字化けの前例）。

### 8.1 触るファイル一覧

```
autumn-shared/supabase/migrations/<UTC秒>_book_booking_mail_and_guest_cancel.sql   新規（§6）
autumn-shared/supabase/functions/_shared/{smtp.ts,mime.ts,auth.ts}                 新規（send-mail から移動・send-push の timingSafeEqualStr）
autumn-shared/supabase/functions/send-mail/{index.ts,mime.ts,mime.test.ts}         import 差替のみ
autumn-shared/supabase/functions/send-booking-mail/{index.ts,templates.ts,templates.test.ts}  新規
autumn-book/apps/web/src/routes/(public)/booking/cancel/{+page.server.ts,+page.svelte}        新規
autumn-book/apps/web/src/routes/(public)/booking/complete/[code]/+page.svelte      文言追加（complete_cancel_hint）
autumn-book/apps/web/messages/{ja,en,zh-TW}.json                                   gcancel_* / complete_* 追加・修正
autumn-book/apps/web/src/lib/server/supabase-data.ts                               guestBookingByToken / guestCancelBooking（anon）
autumn-book/apps/web/src/lib/server/admin-app-data.ts                              admin* 6 関数・型・mapRpcError 追記
autumn-book/apps/web/src/routes/admin/reservations/{+page.server.ts,+page.svelte}  二本立て化・メール列・キュー帯
autumn-book/apps/web/src/routes/admin/reservations/[code]/{+page.server.ts,+page.svelte}  二本立て化・メール／リンク／取消
autumn-book/apps/web/src/routes/admin/members/[id]/{+page.server.ts,+page.svelte}  予約履歴タブ
autumn-book/apps/web/src/routes/admin/app/+page.server.ts                          mail アラート
autumn-book/HANDOFF.md, apps/web/package.json                                      チェックリスト・版
yamado-one/src/lib/api/booking.ts                                                  p_guest.client = 'app'
```

---

## 9. 手動テストチェックリスト（autumn-book `HANDOFF.md` へ転記する）

```markdown
### 予約確認メール・非会員キャンセル・予約管理（設計書 docs/BOOKING_CANCEL_MAIL.md）

※前提: 本番（DATA_SOURCE=supabase / AUTH_MODE=supabase）。テスト予約は必ず **@yamado.co.jp 宛**で作り、テスト後に管理画面から取り消す。
※実会員・実予約が入ったあとは、全件系の操作（purge cron の手動実行等）を行わない。

#### 予約確認メール
- [ ] サイトで非会員として予約 → 完了画面に「確認メールを … 宛にお送りします」と取り消しリンクの案内が出る
- [ ] 2 分以内に予約確認メールが届く。差出人名が施設名（山人-yamado- / 山人-oga-）、From が reservation@… である
- [ ] 件名・本文が文字化けしない（Gmail PC／Gmail iPhone／iPhone 標準メール／Outlook）
- [ ] HTML 版とテキスト版の内容が同じ（テキストのみ表示にしても情報が欠けない）
- [ ] 予約番号・施設・チェックイン日時（15:00〜）・チェックアウト・泊数・部屋・プラン・人数・料金明細・当日お支払い額・キャンセル規定（14/10/3/当日/不泊）・施設連絡先が正しい
- [ ] 到着予定／送迎希望／ご要望を入れた予約では該当行が出て、入れない予約では行が出ない
- [ ] 会員（ポイント利用・クーポン利用）の予約でクーポン行／ポイント行／付与予定行が出る
- [ ] アプリからの予約でも同じメールが届き、本文の「マイページ」文言が「アプリのマイページ」になる（client='app' 送出後）
- [ ] 男鹿の予約は男鹿の SMTP（reservation@oga.yamado.co.jp）・男鹿の住所電話で届く
- [ ] 同じ予約で確認メールが 2 通届かない（dedupe_key）
- [ ] pms.mail_settings の is_active を一時 false にして予約 → outbox が failed にならず pending（設定エラーは last_error に出て 5 回で failed）→ 戻すと次回 drain で送られる（ユーザー立会いのみ）
- [ ] /admin/reservations のメール送信帯が「待機 0／失敗 0／正常」を示し、失敗を作ると赤帯になる

#### 非会員キャンセル（/booking/cancel）
- [ ] メールのボタンから開くと予約内容（電話・メールはマスク）と本日時点のキャンセル料・料率が表示される
- [ ] 表示直後にアドレスバーから ?t= が消え、リロードすると「リンクをもう一度お開きください」になる
- [ ] 「この予約を取り消す」→ 確認パネル（料金・元に戻せない旨）→「取り消しを確定する」→ 完了表示
- [ ] 完了後にキャンセル受付メールが届き、キャンセル料（¥0 なら「いただいておりません」）が本文と一致する
- [ ] 同じリンクをもう一度開くと「取り消し済みです」になる
- [ ] 取消後、/admin/reservations で状態がキャンセル・cancelled_by が guest_token になり、PMS の予約一覧から消えている（部屋割りが解放されている）
- [ ] 在庫（booking.availability）が戻る：同日程・同部屋で再度検索すると残室が +1 されている
- [ ] URL のトークンを 1 文字変えると「このリンクは無効です」（予約の存在が分からない）
- [ ] 15 日以上前の予約で「キャンセル料はかかりません」、14 日前以内で 10% 等が出る（rank standard の規定）
- [ ] PMS でチェックインした予約のリンクを開くと「ご滞在済み」になり取消できない
- [ ] チェックイン翌日以降にリンクを開くと「受付期間を過ぎています」＋施設電話が出る
- [ ] 同一 IP で 1 分に 11 回以上開くと「しばらく時間をおいて」になる
- [ ] 2 つのタブで同時に確定を押しても取消は 1 回・メールは 1 通

#### 管理画面（/admin/reservations）
- [ ] 本番で実予約（YB-…）が一覧に出る（demo 予約が出ない）。既定フィルタは直販・今日〜120 日
- [ ] 会員／非会員、サイト／アプリ、メール送信状況（✔／⏳／⚠）が行に出る
- [ ] 経路「すべて」で OTA 予約が出て、金額「—」・操作カラムに「OTA 側で取り消してください」が出る
- [ ] 詳細で価格明細・クーポン・ポイント・規定・本日時点のキャンセル料・メール履歴・取り消しリンクの状態（有効期限・閲覧回数）が出る
- [ ] 「送信内容を見る」で件名・本文（リンク入り）が admin にだけ見える。staff では非表示・連絡先マスク・操作ボタン無し
- [ ] キャンセル処理（理由必須）→ 状態キャンセル・監査ログ（actor 付き・by=admin）・お客様に受付メール（理由は載っていない）
- [ ] 「施設都合」チェックで免除 → メールが「当館の都合によるお取り消しのため、キャンセル料はいただきません」になる
- [ ] 「予約確認メールを再送」→ 送信済みの予約では「リンクが新しくなる」注記が出て、再送メールの新リンクは使え、旧リンクは「使えなくなりました」になる
- [ ] failed の予約で再送 → 同じリンクのまま送られる（token_rotated=false）
- [ ] 「リンクを無効化して再発行」→ 旧リンク無効・新メール到着・監査ログ rotate_cancel_token
- [ ] /admin/members/[id] に予約履歴が出て、予約番号から詳細へ飛べる
- [ ] /admin/app に「予約メールの送信に失敗 n 件」アラートが出る（失敗を作ったとき）
- [ ] ローカル demo（DATA_SOURCE=demo）で /admin/reservations が従来どおり demo 予約を表示し、/booking/cancel が「本番専用」パネルになる

#### DB・運用
- [ ] cron.job に book_mail_outbox_drain（*/2）と book_mail_outbox_purge（日曜）がある
- [ ] Vault に book_send_booking_mail_url / _secret がある。secret を一時的に変えると EF が 401 を返し outbox は processing→10 分で pending に戻る（ユーザー立会いのみ）
- [ ] book.booking_access_tokens に token_hash だけがあり raw が無い。sent 済み outbox の payload に cancel_token が無い
- [ ] book.admin_audit_logs に cancel_booking / resend_booking_mail / rotate_cancel_token が actor 付きで記録される
```

---

## 10. 積み残し・将来課題

1. **予約変更（`amend_booking`）時のメールとトークン期限**: 日程変更で `check_in_date` が動くとトークンの `expires_at` がずれる。v1 は変更後に管理画面から「リンクを再発行」で対応。次版で `_amend` 内の `expires_at` 更新＋「ご予約変更のお知らせ」メール（`kind='booking_amended'`）を足す。
2. **リコンファーム／リマインドのメール版**: アプリ push（reminder/thanks）は既存。非会員にはメールしか届かないので、`enqueue_stay_notifications` と同じ日次 cron で `mail_outbox` に `kind='reminder'` を積む案。文面は `pms.mail_templates`「リコンファーム」を参考に。
3. **多言語メール**: `metadata.locale`（en / zh-TW）は保存済み。`templates.ts` を locale 分岐にするだけで済む構造にしておく（v1 は ja 固定・他言語の客にも日本語メールが届く）。
4. **`core.facilities.metadata.postal_code` の投入**: EF の定数表で補っているが、DB に入れれば EF から定数を消せる。
5. **`pms.mail_settings.from_name` の統一**: yamado が `山人-reservation-`。EF 側で施設名に上書きしているが、PMS 手動送信の差出人名も揃えるかは運用判断。
6. **会員詳細の予約履歴に OTA 予約を含める**: `core.stays.guest_id` の名寄せ精度（`guest_identities` の email 一致のみ）を確認してから。
7. **管理画面からの予約変更 UI**: 現状は会員本人のマイページ／アプリからのみ。電話で変更依頼を受けたときの運用は PMS（現場操作）。
8. **メール本文の管理画面編集（`book.mail_templates`）**: 2 通・編集者 1 名の間はコード管理。挨拶文だけ差し替えたい要望が出たら `book.mail_snippets(kind, key, text)` で部分差込にする。
9. **outbox の `body_text` 保存方針**: 監査価値と個人情報保持のバランス。90 日 purge で開始し、必要なら「送信直後に本文を破棄・件名のみ保持」へ切り替える。
10. **`has_facility_access` と `tenant_admin`（facility_id NULL）の関係**: §7.2 の確認結果によっては `compute_cancel_fee` / 既存 `cancel_booking` のスタッフ判定に `is_tenant_admin` を OR する小改修が要る。
11. **`/admin/reservations` の CSV 出力・帳票**: 要望が出てから。PMS 側に現場帳票があるため優先度低。
12. **Cloudflare Pages プレビュー環境でのメール**: `BOOK_SITE_BASE_URL` は本番固定。プレビューで予約するとリンクが本番 URL になる（同じ DB を指すので動作はする）。

---

## 付録 A. 環境変数・シークレット一覧

| 置き場 | 名前 | 値 | 変更タイミング |
|---|---|---|---|
| Edge Function secrets（`supabase secrets set`） | `BOOK_SEND_BOOKING_MAIL_SECRET` | 32 文字以上の乱数 | 初回のみ |
| 同 | `BOOK_SITE_BASE_URL` | `https://autumn-book.pages.dev` → 移行後 `https://<独自ドメイン>` | **独自ドメイン移行時** |
| Vault（PROD で一度） | `book_send_booking_mail_url` | `https://opkocyapzmsjzhbwlguh.supabase.co/functions/v1/send-booking-mail` | 初回のみ |
| 同 | `book_send_booking_mail_secret` | 上記 SECRET と同値 | 初回のみ（ローテーション時は両方） |
| `pms.mail_settings`（DB・既存） | 施設別 SMTP | 変更なし | パスワード変更時 |
| autumn-book `wrangler.jsonc` | — | **追加なし** | — |

## 付録 B. 主要文言一覧（コピー＆ペースト用・管理画面）

| 場面 | 文言 |
|---|---|
| 一覧の説明 | `予約サイト・アプリからのご予約の確認と取り消しはここで行います。部屋割り・チェックイン操作は PMS で行います。` |
| 一覧 0 件 | `該当する予約がありません。期間・経路の条件を確認してください。` |
| 一覧 上限 | `表示は 200 件までです。期間を絞ってください。` |
| OTA 行の操作カラム | `OTA・電話経由のご予約は、それぞれの窓口（OTA 管理画面・PMS）で取り消してください。取り消しは PMS に自動反映されます。` |
| キャンセル確認 | `この予約を取り消します。お客様へキャンセル受付メールを自動送信します（入力した理由はメールに載りません）。` |
| 施設都合チェック | `施設都合（キャンセル料を免除する）— メールに「当館の都合によるお取り消しのため、キャンセル料はいただきません」と記載されます` |
| 再送（送信済み） | `送信済みのメールを再送すると、取り消しリンクは新しいものに切り替わります（古いリンクは無効になります）。よろしいですか？` |
| 再送（未送信・失敗） | `同じ内容・同じリンクで再送します。` |
| リンク再発行 | `現在の取り消しリンクを無効にし、新しいリンクを記載した予約確認メールをお客様に送ります。リンクの漏えいが疑われるときに使います。` |
| 取消成功 | `キャンセル処理を実行しました（監査ログに記録・お客様へ受付メールを送信します）。` |
| 再送成功 | `予約確認メールを送信キューに入れました。2 分以内に送信されます。` |
| メール失敗行 | `送信に失敗しました（{attempts} 回）: {last_error}` |
| キュー滞留 | `メール送信が 10 分以上止まっています。cron（book_mail_outbox_drain）と Edge Function のログを確認してください。` |
