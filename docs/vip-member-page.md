# VIP 会員専用ページ（取引先ページの仕組み × 公式会員制度）— 設計書

> 作成: 2026-10-09（autumn-book v0.103.5 時点・読み取り調査のみ。コード・migration・DB 書き込みは未着手）
> 改訂: 2026-10-09 — §10 の未決事項にユーザーの決定が出たため確定に書き換え（キャンセル規定は設定画面で選ぶ・マイページから専用ページへ・複数施設化の後に実装・家族のつながりで利用可・個人指定）
> 改訂: 2026-10-10 — §13「実装設計」を追記（複数施設化・認証強化 S1〜S8・団体予約・料金の先計算の後の実コードに合わせた実装範囲・DB・契約・チェックリスト・要確認 Q1〜Q8）
> 改訂: 2026-10-11 — §13 を公式予約の複数室 M0〜M2（本番適用済み・`docs/official-multi-room.md` §12・§14〜§16）に合わせて全面改訂（束 `hold_groups.metadata.member_page`・部屋 `holds` / `booking_rooms` の `member_perks` 列・`create_member_page_hold_group`・`_confirm_booking_group` の差し替え・部屋ごとのキャンセル規定・専用のかご）。同日、Q9 の決定（専用ページの「ご予約一覧」で取消・日程変更〔専用料金で再計算〕・オプションを管理・公式マイページは参照のみ・DB ガード `_member_page_guard`・入口 `member_page_*`・確認メールのリンク先）を反映・要確認 Q10
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

## 13. 実装設計（2026-10-10 作成・2026-10-11 複数室 M0〜M2 に合わせて全面改訂）

> 作成: 2026-10-10（autumn-book v0.116.0）。**改訂: 2026-10-11（autumn-book v0.119.0・autumn-shared は `20261010204933` まで本番適用済み）** — 公式予約の複数室 M0（`20261010092423`・束 `hold_groups`／部屋 `holds`／部屋のお金 `booking_rooms`）・M1（`20261010125453`・かご・部屋ごとの回答）・M2（`20261010204933`・1 室ずつの取消・部屋ごとの返金・全室同時の日程変更）が本番に入ったので、`docs/official-multi-room.md` §12 の V1〜V16 と §14〜§16 の実装メモ（設計から外れた点）を本節に取り込んだ。コード・migration は未着手。
> §3〜§10 の方針と決定（D1〜D4）、§13.8 の決定（Q1・Q3・Q4・Q5・Q7・Q8 は推奨どおり。**Q2 は複数室・最大 4 室〔公式と同じかご・同じ日程〕。Q6 は取引先一覧を種別に関係なく全部表示。Q9（2026-10-11）は専用ページの「ご予約一覧」で管理・日程変更は専用料金で計算し直す・公式マイページは参照のみ**）はそのまま。アンバサダー会員（§12）は今回作らない（`kind` の check 制約にだけ入れる）。
> 実装するエージェントは本節と §14（契約の正式版・A が書く）だけを見ればよい。事実（調査で確かめたもの）には出典を付ける。判断には【判断】を付ける。

### 13.0 ひとことで

- **見せ方は取引先ページ、予約は会員の公式予約**（§3）は変わらない。変わったのは「公式予約」の中身が **1 予約 ＝ 束（`hold_groups`）＋ 部屋（`holds`）→ 予約（`bookings`）＋ 部屋のお金（`booking_rooms`）** になったこと。
- 特別会員の情報は **束のもの**（どの専用ページ経由か・キャンセル方式・規定）と **部屋のもの**（そのプランに付く専用特典・プラン名の上書き）に分けて持つ。束のものは `hold_groups.metadata.member_page` → `bookings.metadata.member_page`、部屋のものは `holds.member_perks` → `booking_rooms.member_perks`（新列・正規化の原則「部屋の値は部屋の表に」・official-multi-room §2.2）。
- 専用料金は **部屋ごとの泊明細（`holds.price_lines`）** として束に入る。確定（`_confirm_booking_group`）は `room_total` の和で金額を決め、公式料金を引き直さないので、そのまま専用料金で確定・ポイント計算される。
- キャンセル規定は **部屋ごと**（`booking_rooms.cancellation_policy_snapshot`）。専用ページの方式（`favorable` / `page` / `rank`）は確定時に部屋ごとの規定へ合成し、`_cancel_fee` が部屋ごとに読む。M2 の 1 室ずつの取消（`_cancel_room_core`）でもそのまま効く。
- **予約した後の管理（取消〔全室・1 室ずつ〕・日程変更・オプション）は専用ページの「ご予約一覧」から**（2026-10-11 決定・Q9）。日程変更は**専用料金で計算し直す**。公式のマイページは参照表示のみ（DB 側でも公式の会員用 RPC が `metadata.member_page` ありの予約を拒否）。管理画面（スタッフ）は従来どおり。

### 13.1 今のコードと §4〜§8 のずれ・直し方

| # | §4〜§8 の前提 | 実際（2026-10-11 時点） | 直し方 |
|---|---|---|---|
| Z1 | `hooks.server.ts` の `resolvePortal` が種別を見て会員セッションを解決（§5.1） | `hooks.server.ts` は `/p/*` で `locals.user = null` に固定。`resolvePortal` は `lib/server/partners/portal.ts`（244 行）にあり、各ルートの load が直接呼ぶ。会員の検証済みセッションは `getSupabaseUser(event)`（`lib/server/auth.ts`）で cookie `sb-autumn-book-auth-token`（path `/`）から取れる | **hooks は変えない**【判断】。`resolvePortal` の中で `partner.kind === 'member'` のときだけ `getSupabaseUser(event)` を呼び、会員を取引先セッションの形（`PartnerSessionAccount`・`store.ts` 1528 行）に載せる（§13.4.1）。取引先（agent/corporate/other）は今のまま |
| Z2 | `rms_partners.kind` に `member` | check は `kind in ('agent','corporate','other')`（autumn-shared `20260926025319` 35 行・create table 内の無名 check）。TS は `PartnerKind`・`PARTNER_KIND_LABELS`（`store.ts`）・`parsePartnerKind`（`staff-form.ts`・不明な値は `agent`） | migration で check を `('agent','corporate','other','member','ambassador')` に（`ambassador` は制約だけ・TS の型・表示名・選択肢には入れない【判断・Q7】）。TS は `member` を足し、表示名「特別会員」 |
| Z3 | 仮押さえと予約に `member_page_id` / `perks_snapshot` の列（§4.3）・旧 §13 の「`holds.price_snapshot.member_page` に入れる」 | **`holds.price_snapshot` は無くなった**（M0 で `price_lines`＋`room_total` に・`20261010092423` 220〜255 行）。束の表 `hold_groups` に **`metadata jsonb`（既定 `{}`・`legacy_hold_id` 以外は未使用）** がある（190 行）。`_confirm_booking_group` は `bookings.metadata` に固定のキー（`booking_code / hold_group_id / guest / member_user_id / points_earned / coupon / locale`）だけ書き、**`hold_groups.metadata` は写していない**（1286〜1296 行） | 束のもの → `hold_groups.metadata.member_page`。確定で `bookings.metadata.member_page` に写す（`_confirm_booking_group` の差し替え・§13.3.6）。部屋のもの → **`holds.member_perks jsonb null`・`booking_rooms.member_perks jsonb null` を列として足す**（§13.3.3・official-multi-room §12 V2） |
| Z4 | `confirm_booking` が仮押さえの見積で確定するか（§5.3） | `_confirm_booking_group` は **`Σ holds.room_total`** で `v_total` を決める（1159〜1162 行）。公式料金は引き直さない。付与見込みは `floor(v_charge / 1.10 × member_ranks.reward_rate)` | 直さなくてよい。専用料金を `holds.price_lines` / `room_total` に入れれば、そのまま専用料金で確定・ポイント計算される |
| Z5 | キャンセル料は `compute_cancel_fee` に分岐（§6.3） | 適用順の実装は **`book._cancel_fee(p_snapshot, p_total, p_checkin, p_as_of, p_rank_code)`**（`20261006025924`・純関数）。M2 以降の呼び元は **すべて部屋ごとの `booking_rooms.cancellation_policy_snapshot` を渡す**: `_cancel_room_core`（M2 76 行）・`compute_cancel_fee(code, as_of, room_index)`（M2 549 行）・`_booking_cancel_fee`（M0 515 行・全室一括と 2 引数版の中）・`guest_booking_by_token`／`mail_render_context`（M2 596・628・659・701・714 行）・`_amend_compute_dates`（M2 1090 行）・`_amend_compute`（M0） | **`_cancel_fee` 1 本だけ**を差し替える【判断】。方式と規定は確定時に **部屋ごとの `cancellation_policy_snapshot` の中**に写す（§13.3.6・§13.3.7）。呼び元はどれも触らない。1 室ずつの取消でもその部屋の規定で計算される |
| Z6 | 新 RPC は `create_hold` を写す（§5.3） | 公式の仮押さえは **`book.create_hold_group(p_session_id, p_facility_id, p_checkin, p_nights, p_rooms, p_client_key, p_member_user_id, p_locale)`**（M0 648〜808 行）: 1〜4 室・`book.quote` で見積・部屋タイプごとの必要数で在庫を全泊 `for update` → −N・接続元 10 分 20 束／全体 500 束・同じセッションの有効な束を解放（支払中は除く）・**1 室目の `holds.id` ＝ 束 id**。戻り `{group_id, hold_id, expires_at, rooms[{hold_id, room_index, …, quote}], total}` | `create_hold_group` を**丸ごと写し**、見積部分を「TS が渡す部屋ごとの `lines`」に差し替えた **`book.create_member_page_hold_group`** を作る（§13.3.4）。見積の形は既存の `book._quote_of(lines, total, adults)`（M0 81 行）で組む |
| Z7 | 公式非公開の VIP 専用プランも出せる（§6.1） | `create_hold_group` は `public_on_direct and is_active` と `plan_contents.is_published` を要求（M0 709〜715 行）。確認画面 `/booking/hold` は `loadHoldGroupRooms`（`lib/server/hold-group.ts`）→ `sbPlanByUuid`（`v_plans` ＝ 公開プランだけ）で部屋ごとのプランを読む | **公式サイトで公開しているプランに限る**（Q1・A）。VIP 専用プランは「公式に公開しつつ専用ページの料金ルールで安くする」で代替 |
| Z8 | 管理画面のグレード手動変更（V0） | `routes/admin/members/[id]/+page.server.ts` の `rank` action（204 行）は demo の配列を書き換えるだけ。`rank_code` を更新する RPC は autumn-shared に無い | V0: `book.admin_set_member_rank`（§13.3.1）を作り、実データでは `bookAdmin(event)` で呼ぶ |
| Z9 | 専用特典を要望欄の先頭に載せる（§5.4）。旧 §13 は「TS が `p_guest.notes` の先頭に付ける」 | 要望欄は **部屋ごと**: `_confirm_booking_group` は `p_rooms_detail[i].notes`（部屋ごとの回答の行）を **その部屋の `core.stays.notes` の先頭**に置き、代表の要望（`p_guest.notes`・到着・送迎）を後ろに続ける（M0 1218〜1232 行）。電文 `stay.notes_line` は 1 室目の滞在の `notes`、PMS は部屋ごとの滞在の `notes` を要望欄に出す | 特典は部屋ごとに違うので **部屋ごとの `core.stays.notes`**。**DB（`_confirm_booking_group`）が `holds.member_perks` から「【特別会員特典】title／title」の行を作り、その部屋の `notes` の先頭に置く**【判断・旧 Z9 から変更】。理由: 確定の経路が 2 本（現地払い `confirm_booking_group`・カード `direct_payment_confirm` → `_confirm_booking_group`）あり、TS で 2 か所に同じ処理を書くより、どちらも通る `_confirm_booking_group` 1 か所のほうが漏れない。`_confirm_booking_group` は Z3 のために写すので追加コストは小さい |
| Z10 | 還元率はグレードから（§6.2） | `/booking/hold` の `REWARD_RATE` は直書き（68 行）。DB は `member_ranks.reward_rate` | 今回は触らない（既存の二重定義・別件） |
| Z11 | アクセスログに会員の閲覧を残す | `rms_partner_access_logs.account_id` は `rms_partner_accounts` への FK | 会員の閲覧は `accountId: null`・`detail.member_user_id` で残す（§13.4.1 の `portalActor`） |
| Z12 | 予約受付オン＝「予約する」が出る | `isPartnerBookingOpen(partner)` は `booking_enabled` かつ支払方法が 1 つ以上（`booking.ts` 156 行）。`validatePartnerBookingSettings(…, true)` も支払方法を必須にする | member では支払方法を見ない: `memberPageBookingOpen(partner) = kind==='member' && booking_enabled && facility_available`（純関数）。管理画面の保存の検証は `kind==='member'` で支払方法の必須を外す |
| Z13 | 専用ページの料金は `quotePartnerBooking` の料金部分（§5.3） | `quotePartnerBooking(db, partner, {roomCode, planCode, planName, checkIn, nights, rooms:[{adults}]}, {credit})`（`booking.ts` 312 行）は **1 部屋タイプ × N 室**（各室の人数は違ってよい）で、`rooms[i].nights[{date, unit_price}]`・`subtotal`・`total`・`bathTax`・`roomName`・`advance` を返す。識別子は PMS の `room_types.code`・`rate_plans.code`＋プラン名（UUID ではない） | **部屋タイプ・プランの組ごとに `quotePartnerBooking` を呼ぶ**（`credit: false`）。`lines[i] = {date, unit_price, adults, subtotal: unit_price × adults}` に組み直す。UUID は TS が `booking.rate_plans`（`facility_id`＋`code`＋`name`）・`pms.room_types`（`facility_id`＋`code`）で解決して RPC に渡す。RPC 側でも「プランがその施設・`is_active`・`public_on_direct`・`is_published`」「室タイプがその施設」を確かめる（`create_hold_group` と同じ検査） |
| Z14 | 複数施設化の後に実装（D3） | 実装済み（`rms_partner_facilities`・`PartnerContext` の合成・`?f=`／クッキーの施設切替・`20261009054024`）。施設ごとのキーは `PARTNER_FACILITY_SETTING_KEYS = ['planNames','perks','notice','notifyEmails','showOfficialPerks']`（`partner-booking.ts` 364 行）、上書きキーは `PARTNER_FACILITY_OVERRIDE_KEYS`（`maxRooms` 等・366 行） | `cancelPolicyMode` / `cancelRules` は **`PARTNER_FACILITY_SETTING_KEYS` に足す**（施設固有） |
| Z15 | 団体予約（partner-group-booking.md） | `groupInquiryAvailable` は `kind==='agent'` の許可リスト | member では何もしなくて出ない。§13.4.7 の「使わない機能」に入れる |
| Z16 | 旧 §13「1 予約 1 室（Q2）」 | **Q2 変更: 複数室・最大 4 室（公式と同じかご・同じ日程）**。公式の上限は `book._max_rooms_per_booking()`（DB）・`MAX_ROOMS_PER_BOOKING = 4`（`lib/multi-room.ts`）・`holds.room_index` の check。取引先ページの室数は `booking_settings.maxRooms`（既定 5・最大 20・料金カレンダーの `?rooms=N` は**同じ部屋タイプ × N 室・同じ人数**） | 専用ページの室数上限は **`min(4, s.maxRooms)`**（DB の check が 4 なので 5 以上は入らない）。別タイプ・別プランの組み合わせは**かご**で（§13.4.3）。管理画面の member の施設タブでは「最大室数」を 1〜4 に制限して保存 |
| Z17 | 専用ページの入口 → 公式の確認画面 `/booking/hold?id=<hold_id>` | 公式の確認画面は **`/booking/hold?id=<束 id>`**（`sbGetHoldGroupMapped` → `HoldGroup`・`rooms[]`・1 室目の値を最上位にも写す）。遷移経路は cookie `HOLD_NAV_COOKIE`（`{id, back, via}`・`booking-nav.ts` 29 行・プラン詳細の `?/hold` が書き `holdNav()` が読む） | `createMemberPageHoldGroup` → 303 `/booking/hold?id=<束 id>`。`HOLD_NAV_COOKIE` に `{ id: 束 id, back: '/p/<token>/calendar?…', via: '' }` を書く（「プラン・お部屋を選び直す」= `?/release` が `back` へ戻す） |
| Z18 | 確認画面に専用特典（§5.2） | `get_hold_group`（M0 836〜872 行・`language sql`）は束の `metadata` も部屋の列も**返さない**（`guest_draft` まで） | `get_hold_group` を写し、`'member_page', g.metadata->'member_page'` と `rooms[i].member_perks` を足す（§13.3.5）。`sbGetHoldGroupMapped` → `HoldGroup.memberPage?`・`rooms[i].memberPerks?` |
| Z19 | PMS には `price_snapshot.member_page` が載る（旧 Z3・V6 不要の根拠） | `_emit_pms_event`（M2 1690 行〜）の `price_snapshot` は **部屋の `price_lines` から組み直す**（`v_snap`・1827〜1831 行）。`bookings.metadata` のうち電文に載るのは `guest / payment / coupon / points_earned / locale / member_user_id` だけ。`rooms[]` は電文の中で `booking_rooms` から組む（`_booking_rooms_view` ではない・1790〜1802 行） | 電文に **`member_page`（トップ・`v_meta->'member_page'`）** と **`rooms[i].member_perks`** を足す（`_emit_pms_event` を写す・§13.3.9）。PMS は未知のキーを無視する（M0 で `rooms[i].plan` を先に入れて壊れなかった実績・official-multi-room §14.10-8）。V6（PMS 側の表示）は引き続き範囲外 |
| Z20 | オンライン決済の割引・入湯税 | `direct_payment_prepare` は束の部屋ごとに `_early_prepay_discount(facility, rate_plan, checkin, {lines: holds.price_lines, total: room_total})` と入湯税を計算（M0 1455〜1463 行）。確定 `direct_payment_confirm`（M1）は `guest.rooms` を `p_rooms_detail` に、`prepay_discount_detail.rooms[]` を `p_pay` に渡して `_confirm_booking_group` を呼ぶ | 変更なし。早期決済割・予約時決済割は **専用料金に対して**公式と同じに付く（Q3・A）。保存カード・Stripe・Webhook も変更なし |
| Z21 | マイページの予約詳細に特典（§5.5） | `my_reservations`（M2 1408〜1468 行・`returns table` 19 列・末尾 `room_count, rooms`）。`rooms[]` は lateral で `booking_rooms` から組む。`bookings.metadata` は `guest` しか返さない | `my_reservations` を drop → create し、**末尾に `member_page jsonb`** を足す（M0・M2 と同じ手順・yamado-one は列名・順序に依存するので末尾追加のみ）。`rooms[i]` に `member_perks` を足す。専用ページの「ご予約一覧」も同じ RPC を会員の authenticated クライアントで呼び、`member_page.partner_id` で絞る（Z22） |
| Z22 | 旧 §5.5「マイページで取消・変更・オプション」 | **2026-10-11 決定（Q9）: 専用ページ経由の予約の管理は専用ページの「ご予約一覧」から。公式マイページは参照のみ。** 会員向けの操作 RPC は `cancel_booking`・`cancel_booking_room`（→ `_cancel_booking_core` / `_cancel_booking_room_core`・`p_by='member'`）、`amend_booking` / `quote_amendment`（→ `_amend_compute`）、`amend_booking_dates` / `quote_amendment_dates`（→ `_amend_compute_dates`）、`add_booking_options`。いずれも `auth.uid()` で本人（`members.guest_id = stays.guest_id`）を見る。非会員リンクは `guest_booking_by_token` / `guest_cancel_booking(_room)`（`p_by='guest_token'`）。管理画面は `admin_cancel_booking(_room)`（`p_by='admin'`）。確認メールの取消リンクは `_confirm_booking_group` が発行する `cancel_token`（`mail_outbox.payload`）から `templates.ts` 336 行が `/booking/cancel?t=` を組み、会員には「マイページからも」の 1 行（352 行） | **ガードは内部関数 1 本 `book._member_page_guard(p_metadata, p_by)`** を、共通で通る内部関数（`_cancel_booking_core`・`_cancel_booking_room_core`・`_amend_compute`・`_amend_compute_dates`・`add_booking_options`）に 1 行ずつ足す（§13.3.10）。会員・非会員リンクからは `member_page_booking` で拒否、スタッフ・管理者は通る。専用ページの操作は **service_role の入口 `book.member_page_*`**（対象者と予約の持ち主を確かめ、`set_config` で会員とページを名乗って既存 RPC を呼ぶ・§13.3.11）。確認メールは `cancel_token` を発行せず、専用ページの予約一覧の URL を載せる（§13.3.12） |
| Z23 | 日程変更の料金 | `_amend_compute_dates`（M2 1023 行〜）も 1 室の `_amend_compute`（M0 2408 行〜）も **`book.quote`（公式料金）** で引き直す。専用料金は TS（`quotePartnerBooking`）にしかない | **専用料金で計算し直す**（決定）: `_amend_compute_dates` を写し、見積を「TS が渡す部屋ごとの `lines`」に差し替えた `book._amend_compute_member_dates` と、`amend_booking_dates` を写した `book.member_page_amend_booking_dates` / `member_page_quote_amendment_dates`（service_role）を作る（§13.3.11）。キャンセル料・ペナルティ・在庫・クーポン／ポイントの再按分・回数（2 回）・締切・オンライン決済済み不可は公式と同じ規則（写すだけ）。方式（D1）は部屋ごとの snapshot をそのまま引き継ぐ（規定は書き換えない）。**1 室の予約も日程だけ**（部屋・プラン・人数の変更は取消 → 取り直し【判断】） |

