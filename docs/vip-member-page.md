# VIP 会員専用ページ（取引先ページの仕組み × 公式会員制度）— 設計書

> 作成: 2026-10-09（autumn-book v0.103.5 時点・読み取り調査のみ。コード・migration・DB 書き込みは未着手）
> 改訂: 2026-10-09 — §10 の未決事項にユーザーの決定が出たため確定に書き換え（キャンセル規定は設定画面で選ぶ・マイページから専用ページへ・複数施設化の後に実装・家族のつながりで利用可・個人指定）
> 改訂: 2026-10-10 — §13「実装設計」を追記（複数施設化・認証強化 S1〜S8・団体予約・料金の先計算の後の実コードに合わせた実装範囲・DB・契約・チェックリスト・要確認 Q1〜Q8）
> 対象リポ: autumn-book（専用ページ・管理画面・予約）／autumn-shared（migration・DB 関数）／autumn-pms（電文の受け側の確認のみ）
> 本書は「調査で確かめた事実」と「提案」を分けて書く。事実には出典を付ける。提案には【提案】を付ける。
> 関連: `docs/partner-multi-facility.md`（取引先の複数施設化・設計のみ）、`docs/partner-pms-customer-link.md`、`docs/saved-cards.md`

---

## 1. 目的

ユーザーの要望（2026-10-09）:

- 取引先ページ（`/p/[token]`）の仕組みを使って、**VIP 顧客ひとりひとりに専用のプラン・料金・特典**を案内したい。
- 表側（公式サイト）の **会員制度と連動** させたい。
  - 公式サイトから予約 → 全員共通の会員制度の中での待遇（グレードの還元率・グレード別キャンセル料など）だけ。
  - 裏の専用ページから予約 → **会員制度の待遇 ＋ その人だけの専用特典の両方**を受けられる。

ひとことで言うと「**専用ページで予約しても、それは“その会員の公式予約”として扱う。そのうえに専用料金・専用特典を重ねる**」。

---

## 2. 現状（調査結果）

### 2.1 会員制度（公式サイト）

- 会員は Supabase Auth のメール OTP でログイン（`routes/(public)/auth/login`）。表は `book.members`（`user_id`・`guest_id`→`core.guests`・`member_code`・`rank_code`）。
- グレードは `standard / silver / gold / platinum` の4段階（`book.member_ranks`）。**「VIP」という段は無い。**
- グレードの待遇は現状2つだけ:
  1. ポイント還元率（1% / 2% / 3% / 5%。`routes/(public)/booking/hold/+page.server.ts` の `REWARD_RATE`、計算は `packages/core` の `earnedPoints`）。宿泊後に `book._finalize_booking` が付与。
  2. グレード別キャンセル料（`book.rank_cancel_policies`。適用順は プラン規定 → 取消時点のグレードの規定 → standard）。
- そのほか会員だけのもの: ポイント利用、会員クーポン（`confirm_booking` の `p_member_coupon_id`・公式サイトからは未使用）、早期決済ポイント、保存カード、マイページ（予約の確認・取消・変更・オプション）、会員/非会員で支払方法を分ける設定（`lib/member-payment.ts`）。
- 予約は `book.create_hold`（SQL で見積して仮押さえに保存）→ `book.confirm_booking`（SQL で金額・ポイント・割引を確定）。電文の `booker.member_user_id` に会員が載る。
- グレードの自動昇格は未実装。管理画面のグレード手動変更も実データでは未対応（demo のみ）。

### 2.2 取引先ページ

- 表は `public.rms_partners`（施設ごとに1行・`kind`=`agent|corporate|other`・`url_token`・`pricing`・`booking_settings`）。ログインは独自の `rms_partner_accounts` / `rms_partner_sessions`。
- 料金は「料金ルール」（`lib/partner-pricing.ts`）で、ルールに当たったプランだけを公開（当たらない料金は出さない）。
- 専用特典は `booking_settings.perks`（`PartnerPerk`・プラン指定可）。プラン名の上書き `planNames`、お知らせ `notice` など。
- 予約は `public.rms_partner_create_booking`（`channel='rms_partner'`）。支払は月次請求・予約時決済・カード登録後請求など法人向け。
- **会員とのつながりは無い。** `/p/*` では会員セッションを解決しない（`hooks.server.ts`）。取引先予約の電文は `booker.member_user_id: null`。取引先予約への会員紐づけはサーバで拒否（`lib/partner-reservation.ts`）。

### 2.3 ここから分かること

取引先の予約経路（`rms_partner_create_booking`）に会員の待遇を足すと、ポイント付与・利用・グレード別キャンセル料・マイページ・保存カードを**全部二重に作る**ことになる。逆に、会員の予約経路（`create_hold` / `confirm_booking`）に「専用料金・専用特典」を足せば、会員の待遇は**何もしなくても全部付いてくる**。

---

## 3. 方針【提案】

**「見せ方は取引先ページの部品、予約は会員の公式予約」**にする。

| 層 | 使うもの |
|---|---|
| 専用ページの画面（料金カレンダー・お部屋・プラン・特典・予約入力） | 取引先ページの部品を再利用（`PartnerStaySearch`・`PartnerPlanDetailModal`・`PartnerPerkList` など） |
| 料金・特典・プラン名・お知らせの設定 | 取引先と同じ形（料金ルール `pricing`・`perks`・`planNames`・`notice`） |
| ログイン | **公式サイトの会員ログイン（メール OTP）**。取引先のID・パスワードは使わない |
| 予約の確定 | **会員の予約経路**（仮押さえ → `confirm_booking`）。予約は会員の公式予約になる |
| 支払 | 公式サイトと同じ（現地払い・予約時決済・会員の保存カード）。月次請求・与信は使わない |

こうすると、専用ページの予約で自動的に:

- グレードの還元率でポイントが付く（専用料金＝実際に払う額に対して）
- ポイント・クーポンが使える
- グレード別キャンセル料が効く（§6.3 で専用規定との関係を決める）
- マイページの予約一覧に出て、取消・変更・オプション追加ができる
- 電文の `booker.member_user_id` に会員が載る（PMS の顧客も会員の顧客）

その**うえに**、専用料金と専用特典が乗る。

---

## 4. データモデル【提案】

### 4.1 専用ページ本体は `rms_partners` を再利用し、種別 `member` を足す

- `rms_partners.kind` に `'member'` を追加。`PARTNER_KIND_LABELS` の表示名は「特別会員」（2026-10-10 ユーザー指示）。
- 料金ルール・特典・プラン名・お知らせ・受付ルール（`leadDays` など）・`url_token`・有効期間は、そのまま使う。管理画面の設定 UI もそのまま使える。
- 使わない列（`kind='member'` では無視・管理画面で隠す）: `payment_method_id`、`pms_guest_id`、`booking_name_mode`、`credit_over_action`、`memorandum`、`stripe_customer_*`、`booking_settings` の `paymentOptions` / `invoice*` / `creditDeposit*` / `notifyPartner`。
- 別テーブルを新しく作る案もあるが、料金ルール・特典・管理画面・複数施設化（`rms_partner_facilities`）を全部作り直すことになるので採らない。

### 4.2 新表 `public.rms_partner_members`（専用ページを見られる会員）

| 列 | 型 | 説明 |
|---|---|---|
| `partner_id` | uuid FK → `rms_partners` | `kind='member'` の行だけ |
| `member_user_id` | uuid FK → `book.members.user_id` | 見られる会員 |
| `created_at` / `created_by` | | 追加したスタッフ |
| PK | `(partner_id, member_user_id)` | |

- 1ページに複数会員を許す（同じ会社の役員など）。ふつうは1人。
- **家族（決定 D3）**: 対象の会員と **PMS の家族（`pms.guest_families.family_group_id`）でつながっている会員** も、そのページを使える。家族の中に一人でも対象の会員がいれば、家族全員（会員登録している人）が使える。**家族それぞれのグレードは問わない**（グレードは予約した本人のものが効く）。
  - 判定: ログイン中の会員の `book.members.guest_id` → `pms.guest_families` で同じ `family_group_id` の `guest_id` 一覧 → それらの会員（`book.members.guest_id`）のうち誰かが `rms_partner_members` に入っていれば可。
  - 家族は PMS で管理する（2026-10-09 時点 PROD で 12 家族・25 行）。Book の管理画面では、対象の会員の欄に「家族として使える会員」を読み取りで並べる（変更は PMS で）。
  - 判定は SQL 関数 `public.rms_member_page_access(p_partner_id, p_member_user_id) returns boolean`（service_role）にまとめ、入口・仮押さえの両方で使う。
- 1人の会員が複数の専用ページを持つことも許す（施設ごと、季節ごとなど）。
- RLS は既存の `rms_partner_*` と同じく service_role のみ。

> 置き場所: `book` スキーマで完結させる原則（CLAUDE.md）に対し、取引先の表が `public.rms_partner_*` にあるため、同じ並びに置く。`partner-multi-facility.md` の `rms_partner_facilities` と同じ扱い。

### 4.3 予約側に「どの専用ページ経由か」を残す

- 仮押さえ（`book` の hold）と `booking.bookings.metadata` に `member_page_id`（= `rms_partners.id`）を持たせる。
- 予約時点の専用特典の写し（`perks_snapshot`）も予約に残す（後でページの特典を変えても、その予約の特典は変わらない）。取引先予約の `detail.perks` と同じ考え方。

