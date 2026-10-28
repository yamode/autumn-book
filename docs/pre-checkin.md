# 事前チェックイン（設計）

2026-10-29 ユーザー要望:
1. チェックイン前日（または当日）に、予約情報があらかじめ入ったフォームを、お客様それぞれへ送る（客室案内の「トークン付きリンク」と同じ要領）。
2. フォームで基本情報の確認（違えば修正入力）と、夕食時間・朝食時間の入力。そのまま貸切風呂の予約まで行える。
3. Book 管理画面の予約一覧で、どの OTA 経由の予約か分かる。
4. 公式サイト以外（OTA 経由）の予約には、次回から公式サイトで予約するよう誘導するバナーを出す（フォーム・SMS・メール）。
5. 送信には NTT CPaaS（SMS 等）を使う。

状態: **P1（一覧の OTA 名表示）は実装済み（v0.207.0・DB は未適用）。P2（受付・フォーム・管理画面・メール手動送信）は実装済み（v0.209.0・DB は未適用）。P3 以降は設計案**。

2026-10-29 ユーザー回答（反映済み）: ① NTT CPaaS はトライアル契約中でテスト可・送信は **SMS 想定** ② 夕食・朝食の時間は**スタッフ承認なし・お客様の入力をそのまま確定** ③ 送信は**当日 9:00** ④ P1 から実装。事実は出典付き、推測は【推測】、未確認は ★（§10 に一覧）。
関連: `autumn_book_private_bath_design.md`（§段階3 に「事前チェックインフォームは新設」とある）、`docs/launch-tripla-cutover.md`（12/1 切替）、`docs/partner-pms-customer-link.md`。

---

## 1. 現状（調査結果）

出典は `apps/web/src` 基準。DB 定義は Book に無く、兄弟リポ `autumn-shared/supabase/migrations/`（以下 MIG）にある。

### 1.1 「客室案内のリンク送信」は実は存在しない
- 客室案内のトークン配布は **印刷 QR スリップと口頭/紙の 6 桁コード**だけ。メール/SMS 送信のコードは無い（`HANDOFF.md:3552`、`routes/admin/inroom/+page.server.ts:403,455`、`routes/admin/inroom/slip/[id]`）。管理画面の `noticeSend` は全客室向けお知らせの掲載で、個別送信ではない。
- → 「客室案内と同じ要領」は **トークン付きリンクの発行方式**を指すと解釈した（★Q1）。送信そのものは新規。
- 滞在トークン: `book.stay_access_tokens`（token=uuid×2 の 64hex・`short_code` 6 桁・`valid_from`=チェックイン日 12:00・`valid_to`=チェックアウト日 11:00・revoked_at）。署名ではなく不透明な bearer で、期間内なら何度でも使える。`book.get_or_issue_stay_token` は既存があれば同じトークンを返す。`/r/c/<token>` は httpOnly Cookie `ab_stay` に交換して `/r` へ（URL にトークンを残さない）。
- `_pb_token`（全 RPC 共通の検証）は `valid_from` 前を `invalid_token` にする。~~現状、チェックイン前のリンクから貸切風呂は予約できない~~ → **2026-10-29 決定: 滞在トークンの有効開始をチェックイン日 12:00 → 9:00 に前倒し**（autumn-shared `20261028215020`）。事前チェックインの SMS（当日 9:00）のリンクから、客室案内・貸切風呂がすぐ使える。

### 1.2 メール基盤
- 直販予約メール: `book.mail_outbox`（pending/processing/sent/failed・attempts 上限 5・`dedupe_key` unique・本文保存 90 日）→ pg_cron `*/2` → Edge Function `send-booking-mail`。`kind` は check 制約付きで、新しい種別は migration＋`templates.ts` が要る（MIG 20260907081954）。
- Book 側 `lib/server/mailer.ts`（Cloudflare Email Sending）は失敗しても例外にせず `{sent:false, reason}`。送信ログ表なし。
- **SMS / NTT CPaaS / 電話発信のコードはリポジトリに存在しない**。電話番号は保存・表示のみ。