### 13.2 今回の実装範囲（§11 の段との対応）

**V0〜V5 を実装する。V6（autumn-pms の表示）は範囲外**（電文に `member_page` / `rooms[i].member_perks` を載せるので、PMS 側は読みたくなったときに読める。要望欄の先頭の特典の行は何もしなくても PMS に出る）。

| 段 | 今回やること | やらないこと（後回し） |
|---|---|---|
| V0 | `book.admin_set_member_rank` ＋ 管理画面 `rank` action の実データ対応 | グレードの自動昇格 |
| V1 | 種別 `member`（check・TS）、`rms_partner_members`、`rms_member_page_access`、`rms_member_pages_for`、`rms_partner_member_list`、`holds.member_perks` / `booking_rooms.member_perks`、`create_member_page_hold_group`、`get_hold_group`・`_confirm_booking_group`・`_cancel_fee`・`_booking_rooms_view`・`my_reservations`・`admin_booking_detail`・`_emit_pms_event` の差し替え、**`_member_page_guard` と 5 本へのガード、`member_page_*` の入口 5 本、`_amend_compute_member_dates`、`guest_booking_by_token` の `member_page`、確認メールの `member_page_url`（`templates.ts`）** | `pointMultiplier`（§6.2）、確認メールへの特典の掲載【判断: 要望欄と PMS・予約一覧に出るので今回は載せない】 |
| V2 | 管理画面: 取引先詳細の `kind='member'` 表示切替・対象会員の追加／削除、会員詳細の「専用ページ」欄と作成、取引先一覧の種別絞り込み（既定は「すべて」・Q6）、キャンセル規定の設定（施設タブ）、最大室数 1〜4 | 家族の編集（PMS で行う・読み取り表示のみ） |
| V3 | 専用ページの入口（会員ログイン・対象者チェック・家族）、ヘッダー（会員名・グレード・ポイント）、特典の 2 段表示、member で隠すメニュー・ルートの 404 | 専用ページ独自のデザイン |
| V4 | 予約: 専用ページのかご（4 室まで・別タイプ・別プラン可）→ `/p/[token]/book?/hold`（member 版）→ `create_member_page_hold_group` → 公式 `/booking/hold`〜確定・決済。確認画面の見出し・部屋ごとの専用特典・キャンセル方式・戻り先。**専用ページの「ご予約一覧」（`/p/[token]/bookings` の member 版）: 一覧・詳細・取消（全室・1 室ずつ）・返金・日程変更（専用料金）・オプション** | 子ども区分（公式と同じ・M3）、1 室の予約の部屋・プラン・人数の変更（取消 → 取り直し） |
| V5 | マイページトップの「あなた専用のページ」リンク（本人・家族）、予約一覧の「特別会員ページ」バッジ、予約詳細は**参照のみ**（専用特典・方式を表示し、取消・日程変更・オプションのボタンの代わりに専用ページの予約詳細へのリンク）。非会員リンク（`/booking/cancel`）は専用ページへ案内 | — |

### 13.3 DB（autumn-shared・1 ファイル・`bash ~/.claude/new-migration.sh autumn-shared book_member_page`）

> **M2（`20261010204933`）の後ろの実秒で切る**（official-multi-room §12 V16。`create_hold_group`・`_confirm_booking_group`・`get_hold_group`・`my_reservations`・`_emit_pms_event` の最新定義を写すため）。写す元は **PROD の `pg_get_functiondef`**（M0〜M2 の作法）。`schema_migrations` が `20261010204933` まで一致していることを先に確かめる。
> 置き場所: §4.2 の注のとおり、`rms_partner_*` と同じ並びの `public` と、仮押さえ・確定・キャンセル料の `book`。1 ファイル。既存関数は「最新定義を丸ごと写して差分だけ足す」。各関数の直前のコメントに写す元の migration を書く。
> 適用前に巻き戻し用の関数定義（差し替える 13 本・§13.3.13）を `autumn-shared/docs/rollback/<version>_functions_before.sql` に保存し、migration 末尾のコメントに巻き戻し SQL（関数を当て直す → 新しい表・関数・列を drop）を書く（M0〜M2 と同じ）。

#### 13.3.1 V0 `book.admin_set_member_rank`（変更なし）

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

- 作法は `20260907061853_book_admin_app_ops.sql`（`_admin_tenant` / `_require_admin` / `admin_audit_logs` の列）に合わせる。`actor`・`detail` の型はそのファイルの insert を見て揃える。

#### 13.3.2 種別・対象会員・家族の判定・マイページ用一覧（変更なし）

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
alter table public.rms_partner_members enable row level security;  -- ポリシー無し＝service_role のみ

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

- 家族の判定は `book.members.guest_id` → `pms.guest_families`（`guest_id`・`family_group_id`・`20260610090300`）。退会（`withdrawn_at`）は除く。**グレードは見ない**（D3）。
- `rms_partner_members` への追加・削除は service_role の直接 `insert` / `delete`（Book のサーバ・管理者のみ）。`kind='member'` 以外には入れない（TS で拒否。DB にトリガーは置かない【判断】）。
- `facility_names` は `rms_partner_facilities.enabled` の施設名（`core.facilities`）。

#### 13.3.3 部屋の列 `member_perks`

```sql
alter table book.holds         add column member_perks jsonb;   -- null = 専用ページ経由でない／特典なし
alter table book.booking_rooms add column member_perks jsonb;
```

- 形は `[{ "id": "…", "title": "スパークリングワイン（ハーフ）", "description": "…" }]`（`imageUrl` は入れない）。**そのプランに付く特典だけ**（`perksForPlan(s.perks, planCode)`・`partner-booking.ts` 85 行の規則を TS が適用して渡す）。
- `booking.bookings` / `core.stays` の DDL はしない（共有表・official-multi-room §2.5 の原則）。`holds` / `booking_rooms` は Book 専用の表なので列を足してよい。
- バックフィルは不要（既存の行は null のまま）。巻き戻しは `drop column`。

#### 13.3.4 `book.create_member_page_hold_group`（service_role 専用）

`book.create_hold_group`（M0 `20261010092423` 648〜808 行・PROD の定義）を丸ごと写し、次を差し替える。

```sql
create or replace function book.create_member_page_hold_group(
  p_session_id     text,     -- cookie ab_book_sid（公式と同じ・path /）
  p_member_user_id uuid,     -- ログイン中の会員（本人または家族）
  p_partner_id     uuid,     -- 専用ページ（rms_partners.kind='member'）
  p_facility_id    uuid,     -- 選んでいる施設（core.facilities・rms_partner_facilities）
  p_checkin        date,
  p_nights         integer,
  p_rooms          jsonb,    -- 1〜4 件・並び順＝room_index（§13.3.5 の形。lines は専用料金の泊明細）
  p_member_page    jsonb,    -- 束のもの（§13.3.5 の形。partner_id / facility_id / member_user_id は RPC が上書きする）
  p_client_key     text,
  p_locale         text default 'ja')
returns jsonb   -- create_hold_group と同じ {group_id, hold_id, expires_at, rooms[{hold_id, room_index, room_type_id, rate_plan_id, adults, quote}], total}
```

差分（番号は `create_hold_group` の節の順）:

1. **対象者と専用ページの検査**（引数の検査の直後）: `if not public.rms_member_page_access(p_partner_id, p_member_user_id) then raise exception 'forbidden'`。`rms_partners`（`kind='member'`・`is_active`・有効期間の列〔実名を `\d public.rms_partners` で確かめる〕内）と `rms_partner_facilities`（`partner_id, facility_id`・`enabled and booking_enabled`）を確かめ、どれか欠けていれば `'page_unavailable'`。
2. **室数の上限**: `create_hold_group` と同じ `book._max_rooms_per_booking()`（4）。`rms_partner_facilities`／`booking_settings` の `maxRooms` は TS が見る（DB は 4 だけ）。
3. **プラン・室タイプの検査**: `create_hold_group` のまま（`public_on_direct and is_active`・`plan_contents.is_published`・`rate_plans.facility_id = p_facility_id`・`room_types.facility_id = p_facility_id`・Z7・Z13）。
4. **見積**: `book.quote(...)` を呼ばず、`v_room->'lines'` を検証して `v_q := book._quote_of(v_lines, v_room_total, v_adults)` を組む。検証（違えば `'invalid_lines'`）: `jsonb_typeof = 'array'`・長さ ＝ `p_nights`・`lines[k].date = p_checkin + k`（連続）・`unit_price` は 1 以上の整数・`adults = v_adults`・`subtotal = unit_price × adults`。`v_room_total := Σ subtotal`。**料金の正しさ（専用料金かどうか）は TS が責任を持つ**（RPC は形だけ見る）【判断・取引先予約 `rms_partner_create_booking` と同じ流儀】。`member_perks` は `jsonb_typeof = 'array'` のときだけ採り、各要素は `id / title / description` だけに絞る（`jsonb_strip_nulls`）。
5. **試行上限・同じセッションの解放・在庫のロックと −N・`expires_at`（20 分）**: そのまま（上限は `hold_groups` 全体で公式と共用・束 1 件 ＝ 1 回）。
6. **保存**: `hold_groups` の insert に `metadata = jsonb_build_object('member_page', p_member_page || jsonb_build_object('partner_id', p_partner_id, 'facility_id', p_facility_id, 'member_user_id', p_member_user_id))`。`holds` の insert に `member_perks`（`v_items[i].member_perks`・無ければ null）。`member_user_id` 列には `p_member_user_id`。**1 室目の `holds.id` ＝ 束 id** は `create_hold_group` と同じ。
7. **戻り**: `create_hold_group` と同じ形（`rooms[i].quote` は `_quote_of` の戻り）。
8. 権限: `revoke all … from public, anon, authenticated; grant execute … to service_role;`。

#### 13.3.5 `member_page`（束）と `member_perks`（部屋）の形（A→B・PMS 共通の契約）

**束** `hold_groups.metadata.member_page` → `bookings.metadata.member_page`:

```jsonc
{
  "partner_id": "…", "facility_id": "…", "member_user_id": "…",   // RPC が上書き
  "page_name": "山田様 専用ページ",                                 // rms_partners.name
  "via": "self" | "family",                                        // 本人か家族か（表示用）
  "cancel_policy_mode": "favorable" | "page" | "rank",
  "cancel_rules": [{ "days_before": 7, "rate": 0.3 }] | null      // 専用ページの規定（page / favorable のとき）。rank_cancel_policies.rules と同じ形
}
```

**部屋** `p_rooms[i]`（RPC への入力）と `holds.member_perks` → `booking_rooms.member_perks`:

```jsonc
// p_rooms[i]
{ "rate_plan_id": "…", "room_type_id": "…", "adults": 2,
  "lines": [{ "date": "2026-11-09", "unit_price": 27000, "adults": 2, "subtotal": 54000 }],  // 専用料金・泊ごと
  "member_perks": [{ "id": "…", "title": "…", "description": "…" }] | null,                  // そのプランに付く特典の写し
  "plan_display_name": "…" | null }                                                           // planNames の上書き（表示用・RPC は保存しない【判断・プラン名の上書きは専用ページの中だけで使い、公式の確認画面・マイページは公式のプラン名】）
// holds.member_perks / booking_rooms.member_perks
[{ "id": "…", "title": "…", "description": "…" }]
```

- `cancel_rules` の形は `book.rank_cancel_policies.rules`（`[{days_before, rate}]`・`rate` は 0〜1）。取引先の `PlanTerms`（`rate_percent` / `days_before`・`partner-plan-terms.ts` 24 行）とは別物なので、TS で変換する（`lib/partner-member-page.ts` の `toCancelRules`）。
- `get_hold_group` の戻りに `'member_page', g.metadata->'member_page'`（束）と `rooms[i].member_perks`（`h.member_perks`）を足す（M0 836〜872 行を写す・`language sql` なので 2 行足すだけ）。1 室目の写し（最上位）には足さない。

#### 13.3.6 `book._confirm_booking_group` の差し替え（M0 1094〜1368 行・PROD の定義を丸ごと写す）

`confirm_booking_group`（公開版）・`confirm_booking`（旧署名・yamado-one）は `_confirm_booking_group` を呼ぶだけなので**変えない**。足すのは次の 4 点。`auth.uid()` による会員判定・按分・ポイント・クーポン・メール・電文はそのまま。

```sql
declare v_mp jsonb := v_g.metadata->'member_page'; v_perk_line text; v_rules jsonb; v_mp_url text;
…
  -- (1) 部屋ごとの滞在の notes: 専用特典の行を先頭に（Z9）。v_room_notes（部屋ごとの回答）→ 代表の要望（v_notes）はそのまま後ろ
  v_perk_line := case when jsonb_typeof(v_h.member_perks) = 'array' and jsonb_array_length(v_h.member_perks) > 0
                      then '【特別会員特典】' || (select string_agg(e->>'title', '／') from jsonb_array_elements(v_h.member_perks) e) end;
  v_room_notes := nullif(concat_ws(E'\n', v_perk_line, v_room_notes), '');
  …  insert into core.stays (… notes …) values (… case when v_room_notes is null then v_notes else concat_ws(E'\n', v_room_notes, nullif(v_notes, '')) end …)

  -- (2) bookings.metadata に束の member_page を写す（null なら書かない）
  jsonb_build_object('booking_code', v_code, …, 'locale', p_locale)
    || case when v_mp is not null then jsonb_build_object('member_page', v_mp) else '{}'::jsonb end

  -- (3) 部屋ごとのキャンセル規定（§6.3・D1）: v_policy（rate_plans.cancellation_policy）に方式と規定を合成してから booking_rooms に書く
  select cancellation_policy into v_policy from booking.rate_plans where id = v_h.rate_plan_id;
  if jsonb_typeof(v_policy) = 'array' then v_policy := jsonb_build_object('rules', v_policy); end if;   -- 配列形を {rules} に正規化
  v_policy := coalesce(v_policy, '{}'::jsonb);
  if v_mp is not null then
    v_rules := case when jsonb_typeof(v_mp->'cancel_rules') = 'array' and jsonb_array_length(v_mp->'cancel_rules') > 0 then v_mp->'cancel_rules' end;
    v_policy := case v_mp->>'cancel_policy_mode'
      when 'page'      then case when v_rules is not null then jsonb_build_object('rules', v_rules, 'source', 'member_page') else v_policy end
      when 'favorable' then v_policy || jsonb_build_object('member_page', jsonb_build_object('mode', 'favorable', 'rules', coalesce(v_rules, '[]'::jsonb)))
      else v_policy end;   -- 'rank' = 公式と同じ（プラン規定 → グレード → standard）
  end if;

  -- (4) booking_rooms の insert に member_perks（v_h.member_perks）を足す

  -- (5) 確認メール（§13.3.12）: 専用ページ経由はメールの取消リンク（非会員用トークン）を発行せず、専用ページの予約詳細の URL を載せる
  if v_mp is not null then
    select '/p/' || p.url_token || '/bookings/' || v_code into v_mp_url from public.rms_partners p where p.id = (v_mp->>'partner_id')::uuid;
    v_cancel_token := null;
  else
    v_cancel_token := book._issue_booking_token(…);   -- 既存
  end if;
  … mail_outbox.payload = jsonb_build_object('cancel_token', v_cancel_token, 'client', …, 'member_page_url', v_mp_url) …
```