---

## 5. 画面と流れ【提案】

### 5.1 入口とログイン

1. スタッフが VIP 会員の専用ページを作り、限定URL `/p/<token>` を会員に知らせる（メール・手紙・QRなど）。
2. 会員が開く → 公式サイトの会員でログインしていなければ、**専用ページの中で会員ログイン（メール OTP）**。
3. ログインした会員が `rms_partner_members` に入っていれば表示。入っていなければ「このページはご招待の会員さま専用です」。
   - URL だけでは見られない（URL が転送されても安全）。

実装メモ:

- `hooks.server.ts` は今 `/p/*` で会員セッションを解決していない。`kind='member'` のページだけ会員セッションを解決する（`resolvePortal` が種別を見て分岐）。取引先（agent/corporate）は今のまま。
- 会員セッションの cookie（`sb-autumn-book-auth-token`）は公式サイトと共有なので、公式サイトでログイン済みならそのまま入れる。

### 5.2 表示

- ヘッダー: 施設名 ＋「（会員名）様 専用ページ」。会員グレードのバッジ（例: PLATINUM）と保有ポイントも出す。
- 料金カレンダー・お部屋・プラン: 取引先ページと同じ部品。料金は専用ページの料金ルールで出す。
- 特典は2段で見せる:
  - 「（会員名）様専用特典」…このページの `perks`
  - 「会員特典（PLATINUM）」…還元率 5%・グレード別キャンセル規定 など。会員制度から自動で出す
- 予約入力: 公式サイトの予約入力と同じ項目（宿泊者・ポイント利用・クーポン・支払方法・保存カード）。右欄に「専用特典」と「会員特典（獲得予定ポイント）」を並べる。

### 5.3 予約の確定

1. 専用ページの予約入力 → サーバが専用ページの料金ルールで見積（今の `quotePartnerBooking` の料金部分を使う）。
2. 新 RPC `book.create_member_page_hold(...)`（service_role）で仮押さえ。**見積の明細（1泊ごとの単価）をサーバから渡して仮押さえに保存**し、`member_page_id` と `member_user_id` を記録する。
   - 今の `book.create_hold` は SQL で公式料金を見積して仮押さえに保存している。専用ページは料金ルールが TypeScript 側にあるので、サーバ（service_role）が計算した明細を渡す形にする。
   - サーバ側で会員がそのページの対象者であることを確かめてから呼ぶ（RPC の中でも `rms_partner_members` を確かめる）。
3. 以降は公式サイトと同じ: `/booking/hold` 相当の確認 → `confirm_booking`（仮押さえの金額で確定・ポイント利用・クーポン）→ 予約時決済なら `/booking/pay`。
   - `confirm_booking` が仮押さえに保存した見積を使っているなら、そのまま専用料金で確定する（**autumn-shared で要確認**。公式料金を引き直しているなら、仮押さえの見積を使うよう直す）。
4. 予約は公式予約（`channel` は公式と同じ）で、`metadata.member_page_id` と `perks_snapshot` が付く。

### 5.4 PMS への電文

- 公式予約と同じ `book._emit_pms_event`。`booker.member_user_id` / `guest_id` は会員。
- 要望欄の先頭に「【VIP専用特典】スパークリングワイン（ハーフボトル）／…」を載せる（取引先予約で特典を要望欄の先頭に載せているのと同じ）。宿は当日これを見て用意する。
- 電文に `source_detail: {member_page_id, member_page_name}` を足すかは autumn-pms と相談（PMS の予約詳細で「VIP専用ページ経由」と分かるように）。

### 5.5 マイページ

- 専用ページ経由の予約も「ご予約一覧」に出る（公式予約なので何もしなくても出る）。予約詳細に「専用特典」を出す（`perks_snapshot`）。
- **（決定 D2）マイページのトップに「あなた専用のページ」へのリンクを出す**（本人または家族が対象の専用ページがあれば。複数あれば施設名つきで並べる）。押すと `/p/<token>` へ移り、会員セッションのまま入れる。

---

## 6. 待遇の重ね方【提案】

| 待遇 | 公式サイトから予約 | 専用ページから予約 |
|---|---|---|
| 料金 | 公式料金 | **専用料金**（料金ルール） |
| 専用特典 | なし | **あり**（そのページの特典） |
| ポイント還元（グレード） | あり | **あり**（専用料金の支払額 × グレードの還元率） |
| ポイント・クーポン利用 | あり | **あり** |
| グレード別キャンセル料 | あり | **あり**（§6.3） |
| 早期決済ポイント・予約時決済割 | あり | あり（専用ページで止めることもできる） |
| マイページでの取消・変更・オプション | あり | **あり** |
| 保存カード | あり | **あり**（会員のカード） |

### 6.1 料金

- 専用料金は料金ルールで決める（公式料金から −10% など、または固定額）。
- 公式サイトにない「VIP 専用プラン」も、料金ルールで「そのプランだけ出す」ことで作れる（取引先ページと同じ）。PMS 側にプランがある前提。

### 6.2 ポイント

- 付与は **実際に払う額（専用料金）× グレードの還元率**。公式と同じ計算で、`_finalize_booking` をそのまま使う。
- 専用ページだけのボーナス（例: ポイント2倍）を付けたい場合は、専用ページの設定に `pointMultiplier` を足す（任意・後回しでよい）。

### 6.3 キャンセル料（決定 D1: 設定画面で選ぶ）

公式の適用順は「プラン規定 → グレードの規定 → standard」。専用ページごとに、管理画面で次から選ぶ（`booking_settings.cancelPolicyMode`。複数施設化の後は施設ごとの設定）:

| 値 | 表示名 | 中身 |
|---|---|---|
| `favorable`（既定） | お客さまに有利な方 | 専用ページの規定とグレードの規定（公式の適用順で決まる規定）を両方計算し、安い方 |
| `page` | 専用ページの規定 | 専用ページの規定（無ければ公式の適用順） |
| `rank` | 会員グレードの規定 | 公式と同じ（プラン規定 → グレード → standard） |

- 専用ページの規定は `booking_settings.cancelRules`（取引先と同じ形の規定。`page` / `favorable` のときだけ使う）。
- 予約時に選んだ方式と規定を予約に写す（`metadata.member_page.cancel_policy_mode` と規定の写し）。後で設定を変えても、その予約は予約時の方式で計算する。
- 計算は DB の `book.compute_cancel_fee` に分岐を足す（予約の `metadata.member_page` があるときだけ）。

---

## 7. 管理画面【提案】

- 会員詳細（`/admin/members/[id]`）に「専用ページ」欄。
  - 「専用ページを作る」→ `kind='member'` の取引先を作り、その会員を `rms_partner_members` に入れて、取引先詳細へ移る。
  - その会員が対象の専用ページの一覧。
- 取引先一覧に種別の絞り込み（取引先 / 特別会員）。
- 取引先詳細（`kind='member'`）は、法人向けの欄（請求・与信・PMS 顧客の紐づけ・アカウント・API キー・覚書）を隠し、代わりに「対象の会員」欄（会員を検索して追加・外す）を出す。
- 料金ルール・特典・プラン名・お知らせ・受付ルール・有効期間・確認モードは取引先と共通。

---

## 8. 権限・安全

- 専用ページの中身（料金・特典）は、**対象の会員でログインしているとき**だけ出す。URL だけでは見えない。
- 仮押さえの RPC は service_role。サーバで「ログイン中の会員 ∈ 対象の会員」を確かめ、RPC の中でももう一度確かめる。
- 予約の確定・取消・変更は公式予約の RPC（会員本人の authenticated クライアント）なので、既存の本人確認がそのまま効く。
- 管理画面の確認モード（`preview.ts`）は種別 `member` でも使える（見るだけ）。

---

## 9. 複数施設化との関係

- `partner-multi-facility.md` で取引先を施設横断の1行にする設計がある。VIP 会員も施設横断の存在なので、この設計の上に乗せる（1人の VIP に、男鹿・山人など施設ごとの専用料金・特典を設定し、ページの上部で施設を切り替え）。
- **（決定 D3）複数施設化を先に実装し、その後に VIP を実装する。** キャンセル方式 `cancelPolicyMode`・`cancelRules` は施設ごとの設定（`facility_settings`）に置く。

---

## 10. 決定事項（2026-10-09・ユーザー回答）

| # | 論点 | 決定 | 本文 |
|---|---|---|---|
| D1 | キャンセル方式（`cancelPolicyMode`）の分岐 | **専用ページごとに設定画面で選ぶ**（お客さまに有利な方〔既定〕／専用ページの規定／会員グレードの規定） | §6.3 |
| D2 | 入口 | **会員ログイン必須**。**マイページから専用ページへ移れる** | §5.1・§5.5 |
| D3 | 作る順番・家族 | **複数施設化を先に実装し、その後 VIP**。**PMS の家族でつながっている会員は、グレードにかかわらず同じページを使える**（家族に一人でも対象者がいれば可） | §4.2・§9 |
| D4 | 対象の範囲 | **個人指定**（グレード一括は作らない） | §4.2 |

前提の作業: 会員制度側の未実装（グレードの自動昇格・実データでのグレード手動変更）があるので、VIP の方のグレードを確実に上げておく手段（管理画面の手動変更の実データ対応）を V0 として入れる。

---

## 11. 実装の分割【提案】