### 1.3 連絡先・当日一覧
- `core.stays.guest_id → core.guests(name, name_kana, phone, email)`。OTA 予約は匿名メール等のことがある【推測】★Q6。
- `book.list_bookable_stays(p_facility, p_date)` は「当日の在館者」（チェックイン日含む・メール電話なし）。**「check_in_date = 明日」の専用クエリは無い**ので新設する。

### 1.4 食事
- SoT は `pms.stay_meals`（meal_type dinner/breakfast/lunch・meal_date・`meal_time` 'HH:MM'・seat_no・note・metadata・UNIQUE(stay_id,meal_type,meal_date)）。時間枠マスタ `pms.facility_meal_timeslots` / `facility_meal_day_settings`（MIG 20260713052128）。
- Book は読むだけ（RPC `book.stay_meal_times`）。`lib/server/stay-meals.ts` の型には `status:'requested'` が**事前チェックイン用に予約済み**（現状 RPC は常に confirmed）。
- PMS は `autumn-pms/sveltekit/src/lib/server/stay-meals.ts` の `saveMealTimesForNight` 等で upsert（seat_no/note/metadata を保全）。

### 1.5 貸切風呂
- `/r/bath`（Cookie `ab_stay`）。RPC `private_bath_context` / `reserve_private_bath(p_token,p_bath,p_slots)` / `cancel_private_bath`。台帳 `pms.private_bath_slots`（`booked_via='guest'`）。施設×日×浴室の advisory lock、`perRoomPerRange`・`cutoffMin`・`guestCancelMin`。連泊は全日程対象。
- 料金は経路で決まる（`book._pb_price`・無料経路 `DEFAULT_FREE_CHANNELS=['direct','phone','tripla','autumn_booking']`）。数の制限は `perRoomPerRange` のみ。
- 施設設定 `openFrom`: `booking_confirmed`（既定）なら制限なし、`checkin` だとチェックイン前は `not_yet_open`。
- `autumn_book_private_bath_design.md:425-435` に「トークンは `valid_from` 前倒しで流用・RPC 変更不要」とあるが、`valid_from` 前倒しは館内図 QR 側のトークンも早く効くので副作用が要確認。

### 1.6 予約の経路（OTA）
- 元データ: `core.stays.channel_code`（PMS 内部キー）・`source`・`metadata->>'fm_channel_id'`。公式サイト予約は `source='autumn_booking'`（`channel_code` は空のことあり）。tripla は `channel_code='tripla'`。
- 管理画面の一覧は `book.admin_list_bookings`（MIG 20261010204933）。`booking.channels` を join して `channel_name` を返すが、**`booking.channels` のシードは `autumn_booking` と `rms_partner` のみ**。OTA 予約は `channel_name` が null になり、画面は `source` か '—' を出す（`routes/admin/reservations/+page.svelte:28-32,198-209`）。
- 名称マスタは `pms.ota_channels`（PMS/TL 側）にあるが、Book から読む RPC は無い。

### 1.7 バナーの既存部品
- `book.inroom_banners`（画像・リンク・言語・期間）は**チェックアウト後のサンクス画面にしか出ない**。`PerkBanners.svelte` は公式 HP 限定特典のモーダル。会員・クーポン・ポイントは既にある（`/membership`、`admin/coupons`）。

### 1.8 定期実行
- Cloudflare Cron は使わない。Supabase pg_cron → `routes/api/cron/*`（`Authorization: Bearer $CRON_SECRET`、`waitUntil` で即 202）、または Edge Function drainer。雛形は MIG 20261018210132。

---

## 2. 全体像

```
[毎日 9:00 JST pg_cron] → 対象抽出（今日チェックイン）→ book.precheckins を作成（トークン発行）
        → book.precheckin_dispatch に送信ジョブ（SMS 優先・メール併用）
        → Edge Function / cron が NTT CPaaS・メールへ送信（失敗は再試行→メールへフォールバック→管理画面に表示）
[お客様] SMS/メールのリンク /ci/<token> → ①基本情報の確認・修正 ②夕食/朝食の時間 ③貸切風呂の予約（任意）
        → ④（OTA 経由のみ）公式サイト誘導バナー → 完了画面（/r への案内）
[スタッフ] 管理画面 /admin/precheckin: 状況一覧（未送信/送信済/開封/回答済/失敗）・修正差分の確認 → PMS へ反映
```