- `page` で専用ページの規定が空のときは公式の適用順（プラン規定 → グレード → standard）に落ちる（§6.3 の「無ければ公式の適用順」）。
- `favorable` はプラン規定を残したまま `member_page` キーを添える。`_cancel_fee` は `p_snapshot->'rules'` だけを見るので、既存の判定（プラン規定 → グレード）はそのまま動く（§13.3.7 で安い方を取る）。
- `bookings.cancellation_policy_snapshot` は **null のまま**（official-multi-room §2.5）。
- 会員の判定は `auth.uid()`。専用ページの確定も公式と同じく会員の authenticated クライアント（現地払い）か、`direct_payment_confirm` が `set_config('request.jwt.claim.sub', …)` で差し替えた会員（カード）で呼ばれる。`hold_groups.member_user_id = ログイン中の会員` なので `is distinct from` の本人確認もそのまま通る。
- `member_page` が無い束では何も変わらない（公式・yamado-one と互換）。

#### 13.3.7 `book._cancel_fee` の差し替え（`20261006025924` を丸ごと写す）

```sql
  -- 専用ページ「お客さまに有利な方」（favorable）: 公式の適用順で出した率と、専用ページの規定の率の安い方
  v_mp := p_snapshot->'member_page';
  … 既存の v_rules / v_source / v_rate の決定はそのまま（p_snapshot->'rules' → rank_cancel_policies）…
  if v_mp->>'mode' = 'favorable' and jsonb_typeof(v_mp->'rules') = 'array' and jsonb_array_length(v_mp->'rules') > 0 then
    select (r->>'rate')::numeric into v_page_rate from jsonb_array_elements(v_mp->'rules') r
     where (p_checkin - p_as_of) <= (r->>'days_before')::integer order by (r->>'days_before')::integer asc limit 1;
    if coalesce(v_page_rate, 0) < coalesce(v_rate, 0) then v_rate := coalesce(v_page_rate, 0); v_source := 'member_page'; end if;
  end if;
  -- 'page' は snapshot.rules に専用規定が入っているので既存の 'plan' 経路で計算される。表示用に p_snapshot->>'source' = 'member_page' なら v_source := 'member_page'
```

- 戻り `rules_source` に `'member_page'` が増える。呼び元（Z5 の 7 本）は変更不要（値を透過）。**部屋ごとに呼ばれるので、1 室ずつの取消（`_cancel_room_core`）・部屋ごとの返金見込み・全室一括・非会員リンク・日程変更のペナルティ判定のどれでも、その部屋の方式で計算される。**
- 不泊の率は `rules` の `days_before` 最小の段（既存の規則）。専用ページの規定に不泊の段が無ければ公式側の率で比べる（favorable）。
- `compute_cancel_fee` の戻り `rules_source='member_page'` はマイページ・管理画面の表示（`sbComputeCancelFee` の `rules` 補完）で扱う（§13.4.5）。

#### 13.3.8 読み取り関数の差し替え（部屋の特典・束の `member_page` を返す）

| 関数 | 写す元 | 差分 |
|---|---|---|
| `book._booking_rooms_view(booking_id)` | M0 549〜584 行 | 要素に `'member_perks', r.member_perks` を足す → `guest_booking_by_token`・`admin_booking_detail`・`mail_render_context` の `rooms[]` に自動で載る |
| `book.my_reservations()` | M2 1408〜1468 行 | drop → create。**末尾に `member_page jsonb`**（`b.metadata->'member_page'`）。lateral の `rooms[]` 要素に `'member_perks', r.member_perks`。既存 19 列の名前・順序は変えない（yamado-one）。権限（authenticated）を付け直す |
| `book.admin_booking_detail(code)` | M0 2143〜2276 行（M1・M2 で未変更） | `booking` に `'member_page', v_b.metadata->'member_page'` を足す（`rooms[]` は `_booking_rooms_view` 経由で特典が載る） |
| `book.guest_booking_by_token(token)` | M2 561〜667 行 | 戻りに `'member_page', (v_b.metadata ? 'member_page')`（boolean）と `'member_page_url'`（`/p/<url_token>/bookings/<code>`・`rms_partners` から）を足す。`cancellable` は member_page なら false（取消はガードでも止まる・§13.3.10） |

- `mail_render_context`（M2）は `_booking_rooms_view` を使っているか写す前に確かめる（使っていなければ要素に `member_perks` を足す）。
- **専用ページの「ご予約一覧」の読み取りは新しい RPC を作らない**【判断】: 会員の authenticated クライアントで `my_reservations`（`member_page.partner_id` で TS が絞る）・`list_my_booking_options`・`list_my_amendments`・`compute_cancel_fee(code, as_of, room_index)` を呼ぶ（マイページと同じ読み取り関数 `sbMyReservations` 等をそのまま使う）。読み取りはガードの対象外。

#### 13.3.9 `book._emit_pms_event` の差し替え（M2 1690 行〜・PROD の定義を丸ごと写す）

- payload のトップに `'member_page', v_meta->'member_page'`（無ければ `null`）。
- `rooms[]` を組む `jsonb_build_object`（M2 1790〜1802 行付近・`booking_rooms` と `core.stays` から）に `'member_perks', r.member_perks` を足す。
- それ以外は変えない。PMS（autumn-pms）は未知のキーを無視する（Z19）。`cancelled_rooms[].cancellation_policy`（M2 413〜414 行）には部屋の規定がそのまま載るので、`favorable` のときは `member_page` キー付きの規定が PMS に渡る（PMS は `rules` しか読まない・official-multi-room §16.2）。

#### 13.3.10 会員向け操作 RPC のガード `book._member_page_guard`（公式マイページ・非会員リンクからの操作を止める）

```sql
-- 専用ページ経由の予約（metadata.member_page あり）は、会員本人（member）・非会員リンク（guest_token）からの操作を拒否する。
-- 専用ページの入口（§13.3.11）は set_config('book.member_page_ctx', <partner_id>, true) を立ててから既存 RPC を呼ぶので通る。
-- スタッフ・管理者（staff / admin）は常に通る
create or replace function book._member_page_guard(p_metadata jsonb, p_by text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_metadata ? 'member_page' and coalesce(p_by, 'member') in ('member', 'guest_token')
     and current_setting('book.member_page_ctx', true) is distinct from (p_metadata->'member_page'->>'partner_id') then
    raise exception 'member_page_booking';
  end if;
end $$;
```

ガードを 1 行足す関数（写す元・位置）:

| 関数 | 写す元 | 足す位置・`p_by` |
|---|---|---|
| `book._cancel_booking_core(code, waive, reason, by, actor)` | M2 126 行〜 | 予約を `for update` した直後に `perform book._member_page_guard(v_booking.metadata, p_by)`。呼び元: `cancel_booking`（member/staff）・`admin_cancel_booking`（admin）・`guest_cancel_booking`（guest_token）・`_cancel_booking_room_core`（最後の 1 室） |
| `book._cancel_booking_room_core(code, room_index, waive, reason, by, actor)` | M2 291 行〜 | 同上。呼び元: `cancel_booking_room`・`admin_cancel_booking_room`・`guest_cancel_booking_room` |
| `book._amend_compute(stay, booking, …)` | M0 2408 行〜 | 先頭で `perform book._member_page_guard(p_booking.metadata, 'member')`（`quote_amendment` / `amend_booking` は会員専用） |
| `book._amend_compute_dates(booking, checkin, nights)` | M2 1023 行〜 | 同上（`quote_amendment_dates` / `amend_booking_dates` は会員専用） |
| `book.add_booking_options(code, items)` | M2 1545 行〜 | 予約を引いた直後に `perform book._member_page_guard(v_booking.metadata, 'member')` |

- `guest_booking_by_token` は読み取りなので止めず、`member_page: true` を返して画面が案内に切り替える（§13.4.4）。`guest_cancel_booking(_room)` はコアのガードで `member_page_booking`。
- 専用ページの入口以外から `book.member_page_ctx` を立てる経路は無い（`set_config` は SQL 関数の中・service_role 専用の関数だけ）。`current_setting(..., true)` は未設定なら null → `is distinct from` で拒否側に落ちる。

#### 13.3.11 専用ページの操作の入口 `book.member_page_*`（service_role 専用・新規）

共通の前置き（`book._member_page_booking_check(p_partner_id, p_member_user_id, p_booking_code) returns booking.bookings`）: ① `rms_member_page_access(p_partner_id, p_member_user_id)` でなければ `forbidden` ② `_booking_by_code` で予約を引き、`metadata.member_page.partner_id = p_partner_id` でなければ `not_member_page_booking` ③ **`metadata.member_user_id = p_member_user_id`**（予約した本人だけ。家族の予約は各自がログインして操作する【判断・要確認 Q10】）でなければ `forbidden`。その後 `set_config('request.jwt.claim.sub', p_member_user_id::text, true)`・`set_config('book.member_page_ctx', p_partner_id::text, true)` を立てて既存 RPC を呼び、終わったら `request.jwt.claim.sub` を元に戻す（`direct_payment_confirm` M1 46 行〜と同じ作法）。

| 入口 | 中で呼ぶもの | 戻り・例外 |
|---|---|---|
| `member_page_cancel_booking(p_partner_id, p_member_user_id, p_booking_code)` | `book.cancel_booking(code)`（`p_by='member'`・免除なし） | `cancel_booking` と同じ |
| `member_page_cancel_booking_room(…, p_room_index)` | `book.cancel_booking_room(code, room_index)` | 同じ |
| `member_page_add_booking_options(…, p_items)` | `book.add_booking_options(code, items)`（`items[].room_index` 付き・M2） | 同じ |
| `member_page_quote_amendment_dates(…, p_checkin, p_nights, p_rooms)` | `book._amend_compute_member_dates(booking, checkin, nights, p_rooms)`（下） | `quote_amendment_dates` と同じ形（`rooms[]`・`available`・`sold_out[]`・`in_penalty`） |
| `member_page_amend_booking_dates(…, p_checkin, p_nights, p_rooms)` | `amend_booking_dates`（M2 1217 行〜）を写し、`auth.uid()` の本人確認を前置きに置き換え、`_amend_compute_dates` を `_amend_compute_member_dates` に差し替えたもの | `amend_booking_dates` と同じ（`booking_amendments` に `kind='dates'`・電文 `modified/dates`・在庫 ±N・`sold_out:<id>` で全体を戻す・2 回まで・締切・`prepaid_online` 不可） |

**`book._amend_compute_member_dates(p_booking, p_checkin, p_nights, p_rooms jsonb)`** は `_amend_compute_dates`（M2 1023〜1170 行）を写し、生きている部屋ごとの `book.quote(...)` を **`p_rooms` の `lines`** に差し替える。`p_rooms = [{room_index, lines:[{date, unit_price, adults, subtotal}]}]`（生きている部屋ぶん・TS が `quotePartnerBooking` で出す）。検証は `create_member_page_hold_group` と同じ（長さ ＝ `p_nights`・日付が `p_checkin` から連続・`unit_price ≥ 1`・`adults = その部屋の core.stays.adult_count`・`subtotal = unit_price × adults`・生きている部屋がすべて揃っている）→ 違えば `invalid_lines`。見積の形は `book._quote_of(lines, Σsubtotal, adults)`。クーポン（percent は新合計・fixed は `least`）・ポイントの再按分（`_allocate`）・ペナルティ（部屋ごとの `cancellation_policy_snapshot` × `_cancel_fee`・1 室でも率 > 0 なら `in_penalty`）・在庫の目安は写すだけ。**部屋ごとの `cancellation_policy_snapshot` は書き換えない**（D1 の方式がそのまま続く）。`member_perks` も据え置き。

- 権限: 入口 5 本と `_amend_compute_member_dates`・`_member_page_booking_check` は `revoke all … from public, anon, authenticated; grant execute … to service_role`。
- 1 室の予約も `member_page_*_dates` で日程だけ変える（`_amend_compute_dates` は生きている部屋をループするので 1 室でも動く。A はコンテナで確かめる）。
- 返金は従来どおり TS の `refundAfterCancel(code, 'member', {roomIndex})`（`direct_payment_refund_due` は変えない）。

#### 13.3.12 確認メール（autumn-shared `functions/send-booking-mail/templates.ts`）

- `_confirm_booking_group` は専用ページ経由のとき `cancel_token` を発行せず、`payload.member_page_url`（`/p/<url_token>/bookings/<予約番号>`）を入れる（§13.3.6 (5)）。
- `buildConfirmationMail`（336 行〜）: `payload.member_page_url` があれば「■ ご予約の変更・取り消し」の節を「特別会員ページのご予約一覧（`${baseUrl}${member_page_url}`）からお手続きいただけます」に（`/booking/cancel?t=` は出さない）。「マイページからも行えます」の 1 行（352 行）は専用ページ経由では「ご予約内容の確認はマイページからもできます（変更・取消は特別会員ページから）」に。他の種類（`booking_cancelled` / `booking_room_cancelled` / 日程変更）は変えない。テスト（`templates.test.ts`）を足す。
- 限定 URL の再発行で `url_token` が変わっても、旧トークンは `rms_partner_url_token_aliases`（`20261009054024`）でリダイレクトされるので古いメールのリンクも生きる。
- `send-booking-mail` のデプロイは migration と同時（M2 §16.5-3 と同じ順序）。

#### 13.3.13 差し替える既存関数（巻き戻し用に PROD の定義を保存する 13 本）

`get_hold_group`・`_confirm_booking_group`・`_cancel_fee`・`_booking_rooms_view`・`my_reservations`・`admin_booking_detail`・`_emit_pms_event`・`guest_booking_by_token`・`_cancel_booking_core`・`_cancel_booking_room_core`・`_amend_compute`・`_amend_compute_dates`・`add_booking_options`。新規は `admin_set_member_rank`・`rms_member_page_access`・`rms_member_pages_for`・`rms_partner_member_list`・`create_member_page_hold_group`・`_member_page_guard`・`_member_page_booking_check`・`_amend_compute_member_dates`・`member_page_*` 5 本（巻き戻しは drop）。

#### 13.3.14 やらないこと（DB）

- `rms_partners` の列追加・`booking_settings` の DB 側合成関数の変更。`cancelPolicyMode` / `cancelRules` は `rms_partner_facilities.facility_settings`（jsonb）のキーなので DDL 不要。
- `booking.bookings` / `core.stays` の DDL（共有表）。
- `create_hold_group`・`confirm_booking_group`・`confirm_booking`・`direct_payment_*`（`refund_due` / `record_refund` を含む）・`_cancel_room_core`・`cancel_booking` / `cancel_booking_room` / `admin_cancel_booking(_room)` / `guest_cancel_booking(_room)`（公開側の署名・中身）・`amend_booking` / `amend_booking_dates` / `quote_amendment(_dates)`（公開側）・`_finalize_booking` の変更（ガードはコア側 5 本に・§13.3.10）。
- `rms_partner_room_type_remaining`（取引先ページの残室・束×部屋で既に数えている）。

### 13.4 サーバ・画面

#### 13.4.1 入口（`/p/[token]`・`kind='member'`）

- `resolvePortal`（`portal.ts` 244 行）: `partner.kind === 'member'` のとき、取引先セッション（`rms_partner_session`）は**見ない**。`getSupabaseUser(event)` で会員を取り、`resolveSupabaseSessionUser` と同じ判定（`user_metadata.member` / `book.my_profile`）で会員なら `rms_member_page_access(partner.id, user.id)` を service_role で呼ぶ。
  - 対象なら `session = { id: MEMBER_PORTAL_ACCOUNT_ID /* nil UUID。DB には書かない */, login_id: member.memberCode, display_name: member.name, is_master: false, sessionId: '', member: { userId, name, rankCode, guestId, balance, via: 'self'|'family' } }`。
  - 会員だが対象外 → `session = null`・`memberState = 'denied'`。未ログイン → `session = null`・`memberState = 'anonymous'`。
  - 確認モード（`rms_partner_preview`）は従来どおり（会員なしで見られる・書き込み不可）。
  - `PartnerSessionAccount` 型（`store.ts` 1528 行）に `member?: PortalMember` を足す。`portalHeader`（`portal.ts` 332 行）に `member`（名前・グレード・ポイント）と `kind: 'partner' | 'member'`（`kind` そのものは出さない流儀を守る）を足す。
  - キャッシュ（`bundleCache` 30 秒）は GET のみ・従来どおり。**会員の対象判定は毎回 DB**（取引先セッションと同じ扱い・POST は必ず）。