| 段 | リポ | 内容 |
|---|---|---|
| V0 | autumn-book / autumn-shared | 管理画面のグレード手動変更を実データ対応（前提） |
| V1 | autumn-shared | `rms_partners.kind` に `member`、`rms_partner_members`、`rms_member_page_access`（家族の判定）、`book.create_member_page_hold`、仮押さえ・予約への `member_page_id` / `perks_snapshot`、`confirm_booking` が仮押さえの見積で確定することの確認・修正、キャンセル方式（`cancelPolicyMode`）の分岐 |
| V2 | autumn-book | 管理画面（会員詳細の「専用ページ」・取引先詳細の種別 member の表示切替・対象会員の追加） |
| V3 | autumn-book | 専用ページの入口（会員ログイン・対象者チェック）、ヘッダー・特典2段表示 |
| V4 | autumn-book | 予約（見積 → 仮押さえ → 公式の確認・確定・決済の流れへつなぐ）、要望欄への特典 |
| V5 | autumn-book | マイページ（本人・家族の専用ページへのリンク・予約詳細の特典） |
| V6 | autumn-pms | 電文の `source_detail` の表示（相談のうえ） |

## 12. アンバサダー会員（2026-10-10 追加・設計の骨子）

> ユーザー指示: 「特別会員」とは別に「アンバサダー会員」も作る。違いは **紹介実績を持つ会員**（2026-10-10 回答）。

### 12.1 位置づけ
- 種別 `rms_partners.kind = 'ambassador'`（表示名「アンバサダー会員」）。**特別会員（`member`）の仕組みをそのまま使い**、そのうえに「紹介」を足す。
  - 本人は特別会員と同じく、表の会員ログイン → 会員の公式予約（会員の待遇 ＋ 専用料金・専用特典）。
  - 追加: 本人の **紹介リンク** から他の人が予約すると、その予約を本人の紹介実績として数える。
- 特別会員と同じく、与信・月次請求・団体予約は出さない。

### 12.2 紹介の流れ（案）
1. アンバサダー会員のページ（`/p/<token>`）に「紹介リンク」を出す（例: `/r/<紹介コード>`。コードは `rms_partners` ごとに1つ・再発行可）。
2. 紹介リンクを開いた人には、公式サイトの予約画面へ紹介コードを付けて送る（Cookie に一定期間保持。期間は要確認）。
3. 紹介された人の予約（公式予約）に紹介元を残す: `book` 側の予約に `referral_partner_id`、PMS への電文では `booker` を **アンバサダー本人の顧客**（`core.guests`）にして `pms.stay_groups.booker_guest_id` に載せる（PMS の紹介実績の数え方〔docs/partner-pms-customer-link.md §3〕にそのまま乗る）。
4. 本人のページに「ご紹介の実績」（件数・泊数・期間）を出す。

### 12.3 要確認（推奨案つき）

> **2026-10-10 決定: A1〜A6 はすべて推奨どおり**（ユーザー回答）。
| # | 論点 | 推奨案 |
|---|---|---|
| A1 | 紹介された人に特典を付けるか | 付けない（MVP）。後で「紹介リンク経由の割引・特典」を足せる形にしておく |
| A2 | アンバサダー本人への還元 | MVP は実績の表示だけ。還元（ポイント付与など）は会員ポイントの仕組みに乗せる形で後から |
| A3 | 紹介された人は会員必須か | 不要（非会員の公式予約も数える）。会員登録した場合は会員にも紐づける |
| A4 | 紹介の有効期間（Cookie） | 30日。最後に開いた紹介リンクを優先 |
| A5 | 実績に数える予約 | 宿泊済み（チェックアウト済み）のみ。取消・No Show は数えない（PMS の数え方と同じ） |
| A6 | 自己紹介（本人が自分のリンクで予約） | 数えない |

### 12.4 実装順
- 特別会員（§11）を先に実装し、その上に載せる。種別の追加（`kind` の check 制約に `ambassador`）は特別会員の migration と同時に入れてよい。

---

## 13. 実装設計（2026-10-10）

> 作成: 2026-10-10（autumn-book v0.116.0・autumn-shared は `20261010053641` まで）。コード・migration は未着手。
> §3〜§10 の方針と決定（D1〜D4）はそのまま。本節は、§1〜§12 を書いた後に入った変更（取引先の複数施設化・認証強化 S1〜S8・団体予約・料金の先計算・日付未指定の最安のサーバ組み立て）に合わせて、**実装できる粒度**に落としたもの。実装するエージェントは本節と §14（契約・A が書く）だけを見ればよい。
> 事実（調査で確かめたもの）には出典を付ける。判断には【判断】を付ける。

### 13.1 今のコードと §4〜§8 のずれ・直し方