## 3. 送信タイミングと対象

- **確定: チェックイン当日の 9:00 JST に 1 回送る（SMS）**。前日送信案は採らない。当日送信なので、貸切風呂は当日の枠のみ、夕食時間は当日朝の入力になる。リマインドは初期は無し（未回答は管理画面の一覧で見て手動再送）。
- 対象: `status<>'cancelled'` かつ `check_in_date = 今日（施設 TZ）` の滞在。連泊は初日のみ。団体予約の部屋ごと行（`book.bookings` の複数室）は **代表者へ 1 通**（部屋ごとにしない・★Q3）。
- 除外: 取引先経路（`rms_partner`）は別運用なので初期は除外（★Q3）、連絡先が全く無い予約、すでに回答済み。
- 手動操作: 管理画面から「今すぐ送る／再送／送らない」を選べる（当日飛び込みや、日付を過ぎて予約された分に必要）。

## 4. トークンとフォームのセキュリティ

- フォーム用トークンは滞在トークンと**別に**作る（滞在トークンは `valid_from` が 9:00 になったが、フォームの回答だけ見える権限にしたいので流用しない）。事前チェックイン専用に `book.precheckins`（下記 §8）を作り、`token_hash`（SHA-256 のみ保存・平文はリンクに入れる時だけ）・`expires_at`（チェックアウト日 11:00）を持たせる。URL は `/ci/<token>`、検証後は `/r/c` と同様に httpOnly Cookie に交換して URL からトークンを消す。理由: 1) `valid_from` 前倒しの副作用を避ける 2) リンクが漏れても見えるのは「その予約の氏名・食事・風呂」に限る（PMS 全体や請求は見えない）。
- フォームに出す個人情報はマスク表示（電話は下 4 桁、メールは先頭 2 文字）。修正の入力欄は空にして上書き入力。
- 回答は何度でも修正可、チェックイン 12:00 まで。以後は閲覧のみで `/r`（客室案内）へ案内。
- レート制限は `claim-rate-limit` の方式を踏襲（トークン無効の連続試行をロック）。

## 5. フォームの項目と PMS への反映

| ステップ | 項目 | 初期値 | 反映先 |
|---|---|---|---|
| 1 基本情報 | 代表者氏名・カナ・電話・メール | `core.guests` | **PMS を直接書き換えない**。`book.precheckins.answers.contact` に差分として保存 → スタッフが PMS 側で確認して反映（§5.1） |
| 〃 | 到着予定時刻・同伴人数・アレルギー・ご要望 | 予約時入力があれば | `answers.*` → 予約メモ欄に追記（スタッフ確認後） |
| 2 食事 | 夕食時間／朝食時間（連泊は各泊） | 施設の時間枠マスタ | **`pms.stay_meals.meal_time` へそのまま確定**（承認なし・§5.2） |
| 3 貸切風呂 | 空き枠の選択・予約 | — | 既存 `reserve_private_bath` を呼ぶ（§6） |
| 4 完了 | 客室案内への案内、OTA 経由ならバナー | — | — |

### 5.1 PMS へ直接書かない理由と方式
宿泊者名簿は旅館業法上の記録で、お客様の自己申告で PMS のマスタが黙って変わるのは危ない。**回答は Book 側に保存し、スタッフが PMS で「事前チェックイン回答」を見て 1 クリックで反映**する（autumn-pms 側に差分表示＋反映ボタンが要る。別リポの変更）。（食事時間はユーザー決定により承認なし・§5.2。基本情報の修正だけスタッフ確認とする案。★Q4）