- `requirePortalSession` / `requirePortalApi`: member で `session` が無ければ、`memberState` に応じて `/p/<token>`（案内画面）へ 303。MFA の関所（`portalNeedsMfa`）は member では常に false（会員は Supabase Auth 側の本人確認）。
- `/p/[token]/+page.server.ts`（トップ）: member なら取引先のログインフォームを出さず、(a) 未ログイン → 「会員ログイン」（`/auth/login?next=/p/<token>/calendar`・`safe-next.ts` は同一サイトの相対パスなので通る）、(b) 対象外 → 「このページはご招待の会員さま専用です」（会員名とログアウトのリンク）、(c) 対象 → `/calendar` へ 303。
- **member で 404 にするルート**（`requireMemberPortalAbsent()` を各 load/POST の先頭に・団体予約の `requireGroupInquiry` と同じ流儀）: `group/**`・`memorandum`・`account/**`・`mfa`・`passkey/**`・`setup`・`payment/**`・`stay/**`・`legal`（公式の `/legal/*` へリンク）・`book/attachments/**`・`book/reserve`・`logout`（公式の `/auth/logout` を使う）・`bookings/[id]`（取引先予約の詳細・`/bookings/[code]` の member 版は別に作る）。残すもの: `calendar/**`・`rooms`・`plans`・`rate-sheet/**`・`facility`（施設切替）・`book`（member 版）・`book/quote`・**`bookings`（member 版の「ご予約一覧」・§13.4.3b）**。
- `portalActor(session)`: アクセスログ用 `{ accountId: session.member ? null : session.id, detail: session.member ? { member_user_id } : {} }`。`logPartnerAccess` を呼ぶ箇所はこれを通す（Z11）。
- `hooks.server.ts`・`maintenance.ts` は変更なし。

#### 13.4.2 表示（V3）

- ヘッダー（`routes/p/[token]/+layout.svelte`）: `portal.member` があれば「{施設名}」の下に「{会員名} 様 専用ページ」・グレードのバッジ・保有ポイント。メニューは `portal.kind === 'member'` で絞る（料金カレンダー・お部屋・プラン・料金表・**ご予約一覧**。右端に「マイページへ」）。
- 料金・残室・写真・プラン詳細・最安（`loadStayPage` / `loadPortalReference` / 月 JSON）は**取引先と同じ読み出し**。料金ルールは `rms_partner_facilities.pricing`（RMS で編集・先計算 `rms_partner_portal_prices`）。member の料金ルールも RMS の `/partner-rates/<id>` で編集する（管理画面に同じリンク）。
- 特典の 2 段（`PartnerStaySearch` のカード・`PartnerPlanDetailModal`・`/book` の確認画面）: 1 段目「{会員名}様専用特典」= `perks`（`PartnerPerkList`・プラン指定の特典はそのプランにだけ）。2 段目「会員特典（{GRADE}）」= `lib/partner-member-page.ts` の `memberBenefitLines(rankCode, rewardRate, cancelMode)`（還元率・キャンセル方式の説明文・ポイント利用可の 3 行・Q8）。還元率は `book.member_ranks` を service_role で読む（`REWARD_RATE` 直書きは増やさない）。
- 料金カレンダーの「予約する」（`bookHref`・`PartnerStaySearch.svelte` 205 行・`?room&plan&name&date&guests&nights&rooms=N`）はそのまま使い、室数の上限は `min(4, s.maxRooms)`（`loadStayPage` の `booking.maxRooms`・`stay-page.ts` 38・111 行）。

#### 13.4.3 予約の流れ（V4・複数室）

専用ページのかごは **専用の部品にする**【判断】。公式の `BookingCart.svelte` は `CartItem`（`brandSlug / facilitySlug / planSlug`・公式 URL）と公式プラン詳細の `?/hold`（Turnstile 付き）に結び付いており、専用ページの識別子（`roomCode / planCode / planName`・施設は `?f=`）と送り先（`/p/<token>/book?/hold`・Turnstile なし）が違う。見た目と判定は流用し、**純関数（`lib/multi-room.ts` の `canAddToCart`／`payCompatible`／`sameStay`／`cartIsFull`／`cartSummary`／`cartGroups`／`readCart`／`writeCart`）は型引数と保存キーを渡せる形に広げて共有する**（公式のかごの動きは変えない）。

```
料金カレンダー（同じ部屋タイプ × N 室・同じ人数）
  ├「予約する」… /p/<token>/book?room&plan&name&date&nights&guests&rooms=N(&f=)   … 1 タップ（取引先と同じ URL）
  └「＋ もう 1 室追加」（料金カレンダーの行・プラン詳細モーダル）… sessionStorage（ab_member_cart_v1）のかごへ。在庫は押さえない
       別施設（?f=）・別日程 → confirm「かごを空にしますか」／支払方法が両立しない → 理由（Q3）／残室超え → 理由／4 室目で注意・5 室目は入らない
画面下のかごバー（PartnerBookingCart）「N室・大人M名・合計 ¥」［内訳］［予約へ進む］
  予約へ進む → POST /p/<token>/book?/hold（rooms JSON）→ 303 /booking/hold?id=<束 id>（確認は公式の画面で・部屋ごとの特典もそこに出る）
/p/<token>/book（GET・1 タップの経路の確認画面）→「予約へ進む」→ POST ?/hold（同じ rooms JSON）→ 303 /booking/hold?id=<束 id>
公式 /booking/hold（代表者 1 回・部屋ごとの男女と質問・ポイント・支払 1 回）→ 確定 → 完了 → マイページ
```

1. **`/p/[token]/book`（member 版 load）**: `requirePortalSession`（member）→ `memberPageBookingOpen(partner)` でなければ `/calendar` へ 303 → `?room&plan&name&date&nights&guests&rooms=N` を読み（取引先版 23〜38 行と同じ）→ `quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights, rooms: N × {adults: guests} }, { credit: false })` → 表示は「ご予約内容の確認（部屋ごとの専用料金・このプランの専用特典・会員特典・獲得予定ポイントの目安・キャンセル方式）」と「予約へ進む」（hidden `rooms` JSON・`checkin`・`nights`・`facility_id`）だけ。宿泊者・支払・ポイントの入力は**公式の確認画面に任せる**。確認モードはボタンを止める（`denyPreviewWrite`）。
2. **かご**: 要素 `MemberCartItem = { key, partnerToken, facilityId, facilitySlug, checkin, nights, roomCode, roomName, planCode, planName, displayName, adults, total, pay: {onsite, prepay}, remaining }`。`pay` は `loadStayPage` が返すプランの支払方法（`planContents` の `payment_method`／非会員の設定は見ない＝会員）から。保存キー `ab_member_cart_v1`（公式の `ab_booking_cart_v1` とは別・同じタブで両方開いても混ざらない）。4 室目で公式と同じ注意文（`cart_full_notice`）。
3. **action `?/hold`（member 版）**: `requirePortalSession`（POST は毎回 DB）→ `portalFacilityContext(db, partner, fd.facility_id)`（施設はフォームのもの・取引先版と同じ）→ `parseMemberHoldRooms(fd)`（`rooms` JSON `[{roomCode, planCode, planName, adults}]`・1〜`min(4, s.maxRooms)`・無ければ 1 タップ用のフィールド `room/plan/name/guests/rooms`）→ 受付締切 `canBookFor(checkIn, s)` → **部屋タイプ・プランの組ごとに `quotePartnerBooking`（`credit: false`）を呼び直す**（画面の金額は受け取らない）→ `lines` に組み直し（Z13）→ UUID 解決（`booking.rate_plans`: `facility_id`＋`code`＋`name`・`pms.room_types`: `facility_id`＋`code`。見つからなければ `fail(400, code:'invalid')`）→ `sbPlanByUuid` ＋ `planForViewer(plan, true)` で `payCompatible`（違えば `fail(400, code:'mixed_payment')`）→ 部屋ごとの特典 `perksForPlan(s.perks, planCode)` を `member_perks` の形に → `holdRateCheck`（KV `hold:<ip>`・公式と同じ）→ `createMemberPageHoldGroup(...)`（service_role・`.schema('book')`）→ 成功なら `HOLD_NAV_COOKIE` に `{ id: 束 id, back: '/p/<token>/calendar?date&nights&guests(&f=)', via: '' }` を書いて 303 `/booking/hold?id=<束 id>`。失敗: `sold_out` 409（`soldOut:[{roomTypeId, roomName}]`・かごは残す）・`rate_limited`/`too_many_holds` 429・`forbidden` 403・`page_unavailable`/`closed` 400・`invalid_lines` は 500 でなく 400（TS のバグなのでログに残す）。Turnstile は付けない（Q4）。
4. **公式 `/booking/hold`**（既存・小改修・表示だけ）: `hold.memberPage` が載っていれば、(a) 見出しに「{page_name} 経由・専用料金」、(b) 部屋カード（`rooms[i]`）に「専用特典」= `rooms[i].memberPerks`、(c) キャンセル規定の説明に方式（`cancel_policy_mode` の表示名）、(d) 「プラン・お部屋を選び直す」（`?/release`）の戻り先は従来どおり `nav.back`（専用ページ）。**`?/submit`・`/booking/pay` の `prepare`・`applyGroupAnswers` は変えない**（特典の行は DB が付ける・Z9）。それ以外（宿泊者入力・部屋ごとの男女と質問・ポイント・支払方法・保存カード・Stripe・完了画面）は**変更なし**。
   - `sbGetHoldGroupMapped` の戻り `HoldGroup` に `memberPage?: MemberPageSnapshot | null`・`rooms[i].memberPerks?: MemberPerkSnapshot[] | null` を足す（`mapQuote` は従来どおり）。
5. 確定: 公式のまま（会員 = `createSupabaseServerClient(event)` で `confirm_booking_group`、カードは `direct_payment_prepare/confirm`）。`hold_groups.metadata.member_page` → `bookings.metadata.member_page`、`holds.member_perks` → `booking_rooms.member_perks`、部屋ごとの `cancellation_policy_snapshot` に方式を合成（§13.3.6）。
6. 電文: 公式と同じ `_emit_pms_event`。各部屋の `core.stays.notes` の先頭に「【特別会員特典】…」、payload に `member_page`・`rooms[i].member_perks`（§13.3.9）。
7. 完了画面・`LastBooking` cookie: 変更なし（M1 の部屋ごとの明細がそのまま出る）。完了画面の「マイページで確認」は専用ページ経由なら「特別会員ページのご予約一覧で確認」（`LastBooking` に `memberPageUrl` を足す）。確認メールは §13.3.12（変更・取消のリンク先が専用ページの予約詳細）。
8. 取消・返金・日程変更・オプション: **専用ページの「ご予約一覧」から**（§13.4.3b）。公式のマイページ・非会員リンクからは操作できない（§13.4.4）。

#### 13.4.3b 専用ページの「ご予約一覧」（`/p/[token]/bookings` の member 版・V4）

取引先の `/bookings`（`+page.server.ts`・`[id]`）は取引先予約（`rms_partner_bookings`）の一覧なので**流用しない**。member 版は**公式マイページの予約一覧・詳細（`account/+page.server.ts`・`account/reservations/[code]/**`）の読み取りと画面を写し**、操作だけ `member_page_*` の入口に向ける【判断】。

- **一覧 `/p/[token]/bookings`**: `requirePortalSession`（member）→ `createSupabaseServerClient(event)`（会員の authenticated クライアント・公式と同じ）で `sbMyReservations(client)` → `memberPage?.partnerId === partner.id` の予約だけ（**本人が予約したもの**。家族の予約は各自のログインで・Q10）。表示はマイページの一覧と同じ（「N室」・状態・金額）。施設タブで絞らない（ページ全体の予約・施設名を出す）。
- **詳細 `/p/[token]/bookings/[code]`**: マイページの予約詳細と同じ部品（部屋カード・金額・部屋ごとのキャンセル料と返金見込み〔`sbComputeCancelFee(client, code, roomIndex)`〕・オプション一覧〔`sbListMyBookingOptions`〕・変更履歴〔`list_my_amendments`〕）＋ 専用特典（部屋ごと）・方式。予約が `member_page.partner_id ≠ partner.id` なら 404。
  - **取消**: 部屋カードの「この部屋を取り消す」→ `?/cancelRoom` → `member_page_cancel_booking_room`（service_role・`partnerServiceClient().schema('book')`）→ `refundAfterCancel(code, 'member', {roomIndex})`。「すべてのお部屋を取り消す」→ `?/cancel` → `member_page_cancel_booking` → `refundAfterCancel`。条件（生きている部屋がすべて reserved・最後の 1 室なら全体取消の注意）はマイページと同じ。
  - **日程変更 `/p/[token]/bookings/[code]/amend`**: 日付・泊数だけ（1 室の予約も）。load は変更候補の日付で **`quotePartnerBooking`（`credit: false`）を生きている部屋の（roomCode, planCode, planName, adults）の組ごとに呼び**（コードは `booking_rooms.rate_plan_id` → `rate_plans.code / name`、`core.stays.room_type_id` → `room_types.code` を service_role で解決）→ `lines` に組み直し → `member_page_quote_amendment_dates(..., p_rooms)` で見積（部屋ごとの今と変更後・クーポン／ポイントの再按分・ペナルティ・在庫の目安）。専用ページの料金ルールで出せない日（休館・料金なし・プランがルールに無い）は「この日程には変更できません」。`?/amend` は同じ手順で `lines` を作り直して `member_page_amend_booking_dates`（画面の金額は受け取らない）。失敗の文言は公式の `amend_*` と同じキー（`sold_out`→「全室のお部屋を確保できません」・`in_penalty`・`prepaid_online`・`amend_limit`・`deadline_passed`）。
  - **オプション `/p/[token]/bookings/[code]/options`**: マイページの `options` と同じ画面（部屋の選択・M2）→ `?/add` → `member_page_add_booking_options`。
- 確認モード（`preview`）では一覧・詳細は出さず「確認モードではご予約一覧は表示されません」（会員が居ないため）。
- アクセスログ: `booking_view` / `booking_cancel` / `booking_amend` / `booking_options` を `portalActor`（`member_user_id`）で残す。

#### 13.4.4 公式マイページ・非会員リンク（V5・参照のみ）

- トップ（`account/+page.server.ts`）: `listMemberPagesFor(userId)`（service_role・`rms_member_pages_for`）→ `{ name, href: '/p/<token>/calendar', facilityNames, via }[]` を `memberPages` で返す。0 件なら欄を出さない。`admin-client.ts` の冒頭コメントに「例外その7（マイページの専用ページ一覧・`rms_member_pages_for`）」を追記。
- 一覧（`account/+page.svelte`）: 専用ページ経由の予約に「特別会員ページ」バッジ（`memberPage` あり）。
- 予約詳細（`account/reservations/[code]`）: `MemberReservation` に `memberPage?: MemberPageSnapshot | null`（`my_reservations.member_page`）、`rooms[i].memberPerks?` を足す。表示は**参照のみ**: 部屋カードに「専用特典」、見出しに「{page_name} 経由」と方式。**取消（全室・1 室）・日程変更・オプションのボタンは出さず**、「このご予約の変更・取消は特別会員ページから行えます」と `/p/<url_token>/bookings/<code>` へのリンク（`url_token` は service_role で `rms_partners` から解決・`memberPageHrefOf(partnerId, code)`）。`sbComputeCancelFee` の `rules_source='member_page'` の表示はそのまま（規定の表）。
  - **サーバ側でも止める**: `?/cancel`・`?/cancelRoom`・`amend/**`・`options/**` の load / action は `memberPage` ありなら `fail(403, { code: 'member_page_booking' })`／303 で予約詳細へ。DB のガード（§13.3.10）が二重に効く（RPC を直接叩いても `member_page_booking`）。
- **非会員リンク `/booking/cancel?t=`**: 専用ページ経由の予約には `cancel_token` を発行しないので通常は来ない（§13.3.12）。管理画面の「取消リンク再発行」（`admin_rotate_cancel_token`）などで来た場合は `guestBookingByToken` の `member_page: true` で「このご予約は特別会員ページからお手続きください」と `member_page_url` へのリンクを出し、取消ボタンは出さない（押されても DB が `member_page_booking`）。
- 完了画面（`/booking/complete/[code]`）: `LastBooking.memberPageUrl` があれば「ご予約の確認・変更は特別会員ページのご予約一覧から」。

#### 13.4.5 管理画面（V2）

- 取引先一覧 `/admin/partners`: 種別の絞り込み（すべて／取引先〔agent・corporate・other〕／特別会員）。**既定は「すべて」**（Q6・2026-10-10 決定）。新規作成の `kind` の選択肢に「特別会員」を**出さない**（作成は会員詳細から・下）。
- 取引先詳細 `/admin/partners/[id]`（`kind==='member'`）:
  - 隠す: PMS の顧客マスタとの紐づけ・与信・デポジット・支払方法と請求条件・毎回聞く項目（`options`）・団体予約・予約一覧（取引先予約の一覧。会員の公式予約は予約管理で見る）・ご請求書・ログインID・REST API・お支払いカード・覚書・第2要素の方針。アクセスログは残す（会員の閲覧ログ）。
  - 出す: 限定URL（再発行・確認ページを開く）・共通の設定（名前・公開設定・有効期間・備考）・施設タブ（販売・予約受付・何日先・残室・並び順・特別レートの要約と RMS リンク・プラン名・特典・案内文・**最大室数〔1〜4〕**・最大泊数）・プレビュー・**対象の会員**（新設）・**キャンセル規定**（新設・施設タブ）。
  - 対象の会員: 検索（`adminFindMembers`・会員番号／メール／電話）→ 追加（`?/addMember`・service_role で `rms_partner_members` insert・`created_by`）／外す（`?/removeMember`）。下に「家族として使える会員」（`rms_partner_member_list` の `via='family'`・読み取り・「家族の編集は PMS で」）。admin のみ（`staffPartnerScope('edit')`）。
  - キャンセル規定（施設タブ・`cancelPolicyMode` / `cancelRules`）: ラジオ 3 択（既定 favorable）＋ `page`/`favorable` のとき規定の表（日数前・率 %・不泊）。`cancelRules` は `[{days_before, rate}]` で保存。既存の施設タブの保存 `?/saveFacility`（`parsePartnerFacilityForm`）に載せる。
  - `validatePartnerBookingSettings` の支払方法必須は `kind==='member'` で外す（Z12）。`maxRooms` は member のとき 1〜4 に clamp。