| # | §4〜§8 の前提 | 実際（2026-10-10 時点） | 直し方 |
|---|---|---|---|
| Z1 | `hooks.server.ts` の `resolvePortal` が種別を見て会員セッションを解決（§5.1） | `hooks.server.ts` は `/p/*` で `locals.user = null` に固定。`resolvePortal` は hooks ではなく `lib/server/partners/portal.ts` にあり、各ルートの load が直接呼ぶ。会員の検証済みセッションは `createSupabaseServerClient(event)` / `getSupabaseUser(event)`（`lib/server/auth.ts`）で、cookie `sb-autumn-book-auth-token`（path `/`）から取れる | **hooks は変えない**【判断】。`resolvePortal` の中で `bundle.common.kind === 'member'` のときだけ `getSupabaseUser(event)` を呼び、会員を**取引先セッションの形**（`PortalSession`）に載せる（§13.4.1）。取引先（agent/corporate/other）は今のまま会員を持ち込まない |
| Z2 | `rms_partners.kind` に `member` | check 制約は `kind in ('agent','corporate','other')`（autumn-shared `20260926025319`）。TS は `PartnerKind`・`PARTNER_KIND_LABELS`（`lib/server/partners/store.ts` 65 行）・`parsePartnerKind`（`staff-form.ts` 30 行・不明な値は `agent` に丸める） | migration で check を `('agent','corporate','other','member','ambassador')` に（`ambassador` は §12.4 のとおり制約にだけ入れる。TS の型・表示名・選択肢には入れない【判断】）。TS は `member` を足し、表示名「特別会員」。`parsePartnerKind` は `member` を通す |
| Z3 | 仮押さえと予約に `member_page_id` / `perks_snapshot` の列（§4.3） | `book.holds` に `metadata` 列は無い（列は `20260611100300` ＋ `client_key`〔`20261009210747`〕）。`confirm_booking`（最新 `20260907113300`）は `metadata` に `price_snapshot` を**丸ごと写す**（200〜204 行）。`_emit_pms_event`（`20261006075659`）の payload にも `price_snapshot` が入る | **列は足さない**【判断】。専用ページの情報は `holds.price_snapshot.member_page`（§13.3.4）に入れる。`confirm_booking` が `metadata.price_snapshot.member_page` として予約に写し、PMS の電文にも載る（V6 の `source_detail` 追加なしで PMS 側が読める）。`confirm_booking` には **`metadata.member_page` へのコピーとキャンセル規定の写し**だけ足す（§13.3.5） |
| Z4 | `confirm_booking` が仮押さえの見積で確定するか要確認（§5.3） | **確定は `holds.price_snapshot->>'total'`**（`20260907113300` 75 行）。公式料金は引き直さない。ポイント付与も `v_charge`（割引後）× `member_ranks.reward_rate` | 直さなくてよい。専用料金を `price_snapshot` に入れれば、そのまま専用料金で確定・ポイント計算される |
| Z5 | キャンセル料は `book.compute_cancel_fee` に分岐を足す（§6.3） | 適用順を実装しているのは **`book._cancel_fee(p_snapshot, p_total, p_checkin, p_as_of, p_rank_code)`**（最新 `20261006025924`）。呼び元は `compute_cancel_fee`・`_cancel_booking_core`・`guest_booking_by_token`・`_amend_compute` の4つで、どれも予約の `cancellation_policy_snapshot` を `p_snapshot` に渡す。`_cancel_fee` は `metadata` を受けない | **`_cancel_fee` 1本だけ**を直す【判断】（呼び元4つは触らない）。方式と規定は `confirm_booking` が **`cancellation_policy_snapshot` の中**に写す（§13.3.5・§13.3.6）。`compute_cancel_fee` の戻り `rules_source` に `'member_page'` が増えるので、マイページ・管理画面の表示（`sbComputeCancelFee` の `rules` 補完）で扱う |
| Z6 | 新 RPC `create_member_page_hold` は `create_hold` と同じ在庫処理（§5.3） | `create_hold` 新署名（`20261009210747`）は `booking.rate_plans.public_on_direct and is_active` と `book.plan_contents.is_published` を要求し、`book.quote` で公式料金を見積って `price_snapshot` を作る。在庫は `booking.availability` を `for update` → 全泊 −1。接続元 10 分 20 件・全体 500 件の上限。同じセッションの有効な仮押さえは解放（支払中は除く） | `create_hold` を**丸ごと写し**、見積部分を「TS が渡す明細」に差し替えた `book.create_member_page_hold` を作る（§13.3.3）。プランの条件は `public_on_direct and is_active`（下の Z7）。上限・解放・在庫ロックはそのまま写す |
| Z7 | 公式サイトにない VIP 専用プランも料金ルールで出せる（§6.1） | 公式の予約確認 `/booking/hold` はプランを `book.v_plans`（`sbPlanByUuid`）で読み、`v_plans` は **`public_on_direct` かつ `plan_contents.is_published` のプランだけ**（`20260926232136` 32〜33 行）。公式非公開のプランで仮押さえすると確認画面でプランが読めない | **今回は「公式サイトで公開しているプラン」に限る**【判断・要確認 Q1】。VIP 専用プランは「公式に公開しつつ、専用ページの料金ルールで安くする」で代替する。公式非公開プランの対応（`v_plans` の条件緩和か、確認画面がプラン無しでも動く改修）は範囲外 |
| Z8 | 管理画面のグレード手動変更を実データ対応（V0） | `routes/admin/members/[id]/+page.server.ts` の `rank` action は `ADMIN_SUPABASE` で `fail(400, '未対応')`。`rank_code` を更新する RPC は autumn-shared に無い（`book.members` の authenticated UPDATE は `is_mail_opt_in` / `push_opt_in` 列のみ） | V0: `book.admin_set_member_rank(p_member_user_id, p_rank_code, p_reason)`（§13.3.1）を作り、`rank` action から `bookAdmin(event)` で呼ぶ |
| Z9 | 専用特典を要望欄の先頭に載せる（§5.4）。取引先予約は RPC がやっている前提 | 取引先予約で特典を要望に載せているのは **TS 側**（`createPartnerBooking` が `options` に入れる）。`rms_partner_create_booking` の SQL に特典の行は無い。公式の要望欄は `p_guest.notes` → `core.stays.notes`（`confirm_booking` 93〜96 行）と電文 `stay.notes` | 公式と同じ流儀で **TS が `p_guest.notes` の先頭に「【特別会員特典】…」を付ける**（`/booking/hold` の `submit`・`/booking/pay` の `prepare`。`applyPlanAnswers` が回答を先頭に入れているのと同じ場所・§13.4.4） |
| Z10 | 会員の還元率はグレードから（§6.2） | `/booking/hold` の `REWARD_RATE` は直書き（`{standard:0.01,…,platinum:0.05}`）。DB は `member_ranks.reward_rate`。値は一致 | 今回は触らない（既存の二重定義。別件） |
| Z11 | アクセスログ（`rms_partner_access_logs`）に会員の閲覧を残す | `account_id` は `rms_partner_accounts` への FK。会員の UUID は入れられない | 会員の閲覧は `accountId: null`・`detail.member_user_id` で残す（§13.4.1 の `portalActor`）。`logPartnerAccess` の呼び元（`stay-page.ts` ほか）は `session.id` を直接渡しているので、member セッションでは `null` にする |
| Z12 | 予約受付オン＝「予約する」が出る | `isPartnerBookingOpen(partner)` は `booking_enabled` かつ支払方法が1つ以上（`booking.ts` 156 行）。`validatePartnerBookingSettings(…, bookingEnabled=true)` も支払方法を必須にする | member では支払方法を見ない: `memberPageBookingOpen(partner) = kind==='member' && booking_enabled && facility_available`（純関数・`lib/partner-member-page.ts`）。管理画面の保存の検証は `kind==='member'` のとき支払方法の必須を外す |
| Z13 | 専用ページの料金は `quotePartnerBooking` の料金部分（§5.3） | `quotePartnerBooking(db, partner, target, opts)`（`booking.ts` 302 行）は `loadPartnerRates`（先計算 `rms_partner_portal_prices` → 従来計算）で部屋コード・プランコード・プラン名から泊ごとの 1 名単価・入湯税・残室を返す。識別子は PMS の `room_types.code` と `rate_plans.code`（`plan_key`）＋プラン名で、UUID ではない | そのまま使う。仮押さえの RPC は UUID（`rate_plan_id` / `room_type_id`）を要るので、TS が `booking.rate_plans`（`facility_id` ＋ `code` ＋ `name`）・`pms.room_types`（`facility_id` ＋ `code`）で解決して渡す。RPC 側でも「そのプランがその施設のもの・`is_active`・`public_on_direct`」と「室タイプがその施設」を確かめる（§13.3.3） |
| Z14 | 複数施設化の後に実装（D3） | 複数施設化は実装済み（`rms_partner_facilities`・`PartnerContext` の合成・`?f=`／クッキーの施設切替・施設タブ・`20261009054024`）。施設ごとのキーは `facility_settings`（`PARTNER_FACILITY_SETTING_KEYS`） | 前提どおり。`cancelPolicyMode` / `cancelRules` は **`PARTNER_FACILITY_SETTING_KEYS` に足す**（施設ごと・上書きではなく施設固有） |
| Z15 | 団体予約の申し送り（partner-group-booking.md §7.10） | `groupInquiryAvailable` は `kind==='agent'` の許可リスト。member では何もしなくて出ない | §4.1 の「使わない列・機能」に `groupInquiry*`・団体予約メニュー・`/p/[token]/group/**` を加える（本節で加えたものとする） |

### 13.2 今回の実装範囲（§11 の段との対応）

**V0〜V5 を実装する。V6（autumn-pms）は範囲外**（電文に `price_snapshot.member_page` が既に載るので、PMS 側は読みたくなったときに読める）。

| 段 | 今回やること | やらないこと（後回し） |
|---|---|---|
| V0 | `book.admin_set_member_rank` ＋ 管理画面 `rank` action の実データ対応 | グレードの自動昇格 |
| V1 | 種別 `member`（check・TS）、`rms_partner_members`、`rms_member_page_access`、`rms_member_pages_for`、`create_member_page_hold`、`confirm_booking` と `_cancel_fee` の差し替え | `pointMultiplier`（§6.2）・`source_detail`（§5.4） |
| V2 | 管理画面: 取引先詳細の `kind='member'` 表示切替・対象会員の追加／削除、会員詳細の「専用ページ」欄と作成、取引先一覧の種別絞り込み、キャンセル方式の設定（施設タブ） | 家族の編集（PMS で行う・読み取り表示のみ） |
| V3 | 専用ページの入口（会員ログイン・対象者チェック・家族）、ヘッダー（会員名・グレード・ポイント）、特典の2段表示、member で隠すメニュー・ルートの 404 | 専用ページ独自のデザイン |
| V4 | 予約: `/p/[token]/book`（member 版）→ `create_member_page_hold` → 公式 `/booking/hold`〜確定・決済。確認画面の専用特典表示・要望欄の先頭・戻り先 | 複数室（1予約 1室・Q2）、取引先の「予約一覧」メニュー（マイページで見る） |
| V5 | マイページトップの「あなた専用のページ」リンク（本人・家族）、予約詳細の専用特典・キャンセル規定（`member_page`）表示 | — |

### 13.3 DB（autumn-shared・1 ファイル・`bash ~/.claude/new-migration.sh autumn-shared book_member_page`）

> 置き場所: §4.2 の注のとおり、`rms_partner_*` と同じ並びの `public` と、仮押さえ・確定・キャンセル料の `book`。1 ファイルにまとめる（既存関数の差し替えは「最新定義を丸ごと写して差分だけ足す」）。

#### 13.3.1 V0 `book.admin_set_member_rank`

```sql
create or replace function book.admin_set_member_rank(p_member_user_id uuid, p_rank_code text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid := book._admin_tenant(); v_old text;
begin
  perform book._require_admin(v_tenant);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  if not exists (select 1 from book.member_ranks where code = p_rank_code) then raise exception 'bad_rank'; end if;
  select rank_code into v_old from book.members where user_id = p_member_user_id for update;
  if not found then raise exception 'member_not_found'; end if;
  update book.members set rank_code = p_rank_code, updated_at = now() where user_id = p_member_user_id;
  insert into book.admin_audit_logs (tenant_id, actor, action, detail)
  values (v_tenant, auth.uid()::text, 'change_rank',
          jsonb_build_object('member_user_id', p_member_user_id, 'from', v_old, 'to', p_rank_code, 'reason', p_reason));
  return jsonb_build_object('member_user_id', p_member_user_id, 'from', v_old, 'to', p_rank_code);
end $$;
revoke all on function book.admin_set_member_rank(uuid, text, text) from public, anon;
grant execute on function book.admin_set_member_rank(uuid, text, text) to authenticated, service_role;
```

- 作法は `20260907061853_book_admin_app_ops.sql`（`_admin_tenant` / `_require_admin` / `admin_audit_logs` の列 `tenant_id, actor, action, detail`）に合わせる。`actor` と `detail` の型はそのファイルの insert を見て揃える。

#### 13.3.2 種別・対象会員・家族の判定・マイページ用一覧