### 5.2 食事時間（承認なしで確定）
- お客様の入力をそのまま `pms.stay_meals.meal_time` に確定する（ユーザー決定）。Book 側に `stay_meals` へ書く RPC が無いので、トークン検証つきの SECURITY DEFINER RPC（例 `book.precheckin_save_meals`）を新設し、`UNIQUE(stay_id,meal_type,meal_date)` で upsert。既存の `seat_no`・`note`・`metadata` は保全する（PMS の `saveMealTimesForNight` と同じ流儀）。
- **時間枠の定員チェックは RPC 内で必須**（`facility_meal_timeslots` / `facility_meal_day_settings`）。満席の枠は選べないようにフォームでも出さない。上書きされたことをスタッフが分かるよう `metadata.set_by='precheckin'` を残し、PMS の食事画面で印を出す（P5）。
- `stay-meals.ts` の `status:'requested'` は使わない（常に confirmed）。

## 6. 貸切風呂との連携

- 有効開始が 9:00 になったので、**専用 RPC は不要になった可能性が高い**。フォームの最終ステップは、滞在トークン（`get_or_issue_stay_token`）を発行して `/r/c/<token>?next=bath` の既存の貸切風呂画面へ案内する（または同じ画面を埋め込む）。フォーム内で予約まで完結させたい場合のみ `book.precheckin_reserve_private_bath` を新設する（P3 で判断）。
- 制約はそのまま継承: `perRoomPerRange`・`cutoffMin`・料金（経路で無料/有料）・グループ共有枠。`openFrom='checkin'` はチェックイン日前を拒否するだけなので、当日 9:00 以降は問題にならない（★Q7 は解消）。
- 取消・変更は既存どおり `/r/bath`（チェックイン日 12:00 以降）で。事前チェックイン画面からも `cancel_private_bath` 相当を提供する（`guestCancelMin` に従う）。
- 有料の貸切風呂の支払いは、既存どおり請求書への計上（`_pb_sync_bill_items`）で、フォームでは決済しない。

## 7. OTA 判別と一覧表示（要望 3）

- **公式サイト予約** = `core.stays.source='autumn_booking'`（既存コードと同じ判定）。tripla（`channel_code='tripla'`）も「公式 HP の予約エンジン経由」だが **公式サイト（Book）予約ではない**ので誘導の対象にする（12/1 以降に tripla 予約が残るため）。★Q8。
- 一覧の表示: `book.admin_list_bookings` の返却に `channel_code` と、経路名（`pms.ota_channels` を join、無ければコードの対応表）を足す。画面は `BookingListRow` に列を足し `channelLabel` を直す。**案 C（`pms.ota_channels` を join）を推奨**。案 A（`booking.channels` に OTA を seed するだけ）は最小だが、PMS のマスタと二重管理になる。
- 見せ方: 経路列に「楽天トラベル」「じゃらん」「一休」「Booking.com」「Expedia」「tripla」「公式サイト」「電話」等のバッジ（OTA は色分け）、絞り込みに「OTA すべて／公式サイトのみ」を足す。詳細ページの生コード表示（`b.channel_code ?? b.source`）も名称に直す。
- 事前チェックイン管理画面にも同じバッジを出す。

## 8. 公式サイト誘導バナー（要望 4）

- 出し分け: `source<>'autumn_booking'`（かつ取引先でない）の予約だけ。フォーム（完了画面と各ステップ下）、SMS（短文の末尾に 1 行）、メール（本文の末尾）。公式サイト予約には出さない。
- 内容（案）: 「次回のご宿泊は公式サイトが一番お得です」＋施設の予約トップ（`/yamado/nishiwaga`・`/yamado/oga`）へのリンク、会員登録の特典（ポイント・会員限定料金など、実在する特典のみ）。UTM（`utm_source=precheckin&utm_medium=ota`）を付けて効果を測る（既存の `analytics-and-experiments.md` の仕組みに乗せる）。★Q9: 特典の文言・OTA 規約上の問題（OTA 経由の予約者を他チャネルへ誘導する文言に制限がないか・宿泊後の案内なら一般的だが各 OTA の規約を確認）。
- バナーの原稿は管理画面で編集できるようにする（`book.inroom_banners` を流用するか、`kind='precheckin'` を足す）。初期は文言固定でもよい。

## 9. NTT CPaaS による送信（要望 5）