- 会員詳細 `/admin/members/[id]`: 「専用ページ」欄。この会員が対象の専用ページ（本人・家族）の一覧（取引先詳細へのリンク・公開状態・施設）と「専用ページを作る」（admin）。作成 `?/createMemberPage`: `createPartner(db, scope, { name: '{会員名}様 専用ページ', kind: 'member', is_active: false, booking_enabled: false, … })` → `rms_partner_members` に insert → `/admin/partners/<id>` へ 303。`createPartner` は `facilityId` を要るので `ab_fac` の施設で作る（他施設は施設タブでオン）。グレードの手動変更（V0）は同じページの `rank` action。
- 予約管理 `/admin/reservations/[code]`: `booking.member_page` があれば「特別会員の専用ページ経由（{page_name}）・{方式}」を 1 行、部屋の表（`BookingRoomsTable`）の各行に特典（`rooms[i].member_perks` のタイトル）を小さく。**スタッフの操作（全室・1 室の取消・免除・返金の再実行・メール再送・取消リンク再発行）は従来どおり**（`p_by='staff'|'admin'` はガードを通る）。管理画面に日程変更は無い（従来どおり）。

#### 13.4.6 `lib/partner-member-page.ts`（純関数・テスト付き・A が書く）

`isMemberPage(kind)`・`memberPageBookingOpen(partner)`・`memberMaxRooms(s)`（`min(4, s.maxRooms)`）・`toCancelRules(PlanTerms-like) / fromCancelRules`・`memberBenefitLines(rankCode, rewardRate, cancelMode)`・`parseMemberHoldRooms(get)`（`rooms` JSON か 1 タップのフィールド → `{ok, rooms}` / `{ok:false, code:'missing'|'too_many_rooms'|'invalid'}`）・`toHoldLines(quoteRoom, adults)`（`quotePartnerBooking` の `rooms[i]` → `lines[]`・仮押さえと日程変更で共用）・`perksSnapshotOf(perks, planCode)`・`memberPageBookingsOf(reservations, partnerId)`（一覧の絞り込み）・`memberPageHrefOf(token, code)`・`CANCEL_POLICY_MODES` / `CANCEL_POLICY_LABELS`・型 `MemberPageSnapshot`・`MemberPerkSnapshot`・`MemberCartItem`・`MemberAmendRoomLines`。

#### 13.4.7 member で使わない列・機能（§4.1 への追記）

`payment_method_id`・`pms_guest_id`・`booking_name_mode`・`credit_over_action`・`memorandum*`・`stripe_customer_*`・`mfa_policy`・`booking_settings` の `paymentOptions` / `customPaymentOptions` / `invoice*` / `prepayDiscount`（公式の早期決済割・予約時決済割を使う・Q3）/ `creditDeposit*` / `notifyPartner` / `options` / `groupInquiry*` / `notifyEmails`（公式予約のメールの仕組みがある）・取引先アカウント（`rms_partner_accounts` / `sessions` / `passkeys` / `mfa_challenges`）・API キー・団体予約・添付ファイル・覚書・請求書・保存カード（取引先の）・取引先の予約経路（`rms_partner_create_booking`・`/book/reserve`・`/book/quote` は料金の表示だけに使う）。

### 13.5 権限・安全

- **URL だけでは何も見えない**: `kind='member'` の `resolvePortal` は会員セッションが無い・対象外なら `session=null`。料金・特典・プラン名・お知らせを含む load はすべて `requirePortalSession` の後ろ（トップの案内画面は施設名と「会員ログイン」だけ）。月 JSON（`/calendar/month`）・`book/quote` も同じ関所。
- **対象者の二重検査**: TS（`resolvePortal` の `rms_member_page_access`）と RPC（`create_member_page_hold_group` の中）の両方。家族判定も同じ SQL 関数 1 本。
- **仮押さえの本人確認**: `hold_groups.session_id = ab_book_sid`（path `/`・公式と共有）かつ `hold_groups.member_user_id = ログイン中の会員`。確定・取消・変更は公式の RPC（authenticated・`auth.uid()`・`is distinct from` の比較）なので既存の本人確認がそのまま効く。
- **料金の正しさ**: RPC は TS が渡す `lines` の形だけ検査する（取引先予約と同じ）。TS は画面の値を信用せず、`?/hold` でサーバが `quotePartnerBooking` を呼び直して明細を作る（かごの `total` は表示用）。`_check_room_total` トリガーが `Σ subtotal = room_total` を再検証する。
- **service_role の使いどころ**: 仮押さえ（既存の例外その6と同じ）・`rms_partner_members` / `rms_member_page_access` / `rms_member_pages_for` / `rms_partner_member_list`（取引先モジュール内）・`member_ranks` の読み取り・UUID／コード解決（`rate_plans` / `room_types` / `rms_partners.url_token`）・**専用ページの操作の入口 `member_page_*`**（対象者・予約の持ち主・ページの一致を RPC の中で確かめ、`set_config` で会員を名乗って既存 RPC を呼ぶ。`direct_payment_confirm` と同じ作法）。確定・ポイント・専用ページの予約一覧の**読み取り**は会員の authenticated クライアント（service_role を使わない）。
- **公式マイページ・非会員リンクからの操作の拒否**は DB のガード（`_member_page_guard`・§13.3.10）が最終防衛。TS の `fail(403)` は案内のため。`book.member_page_ctx` を立てられるのは service_role 専用の入口だけ。
- **日程変更の料金**: RPC は `lines` の形だけ検査し、料金の正しさは TS（`quotePartnerBooking` をサーバで呼び直す）が持つ。仮押さえと同じ流儀。
- **確認モード**（管理画面の「確認ページを開く」）: member でも従来どおり署名付きクッキーで見られる。会員名の代わりに「管理者の確認」と出し、「予約へ進む」・かごの送信は止める（`denyPreviewWrite`）。
- **会員のログアウト・退会**: 公式の `/auth/logout`。退会（`withdrawn_at`）した会員は `rms_member_page_access` が false。
- **レート制限**: `?/hold` は公式と同じ KV `hold:<ip>` ＋ DB の `rate_limited`（束で数える・公式と共用）。Turnstile は付けない（Q4）。
- **情報の持ち出し**: 専用ページの応答ヘッダは `PORTAL_HEADERS`（no-store・same-origin・noindex）のまま。会員の氏名・ポイントはヘッダーにだけ出す。かごは sessionStorage（タブを閉じれば消える・金額は表示用）。

### 13.6 2 エージェントの分担と契約（団体予約・複数室と同じ流儀: A が先に終わり、§14 を書いてから B が作る）

| 担当 | ファイル |
|---|---|
| **A: DB／サーバ** | autumn-shared の migration 1 本（§13.3・M2 の後ろの実秒）と巻き戻し用の関数定義の保存（13 本）、autumn-shared `functions/send-booking-mail/templates.ts`（`member_page_url`・テスト）、`lib/partner-member-page.ts`（§13.4.6・テスト）、`lib/server/partners/member-bookings.ts`（新規: 一覧の絞り込み・`member_page_*` の呼び出し `memberPageCancelBooking` / `memberPageCancelBookingRoom` / `memberPageAddOptions` / `memberPageQuoteAmendDates` / `memberPageAmendDates`・日程変更の `lines` の組み立て〔コード解決 → `quotePartnerBooking`〕）、`lib/multi-room.ts`（かごの純関数を型引数・保存キー付きに広げる・公式の動きは変えない・既存テストが通ること）、`lib/partner-booking.ts`（`cancelPolicyMode` / `cancelRules` を `PartnerBookingSettings` と `PARTNER_FACILITY_SETTING_KEYS` に・`validatePartnerBookingSettings` の member 分岐・`maxRooms` の clamp）、`lib/server/partners/store.ts`（`PartnerKind` に `member`・`PARTNER_KIND_LABELS`・`PartnerSessionAccount.member`・`rms_partner_members` の読み書き `listPartnerMembers` / `addPartnerMember` / `removePartnerMember`・`memberPagesFor`）、`lib/server/partners/portal.ts`（`resolvePortal` の member 分岐・`portalHeader.member / kind`・`requireMemberPortalAbsent`・`portalActor`）、`lib/server/partners/member-hold.ts`（新規: `quotePartnerBooking` → `lines`・UUID 解決・`payCompatible`・特典の写し・`createMemberPageHoldGroup`）、`lib/server/partners/staff-form.ts`（`parsePartnerKind`・キャンセル規定のフォーム）、`lib/server/supabase-data.ts`（`sbGetHoldGroupMapped` に `memberPage` / `rooms[i].memberPerks`・`sbMyReservations` の `memberPage` / `rooms[i].memberPerks`）、`lib/server/admin-app-data.ts`（`adminSetMemberRank`・`BookingDetail.booking.memberPage`）、`lib/server/admin-client.ts`（コメント追記）、各 `+page.server.ts` / `+server.ts` の load・actions（`routes/p/[token]/**`〔`+page.server.ts`・`book/+page.server.ts` の member 分岐・`calendar/**`・**`bookings/+page.server.ts` の member 分岐・新規 `bookings/[code]/+page.server.ts`・`bookings/[code]/amend/+page.server.ts`・`bookings/[code]/options/+page.server.ts`**〕・`routes/(public)/booking/hold`〔load の `memberPage` だけ〕・`booking/complete/[code]`〔`memberPageUrl`〕・`booking/cancel`〔`member_page` の案内〕・`account`・`account/reservations/[code]/**`〔参照のみ・action の拒否〕・`routes/admin/partners/**`・`routes/admin/members/[id]`・`routes/admin/reservations/[code]`）、member で 404 にするルートの先頭 1 行 |
| **B: 画面** | `routes/p/[token]/+layout.svelte`（会員ヘッダー・メニューの絞り込み〔ご予約一覧を含む〕・かごバーの差し込み）、`routes/p/[token]/+page.svelte`（member の案内画面）、`routes/p/[token]/book/+page.svelte`（member 版の確認画面。既存の取引先版は `data.portal.kind` で分岐するか、`MemberBookConfirm.svelte` を切り出して差し込む）、**`routes/p/[token]/bookings/+page.svelte`（member 分岐・一覧）・`bookings/[code]/+page.svelte`・`[code]/amend/+page.svelte`・`[code]/options/+page.svelte`（公式マイページの `account/reservations/[code]/**` の部品を `lib/components/booking/` に切り出して両方から使う）**、`lib/components/partner/PartnerBookingCart.svelte`（新規・公式 `BookingCart.svelte` の見た目を写す・送り先 `/p/<token>/book?/hold`・Turnstile なし）、`lib/components/PartnerStaySearch.svelte`・`PartnerPlanDetailModal.svelte`（「＋ もう 1 室追加」・特典の 2 段目・室数 `min(4, maxRooms)`）、`lib/components/MemberBenefitList.svelte`（新規）、`routes/(public)/booking/hold/+page.svelte`（見出し・部屋カードの専用特典・方式）、`booking/complete/[code]/+page.svelte`・`booking/cancel/+page.svelte`（専用ページへの案内）、`routes/(public)/account/+page.svelte`（専用ページのリンク・バッジ）、`account/reservations/[code]/+page.svelte`（特典・規定・操作ボタンの代わりに専用ページへのリンク）、`routes/admin/partners/+page.svelte`（絞り込み）、`routes/admin/partners/[id]/+page.svelte`（member の表示切替・対象の会員・キャンセル規定・最大室数。部品 `admin/PartnerMemberList.svelte`・`admin/PartnerCancelPolicyForm.svelte`）、`routes/admin/members/[id]/+page.svelte`（専用ページ欄・グレード変更の実データ対応の文言）、`routes/admin/reservations/[code]/+page.svelte`（経由と特典の 1 行・部屋の表の特典）、`messages/{ja,en,zh-TW}.json`（`member_page_*`） |

**A → B の契約（A が §14 に正式版を書く。ここは骨子）**

- `data.portal`（全 `/p/[token]` ページ）: 既存 ＋ `kind: 'partner' | 'member'`、`member: { name, rankCode, rankLabel, rewardRate, balance, via: 'self'|'family' } | null`、`memberState: 'ok' | 'anonymous' | 'denied' | null`（トップだけ）、`mypageHref: '/account'`。
- `loadStayPage` の返り値に `memberBenefits: string[]`（2 段目の行・member のときだけ）、`booking.maxRooms`（member は `min(4, s.maxRooms)`）、`cartPlans: { planCode, planName, pay: {onsite, prepay} }[]`（かごの `pay` 用）。
- `/p/[token]/book`（member）load: `{ portal, target: { roomCode, planCode, planName, displayName, checkIn, guests, nights, roomCount }, quote: BookingQuote, perks, memberBenefits, earnEstimate: number, cancelMode: { mode, label, rules|null }, canBook, deadlineText, back, holdRooms: MemberHoldRoom[] /* hidden rooms JSON の元 */ }`。action `?/hold`: 入力 `rooms` JSON `[{roomCode, planCode, planName, adults}]`（1〜4）・`checkin`・`nights`・`facility_id`。成功は 303 `/booking/hold?id=<束 id>`。失敗 `fail(status, { message, code: 'sold_out'|'rate_limited'|'too_many_holds'|'forbidden'|'closed'|'too_many_rooms'|'mixed_payment'|'invalid', soldOut?: [{roomTypeId, roomName}] })`。
- `/booking/hold` load: 既存 ＋ `hold.memberPage: { pageName, via, cancelMode: { mode, label }, backHref } | null`、`rooms[i].memberPerks: { title, description }[] | null`。
- `/p/[token]/bookings`（member）load: `{ portal, reservations: MemberReservation[] /* このページの分だけ */ }`。`/p/[token]/bookings/[code]` load: 公式 `account/reservations/[code]` と同じ形（`booking`・`rooms[]`〔`cancelFee`・`cancelPreview`・`refundPreview`・`memberPerks`・`cancelRulesSource`〕・`options`・`amendments`・`canCancelRoom`・`canAmend`）＋ `memberPage`・`hrefs: { amend, options, back }`。actions `?/cancel`・`?/cancelRoom(roomIndex)`（成功 `{ cancelled: true, refund }`／`fail(status, { message, code })`）。`[code]/amend` load: `{ current: { checkin, nights, rooms[] }, quote: AmendDatesQuote | null, unavailable: string | null }`、action `?/amend(checkin, nights)`。`[code]/options` は公式の `options` と同じ契約（action `?/add`）。
- `/booking/cancel` load（`state:'ready'`）: 既存 ＋ `memberPage: { url } | null`（あれば案内だけ・actions は呼ばない）。`/booking/complete/[code]`: `memberPageUrl: string | null`。
- `/account` load: 既存 ＋ `memberPages: { name, href, facilityNames: string[], via }[]`。一覧の各予約に `memberPage: { pageName } | null`。
- `/account/reservations/[code]` load: 既存 ＋ `memberPage: { pageName, cancelMode, href /* 専用ページの予約詳細 */ } | null`、`rooms[i].memberPerks`、`rooms[i].cancelRulesSource: 'plan'|'rank'|'member_page'`、`readOnly: boolean`（member_page なら true・操作ボタンを出さない）。actions は `readOnly` で `fail(403, { code: 'member_page_booking' })`。
- 管理画面 `/admin/partners/[id]`: 既存 ＋ `isMemberPage: boolean`、`members: Promise<{ member_user_id, member_code, name, email, rank_code, via, created_at }[]>`、`facility.cancelPolicy: { mode, rules }`、`facility.maxRooms`（member は 1〜4）。actions `?/addMember`（`member_user_id`）・`?/removeMember`（`member_user_id`）・`?/searchMembers`（`q` → `{ candidates }`）。
- `/admin/members/[id]`: 既存 ＋ `memberPages: { partnerId, name, isActive, facilityNames, via }[]`、`canCreateMemberPage`。actions `?/createMemberPage`（303 取引先詳細）・`rank`（実データ対応・`{ rankChanged: true }` / `fail(400, { message })`）。
- `/admin/reservations/[code]`: `booking.memberPage: { pageName, cancelMode } | null`、`rooms[i].memberPerks`。
- かごの純関数と型は `lib/multi-room.ts`（型引数付き）と `lib/partner-member-page.ts`（`MemberCartItem`・`MEMBER_CART_STORAGE_KEY`）。

**順序**: A が migration を書く → 使い捨てコンテナで M0→M1→M2→本 migration を当てて主な RPC を流す（M0〜M2 の作法。ガードが公式マイページ経路を止め、`member_page_*` が通ること・専用料金での日程変更・1 室の予約の日程変更も）→ 巻き戻し用の関数定義（13 本）を PROD から保存 → main に push → `supabase db push --linked --dry-run`（対象がこの 1 本だけ）→ 本適用 → `migration list --linked` で両側に version があることと、`information_schema` で表・列（`holds.member_perks` / `booking_rooms.member_perks`）・関数の実体を確認 → **`send-booking-mail` をデプロイ**（`supabase functions deploy send-booking-mail --no-verify-jwt`・migration と同時）→ TS を実装 → §14 を書く → B が着手。親がレビュー・結合・バージョン（MINOR）・HANDOFF.md の転記。**Book のデプロイは migration の後**（新 Book は `member_page` を返す `get_hold_group` / `my_reservations` と `member_page_*` を使う。旧 Book は新 DB でそのまま動く。ガードは `member_page` が無い予約には効かないので、旧 Book の既存予約の操作は変わらない）。

### 13.7 テストチェックリスト（HANDOFF.md へ転記する元）