```sql
alter table public.rms_partners drop constraint if exists rms_partners_kind_check;
alter table public.rms_partners add constraint rms_partners_kind_check
  check (kind in ('agent','corporate','other','member','ambassador'));
-- ↑ 制約名は \d で実名を確かめてから（20260926025319 の create table の無名 check）

create table public.rms_partner_members (
  partner_id uuid not null references public.rms_partners(id) on delete cascade,
  member_user_id uuid not null references book.members(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,                       -- スタッフ（auth.users）。null 可
  primary key (partner_id, member_user_id)
);
create index on public.rms_partner_members (member_user_id);
alter table public.rms_partner_members enable row level security;  -- ポリシー無し＝service_role のみ（rms_partner_* と同じ）

-- 本人か家族（pms.guest_families.family_group_id）が対象者なら true。入口と仮押さえの両方で使う
create or replace function public.rms_member_page_access(p_partner_id uuid, p_member_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rms_partner_members where partner_id = p_partner_id and member_user_id = p_member_user_id)
      or exists (
        select 1
        from book.members me
        join pms.guest_families gf_me on gf_me.guest_id = me.guest_id
        join pms.guest_families gf on gf.family_group_id = gf_me.family_group_id
        join book.members fam on fam.guest_id = gf.guest_id
        join public.rms_partner_members pm on pm.partner_id = p_partner_id and pm.member_user_id = fam.user_id
        where me.user_id = p_member_user_id and me.guest_id is not null and me.withdrawn_at is null)
$$;

-- 会員（本人・家族）が使える専用ページ。マイページのリンク用。公開中（is_active・有効期間内）のものだけ
create or replace function public.rms_member_pages_for(p_member_user_id uuid)
returns table (partner_id uuid, name text, url_token text, via text /* 'self' | 'family' */, facility_names text[])
language sql stable security definer set search_path = '' as $$ … $$;

-- 対象会員の一覧（管理画面の「対象の会員」欄＋家族として使える会員の読み取り表示）
create or replace function public.rms_partner_member_list(p_partner_id uuid)
returns table (member_user_id uuid, member_code text, name text, email text, rank_code text, via text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$ … $$;

revoke all on function public.rms_member_page_access(uuid, uuid), public.rms_member_pages_for(uuid), public.rms_partner_member_list(uuid)
  from public, anon, authenticated;
grant execute on … to service_role;
```

- 家族の判定は `book.members.guest_id` → `pms.guest_families`（列は `guest_id`・`family_group_id`・`20260610090300`）。退会（`withdrawn_at`）した会員は除く。**グレードは見ない**（D3）。
- `rms_partner_members` への追加・削除は service_role の直接 `insert` / `delete`（Book のサーバ・管理者のみ）。`kind='member'` 以外の取引先には入れない（TS で拒否。DB にトリガーは置かない【判断】）。

#### 13.3.3 `book.create_member_page_hold`（service_role 専用）

`book.create_hold` 新署名（`20261009210747`）を丸ごと写し、次を差し替える。

```sql
create or replace function book.create_member_page_hold(
  p_session_id text,         -- cookie ab_book_sid（公式と同じ・path /）
  p_member_user_id uuid,     -- ログイン中の会員（本人または家族）
  p_partner_id uuid,         -- 専用ページ（rms_partners.kind='member'）
  p_facility_id uuid,        -- 選んでいる施設（core.facilities）
  p_rate_plan_id uuid, p_room_type_id uuid, p_checkin date, p_nights integer, p_adults integer,
  p_lines jsonb,             -- [{date, unit_price, adults, subtotal}] 専用料金（TS が quotePartnerBooking から作る）
  p_member_page jsonb,       -- §13.3.4 の形（特典の写し・キャンセル方式・規定・表示名）
  p_client_key text, p_locale text default 'ja'
) returns jsonb
```

差分:
1. **対象者の検査**: `if not public.rms_member_page_access(p_partner_id, p_member_user_id) then raise exception 'forbidden'; end if;`。取引先が `kind='member'`・`is_active`・有効期間内・施設が `rms_partner_facilities` で `enabled and booking_enabled` であることも確かめる（`'page_unavailable'`）。
2. **プランの検査**: `public_on_direct and is_active` と `plan_contents.is_published` は**残す**（Z7）。加えて `rate_plans.facility_id = p_facility_id`、`room_types.facility_id = p_facility_id`（室タイプの表は `create_hold` と同じもの）。
3. **見積**: `book.quote(...)` を呼ばず、`p_lines` を検証して `v_quote` を組む。検証: 配列長 = `p_nights`・日付が `p_checkin` から連続・`unit_price` は 0 より大きい整数・`adults = p_adults`・`subtotal = unit_price * adults`。`total = Σ subtotal`・`per_person`・`tax_included` は `book.quote` と同じ式。**料金の正しさ（専用料金かどうか）は TS が責任を持つ**（RPC は形だけ見る）【判断・取引先予約の `rms_partner_create_booking` と同じ流儀】。
4. **保存**: `price_snapshot := v_quote || jsonb_build_object('locale', p_locale, 'member_page', p_member_page || jsonb_build_object('partner_id', p_partner_id, 'facility_id', p_facility_id, 'member_user_id', p_member_user_id))`。`member_user_id` 列にも `p_member_user_id`。
5. 上限（`rate_limited` / `too_many_holds`）・同じセッションの解放・`booking.availability` のロックと −1・`expires_at`・戻り `{hold_id, expires_at, quote}` はそのまま。
6. `revoke all … from public, anon, authenticated; grant execute … to service_role;`。

#### 13.3.4 `price_snapshot.member_page` の形（A→B・PMS 共通の契約）

```jsonc
{
  "partner_id": "…", "facility_id": "…", "member_user_id": "…",
  "page_name": "山田様 専用ページ",          // rms_partners.name
  "perks": [{ "id": "…", "title": "スパークリングワイン（ハーフ）", "description": "…" }],  // そのプランに付く特典の写し（imageUrl は入れない）
  "plan_display_name": "…" | null,          // planNames の上書き（表示用）
  "cancel_policy_mode": "favorable" | "page" | "rank",
  "cancel_rules": [{ "days_before": 7, "rate": 0.3 }] | null   // 専用ページの規定（page / favorable のとき）。rank_cancel_policies.rules と同じ形
}
```

- `cancel_rules` の形は `book.rank_cancel_policies.rules`（`[{days_before, rate}]`・`rate` は 0〜1）に揃える。取引先の `PlanTerms`（`rate_percent` / `days_before`）とは別物なので、TS で変換する（`lib/partner-member-page.ts` の `toCancelRules`）。

#### 13.3.5 `book.confirm_booking` の差し替え（`20260907113300` を丸ごと写す）

足すのは次の 2 点だけ。`auth.uid()` による会員判定・ポイント・クーポン・電文はそのまま。

```sql
declare v_mp jsonb := v_hold.price_snapshot->'member_page'; v_policy jsonb;
…
  -- キャンセル規定の写し（§6.3）: 専用ページ経由なら方式と規定を snapshot の中に残す（_cancel_fee が読む・§13.3.6）
  v_policy := v_plan.cancellation_policy;      -- 既存（rate_plans.cancellation_policy）
  if v_mp is not null then
    v_policy := case v_mp->>'cancel_policy_mode'
      when 'page' then case when jsonb_typeof(v_mp->'cancel_rules') = 'array' and jsonb_array_length(v_mp->'cancel_rules') > 0
                            then jsonb_build_object('rules', v_mp->'cancel_rules', 'source', 'member_page')
                            else coalesce(v_policy, '{}'::jsonb) end
      when 'favorable' then coalesce(v_policy, '{}'::jsonb) || jsonb_build_object('member_page',
                            jsonb_build_object('mode', 'favorable', 'rules', coalesce(v_mp->'cancel_rules', '[]'::jsonb)))
      else coalesce(v_policy, '{}'::jsonb) end;   -- 'rank' = 公式と同じ
  end if;
  …  cancellation_policy_snapshot = v_policy …
  -- metadata: 既存の jsonb_build_object(...) に 'member_page', v_mp を足す（null なら jsonb の null が入るので strip_nulls か case で省く）
```

- `v_plan.cancellation_policy` が `jsonb` の配列形（`_cancel_fee` は配列も受ける）のとき `||` で壊れないよう、配列なら `jsonb_build_object('rules', v_policy)` に正規化してから足す。
- 会員の判定は `auth.uid()` のまま。専用ページの確定は**公式と同じく会員の authenticated クライアント**で呼ぶ（§13.4.4）ので、`v_hold.member_user_id = auth.uid()` が成り立つ。service_role から呼ぶ経路（カード決済の `direct_payment_confirm`）は `set_config('request.jwt.claim.sub', …)` で会員を差し替えており、そこも変更不要。
- `yamado-one` も `confirm_booking` を呼ぶ（メモリ参照）。本差し替えは `member_page` が無い仮押さえでは何も変えないので互換。

#### 13.3.6 `book._cancel_fee` の差し替え（`20261006025924` を丸ごと写す）

```sql
  -- 専用ページ「お客さまに有利な方」（favorable）: 公式の適用順で出した率と、専用ページの規定の率の安い方
  v_mp := p_snapshot->'member_page';
  … 既存の v_rules / v_source / v_rate の決定（p_snapshot から member_page を除いたもので行う）…
  if v_mp->>'mode' = 'favorable' and jsonb_typeof(v_mp->'rules') = 'array' and jsonb_array_length(v_mp->'rules') > 0 then
    select (r->>'rate')::numeric into v_page_rate from jsonb_array_elements(v_mp->'rules') r
     where (p_checkin - p_as_of) <= (r->>'days_before')::integer order by (r->>'days_before')::integer asc limit 1;
    if coalesce(v_page_rate, 0) < coalesce(v_rate, 0) then v_rate := coalesce(v_page_rate, 0); v_source := 'member_page'; end if;
  end if;
  -- 'page' は snapshot.rules に規定が入っているので既存の 'plan' 経路で計算される。source の表示用に snapshot.source='member_page' なら v_source := 'member_page'
```