**コード上、SMS 送信の既存実装も NTT CPaaS の接続情報も無い**ため、以下は設計方針と要確認事項（§10 Q10〜）。

- 方式: DB の送信ジョブ `book.precheckin_dispatch`（`channel` sms/email・`status` pending/sending/sent/failed/undeliverable・`attempts`・`last_error`・`provider_message_id`・`dedupe_key` unique=滞在×種別×日）。pg_cron が Edge Function（または `/api/cron/precheckin-dispatch`）を叩いて送る。`mail_outbox` と同じ流儀で、二重送信を `dedupe_key` で防ぐ。
- 失敗時: 一時エラーは指数バックオフで最大 3 回。恒久エラー（番号不正・拒否）は即 `undeliverable`。**SMS が失敗/番号なしならメールへフォールバック**、両方失敗なら管理画面の一覧に赤で出して、スタッフが電話・手動送付できる。配信結果（到達レポート）が取れるなら Webhook で `status` を更新（★）。
- 秘密情報（API キー等）は Edge Function の secrets / Cloudflare の環境変数。リポジトリ・ログに出さない。
- 文面: 70 字程度の短文 SMS（または長文 SMS）に施設名＋リンク。リンクは短縮せず `book.yamado.app/ci/<token>`（トークンは十分に長いが SMS 文字数に収まるか要検証・★）。差出人表示は施設名か番号か（★）。
- 海外の宿泊者（国際番号）は SMS が届かない/高額なため、メールを既定にする（★Q11）。
- 同意・法令: 予約時の連絡目的の利用として許容されるはずだが、プライバシーポリシーに「事前チェックインのご案内（SMS/メール）」を追記（`lib/server/store.ts:1658` 付近）。

## 10. 要確認事項（★）

| # | 質問 | 暫定の置き方 |
|---|---|---|
| Q1 | 「客室案内と同じ要領」はトークン付きリンクという意味でよいか（現状、客室案内にリンク送信機能は無い） | 左記と解釈 |
| Q2 | ~~送信時刻~~ **確定: 当日 9:00**。当日朝の入力で厨房の仕込みに間に合う時間枠か（締め時刻） | 当日 9:00・リマインドなし |
| Q3 | ~~団体・複数室・取引先~~ **確定（2026-10-29）: 代表者 1 通。取引先経由は一旦除外** | — |
| Q4 | ~~修正入力の反映~~ **確定: 確認方式（Book に保存→スタッフが PMS で確認して反映）** | — |
| Q5 | ~~食事の承認~~ **確定: 承認なし**。時間枠の定員を超えた入力の扱い | 満席は選べない |
| Q6 | ~~OTA 予約の連絡先~~ **調査済み（§16）** | 携帯番号なら SMS・それ以外/空ならメール |
| Q7 | ~~貸切風呂のチェックイン前予約~~ **解消**: 滞在トークンが 9:00 から有効 | — |
| Q8 | tripla 経由の予約も誘導バナーの対象にするか | 対象にする |
| Q9 | バナーの特典内容・OTA 規約上の可否 | 実在特典のみ・規約確認 |
| Q10 | **NTT CPaaS**（トライアル契約中・SMS 想定。P4 で）: 契約済みの商品名（SMS / スマート通知 / メッセージング等）・API 仕様書・認証方式（API キー／OAuth／Basic）・エンドポイント・サンドボックスの有無・送信元（番号／名称）・1 通あたり単価と月間上限・長文／URL 付き可否・到達レポートの取得方法（Webhook／ポーリング）・国際 SMS 可否・送信可能時間帯 | 資料をもらい次第、P2 の実装に入る |
| Q11 | 海外の宿泊者の扱い | メール既定 |
| Q12 | tripla 管理画面で、先々の予約がいつまで入っているか（両施設） | §11 |

## 11. tripla の先々の予約（ユーザー依頼）