#### DB
- [ ] `rms_partners.kind` に `member` を入れられる。`ambassador` も制約は通るが管理画面の選択肢には無い
- [ ] `rms_member_page_access`: 対象者 true／PMS の家族（同じ `family_group_id`）の会員 true／無関係 false／退会者 false。グレードは関係しない
- [ ] `create_member_page_hold_group`: 対象外の会員は `forbidden`、公開停止・施設オフ・予約受付オフは `page_unavailable`、公式非公開のプランは `plan_not_found`、泊数と `lines` の長さ・日付の連続・`subtotal` が合わないと `invalid_lines`。5 室は `invalid_room_count`。同じ IP 10 分 21 束目は `rate_limited`（公式の束と合算）。在庫が無い部屋タイプは `sold_out:<id>`（何も減らない）。2 室（和室 ×2・専用料金）で和室 −2・`holds.member_perks` が部屋ごと・`hold_groups.metadata.member_page` が束に 1 つ・1 室目の `holds.id` ＝ 束 id
- [ ] `get_hold_group`: `member_page` と `rooms[i].member_perks` が返る。公式の束では `member_page` が null
- [ ] `confirm_booking_group`（現地払い）・`direct_payment_confirm`（カード）: 専用ページの束で確定すると `bookings.metadata.member_page`・`booking_rooms.member_perks`（部屋ごと）が入り、`total_amount` が専用料金の和 − クーポン。各部屋の `core.stays.notes` の先頭が「【特別会員特典】…」（特典の無いプランの部屋には無い）。`booking_rooms.cancellation_policy_snapshot` が方式どおり（page＝`{rules: 専用規定, source: 'member_page'}`・favorable＝プラン規定＋`member_page`・rank＝プラン規定のまま）。`bookings.cancellation_policy_snapshot` は null。公式の束（`member_page` なし）・yamado-one の `confirm_booking` は従来どおり
- [ ] `_cancel_fee`: favorable で専用規定の方が安い日は `rules_source='member_page'`、公式が安い日は従来どおり。page は専用規定で計算。rank は従来どおり。`compute_cancel_fee(code, as_of, room_index)`・1 室ずつの取消（`cancel_booking_room`・`guest_cancel_booking_room`）・全室一括・非会員リンクの `rooms[i].fee`・`amend_booking_dates` のペナルティ判定で、部屋ごとに同じ結果
- [ ] `my_reservations`: 末尾に `member_page`・`rooms[i].member_perks`。既存 19 列の名前・順序が変わらない（yamado-one）
- [ ] ガード: 専用ページ経由の予約に会員の authenticated クライアントで `cancel_booking` / `cancel_booking_room` / `quote_amendment(_dates)` / `amend_booking(_dates)` / `add_booking_options` → `member_page_booking`。非会員トークン（管理画面で再発行）の `guest_cancel_booking(_room)` も `member_page_booking`、`guest_booking_by_token` は `member_page=true`・`cancellable=false`。スタッフの `admin_cancel_booking(_room)`・免除は通る。公式の予約（`member_page` なし）は従来どおり
- [ ] `member_page_cancel_booking(_room)`: 対象外の会員・別のページの予約・家族が予約した分は `forbidden` / `not_member_page_booking`。本人なら取消され（1 室→その部屋だけ・最後の 1 室→全体）、`cancelled_by='member'`・電文・メール・ポイント返還が公式の会員の取消と同じ
- [ ] `member_page_quote_amendment_dates` / `member_page_amend_booking_dates`: 2 室の予約を 1 日ずらす（`lines` は専用料金）→ 全室の日付・`price_lines` / `room_total` が専用料金・クーポン／ポイントの再按分・在庫 ±N・`booking_amendments(kind='dates')`・電文 `modified/dates`。`lines` の長さ・日付・`adults`・`subtotal` が合わないと `invalid_lines`。1 室でもペナルティ期間なら `in_penalty`。オンライン決済済みは `prepaid_online`。2 回まで。1 室の予約も同じ入口で日程だけ変わる。部屋ごとの `cancellation_policy_snapshot`・`member_perks` は変わらない
- [ ] `_confirm_booking_group`（専用ページ）: `mail_outbox.payload` に `member_page_url`・`cancel_token` は null。`booking_access_tokens` に guest_cancel のトークンが作られない。公式の束では従来どおり `cancel_token`
- [ ] `_emit_pms_event`: 電文の `member_page`・`rooms[i].member_perks`・各滞在の `notes` に特典の行。autumn-pms の取込が従来どおり通る（未知のキーを無視）
- [ ] `admin_set_member_rank`: admin で変わり `admin_audit_logs` に `change_rank`。staff は `forbidden`。理由なしは `reason_required`

#### 専用ページ（本番ドメインまたは localhost・会員 2 名〔対象者・家族〕と無関係の会員 1 名）
- [ ] 未ログインで `/p/<token>` → 施設名と「会員ログイン」だけ。料金・特典・プラン名は出ない。`/calendar`・`/calendar/month`・`/book/quote` も料金を返さない
- [ ] 公式サイトでログイン済みの対象会員が開く → そのまま `/calendar`。ヘッダーに「{会員名} 様 専用ページ」・グレード・ポイント
- [ ] 無関係の会員 → 「ご招待の会員さま専用です」。URL を知っていても料金が見えない
- [ ] 家族（PMS で同じ家族・グレードは standard）が開ける。予約すると家族本人の名前・グレードで公式予約になる（`member_page.via='family'`）
- [ ] メニューは 料金カレンダー・お部屋・プラン・料金表 だけ。`/bookings`・`/group`・`/memorandum`・`/account`・`/mfa`・`/payment`・`/legal`・`/book/reserve` は 404
- [ ] 料金が取引先と同じ仕組み（RMS の特別レート・先計算）で出る。RMS で料金ルールを変えると反映される
- [ ] 特典が 2 段（専用特典／会員特典〔還元率・キャンセル方式・ポイント利用可〕）で出る。プラン指定の特典はそのプランにだけ
- [ ] 2 施設オンの専用ページで施設を切り替えると料金・特典・キャンセル方式がその施設のもの。かごに別施設の部屋は入らない（「かごを空にしますか」）
- [ ] 料金カレンダーの室数は 4 まで（取引先の最大室数が 5 以上でも）。「予約する」（同じタイプ ×2）→ 確認画面に部屋ごとの専用料金・特典・会員特典・獲得予定ポイント → 「予約へ進む」→ 公式 `/booking/hold` に 2 室・金額が専用料金・部屋カードに専用特典・見出しに「{page_name} 経由」・「選び直す」が専用ページへ戻る
- [ ] 「＋ もう 1 室追加」で別タイプ・別プランをかごに入れ、4 室目で注意・5 室目は入らない。支払方法が両立しないプランは入らない。「予約へ進む」で全室が押さえられ公式 `/booking/hold` へ。1 室だけ満室だとどの部屋かが出てかごは残る
- [ ] 現地払いで確定 → マイページの予約一覧に出る（「2室」）。PMS の予約詳細で部屋ごとの要望欄の先頭に「【特別会員特典】…」（特典の無いプランの部屋には無い）。ポイント付与が専用料金の和 × グレードの率
- [ ] 予約時決済（カード・保存カード）で確定できる。早期決済割・予約時決済割が専用料金に対して部屋ごとに付く。請求額 ＝ 画面の合計
- [ ] ポイント利用・クーポンが公式と同じに使える（按分は部屋の金額比）
- [ ] 確認メールの「ご予約の変更・取り消し」が専用ページの予約詳細（`/p/<token>/bookings/<予約番号>`）へのリンクで、`/booking/cancel?t=` が無い。限定 URL を再発行した後も古いメールのリンクで（リダイレクトされて）開ける
- [ ] **専用ページの「ご予約一覧」**: メニューに出る。このページから予約した分だけ（公式サイトから予約した分・別の専用ページの分・家族が予約した分は出ない）。詳細に部屋カード・専用特典・方式・部屋ごとのキャンセル料と返金見込み
- [ ] 専用ページから 1 室だけ取消 → その部屋の専用規定（favorable の日・page の日を 1 件ずつ）でキャンセル料、その部屋の分だけ返金（カード払い）。残りの部屋の特典は残る。「すべてのお部屋を取り消す」→ 全体取消・クーポン復帰。PMS に部屋ごとの取消ログ
- [ ] 専用ページから日程変更（2 室・1 室とも）: 日付・泊数だけ。変更後の金額が**専用料金**（料金カレンダーの同じ日の金額と一致）・部屋ごとの今と変更後が出る。専用ページで料金が出ない日（休館・料金なし）は「この日程には変更できません」。全室ぶんの在庫が無い日は「全室のお部屋を確保できません」。カード払い済みは不可。PMS の泊行が作り直される
- [ ] 専用ページからオプション（滞在アレンジ）を部屋を選んで付けられる。取り消した部屋のオプションは取消済み
- [ ] 公式マイページの予約詳細は参照のみ（「特別会員ページから変更・取消できます」のリンク → 専用ページの予約詳細へログイン状態のまま移る）。URL 直打ちの `amend` / `options`・`?/cancel` の POST は 403 で止まり、DB でも `member_page_booking`
- [ ] 管理画面からスタッフが専用ページ経由の予約を取消（全室・1 室・免除・返金の再実行）できる。再送したメールのリンクも専用ページ
- [ ] 受付締切（leadDays）を過ぎた日は「予約へ進む」が出ない
- [ ] 確認モード（管理画面の「確認ページを開く」）で会員なしに見られ、「予約へ進む」・かごの送信は止まる
- [ ] 同じ IP で 10 分に 21 回目の仮押さえは 429
- [ ] 取引先（agent/corporate）の `/p/<token>` が従来どおり（会員でログインしていても会員名が出ない・取引先ログインが必要・かごが出ない）。公式サイトの予約かご（`ab_booking_cart_v1`）が従来どおり動く

#### マイページ
- [ ] トップに「あなた専用のページ」（本人・家族の分。施設名つき）。対象でない会員には出ない。押すとログイン状態のまま専用ページへ
- [ ] 一覧に「特別会員ページ」バッジ。予約詳細に「{page_name} 経由」・キャンセル方式・部屋ごとの専用特典。取消・日程変更・オプションのボタンが無く、専用ページへのリンクがある。公式サイトから予約した分は従来どおり操作できる

#### 管理画面
- [ ] 会員詳細の「専用ページを作る」→ `kind='member'`・公開停止・予約受付オフで作られ、その会員が対象に入り、取引先詳細へ移る。staff には出ない
- [ ] 会員詳細でグレードを変更できる（admin・理由必須・監査ログ）。staff は不可
- [ ] 取引先詳細（member）: 請求・与信・PMS 紐づけ・ログインID・API・覚書・団体予約・支払方法・請求書が出ない。対象の会員・キャンセル規定・最大室数（1〜4）・限定URL・施設タブ・プレビューが出る。支払方法なしで予約受付をオンにできる
- [ ] 対象の会員を検索して追加・外せる。家族として使える会員が読み取りで並ぶ
- [ ] キャンセル規定: 3 方式の切替と規定表の保存。保存後に専用ページの会員特典の説明が変わる。既存の予約は予約時の方式のまま（部屋ごとの `cancellation_policy_snapshot`）
- [ ] 取引先一覧は既定で全部出て、種別で絞れる（取引先／特別会員）
- [ ] 予約管理の予約詳細に「専用ページ経由」と部屋ごとの特典が出る。1 室取消の返金の再実行が従来どおり
- [ ] 取引先詳細のアクセスログに会員の閲覧（`member_user_id`）が出る

### 13.8 決定事項と要確認

> **2026-10-10 決定（ユーザー回答）**: Q1・Q3・Q4・Q5・Q7・Q8 は推奨どおり。Q2 は複数室（公式の複数室を先に実装・特別会員はその上に載せる→ 本改訂で反映）。Q6 は取引先一覧を種別に関係なく全部表示。

| # | 論点 | 決定 |
|---|---|---|
| Q1 | 専用ページに出すプランの範囲 | **公式サイトで公開しているプランだけ**（専用料金で安くする）。公式非公開の VIP 専用プランは次の段 |
| Q2 | 1 回の予約の室数 | **複数室・最大 4 室**（公式と同じかご・同じ施設・同じ日程。部屋タイプ・プラン・人数は部屋ごと）。取引先の最大室数が 5 以上でも 4 |
| Q3 | 早期決済割・早期決済ポイント・予約時決済割 | **公式と同じ**（専用料金に対して付く・切替なし） |
| Q4 | 仮押さえ `?/hold` に Turnstile | **付けない**（会員ログイン済み・KV と DB の上限あり） |
| Q5 | 専用ページの作成権限と初期状態 | **admin のみ・公開停止・予約受付オフで作る** |
| Q6 | 取引先一覧の既定の絞り込み | **すべて表示**（種別で絞れる） |
| Q7 | `ambassador` を今回の check 制約に入れるか | **入れる**（制約だけ・TS には出さない） |
| Q8 | 会員特典の 2 段目に出す内容 | **還元率・キャンセル方式・ポイント利用可の 3 行** |
| Q9 | 専用ページ経由の予約の管理と日程変更の料金（2026-10-11 決定） | **専用ページの「ご予約一覧」で管理する**（取消〔全室・1 室〕・日程変更・オプションはすべてそこから）。**日程変更は専用料金で計算し直す**（TS が `quotePartnerBooking` で出した部屋ごとの `lines` を新 RPC `member_page_amend_booking_dates` に渡して検証・規則は公式と同じ・方式は部屋ごとの snapshot を引き継ぐ）。公式マイページは参照のみ（DB のガードで操作を拒否）。非会員リンクは専用ページへ案内。管理画面は従来どおり。確認メールのリンクは専用ページの予約詳細 |

**要確認（推奨案つき・最小限）**

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| Q10 | 専用ページの「ご予約一覧」に**家族が予約した分**を出し、取消・変更できるようにするか（家族は同じページを使える・D3） | A. **本人が予約した分だけ**（家族は各自がログインして自分の分を操作。`member_page_*` の入口も `metadata.member_user_id = 本人` を要求）／B. 家族の分も見られて操作できる（`my_reservations` は本人の滞在しか返さないので、家族の予約を読む新 RPC と入口の条件緩和が要る） | **A**（会員の予約は会員本人のもの・ポイントの逆仕訳も本人の台帳。B は次の段で足せる） |

> **2026-10-11 決定: Q10 は A（本人が予約した分だけ）**（ユーザー回答）。
>
> Q10 以外は本節の【判断】で置いた（専用のかご部品・特典の行は DB で付ける・プラン名の上書きは専用ページの中だけ・確認メールに特典を載せない・電文に `member_page` を足す・1 室の予約も専用ページでは日程だけ変更・ガードは内部関数 5 本に・予約一覧の読み取りは公式の RPC をそのまま使う）。親のレビューで覆してよい。

---

## 14. 実装メモ（サーバ側の契約）

> 2026-10-11 A（DB／サーバ）。autumn-book・autumn-shared とも **commit / push なし・本番 DB 未適用**（読み取り SQL だけ）。`+page.svelte` と部品は触っていない（B が本節を読んで作る）。
> 検証: 使い捨てコンテナ（`supabase/postgres:17.6.1.084`）に M0 と同じスタブ＋特別会員用のスタブ（`rms_partners`・`rms_partner_facilities`・`pms.guest_families`・`book.v_plans` 等）→ M0 → M1 → M2 → **本 migration** を当て、§14.6 の RPC と巻き戻しを流した。`svelte-check --threshold error` 0 件・`vitest` 737 件（新規 25 件）・send-booking-mail の vitest 39 件（新規 5 件）。

### 14.1 migration（1 本・`autumn-shared/supabase/migrations/20261010221207_book_member_page.sql`）

写す元は PROD の定義（`schema_migrations` は `20261010204933` まで一致を確認）。差し替えた既存関数は、コンテナの定義の `md5(prosrc)` が PROD と一致することを 14 本とも確かめてから写した（`_cancel_fee` だけはコンテナがスタブなので PROD の定義を読んで写した）。各関数の直前のコメントに写す元を書いた。表の DDL は `rms_partners` の kind の check・新表 `rms_partner_members`・`holds.member_perks` / `booking_rooms.member_perks` の列だけ（`booking.bookings` / `core.stays` の DDL なし）。

| 節 | 中身 |
|---|---|
| 0 | V0 `book.admin_set_member_rank(member_user_id, rank_code, reason)`（admin・理由必須・同じグレードなら `changed:false`・監査 `change_rank`。`actor` は uuid 列なので `auth.uid()`） |
| 1 | `rms_partners_kind_check` を `('agent','corporate','other','member','ambassador')` に（PROD の制約名は確認済み） |
| 2 | `public.rms_partner_members`（PK `(partner_id, member_user_id)`・RLS 有効・ポリシーなし・anon/authenticated の権限を外す）、`rms_member_page_access`（本人 or 家族・退会者は false）、`rms_member_pages_for`（公開中・有効期間内・施設が 1 つ以上オン・`via`）、`rms_partner_member_list`（self ＋ family・`withdrawn` 列を足した） |
| 3 | `holds.member_perks` / `booking_rooms.member_perks`（jsonb null） |
| 4 | 内部: `_member_page_guard(metadata, by)`・`_member_lines(lines, checkin, nights, adults)`（泊明細の形の検査 → `{lines, total}`・違えば `invalid_lines`）・`_member_perks_of(perks)`（`id/title/description` だけ・20 件まで） |
| 5 | `create_member_page_hold_group`（`create_hold_group` を写す）・`get_hold_group`（`member_page`・`rooms[i].member_perks`） |
| 6 | `_confirm_booking_group`（§14.2） |
| 7 | `_cancel_fee`（favorable・page の `rules_source='member_page'`） |
| 8 | 読み取り: `_booking_rooms_view`・`my_reservations`（drop → create・末尾に `member_page`）・`admin_booking_detail`・`guest_booking_by_token`・`_emit_pms_event` |
| 9 | ガード（`_cancel_booking_core`・`_cancel_booking_room_core`・`_amend_compute`・`_amend_compute_dates`・`add_booking_options`）・`admin_resend_booking_mail`（§14.8-3） |
| 10 | 入口: `_member_page_booking_check`・`member_page_cancel_booking`・`member_page_cancel_booking_room`・`member_page_add_booking_options`・`member_page_booking_rooms`・`member_page_plans`・`_amend_compute_member_dates`・`member_page_quote_amendment_dates`・`member_page_amend_booking_dates` |