- 戻り `rules_source` に `'member_page'` が増える。呼び元 4 関数は変更不要（値を透過）。
- No Show の率は `rules` の `days_before` 最小の段（既存の規則）に従う。専用ページの規定に不泊の段が無ければ公式側の率で比べる（favorable）。

#### 13.3.7 やらないこと（DB）
- `rms_partners` の列追加・`booking_settings` の DB 側合成関数（`_rms_partner_effective_settings`）の変更。`cancelPolicyMode` / `cancelRules` は `facility_settings`（jsonb）のキーなので DDL 不要。
- `_emit_pms_event` の変更（`price_snapshot.member_page` が既に載る）。

### 13.4 サーバ・画面

#### 13.4.1 入口（`/p/[token]`・`kind='member'`）

- `resolvePortal`（`portal.ts`）: `bundle.common.kind === 'member'` のとき、取引先セッション（`rms_partner_session`）は**見ない**。`getSupabaseUser(event)` で会員を取り、`locals.user` 相当の判定（`resolveSupabaseSessionUser` と同じ `user_metadata.member` / `book.my_profile`）で会員なら `rms_member_page_access(partner.id, user.id)` を service_role で呼ぶ。
  - 対象なら `session = { id: MEMBER_PORTAL_ACCOUNT_ID /* nil UUID。DB には書かない */, login_id: member.memberCode, display_name: member.name, is_master: false, sessionId: '', member: { userId, name, rankCode, guestId, balance, via: 'self'|'family' } }`。
  - 会員だが対象外 → `session = null`・`memberState = 'denied'`。未ログイン → `session = null`・`memberState = 'anonymous'`。
  - 確認モード（`rms_partner_preview`）は従来どおり（会員なしで見られる・書き込み不可）。
  - `PortalSession` 型に `member?: PortalMember` を足す。`portalHeader` に `member`（名前・グレード・ポイント）と `kind`（`'partner' | 'member'` の 2 値。`kind` そのものは出さない流儀を守る）を足す。
  - キャッシュ（`bundleCache` 30 秒）は GET のみ・従来どおり。**会員の対象判定は毎回 DB**（取引先セッションと同じ扱い）。
- `requirePortalSession` / `requirePortalApi`: member で `session` が無ければ、`memberState` に応じて `/p/<token>`（案内画面）へ 303。MFA の関所（`portalNeedsMfa`）は member では常に false（会員は Supabase Auth 側の本人確認）。
- `/p/[token]/+page.server.ts`（トップ）: member なら取引先のログインフォームを出さず、(a) 未ログイン → 「会員ログイン」ボタン（`/auth/login?next=/p/<token>/calendar`。`safe-next.ts` は同一サイトの相対パスなので通る）、(b) 対象外 → 「このページはご招待の会員さま専用です」（会員名とログアウトのリンク）、(c) 対象 → `/calendar` へ 303。
- **member で 404 にするルート**（`requireMemberPortalAbsent()` を各 load/POST の先頭に・団体予約の `requireGroupInquiry` と同じ流儀）: `bookings/**`・`group/**`・`memorandum`・`account/**`・`mfa`・`passkey/**`・`setup`・`payment/**`・`stay/**`・`legal`（公式の `/legal/*` へリンク）・`book/attachments/**`・`book/reserve`・`logout`（公式の `/auth/logout` を使う）。残すもの: `calendar/**`・`rooms`・`plans`・`rate-sheet/**`・`facility`（施設切替）・`book`（member 版）・`book/quote`。
- `portalActor(session)`: アクセスログ用 `{ accountId: session.member ? null : session.id, detail: session.member ? { member_user_id } : {} }`。`stay-page.ts` ほか `logPartnerAccess` を呼ぶ箇所はこれを通す（Z11）。
- `hooks.server.ts`・`maintenance.ts` は変更なし。

#### 13.4.2 表示（V3）

- ヘッダー（`routes/p/[token]/+layout.svelte`）: `portal.member` があれば「{施設名}」の下に「{会員名} 様 専用ページ」・グレードのバッジ・保有ポイント。メニューは `MENU` を `portal.kind === 'member'` で絞る（料金カレンダー・お部屋・プラン・料金表のみ。「マイページへ」リンクを右端に）。
- 料金・残室・写真・プラン詳細・最安（`loadStayPage` / `loadPortalReference` / 月 JSON）は**取引先と同じ読み出し**。料金ルールは `rms_partner_facilities.pricing`（RMS で編集・先計算）。member の料金ルールも RMS の `/partner-rates/<id>` で編集する（管理画面に同じリンクが出る）。
- 特典の 2 段（`PartnerStaySearch` のカード・`PartnerPlanDetailModal`・`/book`）: 1 段目「{会員名}様専用特典」= `perks`（従来の `PartnerPerkList`）。2 段目「会員特典（{GRADE}）」= `lib/partner-member-page.ts` の `memberBenefitLines(rankCode, rewardRate, cancelMode)`（還元率・キャンセル方式の説明文・ポイント利用可）。還元率は `book.member_ranks` を service_role で読む（`REWARD_RATE` 直書きは増やさない）。

#### 13.4.3 予約の流れ（V4）

1. 料金カレンダーの「予約へ進む」→ `/p/<token>/book?room&plan&name&date&guests&nights&rooms=1(&f=)`（既存の `bookHref`。member は室数 1 に固定・Q2）。
2. **`/p/[token]/book`（member 版 load）**: `requirePortalSession` → `quotePartnerBooking(db, partner, target)`（取引先と同じ）→ 表示は「ご予約内容の確認（専用料金・専用特典・会員特典・獲得予定ポイントの目安）」と「予約へ進む」ボタンだけ。宿泊者・支払・ポイント利用の入力は**公式の確認画面に任せる**（§5.2 の「公式サイトの予約入力と同じ項目」はこれで満たす）。確認モードはボタンを止める。
3. **action `?/hold`（member 版）**: `requirePortalSession`（POST は毎回 DB）→ 受付締切 `canBookFor(checkIn, booking_settings)` → `quotePartnerBooking` でサーバ側が見積り直す → UUID 解決（Z13）→ `holdRateCheck`（KV `hold:<ip>`・公式と同じ）→ `createMemberPageHold(...)`（service_role・`.schema('book')`）→ 成功なら `/booking/hold?id=<hold_id>` へ 303。`HOLD_NAV_COOKIE`（`lib/booking-nav.ts`）に `{ id, back: '/p/<token>/calendar?…', via: 'member_page' }` を書く。失敗: `sold_out` 409・`rate_limited`/`too_many_holds` 429・`forbidden` 403（文言は公式に揃える）。Turnstile は付けない（会員ログイン済み・Q4）。
4. **公式 `/booking/hold`**（既存・小改修）: `hold.quote` に `member_page` が載っていれば、(a) 見出しに「{page_name} 経由・専用料金」、(b) 右欄に専用特典（`perks`）、(c) キャンセル規定の説明に方式（`cancel_policy_mode`）、(d) 「プラン・お部屋を選び直す」の戻り先を `nav.back`（専用ページ）に、(e) `submit` / `pay prepare` で `guest.notes` の先頭に `【特別会員特典】title／title` を付ける（`applyPlanAnswers` の直後・`lib/partner-member-page.ts` の `perkNotesLine`）。それ以外（宿泊者入力・ポイント利用・支払方法・保存カード・Stripe・完了画面）は**変更なし**。
   - `SbHold.quote` の `mapQuote` は `member_page` を落とすので、`sbGetHoldMapped` の戻りに `memberPage?: MemberPageSnapshot` を足す。
5. 確定: 公式のまま（会員 = `createSupabaseServerClient(event)` で `confirm_booking`、カードは `direct_payment_prepare/confirm`）。`price_snapshot.member_page` → `metadata.member_page` と `cancellation_policy_snapshot` に写る（§13.3.5）。
6. 電文: 公式と同じ `_emit_pms_event`。`stay.notes` の先頭に特典、`price_snapshot.member_page` が payload に入る。

#### 13.4.4 マイページ（V5）

- トップ（`account/+page.server.ts`）: `listMemberPagesFor(userId)`（service_role・`rms_member_pages_for`）→ `{ name, href: '/p/<token>/calendar', facilityNames, via }[]` を `memberPages` で返す。0 件なら欄を出さない。admin-client.ts の冒頭コメントに「例外その7（マイページの専用ページ一覧・`rms_member_pages_for`）」を追記。
- 予約詳細（`account/reservations/[code]`）: `MemberReservation` に `memberPage?: MemberPageSnapshot`（`metadata.member_page`）を足す（`sbMyReservations` の読み出し列を確認・無ければ `metadata` を返す RPC の列を足す）。表示: 専用特典・「キャンセル規定: 専用ページの規定／お客さまに有利な方／会員グレードの規定」。`sbComputeCancelFee` の `rules_source='member_page'` のときは `cancellation_policy_snapshot.rules`（page）または `member_page.rules`（favorable）を表に出す。

#### 13.4.5 管理画面（V2）