- tripla 管理画面は認証が要るため、このセッションからは確認していない（ログイン情報は扱わない）。**ユーザーがログイン済みの画面で確認、または CSV を共有してください。**
- 確認手順（tripla ナレッジ「予約一覧」より）: 施設管理画面 → 予約 → 予約一覧 → 日付で絞込み（**チェックイン日**）、予約状態「予約完了」、予約経路で triplaBook／triplaOTA を見分ける → 「予約一覧のダウンロード」で CSV（1,000 件以内は直接、超えるとメールで URL）。月ごとの絞込みで、いちばん先の月まで繰り返す。
- 新規受付が 11/29 まで続くため、**最後に入る予約は 2027 年の秋〜冬まで伸びる可能性**がある。事前チェックインは 12/1 以降に tripla 予約のお客様にも送るので、tripla 予約の連絡先（Q6）が重要。

## 12. DB 変更（migration は autumn-shared へ。本番適用はユーザーの指示があるまでしない）

ファイル名は `bash ~/.claude/new-migration.sh autumn-shared book_precheckin_<内容>` で実秒を採番。`book` スキーマ内で完結させる。

1. `book.precheckins`（id, tenant_id, facility_id, stay_id, token_hash unique, expires_at, status, answers jsonb, answered_at, first_opened_at, source_kind 'official'|'ota'|'tripla'…）＋ deny-all RLS＋RPC のみ。
2. `book.precheckin_dispatch`（送信ジョブ・上記）。
3. RPC: `book.precheckin_targets(p_facility, p_date)`（service_role、今日のチェックイン一覧＋連絡先）、`book.precheckin_context(p_token)`（フォーム用）、`book.precheckin_submit(p_token, p_answers)`、`book.precheckin_reserve_private_bath(...)`。
4. `book.stay_meal_times` を `requested` も返すよう更新（`metadata.requested_time`）。
5. `book.admin_list_bookings` に `channel_code`・経路名を追加（既存の戻り列を壊さない・autumn-pms の未適用 migration と競合しないか事前確認）。
6. pg_cron: 毎日 9:00 JST（UTC 0:00）。
7. autumn-pms 側（別リポ）: 回答の確認・反映 UI、`stay_meals` の requested 承認。

## 13. 段階

| 段階 | 内容 | 前提 |
|---|---|---|
| **P0** | 要確認 Q1〜Q12 の回答、NTT CPaaS 資料、tripla 予約の先の日付 | ユーザー |
| **P1** ✅実装済み（v0.207.0） | 一覧に OTA 名のバッジ・「OTA経由のみ」絞り込み（§7）。DB は `admin_list_bookings` のみ（autumn-shared `20261028213735`・未適用）。詳細ページの名称表示は未対応 | なし |
| **P2** ✅実装済み（v0.209.0） | `precheckins`＋フォーム（基本情報・食事・完了）＋管理画面の状況一覧。送信は**メールのみ・手動の「送る」ボタン**。DB は autumn-shared `20261028220125_book_precheckin_p2.sql`（未適用）。食事の時間枠の受付上限（室数）は Book 側の `book.precheckin_meal_caps` に新設（PMS のマスタに定員の列が無いため）。再送は新しいリンクを発行し前のリンクは無効 | P0 |
| **P3** | 貸切風呂の連携（§6）＋ OTA 誘導バナー（§8） | P2 |
| **P4** | NTT CPaaS の SMS 送信・自動送信（cron）・フォールバック・到達管理 | Q10 の資料 |
| **P5** | autumn-pms 側の回答確認・反映・食事承認 | P2 |

11/30 ローンチに必須なのは P1（OTA 名の表示）と、できれば P2〜P3。SMS 自動送信（P4）は契約・審査に時間がかかるので、**P2 のメール手動送信で運用を始め、P4 を後から足す**順を推奨。

## 14. テストチェックリスト（実装時に HANDOFF.md へ転記）

### 一覧（P1）
- [ ] （DB 適用後）予約一覧の経路列に OTA 名（楽天・じゃらん・一休・Booking.com・Expedia・tripla・公式サイト・電話）が出る
- [ ] 経路で「OTA経由のみ」「直販のみ」に絞り込める（直販・取引先・電話は OTA に出ない）