- **差し替えた既存関数（14 本）**: `get_hold_group`・`_confirm_booking_group`・`_cancel_fee`・`_booking_rooms_view`・`my_reservations`・`admin_booking_detail`・`_emit_pms_event`・`guest_booking_by_token`・`_cancel_booking_core`・`_cancel_booking_room_core`・`_amend_compute`・`_amend_compute_dates`・`add_booking_options`・**`admin_resend_booking_mail`**（設計の 13 本＋1）。
- **新しい関数（17 本）**: `book.admin_set_member_rank`・`public.rms_member_page_access`・`public.rms_member_pages_for`・`public.rms_partner_member_list`・`book._member_page_guard`・`book._member_lines`・`book._member_perks_of`・`book.create_member_page_hold_group`・`book._member_page_booking_check`・`book.member_page_cancel_booking`・`book.member_page_cancel_booking_room`・`book.member_page_add_booking_options`・`book.member_page_booking_rooms`・`book.member_page_plans`・`book._amend_compute_member_dates`・`book.member_page_quote_amendment_dates`・`book.member_page_amend_booking_dates`。権限はどれも service_role だけ（`admin_set_member_rank` は authenticated・service_role）。
- **巻き戻し**: migration 末尾のコメント（`begin … commit`）。適用前の定義は `autumn-shared/docs/rollback/20261010221207_functions_before.sql`（コンテナから保存し `_cancel_fee` を PROD の定義に差し替えたもの。**当てる直前に末尾のコメントの SQL で PROD から取り直して上書きする**）。コンテナで「新しい関数・表・列が消え、差し替えた関数の md5 が M2 の定義に戻る」ことを確認。`kind='member'` の取引先が残っていると check を戻せない（コメントに注記）。

### 14.2 RPC（DB）の入出力

**`book.create_member_page_hold_group(p_session_id, p_member_user_id, p_partner_id, p_facility_id, p_checkin, p_nights, p_rooms jsonb, p_member_page jsonb, p_client_key, p_locale='ja')`**（service_role）

- `p_rooms[i]`: `{ rate_plan_id? | rate_plan_code?, room_type_id? | room_type_code?, adults, lines:[{date, unit_price, adults, subtotal}], member_perks?:[{id,title,description}] }`。**コードでも受ける**（`rate_plan_code` ＝ `booking.rate_plans.code` ＝ 料金カレンダーの `planCode■planName`、`room_type_code` ＝ `pms.room_types.code`。この施設のものだけ・無ければ `plan_not_found` / `room_not_found`）。TS はコードで渡す（§14.8-1）。
- `p_member_page`: `{ page_name, cancel_policy_mode, cancel_rules }`。`partner_id / facility_id / member_user_id` は RPC が上書き、**`via` も RPC が決める**（対象に入っている会員なら `self`、家族なら `family`）。`cancel_rules` は 0〜365 日・率 0〜1 の段だけ残す。
- 検査の順: 引数 → `rms_member_page_access`（`forbidden`）→ ページ（`kind='member'`・`is_active`・有効期間・`rms_partner_facilities.enabled and booking_enabled`。違えば `page_unavailable`）→ 試行上限・同じセッションの解放（公式と共用）→ 部屋ごと（`plan_not_found`・`room_not_found`・`invalid_lines`）→ 在庫（`sold_out:<room_type_id>`）。戻りは `create_hold_group` と同じ（`rooms[i].member_perks` が増える）。
- 束 `hold_groups.metadata = {member_page: {...}}`、部屋 `holds.member_perks`。1 室目の `holds.id` ＝ 束 id。

**`_confirm_booking_group`**（`confirm_booking_group`・`direct_payment_confirm` から）: 束に `member_page` があるときだけ ―
(a) `auth.uid()` が `member_page.member_user_id` と違えば `forbidden`（§14.8-2）／(b) 部屋の `core.stays.notes` の先頭に `【特別会員特典】title／title`（その部屋の回答 → 代表の要望の前）／(c) `bookings.metadata.member_page` に写す／(d) `booking_rooms.cancellation_policy_snapshot` に方式を合成（`page` かつ規定あり → `{rules: 専用規定, source:'member_page'}`・`favorable` → プラン規定（配列は `{rules}` に正規化）＋`member_page:{mode:'favorable', rules}`・`rank` → そのまま）／(e) `booking_rooms.member_perks`／(f) メールの `cancel_token` を発行せず `payload.member_page_url = '/p/<url_token>/bookings/<予約番号>'`。

**`_cancel_fee`**: snapshot がオブジェクトで `source='member_page'` なら `rules_source='member_page'`。`member_page.mode='favorable'` で専用規定の率の方が安ければその率・`rules_source='member_page'`（専用規定に該当の段が無い日は 0% として比べる）。

**読み取り**: `get_hold_group` → `member_page`・`rooms[i].member_perks`／`_booking_rooms_view` → `member_perks`（`admin_booking_detail`・`guest_booking_by_token`・`mail_render_context` の `rooms[]` に載る）／`my_reservations` → 既存 19 列＋**`member_page jsonb`**（末尾）・`rooms[i].member_perks`／`admin_booking_detail.booking.member_page`／`guest_booking_by_token` → `member_page: boolean`・`member_page_url`・専用ページ経由なら `cancellable=false`・`reason='member_page'`（取消済み等の理由があればそちらが先）／電文 → トップの `member_page`（無ければ null）・`rooms[i].member_perks`。

**ガード** `_member_page_guard(metadata, by)`: `metadata ? 'member_page'` かつ `by in ('member','guest_token')` かつ `current_setting('book.member_page_ctx')` ≠ `member_page.partner_id` → `member_page_booking`。スタッフ・管理者（`staff` / `admin`）は通る。

**入口**（service_role。前置き `_member_page_booking_check(partner, member, code)`: 対象者でなければ `forbidden`／予約が無ければ `not_found`／このページ経由でなければ `not_member_page_booking`／予約した本人でなければ `forbidden`〔Q10〕）

| 入口 | 中身 | 戻り |
|---|---|---|
| `member_page_cancel_booking(partner, member, code)` | `request.jwt.claim.sub` と `book.member_page_ctx` を立てて `cancel_booking(code)`（`by='member'`）・終わったら戻す | `cancel_booking` と同じ |
| `member_page_cancel_booking_room(…, room_index)` | 同じく `cancel_booking_room` | `{booking_code, room_index, cancellation_fee, remaining_rooms, booking_cancelled, …}` |
| `member_page_add_booking_options(…, items)` | 同じく `add_booking_options` | `{total_added, orders}` |
| `member_page_booking_rooms(partner, member, code)` | 読み取り（日程変更の料金を引き直す材料） | `{booking_code, facility_id, check_in_date, nights, status, rooms:[{room_index, cancelled, stay_status, adults, room_type_id, room_code, room_name, rate_plan_id, plan_code, plan_label, room_total}]}` |
| `member_page_plans(facility_id)` | 公開プラン（`public_on_direct`・`is_active`・`is_published`・コードに `■`）と会員の支払方法（`v_plans.payment_method`） | `[{rate_plan_id, plan_code, plan_label, payment_method}]` |
| `member_page_quote_amendment_dates(partner, member, code, checkin, nights, rooms)` | `quote_amendment_dates` を写し、本人確認を前置きに、見積を `_amend_compute_member_dates` に | `quote_amendment_dates` と同じ形 |
| `member_page_amend_booking_dates(…)` | `amend_booking_dates` を写し同上。`booking_amendments.member_user_id` ＝ 会員・お知らせの URL ＝ 専用ページの予約詳細 | `amend_booking_dates` と同じ |

`_amend_compute_member_dates(booking, checkin, nights, rooms)`: `rooms = [{room_index, lines}]`（生きている部屋ぶん・過不足は `invalid_lines`）。部屋ごとに `_member_lines`（`adults` ＝ その部屋の `core.stays.adult_count`）→ `_quote_of`。按分・ペナルティ・在庫の目安は写すだけ。部屋ごとの `cancellation_policy_snapshot` と `member_perks` は書き換えない。

### 14.3 Book のサーバ関数（autumn-book）

| ファイル | 中身 |
|---|---|
| `lib/partner-member-page.ts`（新・テスト `partner-member-page.test.ts`） | `isMemberPage`・`memberPageBookingOpen`・`memberMaxRooms`（`min(4, maxRooms)`）・`CANCEL_POLICY_MODES` / `CANCEL_POLICY_LABELS` / `CANCEL_POLICY_NOTES`・`normalizeCancelPolicyMode` / `normalizeCancelRules` / `toCancelRules` / `fromCancelRules` / `describeCancelRule`・`rankLabelOf`・`memberBenefitLines(rankLabel, rewardRate, mode)`・`earnEstimateOf`・型 `MemberPageSnapshot` / `MemberPerkSnapshot` と `parseMemberPageSnapshot` / `parseMemberPerks`・`perksSnapshotOf`・`memberPageInput`・`MemberHoldRoom` と `parseMemberHoldRooms(get, maxRooms)`・`groupMemberHoldRooms`・`MemberLine` / `toHoldLines`・`MemberAmendRoomLines`・`memberPageBookingsOf`・`memberPageHrefOf` / `memberPageCalendarHrefOf`・**かご** `MemberCartItem`・`MEMBER_CART_STORAGE_KEY='ab_member_cart_v1'`・`memberCartPayload`・`memberCartPayCompatible`・`isMemberCartItem`・`normalizeMemberCartItem` |
| `lib/multi-room.ts` | かごの判定を共用: `CartLike`・`canAddToCart<T>(cart, item, maxRooms=4)`・`cartGroups<T>(cart, planOf?)`・`readCartWith(storage, key, isItem, normalize?)`・`writeCartWith(storage, key, cart)`（`readCart` / `writeCart` は従来どおり・既存テスト通過）。`HoldGroup.memberPage?`・`HoldGroupRoom.memberPerks?`・`BookingRoom.memberPerks?` |
| `lib/partner-booking.ts` | `PartnerBookingSettings.cancelPolicyMode`（既定 favorable）・`cancelRules`。**施設ごとのキーは `PARTNER_FACILITY_MEMBER_KEYS = ['cancelPolicyMode','cancelRules']`**（§14.8-4）。`validatePartnerBookingSettings(s, bookingEnabled, kind?)`（member は支払方法の必須を外す） |
| `lib/server/partners/store.ts` | `PartnerKind` に `member`・`PARTNER_KIND_LABELS.member='特別会員'`・`PARTNER_CREATE_KIND_LABELS`（作成の選択肢・member なし）・`PartnerSessionAccount.member?: PortalMember`・`MEMBER_PORTAL_ACCOUNT_ID`（`logPartnerAccess` が account_id を null にする）・`listPartnerMembers` / `addPartnerMember` / `removePartnerMember` / `memberPageAccess` / `memberPagesFor` / `memberPagesForAdmin` |
| `lib/server/partners/portal.ts` | `resolvePortal`: member なら取引先セッションを見ず、`getSupabaseUser` → `my_profile` → `rms_member_page_access` → グレード（`member_ranks`）・ポイント → `session = {id: MEMBER_PORTAL_ACCOUNT_ID, login_id: 会員番号, display_name: 会員名, member}`。戻りに `memberState: 'ok'|'anonymous'|'denied'|null`・`memberName`。運営（admin/staff）のログインは `denied`。**member で使わないルートを一括で 404**（`MEMBER_PORTAL_DENIED`・§14.8-5）。`requireMemberPortalAbsent` / `requireMemberPortal`・`portalLogActor(session, detail)`・`portalHeader` に `kind / member / mypageHref`。member は MFA の関所を通さない |
| `lib/server/partners/member-hold.ts`（新） | `loadMemberPagePlans(db, facilityId)`（`Map<planCode■planName, {ratePlanId, pay}>`）・`quoteMemberRooms(db, partner, rooms, checkIn, nights, {ignoreRemaining?})`・`memberPageHold({db, partner, session, fd, sessionId, clientKey})` → `{ok, groupId, checkIn, nights, rooms}` / `{ok:false, status, code, message, soldOut?}`・`memberHoldBack`・`memberCancelSetting` |
| `lib/server/partners/member-bookings.ts`（新） | `memberPageReservations`・`memberPageCancelBooking` / `memberPageCancelBookingRoom` / `memberPageAddOptions` / `memberPageBookingRooms` / `memberAmendLines` / `memberPageQuoteAmendDates` / `memberPageAmendDates`・`memberPageOpError(e)`（DB の例外 → `{code, status, message}`）・`memberPageHrefFor(partnerId, code)`・`listMemberPagesFor(userId)` |
| `lib/server/member-reservation-detail.ts`（新） | 公式マイページの予約詳細の読み出しを切り出した `reservationDetailOf(event, client, r)`（`amendGate`・`multiRoomCards`・`multiRemainingRefund` も移した）＋ `memberPage`。`memberPageBookingOf(client, code)`・`MEMBER_PAGE_BOOKING_MESSAGE` |
| `lib/server/supabase-data.ts` | `sbGetHoldGroupMapped` → `memberPage`・`rooms[i].memberPerks`／`MemberReservation.memberPage`・`rooms[i].memberPerks`／`GuestCancelReason` に `member_page`・`GuestBookingLookup.member_page / member_page_url`／`LastBooking.memberPage`・`lastBookingMemberPageOf`／`rulesSource` に `member_page`／`mapAmendDatesQuote` を export |
| `lib/server/admin-app-data.ts` | `adminSetMemberRank`・`adminBookingDetail` が `booking.memberPage`（`cancelModeLabel` 付き）・`rooms[i].memberPerks` を足す（`withMemberPage`）・エラー文言 `member_page_booking` / `bad_rank` / `member_not_found` |
| `lib/server/partners/admin-client.ts` | 冒頭コメントに「例外その7」 |
| `lib/server/partners/staff-form.ts` | 施設タブの `facility_booking` に `cancelPolicyMode` / `cancelRules` があれば保存（無ければ今の値のまま） |
| `lib/server/partners/stay-page.ts` | member: 室数 `min(4, maxRooms)`・予約受付は支払方法を見ない（確認モードはオフ）・`memberBenefits`・`memberCancel`・`cartPlans`・取引先の取消期限 `cancelText` は null・ログは `portalLogActor` |
| autumn-shared `functions/send-booking-mail/templates.ts`（＋test） | `payload.member_page_url`（`/p/<token>/bookings/<code>` の形だけ受ける）があれば「■ ご予約の変更・取り消し」→ 専用ページのリンク・取消リンクは出さない・マイページの 1 行は「確認はマイページ・変更と取消は特別会員ページ」 |

### 14.4 各ルートの load / actions（B が使う契約）