- 取引先一覧 `/admin/partners`: 種別の絞り込み（すべて／取引先〔agent・corporate・other〕／特別会員）。既定は「取引先」【判断・会員が増えると一覧が埋まるため】。新規作成の `kind` の選択肢に「特別会員」を**出さない**（作成は会員詳細から・下）。
- 取引先詳細 `/admin/partners/[id]`（`kind==='member'`）:
  - 隠す: PMS の顧客マスタとの紐づけ・与信・デポジット・支払方法と請求条件・毎回聞く項目（`options`）・団体予約・予約一覧（取引先予約の一覧。会員の公式予約は予約管理で見る）・ご請求書・ログインID・REST API・お支払いカード・覚書・第2要素の方針・アクセスログ（会員の閲覧ログは出してよい→残す）。
  - 出す: 限定URL（再発行・確認ページを開く）・共通の設定（名前・公開設定・有効期間・備考）・施設タブ（販売・予約受付・何日先・残室・並び順・特別レートの要約と RMS リンク・プラン名・特典・案内文・通知先）・プレビュー・**対象の会員**（新設）・**キャンセル規定**（新設・施設タブ）。
  - 対象の会員: 検索（`adminFindMembers`・会員番号／メール／電話）→ 追加（`?/addMember`・service_role で `rms_partner_members` insert・`created_by`）／外す（`?/removeMember`）。下に「家族として使える会員」（`rms_partner_member_list` の `via='family'`・読み取り・「家族の編集は PMS で」）。admin のみ（`staffPartnerScope('edit')`）。
  - キャンセル規定（施設タブ・`cancelPolicyMode` / `cancelRules`）: ラジオ 3 択（既定 favorable）＋ `page`/`favorable` のとき規定の表（日数前・率 %・不泊）。`cancelRules` は `[{days_before, rate}]` で保存。既存の施設タブの保存 `?/saveFacility`（`parsePartnerFacilityForm`）に載せる。
  - `validatePartnerBookingSettings` の支払方法必須は `kind==='member'` で外す（Z12）。
- 会員詳細 `/admin/members/[id]`: 「専用ページ」欄。この会員が対象の専用ページ（本人・家族）の一覧（取引先詳細へのリンク・公開状態・施設）と「専用ページを作る」（admin）。作成 `?/createMemberPage`: `createPartner(db, scope, { name: '{会員名}様 専用ページ', kind: 'member', is_active: false, booking_enabled: false, … })` → `rms_partner_members` に insert → `/admin/partners/<id>` へ 303。`createPartner` は `facilityId` を要るので `ab_fac` の施設で作る（他施設は施設タブでオン）。グレードの手動変更（V0）は同じページの `rank` action。
- 予約管理 `/admin/reservations/[code]`: `metadata.member_page` があれば「特別会員の専用ページ経由（{page_name}）」と特典を 1 行（小さく・任意）。

#### 13.4.6 member で使わない列・機能（§4.1 への追記）

`payment_method_id`・`pms_guest_id`・`booking_name_mode`・`credit_over_action`・`memorandum*`・`stripe_customer_*`・`mfa_policy`・`booking_settings` の `paymentOptions` / `customPaymentOptions` / `invoice*` / `prepayDiscount` / `creditDeposit*` / `notifyPartner` / `options` / `groupInquiry*`・取引先アカウント（`rms_partner_accounts` / `sessions` / `passkeys` / `mfa_challenges`）・API キー・団体予約・添付ファイル・覚書・請求書・保存カード（取引先の）。`notifyEmails`（宿側の通知先）は公式予約のメールの仕組みがあるので使わない。

### 13.5 権限・安全

- **URL だけでは何も見えない**: `kind='member'` の `resolvePortal` は会員セッションが無い・対象外なら `session=null`。料金・特典・プラン名・お知らせを含む load はすべて `requirePortalSession` の後ろ（トップの案内画面は施設名と「会員ログイン」だけ）。月 JSON（`/calendar/month`）・`book/quote` も同じ関所。
- **対象者の二重検査**: TS（`resolvePortal` の `rms_member_page_access`）と RPC（`create_member_page_hold` の中）の両方。家族判定も同じ SQL 関数 1 本。
- **仮押さえの本人確認**: `holds.session_id = ab_book_sid`（path `/`・公式と共有）かつ `member_user_id = ログイン中の会員`。確定・取消・変更は公式の RPC（authenticated・`auth.uid()`）なので既存の本人確認がそのまま効く。
- **料金の正しさ**: RPC は TS が渡す明細の形だけ検査する（取引先予約と同じ）。TS は画面の値を信用せず、`?/hold` でサーバが `quotePartnerBooking` を呼び直して明細を作る（画面から金額を受け取らない）。
- **service_role の使いどころ**: 仮押さえ（既存の例外その6と同じ）・`rms_partner_members` / `rms_member_page_access` / `rms_member_pages_for` / `rms_partner_member_list`（取引先モジュール内）・`member_ranks` の読み取り。確定・ポイント・取消は service_role を使わない。
- **確認モード**（管理画面の「確認ページを開く」）: member でも従来どおり署名付きクッキーで見られる。会員名の代わりに「管理者の確認」と出し、「予約へ進む」は止める（`denyPreviewWrite`）。
- **会員のログアウト・退会**: 公式の `/auth/logout`。退会（`withdrawn_at`）した会員は `rms_member_page_access` が false。
- **レート制限**: `?/hold` は公式と同じ KV `hold:<ip>` ＋ DB の `rate_limited`。Turnstile は付けない（Q4）。
- **情報の持ち出し**: 専用ページの応答ヘッダは `PORTAL_HEADERS`（no-store・same-origin・noindex）のまま。会員の氏名・ポイントはヘッダーにだけ出す。

### 13.6 2 エージェントの分担と契約（団体予約と同じ流儀: A が先に終わり、§14 を書いてから B が作る）

| 担当 | ファイル |
|---|---|
| **A: DB／サーバ** | autumn-shared の migration 1 本（§13.3）、`lib/partner-member-page.ts`（純関数＋テスト: `isMemberPage(kind)`・`memberPageBookingOpen`・`toCancelRules`／`fromCancelRules`・`memberBenefitLines`・`perkNotesLine`・`MemberPageSnapshot` 型・`CANCEL_POLICY_MODES`／`LABELS`）、`lib/partner-booking.ts`（`cancelPolicyMode` / `cancelRules` を `PartnerBookingSettings` と `PARTNER_FACILITY_SETTING_KEYS` に・`validatePartnerBookingSettings` の member 分岐）、`lib/server/partners/store.ts`（`PartnerKind` に `member`・`PARTNER_KIND_LABELS`・`PortalSession.member`・`rms_partner_members` の読み書き `listPartnerMembers` / `addPartnerMember` / `removePartnerMember`・`memberPagesFor`）、`lib/server/partners/portal.ts`（`resolvePortal` の member 分岐・`portalHeader.member`・`requireMemberPortalAbsent`・`portalActor`）、`lib/server/partners/member-hold.ts`（新規: UUID 解決・`createMemberPageHold`）、`lib/server/partners/staff-form.ts`（`parsePartnerKind`・キャンセル規定のフォーム）、`lib/server/supabase-data.ts`（`sbGetHoldMapped` に `memberPage`・`sbMyReservations` の `memberPage`）、`lib/server/admin-app-data.ts`（`adminSetMemberRank`）、`lib/server/admin-client.ts`（コメント追記）、各 `+page.server.ts` / `+server.ts` の load・actions（`routes/p/[token]/**`・`routes/(public)/booking/hold`・`pay`・`account`・`routes/admin/partners/**`・`routes/admin/members/[id]`）、member で 404 にするルートの先頭 1 行 |
| **B: 画面** | `routes/p/[token]/+layout.svelte`（会員ヘッダー・メニューの絞り込み）、`routes/p/[token]/+page.svelte`（member の案内画面）、`routes/p/[token]/book/+page.svelte`（member 版の確認画面。既存の取引先版は `data.portal.kind` で分岐するか、`MemberBookConfirm.svelte` を切り出して差し込む）、`lib/components/PartnerStaySearch.svelte`・`PartnerPlanDetailModal.svelte`（特典の 2 段目・室数 1 固定）、`lib/components/MemberBenefitList.svelte`（新規）、`routes/(public)/booking/hold/+page.svelte`（専用特典・方式・戻り先）、`routes/(public)/account/+page.svelte`（専用ページのリンク）、`account/reservations/[code]/+page.svelte`（特典・規定）、`routes/admin/partners/+page.svelte`（絞り込み）、`routes/admin/partners/[id]/+page.svelte`（member の表示切替・対象の会員・キャンセル規定の欄。部品 `admin/PartnerMemberList.svelte`・`admin/PartnerCancelPolicyForm.svelte` に切り出す）、`routes/admin/members/[id]/+page.svelte`（専用ページ欄・グレード変更の実データ対応の文言） |

**A → B の契約（A が §14 に正式版を書く。ここは骨子）**