### 発行・送信（P2/P4）
- [ ] 今日チェックインの予約だけが対象になる（取消・取引先・回答済みは除外）
- [ ] 同じ滞在に二重送信されない（cron を 2 回走らせても 1 通）
- [ ] SMS 失敗時にメールへフォールバックし、管理画面の一覧に失敗が出る
- [ ] 連絡先が無い予約は「連絡先なし」と出て、手動送付できる
- [ ] 海外番号はメールで送られる

### フォーム（P2）
- [ ] リンクを開くと予約情報（氏名・日程・人数）が入っている／個人情報がマスクされている
- [ ] 修正入力が保存され、PMS 側のマスタは勝手に変わらない
- [ ] 夕食・朝食の時間を選べ、連泊は各泊分出る。枠の定員を超えられない。選んだ時間がそのまま PMS の食事に確定する
- [ ] トークンが違う／期限切れだと開けず、連続失敗でロックされる
- [ ] チェックイン 12:00 を過ぎると閲覧のみになり、客室案内へ案内される
- [ ] スマホ（iPhone 実機）で崩れない／ja・en・zh-TW

### 貸切風呂（P3）
- [ ] 当日 9:00 のリンクから（12:00 前でも）空き枠を予約できる（`openFrom='checkin'` の施設でも）
- [ ] 上限・締切・料金（無料経路）が `/r/bath` と同じ結果になる
- [ ] 取消ができる（`guestCancelMin` 内は不可）
- [ ] 予約が PMS の請求書に反映される

### バナー（P3）
- [ ] OTA／tripla 経由の予約にだけバナーが出る。公式サイト予約には出ない
- [ ] リンク先が施設の予約トップで、UTM が付く

### PMS 連携（P5）
- [ ] スタッフが回答の差分を確認して反映できる／食事の希望を承認すると `meal_time` が確定する

## 15. 客室案内の有効開始を 9:00 に前倒し（2026-10-29・v0.208.0）

- ユーザー指示: 事前チェックインの送信（当日 9:00）に合わせ、客室案内（滞在トークン・6 桁コード）を当日 9:00 から見られるようにする。終わりはチェックアウト日 11:00 のまま。
- DB: autumn-shared `20261028215020_book_stay_token_open_0900.sql`（`_resync_chain_tokens` と `get_or_issue_stay_token` の `interval '12 hours'` → `'9 hours'`、有効なトークンの開始を引き直す）。**本番適用はユーザーの指示を待つ**。
- 画面の文言（9:00 から表示・入口 QR の説明）を合わせた。
- 注意: 前のお客様のチェックアウト（11:00）と重なる 9:00〜11:00 は、同じ部屋の客室案内が前後 2 組に開ける。コードは滞在ごとなので取り違えは起きないが、客室スリップを前のお客様が持っている間に次のお客様のコードも有効になる。

## 16. OTA 予約の連絡先の実態（本番 2026-10-29 調査・今日以降の予約・取消除く）

| 経路 | 件数 | 携帯番号 | メールあり |
|---|---|---|---|
| 一休 | 528 | 470 | 約 27% |
| tripla | 217 | 175 | 100% |
| じゃらん | 84 | 73 | 100% |
| 楽天 | 44 | 37 | 2 件のみ |
| Expedia | 12 | 0 | 1 件（連絡先がほぼ無い） |
| るるぶ | 7 | 5 | 5 |
| 直接（FileMaker 含む） | 315 | 102 | 約 72%（番号なしが 75） |

- 匿名の中継メールらしいものは検出されず（パターン外は未確認）。
- 方針: 携帯番号（070/080/090）なら SMS、それ以外・空はメール、どちらも無ければ「連絡先なし」として管理画面に出し手動対応。Expedia は実質送れない前提。一休・楽天はメールがほぼ無いので SMS が失敗したら手動。

## 17. P2 の範囲（2026-10-29 確定: Q3・Q4 回答後）

- 対象: 代表者 1 通（複数室の公式予約は部屋ごとの食事入力をフォーム内で）。取引先経由（`rms_partner`）は除外。
- 基本情報の修正は Book に保存し、スタッフが確認して PMS に反映（P5 で PMS 側）。食事は承認なしで確定。
- P2 の送信はメールの手動ボタンのみ（SMS 自動送信は P4）。