- **全 `/p/[token]`**: `data.portal` に `kind: 'partner'|'member'`・`member: {name, rankCode, rankLabel, rewardRate, balance, via} | null`・`mypageHref: '/account' | null`。`bookingEnabled` は member なら会員がいれば true（メニューの「ご予約一覧」）。
- **`/p/[token]`（トップ）**: 既存 ＋ `memberState: 'ok'|'anonymous'|'denied'|null`・`memberName`・`memberLoginHref`（`/auth/login?next=/p/<token>/calendar`）・`memberLogoutHref`（`/auth/logout`）。member の対象者は `/calendar` へ 303。member の POST（取引先ログイン）は 404。
- **`/calendar`・`/plans`（`loadStayPage`）**: 既存 ＋ `booking.maxRooms`（member は 1〜4）・`booking.enabled`・`memberBenefits: string[] | null`・`memberCancel: {mode, label, rules} | null`・`cartPlans: {planCode, planName, pay:{onsite, prepay}}[]`（member だけ・取引先は []）。
- **`/p/[token]/book`（GET・member）**: `data = { portal, member: MemberBookData }`（**取引先の項目は無い**。型は取引先の形のまま `data.member` が増えた・取引先は `data.member = null`）。`MemberBookData = { portal, facilityId, target:{roomCode, planCode, planName, displayName, checkIn, guests, nights, roomCount}, photo, quote: BookingQuote（quote.rooms[i].nights が専用料金・quote.prepay は使わない）, perks: MemberPerkSnapshot[], memberBenefits: string[]|null, earnEstimate, cancelMode:{mode, label, rules|null}, pay:{onsite, prepay}|null, canBook, deadlineText, back, holdRooms: MemberHoldRoom[] }`。画面は `data.portal.kind === 'member'` で `data.member` だけを使う。
- **`/p/[token]/book`（POST・default action・member）**: 入力 `rooms`（JSON `[{roomCode, planCode, planName, adults}]`・1〜`min(4, maxRooms)`）か 1 タップ `room / plan / name / guests / rooms=N`・`checkin`（`date` も可）・`nights`・`facility_id`。成功 303 `/booking/hold?id=<束 id>`（`HOLD_NAV_COOKIE.back` は専用ページの料金カレンダー）。失敗 `fail(status, {message, code: 'sold_out'|'rate_limited'|'too_many_holds'|'forbidden'|'closed'|'too_many_rooms'|'mixed_payment'|'invalid', soldOut?: [{roomTypeId: 部屋タイプのコード, roomName}]})`。**`?/hold` ではなく default action**（§14.8-6）。かごの送信先も `POST /p/<token>/book`。Turnstile なし・KV `hold:<ip>`。
- **`/p/[token]/bookings`（member）**: `data = { portal, member: { portal, preview: boolean, reservations: [{code, href, status, checkin, checkout, nights, adults, roomCount, liveRooms, total, pointsUsed, pointsEarned, payment, paymentStatus, facilityId, facilityName, createdAt}], message: string|null } }`（取引先は `data.member = null`）。取引先の `?/cancel` は member では 404。
- **`/p/[token]/bookings/[id]`（新・member だけ・取引先は 404・`[id]` は予約番号）**: load は公式マイページの予約詳細と同じ形（`booking`・`checkout`・`options`・`amendments`・`rooms[]`〔`canCancel`・`fee`・`refundPreview`・`memberPerks`・`cancelRulesSource`〕・`multiRoom`・`amend`・`cancelPreview`〔`rulesSource` に `member_page`・規定は専用規定〕・`refundPreview`・`prepayBonus`・`memberPerks`（1 室）・`memberPage: {partnerId, pageName, via, cancelMode, cancelModeLabel, cancelRules}`）＋ `portal`・`facilityName`・`canCancel`・`canCancelRoom`・`canAmend`・`hrefs: {self, amend, options, back}`。actions: `?/cancel` → `{cancelled: true, refund}`／`?/cancelRoom`（`roomIndex`）→ `{roomCancelled:{index, fee, bookingCancelled}, cancelled, refund}`／`?/cancelOption`（`orderId`）→ `{optionCancelled}`。失敗 `fail(status, {code, message})`。
- **`/p/[token]/bookings/[id]/amend`（新）**: load `{ portal, code, current:{checkin, nights, rooms:[{index, roomCode, roomName, planCode, planName, adults, total}]}, candidate:{checkin, nights}|null, quote: AmendDatesQuote|null, unavailable: string|null, maxNights, hrefs:{back, self} }`。候補は `?checkin=&nights=`（GET で見積）。action `?/amend`（`checkin`・`nights`）→ 303 予約詳細／`fail(status, {code: 'sold_out'|'in_penalty'|'prepaid_online'|'amend_limit'|'deadline_passed'|'no_change'|'unavailable'|'invalid'|…, message})`。
- **`/p/[token]/bookings/[id]/options`（新）**: 公式の `account/reservations/[code]/options` と同じ（`code, checkin, checkout, items, rooms` ＋ `portal`・`hrefs.back`）。action `?/add`（`qty_<id>`・`date_<id>`・`note_<id>`・`roomIndex`）→ 303 予約詳細／`fail(400, {message})`。
- **`/booking/hold`**: 既存 ＋ `memberPage: {pageName, via, cancelMode:{mode, label}, backHref} | null`・`rooms[i].memberPerks`。確定時の `LastBooking.memberPage`。
- **`/booking/complete/[code]`**: `memberPageUrl: string|null`・`memberPageName`。
- **`/booking/cancel`**: 専用ページ経由は `state:'blocked'`・`reason:'member_page'`・`memberPage: {url}`（設計の「ready ＋ memberPage」ではない）。actions は `fail(403, {reason:'member_page', memberPage:{url}})`。
- **`/account`**: 既存 ＋ `memberPages: {name, href, facilityNames, via}[]`・各予約に `memberPage: {pageName} | null`。
- **`/account/reservations/[code]`**: 既存 ＋ `memberPage: {partnerId, pageName, via, cancelMode, cancelModeLabel, cancelRules, href} | null`・`rooms[i].memberPerks`・`rooms[i].cancelRulesSource`・`memberPerks`・`readOnly`。actions（`cancel`・`cancelRoom`・`cancelOption`）は専用ページ経由なら `fail(403, {code:'member_page_booking', message, href})`。`amend` / `options` は load で予約詳細へ 303・action は 403。
- **`/admin/partners`**: `kindFilter: 'all'|'partner'|'member'`（`?kind=`・既定 all）・`createKindLabels`。
- **`/admin/partners/[id]`**: `isMemberPage`・`members: Promise<PartnerMemberListRow[]>`・`facility.cancelPolicy: {mode, rules}`・`facility.maxRooms`・`facility.own` に `cancelPolicyMode / cancelRules`。保存は `?/saveFacility` の `facility_booking` JSON に `cancelPolicyMode` / `cancelRules`（rate は 0〜1）を入れる（member だけ保存・最大室数は 1〜4 に丸める）。actions `?/searchMembers`（`q` → `{memberQuery, candidates: MemberCandidate[]}` / `fail(400, {memberError})`）・`?/addMember`（`member_user_id` → `{memberAdded}`）・`?/removeMember`（→ `{memberRemoved}`）。`?/saveCommon` は member の kind を保つ・支払方法を求めない。
- **`/admin/members/[id]`**: `memberPages: {partnerId, name, isActive, facilityNames, via}[]`・`canCreateMemberPage`。actions `?/createMemberPage`（→ 303 `/admin/partners/<id>`・公開停止・予約受付オフ・`paymentOptions: []`・`maxRooms: 4`）・`rank`（実データ: `rank`・`rankReason` → `{rankChanged: true}` / `fail(400, {message})`）。
- **`/admin/reservations/[code]`**: `detail.booking.memberPage`（`pageName`・`cancelPolicyMode`・`cancelModeLabel` 等）・`detail.booking.rooms[i].memberPerks`。

### 14.5 本番に当てる順番と条件

1. 事前確認（読み取り）: `schema_migrations` の最新が `20261010204933`・差し替える 14 本が §14.1 の確認時から変わっていないこと。`docs/rollback/20261010221207_functions_before.sql` を末尾のコメントの SQL で PROD から取り直して上書き。
2. `supabase db push --linked --dry-run`（対象がこの 1 本だけ）→ 本適用 → `migration list --linked`。`information_schema` で `book.holds.member_perks`・`book.booking_rooms.member_perks`・`public.rms_partner_members`、`pg_proc` で新関数 17 本、`my_reservations` の戻りに `member_page` があることを確認。
3. **send-booking-mail を同時にデプロイ**（`supabase functions deploy send-booking-mail --no-verify-jwt`）。古いままだと専用ページ経由の確認メールに「変更・取り消し」の節が出ない（トークンが無いので取消リンクも出ない）。
4. Book のデプロイは migration の後（新 Book は `member_page_*`・`member_page_plans`・`my_reservations.member_page` を使う）。旧 Book は新 DB でそのまま動く（`member_page` の無い予約・束は従来どおり）。
5. yamado-one: `my_reservations` の列が 1 つ増える（末尾）。`confirm_booking`（旧署名）は変えていない。

### 14.6 確認した範囲（使い捨てコンテナ）

- 判定: 本人 t・家族 t・無関係 f・退会した家族 f・他人のページ f。`rms_member_pages_for` の `via`、`rms_partner_member_list` の self / family / withdrawn。種別の check（member・ambassador は入り、不明は弾く）。
- 仮押さえ: `forbidden`・`page_unavailable`（施設の予約受付オフ）・`invalid_lines`（長さ・日付・小計）・`invalid_room_count`（5 室）・`plan_not_found`（非公開プラン・存在しないコード）・`room_not_found`。2 室（和室 P1 特典あり・洋室 P2 はコードで指定・特典なし）で在庫 −1/−1・`holds.member_perks` が部屋ごと・束の `member_page`（`via` は DB が決める・`partner_id` の偽装は上書き）・`get_hold_group` に `member_page` と `rooms[i].member_perks`。
- 確定（現地払い）: 別の会員は `forbidden`。`total_amount` ＝ 専用料金の和・ポイント按分・付与見込み・部屋の `notes` 先頭に特典の行（特典なしの部屋には無い）・規定の合成（favorable）・`mail_outbox.payload` に `member_page_url`・`cancel_token` null・トークンが作られない・電文に `member_page` と `rooms[i].member_perks`。**カード**（`direct_payment_prepare/confirm`）でも同じ（早期決済割・入湯税つき・rank 方式）。page 方式（家族の予約・`via='family'`・家族本人のグレードで付与）。
- キャンセル料: favorable で専用規定が安い日だけ `member_page`、page は `member_page`、プランの配列形・rank は従来どおり。`compute_cancel_fee`（3 引数）で部屋ごと。
- ガード: 会員の `cancel_booking` / `cancel_booking_room` / `quote_amendment_dates` / `add_booking_options`、非会員の `guest_cancel_booking_room` が `member_page_booking`・`guest_booking_by_token` は `cancellable=false`・`reason='member_page'`・URL。`admin_cancel_booking_room`（スタッフ）は通る。`admin_resend_booking_mail` は取消リンクを出さず `member_page_url`。
- 入口: 家族（予約した本人でない）`forbidden`・別ページ `not_member_page_booking`・無関係 `forbidden`。オプション（2 室目）。日程変更の見積（`lines` 不足は `invalid_lines`）と確定（専用料金・在庫 ±・`booking_amendments` の会員・電文 `dates`・お知らせの URL が専用ページ・規定と特典は据え置き）。**1 室の予約の日程変更**も同じ入口で動く。1 室取消（`cancelled_by='member'`）→ 残りの全室取消。呼んだ後に `book.member_page_ctx` と `request.jwt.claim.sub` が戻っている。`member_page_booking_rooms`（他の会員は `forbidden`）・`member_page_plans`。
- 公式の束: `member_page` null・`cancel_token` あり・会員が取り消せる・規定と特典の列は従来どおり（電文の `member_page` は null）。
- V0: `reason_required`・`bad_rank`・変更と監査ログ。権限: anon / authenticated は入口・仮押さえ・ガード・判定を呼べない（`admin_set_member_rank` は authenticated 可・中で admin を確認）。
- コンテナに無い関数（`guest_cancel_booking`・`admin_cancel_booking` の 3 引数版など M0 以前の関数）は呼べていない（スタブに無いため）。`_cancel_booking_core` のガードは `cancel_booking` で確認済み。

### 14.7 B（画面）へのメモ

- `/p/[token]/book` と `/p/[token]/bookings` の `+page.svelte` は、**先頭で `data.portal.kind === 'member'` を見て `data.member` だけを描く分岐を入れる**（member のとき取引先の項目は data に無い）。
- 専用ページの新しい 3 ページ（`bookings/[id]`・`amend`・`options`）の `+page.svelte` は未作成（今は load だけ）。公式マイページの `account/reservations/[code]/**` の部品を切り出して使う想定（§13.6）。
- かごは `lib/multi-room.ts` の `canAddToCart(cart, item, memberMaxRooms(s))`・`cartGroups(cart, (c) => c.planCode)`・`readCartWith(sessionStorage, MEMBER_CART_STORAGE_KEY, isMemberCartItem, normalizeMemberCartItem)`・`writeCartWith`。`MemberCartItem.roomTypeId` には部屋タイプのコード（`roomCode` と同じ値）を入れる。支払方法は `cartPlans`（`planCode`・`planName` で引く）。
- 文言は日本語（取引先ページと同じ）。会員特典の 2 段目は `memberBenefits`（サーバが作る 3 行）。

### 14.8 設計から外れた点

1. **仮押さえの部屋はコードでも渡せるようにした**（`rate_plan_code` / `room_type_code`）。`booking` スキーマが Data API に出ていない前提（`booking.rate_plans` を service_role で読めない）なので、TS が UUID を解決する代わりに RPC がこの施設の中で解決する。同じ理由で、日程変更の材料（`member_page_booking_rooms`）と公開プランの支払方法（`member_page_plans`）の読み取り RPC を足した（設計に無い 2 本）。
2. **確定で「予約する会員 ＝ 束の会員」を確かめる**（`_confirm_booking_group` の (a)）。同じブラウザのセッションで別の会員がログインし直した場合に、他人の専用料金で予約できないように。
3. **`admin_resend_booking_mail` も差し替えた**（14 本目）。管理画面からの確認メールの再送でも取消リンクを出さず `member_page_url` を載せる（§13.7 の「再送したメールのリンクも専用ページ」を満たすため）。`admin_rotate_cancel_token`（取消リンクの再発行）は変えていない（発行されても非会員ページは案内だけ・DB のガードで止まる）。
4. **キャンセル方式・規定のキーは `PARTNER_FACILITY_SETTING_KEYS` ではなく `PARTNER_FACILITY_MEMBER_KEYS`**（施設ごと・`splitPartnerBookingSettings` で施設へ）。`PARTNER_FACILITY_SETTING_KEYS` に足すと `PartnerFacilityOwnSettings` が必須キーになり、既存の取引先詳細の画面（.svelte）が型エラーになるため。`PartnerFacilityOwnSettings` では省略可（送られたときだけ保存）。既存テスト 1 件の期待値（施設へ行くキーの一覧）を合わせて直した。
5. **member で使わないルートは `resolvePortal` が一括で 404**（`MEMBER_PORTAL_DENIED`）。各ルートに 1 行ずつ足す代わり（漏れが無いように）。`requireMemberPortalAbsent` は用意だけ。
6. **専用ページの「予約へ進む」は `?/hold` ではなく default action**（`/p/[token]/book` に取引先の default action があり、SvelteKit では default と名前付きを同じページに置けないため）。
7. **予約詳細のディレクトリは `bookings/[id]`**（取引先予約の添付 `bookings/[id]/attachments` と同じ階層に `[code]` を置くとルートが衝突する）。URL は設計どおり `/p/<token>/bookings/<予約番号>`。
8. **`/p/[token]/book` と `/bookings` の member の data は `{portal, member}`**（取引先の形の型を保つため `as never` で返す・取引先は `member: null`）。既存の .svelte を触らずに svelte-check を 0 件に保つため。
9. `guest_booking_by_token` は専用ページ経由で `reason='member_page'`（`cancellable=false`）。非会員ページは `state:'blocked'` で案内する（設計は ready ＋ memberPage）。
10. `rms_partner_member_list` に `withdrawn` 列を足した（退会した家族を画面で区別するため）。`rms_member_pages_for` は施設が 1 つもオンでないページを出さない。
11. 公式マイページの予約詳細の読み出しを `lib/server/member-reservation-detail.ts` に切り出した（専用ページの予約詳細と共用。マイページの表示は従来と同じ・`cancelPreview.rules` は `member_page` のとき専用規定）。
12. アクセスログ: 取引先の料金表（CSV / PDF）の記録は会員 id を持たない（`logPartnerAccess` が account_id を null にするだけ）。料金カレンダー・お部屋・月の JSON・予約・ご予約一覧は `detail.member_user_id` を残す。
13. `_member_page_booking_check` はページの公開状態（`is_active`・有効期間）を見ない（公開を止めても、既に予約した会員が取消・変更できるように）。ただし TS の `resolvePortal` は公開停止中のページを開かせないので、画面からは公開中だけ。

### 14.9 残したもの

- 画面（B）: §13.6 の B の全部。`/p/[token]/bookings/[id]/**` の `+page.svelte`・`/booking/hold` 等の表示。
- 専用ページの確認モードでのかご・予約詳細（会員が居ないので出さない）。
- `pointMultiplier`（§6.2）・確認メールへの特典の掲載・PMS 側の表示（V6）。
- 家族の予約を専用ページで操作する（Q10 の B 案）。
- `/booking/hold` の `REWARD_RATE` 直書きは触っていない。専用ページの獲得予定ポイントは `member_ranks.reward_rate` から。

### 14.10 レビュー（Fable）を受けて直した点（2026-10-11）

1. **対象から外された会員の予約（ユーザー決定: 運用で避ける）**
   - DB: `public.rms_member_page_live_bookings(partner_id, member_user_id default null)`（このページ経由で取消でなく・チェックアウト日が今日〔JST〕以降の予約の件数・service_role）。トリガー `rms_partner_members_guard_delete`（その会員の分が残っていれば `member_page_has_bookings:<件数>`）と `rms_partners_guard_member_delete`（kind='member' のページの分が残っていれば同じ）。専用ページ・会員そのものの削除の連鎖（cascade）では親が先に消えているので会員の行のトリガーは止めない（ページの削除は rms_partners のトリガーで確かめる）。巻き戻しのコメントにトリガー・関数の drop を足した。
   - TS: `removePartnerMember`・`deletePartner` が先に件数を見て `PartnerStoreError(409, 'member_page_has_bookings')`「このページ経由のご予約が残っているため外せません（N件）。」／「…削除できません（N件）。」。DB の例外も同じ文言に直す（`memberPageHasBookingsCount`）。管理画面の `?/addMember`・`?/removeMember` の失敗は `memberError`（「対象の会員」欄に出る）。
   - コンテナ: 生きている予約のある会員を外す・ページを消す → `member_page_has_bookings:1`。予約の無いページ Q は会員を外せて消せる（Q を消すと連鎖で M1 の Q の行も消える）。予約を取り消すと外せる。
   - **運用メモ（HANDOFF 用）**: PMS の家族のつながりが切れた・退会した等で専用ページの対象外になった会員の、専用ページ経由の予約は、会員自身では操作できない。**取消・返金は管理画面の予約詳細からスタッフが行う**（スタッフの操作はガードを通る）。日程変更・オプションはお電話で受け、取消 → 取り直しか管理側で対応。家族が予約した分は、対象の会員（本人）を外してもトリガーは止めない（数えるのは外す会員本人が予約した分だけ）。
2. `admin/members/[id]` の `?/createMemberPage` は会員を一覧（1,000 件）から探さず、`memberForMemberPage(db, tenantId, userId)`（`book.members` 1 行＋`core.guests` の氏名・同じテナント・service_role）で引く。load の会員の読み出し（`admin_list_members` から探す）は従来のまま（単体取得の RPC が無いため・別件）。
3. `memberPageOpError` を `lib/partner-member-page.ts` へ移し（`member-bookings.ts` は再輸出）、例外の文の語（英小文字と _ のかたまり）を**具体的な語から**判定する表にした（`room_not_found` が `not_found` に、`option_sold_out` が `sold_out` に先に当たらない）。テストを足した。
4. 管理画面 `PartnerCancelPolicyForm.svelte` と `CANCEL_POLICY_NOTES.favorable`（会員特典の 2 段目にも出る）に「専用ページの規定に当てはまる段が無い日はキャンセル料なし（0%）として比べる」を明記。
5. 公式マイページの action の `memberPageBookingOf` は `my_reservations` を全件読み直したまま（会員本人の予約を 1 件だけ引く RPC が無く、`booking` スキーマも Data API に無いため）。予約は会員 1 人ぶんなので件数は小さい。据え置き。
6. 低: `resolvePortal`・`requirePortalSession`・`requirePortalApi` の `url` を必須にした（呼び元はすべてルートの event）。添付の入口（`portal-attachments.ts` の `PortalEvent`）に `url` を足した（型の上で `url` が無いと、専用ページで使わないルートの一括 404 の判定がパスを見られないため）。

再確認: コンテナで M0→M1→M2→本 migration と §14.6 の RPC・上の 1 の削除の止め・巻き戻しを流し直した（結果は前回と同じ＋新しい止め）。`svelte-check` 0 件・`vitest` 745 件・send-booking-mail 39 件。