- `data.portal`（全 `/p/[token]` ページ）: 既存 ＋ `kind: 'partner' | 'member'`、`member: { name, rankCode, rankLabel, rewardRate, balance, via: 'self'|'family' } | null`、`memberState: 'ok' | 'anonymous' | 'denied' | null`（トップだけ）、`mypageHref: '/account'`。
- `loadStayPage` の返り値に `memberBenefits: string[]`（2 段目の行・member のときだけ）、`fixedRooms: 1 | null`。
- `/p/[token]/book`（member）load: `{ portal, target, quote: BookingQuote, perks, memberBenefits, earnEstimate: number, cancelMode: { mode, label, rules|null }, canBook, deadlineText, back }`。action `?/hold`: 成功は 303 `/booking/hold?id=`。失敗 `fail(status, { message, code: 'sold_out'|'rate_limited'|'too_many_holds'|'forbidden'|'closed' })`。
- `/booking/hold` load: 既存 ＋ `memberPage: { pageName, perks: {title, description}[], cancelMode, backHref } | null`。
- `/account` load: 既存 ＋ `memberPages: { name, href, facilityNames: string[], via }[]`。
- `/account/reservations/[code]` load: 既存 ＋ `memberPage: MemberPageSnapshot | null`、`cancelRulesSource: 'plan'|'rank'|'member_page'`。
- 管理画面 `/admin/partners/[id]`: 既存 ＋ `isMemberPage: boolean`、`members: Promise<{ member_user_id, member_code, name, email, rank_code, via, created_at }[]>`、`facility.cancelPolicy: { mode, rules }`。actions `?/addMember`（`member_user_id`）・`?/removeMember`（`member_user_id`）・`?/searchMembers`（`q` → `{ candidates }`）。
- `/admin/members/[id]`: 既存 ＋ `memberPages: { partnerId, name, isActive, facilityNames, via }[]`、`canCreateMemberPage`。actions `?/createMemberPage`（303 取引先詳細）・`rank`（実データ対応・`{ rankChanged: true }` / `fail(400, { message })`）。
- 純関数 `lib/partner-member-page.ts` の名前は上の A の欄のとおり。

**順序**: A が migration を main に push → `supabase db push --linked` → `migration list --linked` で両側に version があることと、`information_schema` で表・関数の実体を確認 → TS を実装 → §14 を書く → B が着手。親がレビュー・結合・バージョン（MINOR）・HANDOFF.md の転記。

### 13.7 テストチェックリスト（HANDOFF.md へ転記する元）

#### DB
- [ ] `rms_partners.kind` に `member` を入れられる。`ambassador` も制約は通るが管理画面の選択肢には無い
- [ ] `rms_member_page_access`: 対象者 true／PMS の家族（同じ `family_group_id`）の会員 true／無関係 false／退会者 false。グレードは関係しない
- [ ] `create_member_page_hold`: 対象外の会員は `forbidden`、公開停止・施設オフ・予約受付オフは `page_unavailable`、公式非公開のプランは拒否、泊数と明細の長さが合わないと拒否。同じ IP 10 分 21 件目は `rate_limited`。在庫が無い日は `sold_out`
- [ ] `confirm_booking`: 専用ページの仮押さえで確定すると `metadata.member_page` と `metadata.price_snapshot.member_page` が入り、`total_amount` が専用料金。`cancellation_policy_snapshot` が方式どおり（page＝専用規定・favorable＝プラン規定＋`member_page`・rank＝プラン規定のまま）。公式の仮押さえ（`member_page` なし）は従来どおり
- [ ] `_cancel_fee`: favorable で専用規定の方が安い日は `rules_source='member_page'`、公式が安い日は従来どおり。page は専用規定で計算。rank は従来どおり。`compute_cancel_fee`・マイページの取消・非会員トークンの取消・日程変更で結果が同じ
- [ ] `admin_set_member_rank`: admin で変わり `admin_audit_logs` に `change_rank`。staff は `forbidden`。理由なしは `reason_required`

#### 専用ページ（本番ドメインまたは localhost・会員 2 名〔対象者・家族〕と無関係の会員 1 名）
- [ ] 未ログインで `/p/<token>` → 施設名と「会員ログイン」だけ。料金・特典・プラン名は出ない。`/calendar`・`/calendar/month`・`/book/quote` も料金を返さない
- [ ] 公式サイトでログイン済みの対象会員が開く → そのまま `/calendar`。ヘッダーに「{会員名} 様 専用ページ」・グレード・ポイント
- [ ] 無関係の会員 → 「ご招待の会員さま専用です」。URL を知っていても料金が見えない
- [ ] 家族（PMS で同じ家族・グレードは standard）が開ける。予約すると家族本人の名前・グレードで公式予約になる
- [ ] メニューは 料金カレンダー・お部屋・プラン・料金表 だけ。`/bookings`・`/group`・`/memorandum`・`/account`・`/mfa`・`/payment`・`/legal`・`/book/reserve` は 404
- [ ] 料金が取引先と同じ仕組み（RMS の特別レート・先計算）で出る。RMS で料金ルールを変えると反映される
- [ ] 特典が 2 段（専用特典／会員特典〔還元率・キャンセル方式〕）で出る。プラン指定の特典はそのプランにだけ
- [ ] 2 施設オンの専用ページで施設を切り替えると料金・特典・キャンセル方式がその施設のもの
- [ ] 「予約へ進む」→ 専用料金・特典・獲得予定ポイントの確認 → 公式の `/booking/hold` に移り、金額が専用料金・右欄に専用特典・「選び直す」が専用ページへ戻る
- [ ] 現地払いで確定 → マイページの予約一覧に出る。PMS の予約詳細の要望欄の先頭に「【特別会員特典】…」。ポイント付与が専用料金 × グレードの率
- [ ] 予約時決済（カード・保存カード）で確定できる。早期決済割・ポイントが公式と同じに付く
- [ ] ポイント利用・会員のキャンセル（マイページ）が従来どおり。キャンセル料が設定した方式で計算される（favorable の日・page の日を 1 件ずつ）
- [ ] 受付締切（leadDays）を過ぎた日は「予約へ進む」が出ない。室数は 1 に固定
- [ ] 確認モード（管理画面の「確認ページを開く」）で会員なしに見られ、「予約へ進む」は止まる
- [ ] 同じ IP で 10 分に 21 回目の仮押さえは 429
- [ ] 取引先（agent/corporate）の `/p/<token>` が従来どおり（会員でログインしていても会員名が出ない・取引先ログインが必要）

#### マイページ
- [ ] トップに「あなた専用のページ」（本人・家族の分。施設名つき）。対象でない会員には出ない。押すとログイン状態のまま専用ページへ
- [ ] 予約詳細に専用特典とキャンセル方式。キャンセル料のプレビューが方式どおり

#### 管理画面
- [ ] 会員詳細の「専用ページを作る」→ `kind='member'`・公開停止・予約受付オフで作られ、その会員が対象に入り、取引先詳細へ移る。staff には出ない
- [ ] 会員詳細でグレードを変更できる（admin・理由必須・監査ログ）。staff は不可
- [ ] 取引先詳細（member）: 請求・与信・PMS 紐づけ・ログインID・API・覚書・団体予約・支払方法・請求書が出ない。対象の会員・キャンセル規定・限定URL・施設タブ・プレビューが出る。支払方法なしで予約受付をオンにできる
- [ ] 対象の会員を検索して追加・外せる。家族として使える会員が読み取りで並ぶ
- [ ] キャンセル規定: 3 方式の切替と規定表の保存。保存後に専用ページの会員特典の説明が変わる。既存の予約は予約時の方式のまま
- [ ] 取引先一覧の種別絞り込み（取引先／特別会員）。既定で特別会員は混ざらない
- [ ] 予約管理の予約詳細に「専用ページ経由」と特典が出る
- [ ] 取引先詳細のアクセスログに会員の閲覧（`member_user_id`）が出る

### 13.8 要確認（ユーザーに聞く・各々に推奨案）

> **2026-10-10 決定（ユーザー回答）**: Q1・Q3・Q4・Q5・Q7・Q8 は推奨どおり。
> - **Q2 変更**: 1回の予約の室数に制限なし。**公式サイトの予約（表）でも複数室を1回で予約できるようにする**。条件は全室同じチェックイン日・同じ泊数（日付が違えば別の予約）。部屋タイプ・プランは部屋ごとに選べる。取消は1室ずつできる。→ 公式の複数室予約を先に実装し（`docs/official-multi-room.md`）、特別会員はその上に載せる。
> - **Q6 変更**: 管理画面の取引先一覧は種別に関係なく一覧表示（既定の絞り込みなし）。

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| Q1 | 専用ページに出すプランの範囲 | A. 公式サイトで公開しているプランだけ（専用料金で安くする）／B. 公式非公開の VIP 専用プランも出す（`v_plans` の条件緩和と確認画面の改修が要る） | **A**（Z7）。B は次の段で。 |
| Q2 | 1 回の予約の室数 | A. 1 室（公式の仮押さえと同じ）／B. 複数室（仮押さえを室数ぶん作る・確認画面の改修） | **A**。複数室は電話で |
| Q3 | 専用ページでも早期決済割・早期決済ポイント・予約時決済割を公式と同じに付ける（§6 の「止めることもできる」） | A. 公式と同じ（切替なし）／B. 専用ページごとに止められる | **A**（切替は後から足せる） |
| Q4 | 仮押さえ `?/hold` に Turnstile | A. 付けない（会員ログイン済み・KV と DB の上限あり）／B. 付ける | **A** |
| Q5 | 専用ページの作成権限と初期状態 | A. admin のみ・公開停止・予約受付オフで作る（取引先と同じ）／B. staff も可 | **A** |
| Q6 | 取引先一覧の既定の絞り込み | A. 取引先のみ（特別会員は切替で）／B. すべて | **A** |
| Q7 | `ambassador` を今回の check 制約に入れるか | A. 入れる（制約だけ・TS には出さない）／B. §12 実装時に | **A**（migration を 1 本減らせる・害なし） |
| Q8 | 会員特典の 2 段目に出す内容 | A. 還元率・キャンセル方式・ポイント利用可の 3 行／B. グレード別の全待遇の表 | **A**（短く） |
