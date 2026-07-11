# autumn-book 予約後機能（変更・オプション・グレード別キャンセル・先行予約）設計（v2・2026-07-11）

- **目的**: `/membership` にマーケティングコピーのみで掲載中の会員特典 4 機能を、実機能として実装可能な状態まで設計する。
  1. 予約後の変更（宿泊日／人数／部屋・プラン）
  2. 食事・オプション予約（宿泊パーソナライズを含む）
  3. グレード別キャンセル料規定
  4. OTA 先行予約割引（会員先行予約）
- **v1（同日）からの変更**: §9 の未決 10 件についてユーザー決定を受領し、全面反映した（§0.0）。主な方式変更は
  ①グレード別キャンセルを「係数方式」→「**グレード別ルール表マスタ（管理画面編集）**」へ、②先行予約の管理を **rms 側へ全面移管**、
  ③ポイント付与の確定を**チェックアウト基準**へ、の 3 点。
- **前提とする設計書**: `autumn_book_rms_pricing_design.md`（v2）— 料金 SoT は rms マスタの理論式。`booking.daily_rates.price_adult_1..6` に人数帯別 pp（税込）が入る。在庫は暫定で TL 残室差分適用（Phase C/D で PMS 化）。
- **土台とする実装済みスキーマ**: `autumn-shared/supabase/migrations/*_book_*.sql`（構想版 ERD `autumn_book_erd.md` の名前は使わない）。
- **設計規律**: DDL は **book スキーマ内で完結**（core / booking への ALTER はしない）。汎用化しない・山人業務に最適化・テナント分岐を作らない。既存 RPC は**シグネチャ不変＋新規追加**で後方互換を守る。

---

## 0. 概要・スコープ・非スコープ

### 0.0 ユーザー決定（2026-07-11・v1 §9.1 の 10 件）

| # | 論点 | 決定 |
|---|---|---|
| 1 | 基準キャンセル料の規定 | **管理画面（book `/admin`）から会員グレードごとにルール表をマスタ管理**。standard 行が実質の基準規定 |
| 2 | グレード別優遇の具体値 | #1 の方式変更により解消（係数は廃止。数値は管理画面から運用者が入力） |
| 3 | 先行予約の割引率・対象期間・公開ルール | **rms 側で管理**（book 側での管理は不要）。→ autumn-rms HANDOFF.md へ引き継ぎ済み |
| 4 | オプション商品の初期ラインナップ | 管理画面でマスタ管理。初期 2 品: **冷蔵庫「ノンアル化」**（personalize）・**アメニティ「タオル多め」**（amenity） |
| 5 | オプションの取消期限 | **提供日の前日までオンライン取消可**（無料）。当日以降は電話 |
| 6 | 変更回数の上限 | **2 回まで** |
| 7 | 差額の精算 | 現地決済（onsite）は**予約金額の書換えをそのまま反映**。Stripe 事前決済（将来）は**チェックアウト後に最終確定額で修正決済**。**キャンセル料発生期間に入ってからの日程変更は原則 NG**（ただしグレード別に許可可能） |
| 8 | ポイント付与再計算の rank 基準 | **チェックアウト基準**（チェックアウト時点の rank で最終確定） |
| 9 | 非会員（ゲスト予約）の変更 | **対応不可（電話のみ）**・確定 |
| 10 | クーポン併用予約の変更 | **percent 割引は変更の都度再計算**（fixed は据え置き） |

### 0.1 決定サマリ

| 論点 | 決定 | 背景 |
|---|---|---|
| 変更の対象者 | **会員のみ**（member.guest_id = stays.guest_id）。非会員ゲスト予約は電話対応（決定 #9） | membership ページの訴求どおり「会員特典」として実装。RPC の所有者判定は `cancel_booking` と同型 |
| 変更の実装方式 | **in-place 更新**（キャンセル＋再予約ではなく、同一 stay/booking を更新し履歴テーブルに記録）。**上限 2 回**（決定 #6） | 予約番号 YB-xxxx を維持する（ゲスト体験・PMS/精算連携・ポイント台帳の連続性）。履歴は `book.booking_amendments` |
| 変更後の料金 | **変更時点の理論式現在値で全泊再計算**（旧単価は引き継がない） | 料金 SoT は daily_rates（rms 理論式）。部分泊だけ旧値を残すと SoT と乖離し整合不能になる |
| 差額の決済 | 現地精算（`total_amount` の書換えをそのまま反映＝決定 #7）。Stripe 事前決済（将来）はチェックアウト後の修正決済に一本化し、amendment 行の settlement 列で区別 | rms 設計書 §5-5。`paid_amount` は現状常に 0 |
| ペナルティ期間の日程変更 | キャンセル料発生期間内は**原則 NG**。`rank_cancel_policies.allow_amend_in_penalty = true` のグレードのみ許可（決定 #7）。人数・部屋・プラン変更は期間内も可（宿泊日を動かさないため） | 「変更＝キャンセル料回避の抜け道」の裁定を封じる（v1 §1.1 注記のリスクを解消） |
| ポイント付与 | 予約確定時は暫定付与（現行どおり）→ **チェックアウト後に当時 rank で再計算し差分仕訳で確定**（決定 #8・§3.4） | 「チェックアウト基準」の決定。変更のたびに earn を触らず、確定処理に一本化して仕訳を最小化 |
| オプションの会計 | **宿泊料金と分離**（`booking.bookings.total_amount` に混ぜない。オプション明細は book 側で持ち現地精算） | booking スキーマ非改変の規律。PMS 精算時に stay_id で合算する将来接続を想定 |
| グレード別キャンセル | **グレードごとの「◯日前◯%」ルール表を `book.rank_cancel_policies` に持ち、book `/admin` で編集**（決定 #1）。適用はキャンセル操作時点の rank。プラン側 `cancellation_policy`（rms 由来）が非空ならプラン規定を優先（特別プラン用） | 係数方式（v1）は廃止。運用者が直接ルール表を編集できるほうが分かりやすく、standard 行がそのまま「基準規定」になる |
| 先行予約の実現方式 | **rms 側で管理**（決定 #3）: rms が会員限定・先行販売プラン（割引込み価格）をマスタ定義し、既存の理論式 sync で daily_rates に流れる。book 側は `plan_contents.min_rank_order` による表示・予約フィルタと、先行期間の在庫 seed のみ | rms が料金 SoT である以上、割引もプラン定義（rms）に置くのが一貫。book に販売窓テーブル（v1 §2.5 `advance_sales_windows`）は**作らない** |
| 会員限定プランの土台 | `book.plan_contents.min_rank_order`（NULL=全員） | plan_contents は book スキーマなので ALTER 可 |

### 0.2 非スコープ（今は作らない）

| 項目 | 理由 |
|---|---|
| 子供料金・子供人数の変更 | 未モデル化（rms 設計書 §5-4）。大人のみ運用を継続 |
| Stripe 事前決済の差額課金/返金の実装 | 全プラン onsite。方式は決定済み（チェックアウト後の修正決済＝§3.4）だが、実装は Stripe 接続時 |
| 多通貨 | 円のみ |
| オプションの Stripe 決済 | 現地精算のみ |
| 非会員（ゲスト予約）のオンライン変更 | 電話対応（決定 #9・確定） |
| テナント招待・汎用設定画面等 | CLAUDE.md「今は作らないリスト」どおり |
| TL-リンカーンへの変更書き戻し | Phase D（PMS 切替後）。それまで在庫は book ローカル＋TL差分適用の既存方式 |

---

## 1. 業務ルール

### 1.1 予約変更（宿泊日／人数／部屋・プラン）

| ルール | 内容 |
|---|---|
| 変更可能な状態 | `booking.bookings.status = 'confirmed'` かつ `core.stays.status = 'reserved'`（チェックイン処理後・キャンセル後は不可） |
| 締切 | **チェックイン日の朝 9:00（施設タイムゾーン）まで**。`now() < (stays.check_in_date::timestamp + interval '9 hours') at time zone facilities.timezone`。`core.facilities.timezone`（既存列・既定 'Asia/Tokyo'）を使う |
| 変更できる項目 | 宿泊日（checkin）・泊数（1⇄2泊等）・大人人数（1..6・部屋 capacity_max 以内）・部屋タイプ・プラン。**全て「新しい組合せへの差し替え」として単一 RPC で処理**（種別は履歴の分類にのみ使う） |
| **回数上限** | **2 回まで**（決定 #6）。`bookings.metadata.amended_count >= 2` で `amend_limit` エラー。3 回目以降は電話 |
| **ペナルティ期間の日程変更** | 会員の現 rank ルール表（プラン規定が非空ならそちら）で**現時点のキャンセル料率 > 0** なら、checkin/泊数を動かす変更は `amend_in_penalty` エラー。`rank_cancel_policies.allow_amend_in_penalty = true` のグレードは許可（決定 #7）。人数・部屋・プランのみの変更は期間内も可 |
| 締切の統一 | 人数・部屋・プラン変更も同じ「CI 日 9:00」に統一（運用簡素化）。オプションは §1.2 の期限で個別管理 |
| 料金 | 変更時点の daily_rates（理論式現在値）で全泊再計算。差額 = 新支払額 − 旧支払額（±両方あり得る）。onsite では書換えをそのまま反映（決定 #7） |
| クーポン | **percent**: 新総額に対して**都度再計算**（決定 #10）`new_discount = floor(new_total × value / 100)`。min_total の再検証はせず失効もさせない。**fixed**: 据え置き（new_charge にクランプ） |
| ポイント利用分 | 据え置き。ただし新支払額 < points_used となる縮小変更では、超過分を自動返還（+側の逆仕訳）し `points_used` を新支払額にクランプ |
| ポイント付与分 | **変更時は触らない**。チェックアウト後の確定処理（§3.4）で最終支払額 × チェックアウト時 rank により一括再計算（決定 #8） |
| キャンセル規定 snapshot | 日程・人数・部屋のみの変更では**据え置き**。**プラン変更時のみ**新プランの `cancellation_policy` で snapshot を取り直す |
| 同一条件への変更 | 差分ゼロ（同一プラン・部屋・日程・人数）はエラー（no-op 防止） |

### 1.2 食事・オプション予約（宿泊パーソナライズ）

| ルール | 内容 |
|---|---|
| 対象 | 会員かつ自分の予約（reserved・未チェックイン）に対する事前予約。カタログ閲覧自体は anon 可（販促） |
| 商品の型 | スパ／マッサージ／アクティビティ／食事追加／アメニティ追加／冷蔵庫の中身（パーソナライズ）を**単一のオプションマスタ**（`book.option_items`）で表現。カテゴリ列で区分 |
| マスタ管理 | **book `/admin/options`** で CRUD（決定 #4）。初期 2 品: 冷蔵庫「ノンアル化」（personalize）・「タオル多め」（amenity）。単価・締切・公開は管理画面から設定 |
| 課金単位 | `per_person`（人数分）／`per_unit`（個数）／`per_stay`（滞在あたり1式）の 3 型 |
| 申込締切 | 商品ごとの `lead_time_hours`（例: 食事追加=72h、アメニティ=24h）。基準はチェックイン日 15:00（施設 TZ）から遡る。予約変更の CI 9:00 締切とは独立 |
| **取消** | **提供日の前日（施設 TZ・23:59）までオンライン取消可・無料**（決定 #5）。`requires_service_date = false`（滞在全体に紐づく per_stay）はチェックイン日の前日まで。当日以降は宿へ電話 |
| 会計 | 現地精算。宿泊料金（bookings.total_amount）とは別建て。税は内税 10%（入湯税と同様、宿泊理論式には混ぜない） |
| ポイント | オプション購入分はポイント付与・利用の対象外（v1。将来検討） |
| 在庫 | `stock_type='per_day'` の商品のみ日別数量上限（`daily_capacity`）。貸切風呂等の時間枠予約は**スコープ外**（アプリ3・貸切風呂予約システムの領域） |
| 宿泊日変更との連動 | 予約変更（§1.1）で宿泊日が変わった場合、`service_date` が新滞在期間から外れるオプション明細は**アプリが警告表示し会員が取り直す**（自動移動は在庫・締切の再検証が絡み事故のもと）。amend_booking は該当明細を `status='needs_reschedule'` にマークする |

### 1.3 グレード別キャンセル料規定（v2・ルール表マスタ方式）

| ルール | 内容 |
|---|---|
| マスタ | `book.rank_cancel_policies`（rank ごとに `rules jsonb = [{days_before, rate}]` のルール表を保持）。**book `/admin/cancel-policies` で編集**（決定 #1） |
| 基準規定 | **standard 行のルール表が実質の基準規定**。非会員（anon 予約・スタッフ代行）にも standard 行を適用 |
| プラン規定との関係 | `bookings.cancellation_policy_snapshot`（rms 由来のプラン規定）が**非空ならプラン規定を優先**（早割・返金不可等の特別プラン用）。現状は全プラン `'[]'` のため、グレードマスタが全予約の規定になる |
| 適用タイミング | **キャンセル操作時点の rank** のルール表を適用（予約時 rank ではない）。昇格が即時反映されるほうが特典として自然 |
| 適用者 | 会員本人のキャンセル・スタッフ代行とも同じ計算（`waive_fee` は従来どおり全額免除の別レバー） |
| 計算式 | `rate = rules を days_before（check_in_date − 操作日）で評価`（昇順・最初に該当）→ `fee = round(total_amount × rate)` |
| 監査 | 適用した rank・rules・rate を `bookings.metadata.cancel_rank_benefit` と `admin_audit_logs`（スタッフ時）に記録 |
| ペナルティ期間との連動 | §1.1 の「日程変更 NG 判定」も同じルール表で行う（現時点 rate > 0 ならペナルティ期間内） |
| seed | 4 ランク全行を `rules = '[]'`（キャンセル料ゼロ＝現行同挙動）で投入。**実規定の投入は管理画面から**（公開前必須タスク・rms 設計書 §5-3 の解消手段） |

### 1.4 OTA 先行予約割引（会員先行予約）— rms 側管理に全面移管（決定 #3）

| 項目 | 内容 |
|---|---|
| 概念 | OTA（TL 経由）で未販売の「先々の宿泊期間」を、会員にだけ先行公開し割引付きで販売する |
| **管理の所在** | **割引率・対象期間・公開/終了ルールはすべて rms 側で管理**。rms が「会員限定・先行販売プラン」（割引込み価格）をマスタ定義し、既存の理論式 sync（`sync_rms_rates_range`）が daily_rates を生成する。book に販売窓テーブルは**作らない**（v1 §2.5 廃止） |
| book 側の責務 | ① `plan_contents.min_rank_order` による表示・予約フィルタ（会員 rank_order 未満のプランは非表示・予約不可。anon には行も見せない）② 先行期間の在庫 seed（`book.seed_advance_availability`・`/admin` から実行）③「会員先行」バッジ表示 |
| rms 側の前提（handoff 済み） | ① `rms_rank_calendar` の恒久化（rms 設計書 §3.1・Phase B+）を先行期間分まで入力可能に ② sync の rank 取得を「rms_rank_calendar 優先 → TL day_rank フォールバック」へ ③ OTA 一般販売開始時の切替運用（先行プランの販売終了）。**→ autumn-rms/HANDOFF.md に記載済み（2026-07-11）** |
| ポイント・クーポン併用 | 併用可。割引はプラン価格そのもの（daily_rates）に織り込まれるため、confirm_booking の計算順に割込まない |
| **技術前提（最重要）** | 先行期間は TL キャッシュに rank カレンダーも残室も存在しない。ランクは rms_rank_calendar（rms 側）、在庫は seed RPC（book 側）で補う。**この 2 つが揃うまで P4 は着手不可** |

---

## 2. データモデル設計（book スキーマ内で完結）

### 2.1 予約変更履歴 `book.booking_amendments`（新規）

| 列 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| tenant_id | uuid | NOT NULL ref core.tenants | |
| facility_id | uuid | NOT NULL ref core.facilities | RLS 用デノーマライズ（admin_audit_logs と同型） |
| booking_id | uuid | NOT NULL ref booking.bookings | |
| stay_id | uuid | NOT NULL ref core.stays | |
| member_user_id | uuid | NOT NULL ref auth.users | 操作者（会員） |
| amendment_no | integer | NOT NULL check (amendment_no between 1 and 2) | 予約内連番。unique (booking_id, amendment_no)。**上限 2＝決定 #6 を CHECK でも担保** |
| kind | text | NOT NULL check in ('dates','party','room','plan','composite') | 表示分類。複数項目同時なら composite |
| before | jsonb | NOT NULL | 変更前 {rate_plan_id, room_type_id, checkin, checkout, adults, total, points_used, coupon_discount, policy_snapshot} |
| after | jsonb | NOT NULL | 変更後（同構造）+ price_snapshot（quote 全文） |
| price_before | integer | NOT NULL | 旧支払額（bookings.total_amount） |
| price_after | integer | NOT NULL | 新支払額 |
| diff_amount | integer | NOT NULL | price_after − price_before |
| points_refund | integer | NOT NULL default 0 | クランプで返還した利用ポイント |
| settlement | text | NOT NULL default 'onsite' check in ('onsite','stripe_checkout_adjust') | 差額の精算方法。現状 'onsite' 固定。Stripe 接続後は「チェックアウト後修正決済」（決定 #7） |
| created_at | timestamptz | NOT NULL default now() | |

- v1 からの変更: `points_earn_delta` 列を**削除**（earn はチェックアウト確定に一本化・§3.4）。settlement の値域を決定 #7 に合わせ簡素化。
- **RLS**: 本人 select（`member_user_id = auth.uid()`）＋スタッフ select（`private.has_facility_access(tenant_id, facility_id)`）。insert/update は RPC（security definer）経由のみ。service_role フル。
- 既存テーブルへの反映: `booking.bookings.metadata` に `'amended_count'`, `'last_amended_at'` を追記（jsonb マージのみ・列追加なし）。`core.stays` は check_in_date / check_out_date / party_size / adult_count / room_type_id を UPDATE（列追加なし）。

### 2.2 オプション商品マスタ `book.option_items`（新規）

| 列 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | uuid | PK | |
| tenant_id | uuid | NOT NULL ref core.tenants | |
| facility_id | uuid | NOT NULL ref core.facilities | 施設別商品（山人業務に最適化・共通商品は作らない） |
| code | text | NOT NULL, unique (facility_id, code) | 例 'fridge-nonalc', 'towel-extra' |
| name | text | NOT NULL | ja ベース。en/zh-TW は content_translations |
| description | text | | Markdown 原文 |
| category | text | NOT NULL check in ('meal','spa','activity','amenity','personalize','other') | membership コピーの区分に対応 |
| price_type | text | NOT NULL check in ('per_person','per_unit','per_stay') | |
| unit_price | integer | NOT NULL check >= 0 | 税込円。0 円（無償パーソナライズ）も可 |
| lead_time_hours | integer | NOT NULL default 24 | チェックイン日 15:00（施設TZ）基準の申込締切 |
| stock_type | text | NOT NULL default 'none' check in ('none','per_day') | |
| daily_capacity | integer | | stock_type='per_day' 時の日別上限 |
| requires_service_date | boolean | NOT NULL default true | false = 滞在全体に紐づく（per_stay のパーソナライズ等） |
| member_only | boolean | NOT NULL default true | v1 は会員特典として true 既定 |
| photos | jsonb | NOT NULL default '[]' | plan_contents と同型 |
| sort_order | integer | NOT NULL default 0 | |
| is_active | boolean | NOT NULL default true | |
| created_at / updated_at | timestamptz | | |

- **seed（決定 #4）**: 両施設に `fridge-nonalc`「冷蔵庫の中身をノンアルコールに変更」（category=personalize・per_stay・requires_service_date=false）と `towel-extra`「タオル多め」（category=amenity・per_stay・requires_service_date=false）を **`is_active=false`・unit_price=0** で投入。単価・締切・公開（is_active=true）は管理画面から運用者が確定する（安全側）。
- **RLS**: anon/authenticated は `is_active` のみ select（カタログ表示）。スタッフ write は `private.has_facility_access`。service_role フル。
- **i18n**: `book.content_translations.entity_type` の check 制約に `'option'` を追加（book スキーマ内 ALTER。'news','site_page' 追加の前例に倣う）。

### 2.3 オプション予約明細 `book.booking_option_orders`（新規）

| 列 | 型 | 制約 | 説明 |
|---|---|---|---|
| id | uuid | PK | |
| tenant_id / facility_id | uuid | NOT NULL | |
| booking_id | uuid | NOT NULL ref booking.bookings | |
| stay_id | uuid | NOT NULL ref core.stays | PMS 精算連携の将来キー |
| member_user_id | uuid | NOT NULL ref auth.users | |
| option_id | uuid | NOT NULL ref book.option_items | |
| service_date | date | | 提供日（requires_service_date=false なら NULL） |
| quantity | integer | NOT NULL check between 1 and 20 | per_person は人数、per_unit は個数、per_stay は 1 |
| unit_price | integer | NOT NULL | 注文時スナップショット |
| amount | integer | NOT NULL | unit_price × quantity |
| status | text | NOT NULL default 'reserved' check in ('reserved','cancelled','fulfilled','needs_reschedule') | needs_reschedule は宿泊日変更時のマーク（§1.2） |
| note | text | | 会員の要望メモ |
| created_at / cancelled_at | timestamptz | | |

- index: `(booking_id)`, `(option_id, service_date, status)`（在庫集計用）, `(facility_id, service_date, status)`（宿側の当日リスト用）。
- **RLS**: 本人 select、スタッフ select（facility_access）。書込みは RPC 経由。
- 在庫判定: `stock_type='per_day'` の商品は INSERT 時に `sum(quantity) filter (status='reserved') + 今回 <= daily_capacity` を **`option_items` 行の FOR UPDATE ロック下**で検証（availability の version 方式より単純なロック直列化で十分な流量）。

### 2.4 グレード別キャンセル規定 `book.rank_cancel_policies`（新規・v2 方式）

| 列 | 型 | 制約 | 説明 |
|---|---|---|---|
| rank_code | text | PK ref book.member_ranks(code) | |
| rules | jsonb | NOT NULL default '[]' | ルール表 `[{days_before, rate}]`（rate は 0..1）。プラン規定 snapshot と同一スキーマ（`_cancel_fee` を共用するため） |
| allow_amend_in_penalty | boolean | NOT NULL default false | キャンセル料発生期間内の日程変更を許可するか（決定 #7・グレード特典） |
| note | text | | 規定の説明文（管理画面・/membership 表示用） |
| updated_at | timestamptz | NOT NULL default now() | |

- v1 からの変更: `fee_multiplier` / `extra_free_days`（係数方式）を**廃止**し、ルール表そのものを持つ。
- seed: 4 ランク全行を `rules='[]'`・`allow_amend_in_penalty=false` で投入（現行同挙動）。実規定・グレード差・許可フラグは **`/admin/cancel-policies`** から設定。
- **RLS**: 公開 read（anon/authenticated・キャンセルポリシー表示に使う）。write は tenant_admin ＋ service_role（rank はテナント横断のグローバルマスタのため facility 単位ではなく tenant_admin 権限）。

### 2.5 先行予約の book 側データ（v1 の advance_sales_windows は廃止）

- 新規テーブルは**作らない**（決定 #3・rms 側管理）。
- book 側は `book.plan_contents` への列追加のみ:

| 対象 | 変更 | 目的 |
|---|---|---|
| `book.plan_contents` | `min_rank_order integer`（NULL=全員公開）を追加 | 会員限定・先行販売プランの公開判定。`/admin/plans` で設定 |
| `book.content_translations` | entity_type check に `'option'` を追加 | オプションの en/zh-TW 翻訳 |

> `core.stays` / `booking.bookings` / `booking.daily_rates` / `booking.availability` への**列追加はゼロ**。更新は既存列と metadata jsonb のみ。`book.holds` への列追加も不要（変更フローは hold を経由しない・§4.1）。

---

## 3. 料金再計算ロジック

### 3.1 変更時の再見積（rms 設計書との整合）

```
新総額 new_total = Σ_{d ∈ 新泊数} _unit_price(daily_rates[新plan, 新room, d], 新adults) × 新adults
                   （book.quote と同一。is_closed / min_stay / NULL 単価は not_sellable）
クーポン再計算（決定 #10）:
  percent → new_discount = floor(new_total × value / 100)   … 都度再計算・min_total 再検証なし・失効なし
  fixed   → new_discount = least(旧割引額, new_total)        … 据え置き（クランプのみ）
新支払額 new_charge = new_total − new_discount
差額 diff = new_charge − old_charge（old_charge = bookings.total_amount）
```

- **丸め**: `round()`（四捨五入）。理論式 `book._theory_pp` と同じ。
- **税**: 内税 10%。`tax_amount = round(new_charge − new_charge / 1.10)`（confirm_booking と同式で上書き）。入湯税 150 円/人は含まない（現地徴収・プラン説明に明記済み）。
- **ポイント利用分**: `new_use = least(old_use, new_charge)`、`points_refund = old_use − new_use` を +仕訳（reason 例「ご予約変更に伴う返還（YB-…）」）。
- **ポイント付与分**: 変更時は**触らない**（§3.4 のチェックアウト確定に一本化）。metadata.points_earned は暫定値のまま。
- **ペナルティ期間判定（日程変更時のみ）**: `_cancel_fee`（§4.3）を as_of=現在日で評価し `rate > 0` なら、`allow_amend_in_penalty(現rank)` が false の場合 `amend_in_penalty` エラー。

### 3.2 オプションの加算

- オプション金額は宿泊の quote に**混ぜない**。`booking_option_orders.amount` の合計を予約詳細画面で「滞在アレンジ（現地精算）」として別枠表示。
- 領収・精算は現地（PMS/フロント）。将来 PMS 接続時に stay_id で明細を取得して会計へ合流。

### 3.3 キャンセル料（グレード別ルール表）

```
rules       = snapshot.rules が非空 → プラン規定（特別プラン優先）
              空                   → rank_cancel_policies[キャンセル時点 rank].rules
                                     （非会員・rank 不明は 'standard'）
days_before = check_in_date − as_of（実日数）
rate        = rules を days_before で評価（既存 cancel_booking と同じ「昇順・最初に該当」）
fee         = round(total_amount × rate)
```

- アプリ側 `@autumn-book/core` に `cancellationRateForRank(planPolicy, rankRules, checkin, today)` を**新規追加**（既存 `cancellationRate/cancellationFee` は変更しない）。demo モードとキャンセル確認画面のプレビューが SQL と同式になる。

### 3.4 チェックアウト確定処理（新設・決定 #7/#8 の実装点）

```
book.finalize_checkout()   … pg_cron 日次（JST 12:00 目安）
対象: core.stays.check_out_date < current_date
      かつ booking.status = 'confirmed'
      かつ bookings.metadata.points_finalized が未設定
処理:
  1. final_charge = bookings.total_amount（変更が反映済みの最終確定額）
  2. final_earn = floor(final_charge / 1.10 × reward_rate(会員の現在 rank))   … チェックアウト基準（決定 #8）
  3. earn_delta = final_earn − metadata.points_earned（暫定付与額）
     earn_delta ≠ 0 なら point_ledger に ±仕訳（expires_at = check_out_date + 365日）
  4. metadata に points_finalized=true / points_earned=final_earn をマージ
  5. （将来・Stripe 接続後）事前決済額 paid_amount と final_charge の差額を修正決済
     （charge/refund）。settlement='stripe_checkout_adjust' の amendment がある予約が対象（決定 #7）
```

- 「チェックアウト時点の rank」は厳密にはイベント時刻だが、PMS 切替前はチェックアウトイベントが book に流れないため、**チェックアウト翌日の日次 cron 実行時点の rank** で近似する（rank が日単位でしか動かない運用では実質同値）。PMS 接続後はチェックアウトイベント駆動に置換できる設計にしておく（関数を単一予約単位の `book._finalize_booking(booking_id)` に分け、cron は走査のみ）。
- 既存の暫定付与（confirm_booking の earn 仕訳）は**無改修**。確定処理が差分だけを追加仕訳する。

---

## 4. RPC 設計（既存は壊さない・すべて新規追加または CREATE OR REPLACE の互換差替え）

### 4.1 予約変更

```sql
-- 見積（読み取り専用・authenticated）
book.quote_amendment(
  p_booking_code text,
  p_rate_plan_id uuid,      -- 変更なしでも現値を渡す（全項目必須で曖昧さ排除）
  p_room_type_id uuid,
  p_checkin date,
  p_nights integer,
  p_adults integer
) returns jsonb
-- => { ok, deadline_at, kind, amend_remaining, quote:{lines,total,...}, coupon:{type,discount},
--      old_charge, new_charge, diff, points_refund, in_penalty, errors:[...] }

-- 確定（トランザクション本体・authenticated）
book.amend_booking(  同一引数  ) returns jsonb
-- => { booking_code, amendment_no, diff, new_total, points_refund }
```

`amend_booking` の処理順（単一 Tx）:

1. stays を reservation_code で `FOR UPDATE` → bookings を `FOR UPDATE`。状態検証（reserved/confirmed）
2. 本人検証（members.guest_id = stays.guest_id）・締切検証（CI 9:00 施設 TZ）・**回数検証（amended_count < 2）**
3. no-op 検証（全項目同一ならエラー）
4. **ペナルティ期間検証**: 日程（checkin/nights）が変わる場合、`_cancel_fee` を現在日で評価し rate>0 かつ `allow_amend_in_penalty=false` なら `amend_in_penalty` エラー
5. **在庫: 旧区間を先に +1 で解放** → 新区間を `create_hold` と同じ方式でロック・検証（available − buffer > 0 かつ not stop_sell が全泊）→ −1（§5 参照。hold は経由しない: 会員本人の同期的操作であり 20 分保持が不要、hold 経由だと在庫を二重に触る）
6. 料金再計算（§3.1・クーポン percent 再計算込み）
7. `core.stays` UPDATE（check_in/out・adult_count・party_size・room_type_id）
8. `booking.bookings` UPDATE（rate_plan_id・total/accommodation/tax/net_amount・プラン変更時のみ cancellation_policy_snapshot・metadata マージ {price_snapshot, points_used, coupon, amended_count, last_amended_at}）
9. ポイント返還仕訳（points_refund > 0 時）
10. `booking_option_orders` の service_date が新滞在期間外の行を `needs_reschedule` へ
11. `book.booking_amendments` INSERT（before/after 全記録）
12. 通知 enqueue（`book.notifications` type='booking_amended'。クーポン通知と同パターン）

- grant: `authenticated, service_role` のみ（anon 不可・決定 #9）。`revoke from public, anon`。
- **confirm_booking / create_hold は本機能では改修しない**（後方互換の核）。

### 4.2 オプション

```sql
book.list_option_items(p_facility uuid)                       -- anon 可（is_active のみ）
book.add_booking_options(p_booking_code text, p_items jsonb)  -- authenticated
  -- p_items: [{option_id, service_date, quantity, note}]
book.cancel_booking_option(p_order_id uuid)                   -- authenticated（本人・提供日前日まで＝決定 #5）
book.list_my_booking_options(p_booking_code text)             -- authenticated（本人）
book.list_booking_options_admin(p_facility uuid, p_date date) -- スタッフ（当日提供リスト）
```

- `add_booking_options` 検証: 本人・予約状態・service_date が滞在期間内（requires_service_date 時）・申込締切（CI 日 15:00 − lead_time_hours、施設 TZ）・member_only・per_day 在庫（option_items 行ロック下で集計）。unit_price/amount をスナップショットして INSERT。
- `cancel_booking_option` 検証: 本人・status='reserved'・**現在時刻 < 提供日 0:00（施設 TZ）**（= 前日まで可）。requires_service_date=false は check_in_date を基準にする。
- マスタ CRUD は RPC を設けず、`/admin/options` からスタッフ RLS（facility_access）で直接 write。

### 4.3 キャンセル料（グレード別ルール表）

```sql
-- 内部ヘルパ（fee 計算の単一実装。cancel_booking / compute_cancel_fee / amend_booking が共用）
book._cancel_fee(p_snapshot jsonb, p_total integer, p_checkin date, p_as_of date,
                 p_rank_code text) returns jsonb
  -- rules 選択: 非空 snapshot 優先 → rank_cancel_policies[p_rank_code] → standard
  -- => { rules_source: 'plan'|'rank', rank_code, rate, fee }

-- キャンセル確認画面用プレビュー（authenticated・本人 or スタッフ）
book.compute_cancel_fee(p_booking_code text, p_as_of date default current_date) returns jsonb

-- 既存 cancel_booking の互換差替え（シグネチャ不変・CREATE OR REPLACE）
book.cancel_booking(p_booking_code text, p_waive_fee boolean, p_reason text)
  -- 変更点は v_fee の算出を book._cancel_fee に委譲し、
  -- metadata.cancel_rank_benefit へ適用内訳を記録することのみ。他ロジックは 20260704000200 と同一
```

### 4.4 先行予約（book 側の薄い実装のみ・主体は rms）

```sql
-- 在庫 seed（管理 RPC・tenant_admin/superadmin）。先行期間の availability を手動投入
book.seed_advance_availability(p_facility uuid, p_room_type uuid,
                               p_from date, p_to date, p_total integer) returns integer
```

- **料金系 RPC の改修方針（互換差替え・シグネチャ不変）**: `plan_offers` / `search_plans` / `get_plan_calendar` / `quote` / `create_hold` に `plan_contents.min_rank_order` フィルタを織り込む — `auth.uid()` から会員 rank_order を引き、`min_rank_order is null or rank_order >= min_rank_order`。anon は NULL 扱い（限定プラン非表示）。
- 割引はプラン価格（daily_rates）に織り込み済みのため、hold → confirm_booking は**無改修**で先行予約が成立する。
- v1 の `list_advance_offers` / `advance_sales_windows` 関連 RPC は**廃止**（rms 側管理のため不要）。

### 4.5 チェックアウト確定（新設）

```sql
book._finalize_booking(p_booking_id uuid) returns jsonb   -- 単一予約の確定（§3.4）
book.finalize_checkout() returns integer                  -- 走査（pg_cron 日次・処理件数を返す）
```

- pg_cron 登録は `book_stay_notification_crons`（20260703001400）と同パターン。将来 PMS のチェックアウトイベントから `_finalize_booking` を直接呼べる分割にしておく。

---

## 5. 在庫整合

| 場面 | 方式 |
|---|---|
| 変更の在庫振替 | 単一 Tx 内で「**旧区間 +1 → 新区間ロック・検証 → −1**」。旧新が重複する日（例: 1→2 泊延長）は +1 後に検証するため自室分が自動的に考慮され、追加日のみ実質チェックされる。ロックは create_hold と同じ `SELECT … FOR UPDATE`（availability 行）で直列化 |
| デッドロック回避 | 旧区間 UPDATE → 新区間 SELECT FOR UPDATE の 2 段だが、いずれも (room_type_id, date) 昇順で行に触れる。同時 amend の競合はテナント規模的に稀・発生時は片方が lock wait 後に sold_out 検出で失敗（安全側） |
| 検証条件 | `available_rooms − buffer_rooms > 0 AND NOT stop_sell` が新区間全泊・`daily_rates.is_closed=false`・min_stay（quote 内で検証） |
| TL 差分適用との整合 | 解放・確保はローカル増減。同期の差分適用は「TL 残室の変動分」だけを足し引きし `metadata.tl_remaining` 基準で比較するため、**ローカルの振替分は次回同期で消えない**（rms 設計書 §A・実装 20260711012200 で確認済み） |
| オーバーブッキング | 変更も新規予約と同じ暫定対策（buffer_rooms ≥ 1 運用・Phase D で TL 書き戻し）。変更が特別にリスクを増やすことはない |
| 先行期間の在庫 | TL に存在しない期間は `seed_advance_availability` で行を作る。将来 TL が同期間を配信し始めた際、差分適用は `tl_remaining` 初回記録から始まるため seed 値とローカル販売分が保持される（初回 INSERT は `on conflict do nothing` なので seed 行が上書きされない点を確認済み） |
| オプション在庫 | availability とは独立。option_items 行ロック + 明細集計（§2.3）。version 列は設けない |

---

## 6. UI/UX フロー

### 6.1 予約変更（マイページ起点）

```
/account/reservations/[code]                    … 予約詳細（既存）
  └ [予約を変更] ボタン（会員 & reserved & 締切前 & 残回数あり のみ表示。
                        締切後・3回目は「お電話ください」）
      └ /account/reservations/[code]/amend      … 新規ルート（ウィザード1ページ）
          ①新しい条件を選ぶ: 日付・泊数・人数（既存の検索UIパーツ再利用）
                             部屋×プラン候補は plan_offers(facility, 新条件) で提示
          ②差額見積: quote_amendment の結果を「現在のご予約 / 変更後 / 差額」3カラムで表示
                     差額 +¥N →「ご到着時に現地にてお支払い」/ −¥N →「現地精算額から減額」
                     ポイント返還・クーポン再計算（percent時）も明示。残り変更可能回数を表示
          ③確認 → amend_booking → 完了画面（新しい予約内容 + 変更履歴リンク）
```

- ペナルティ期間内（in_penalty=true）で日程を触った場合: 「キャンセル料発生期間のため宿泊日の変更は承れません」＋グレードによっては可能な旨の案内（allow_amend_in_penalty=true の会員はそのまま進める）。
- 予約詳細に「変更履歴」セクション（booking_amendments を新しい順に、kind バッジ + 差額）。
- オプション明細が `needs_reschedule` になった場合は詳細画面に警告バナー＋取り直し導線。

### 6.2 オプション（滞在アレンジ）

```
/account/reservations/[code]                    … 「滞在アレンジ」セクション（注文済み明細 + 追加ボタン）
  └ /account/reservations/[code]/options        … 新規ルート
      カテゴリタブ（お食事／スパ・マッサージ／アクティビティ／アメニティ／パーソナライズ）
      商品カード: 写真・説明・単価（0円は「無料」表示）・締切表示（'ご到着 3 日前まで'）
      → 数量・提供日（滞在日程からセレクト）・要望メモ → カートまとめて add_booking_options
      注文済み明細: 提供日前日まで [取消] ボタン（決定 #5）。以降は「お電話ください」
```

- 予約完了画面（`/booking/complete/[code]`）にも「チェックイン後はご予約が取りづらいため、事前の滞在アレンジがおすすめです」の導線カードを置く（membership コピーの実体化）。
- 施設ページ（サイトページ `option` スラッグ既存）からはカタログ閲覧のみ可（anon）。注文はログイン + 対象予約選択へ誘導。

### 6.3 管理画面（book `/admin`・新設 2 画面）

| 画面 | 内容 |
|---|---|
| `/admin/cancel-policies` | グレード別キャンセル規定の編集（決定 #1）。ランクごとに「◯日前から◯%」の行を追加/削除/編集し rules jsonb へ保存。allow_amend_in_penalty トグル・note 編集。tenant_admin のみ |
| `/admin/options` | オプションマスタ CRUD（決定 #4）。施設切替・カテゴリ・単価・締切・日別上限・公開トグル・写真・翻訳（content_translations 'option'）。当日提供リスト（list_booking_options_admin）のビューも同居 |

### 6.4 グレード別キャンセル規定（会員向け表示）

- キャンセル確認モーダル（既存 `cancelPreview`）を `compute_cancel_fee` ベースに差替え、「あなたの会員グレードの規定: ◯日前◯%」＋計算結果を表示。
- `/membership` のグレード表に優遇欄（rank_cancel_policies.note）を追加。予約フロー（hold 画面）にも適用規定を表示。

### 6.5 先行予約

- 施設プラン一覧・料金カレンダーで min_rank_order 付きプランに「会員先行」バッジ。
- 未ログイン: バッジ + 「会員限定・ログインしてご覧ください」。rank 不足: 「ゴールド会員以上の特典です」＋グレード案内リンク。

### 6.6 demo モード二重実装（DATA_SOURCE=demo）

| 層 | 追加 |
|---|---|
| `store.ts` | `optionItems` / `bookingOptionOrders` / `rankCancelPolicies` の in-memory 配列 + `amendBooking()` / `addBookingOptions()` / `computeCancelFee()`。既存 `cancelBooking()` にルール表参照を接続 |
| `supabase-data.ts` | `sbQuoteAmendment` / `sbAmendBooking` / `sbListOptionItems` / `sbAddBookingOptions` / `sbCancelBookingOption` / `sbListMyBookingOptions` / `sbComputeCancelFee`（`client.schema('book').rpc(...)` パターン踏襲） |
| ルート | `MEMBER_SUPABASE` 分岐は `reservations/[code]/+page.server.ts` の既存パターンを踏襲（demo は store、実接続は sb*） |
| `@autumn-book/core` | `cancellationRateForRank` / `amendmentDiff`（純粋関数）を追加。SQL と同式の二重検証（quote の前例どおり） |

---

## 7. i18n（ja / en / zh-TW 必須）

| 対象 | 方式 |
|---|---|
| UI 文言 | Paraglide messages に追加。キー命名は既存流儀（`membership_*` / `booking_*`）に合わせ、機能プレフィクスで揃える: `amend_*`（`amend_title`, `amend_deadline_note`, `amend_limit_note`, `amend_penalty_blocked`, `amend_diff_pay_onsite`, `amend_history_heading`…）、`options_*`（`options_heading`, `options_deadline_fmt`, `options_cancel_until_eve`, `options_needs_reschedule`…）、`cancelrank_*`（`cancelrank_rule_line`…）、`advance_*`（`advance_badge`, `advance_locked_rank`…）。**3 ロケール同時に追加**（ja.json / en.json / zh-TW.json） |
| オプション商品名・説明 | DB コンテンツ。`book.content_translations`（entity_type='option'）で en / zh-TW を部分上書き。既存 `applyTranslation` パターンをカタログ取得に適用 |
| キャンセル規定文 | rules（数値）は messages 側のテンプレート（`cancelrank_rule_line`: "{days}日前から {rate}%"）で組み立て。note は ja のみ（v1 は messages 優先で回避） |
| 通知（booking_amended 等） | notifications の title/body は enqueue 時に会員の `locale`（members.locale 既存）で組み立て |

---

## 8. 段階リリース計画

| Phase | 内容 | 新規物 | 前提 | 状態 |
|---|---|---|---|---|
| **P1** | **オプション事前予約（滞在アレンジ）＋マスタ管理画面** | option_items（seed 2品）/ booking_option_orders / RPC 5本 / `/options` ルート / `/admin/options` / content_translations 'option' | なし（既存フロー無改修・在庫/料金と非干渉）。公開は管理画面で単価確定後 | 📋 設計確定 |
| **P2** | **予約変更（日程・人数・部屋・プラン）＋チェックアウト確定 cron** | booking_amendments / quote_amendment / amend_booking / _finalize_booking / finalize_checkout（pg_cron）/ `/amend` ルート | なし（ペナルティ判定は P3 の rules が空なら常に非ペナルティ＝全期間変更可で、現行と同挙動） | 📋 設計確定 |
| **P3** | **グレード別キャンセル料＋マスタ管理画面** | rank_cancel_policies / _cancel_fee / compute_cancel_fee / cancel_booking 差替え / `/admin/cancel-policies` | 実規定の数値入力（管理画面から・**公開前必須**＝rms 設計書 §5-3 の解消手段） | 📋 設計確定 |
| **P4** | **OTA 先行予約割引（book 側は薄い実装のみ）** | plan_contents.min_rank_order / 料金系 RPC の rank フィルタ差替え / seed_advance_availability / 会員先行バッジ | **rms 側**: rms_rank_calendar 恒久化＋先行プラン定義＋sync の rank 取得差替え（→ rms HANDOFF 済み） | ⏸ rms 側前提待ち |

### 推奨順の判断材料（P1 を先にする理由・v1 から不変）

| 観点 | オプション先行（推奨） | 日程変更先行 |
|---|---|---|
| 実装リスク | 低（book 完結・既存予約トランザクション無改修） | 中（在庫振替・ポイント/クーポン再計算・既存 booking 更新に触る） |
| 現時点の代替手段 | なし（電話のみ。チェックイン後は取りづらい＝機会損失が現に発生） | あり（キャンセル料ゼロの現状では「キャンセル→再予約」が実質同等） |
| 売上効果 | アップセル直結（客単価+） | 解約防止（間接） |

- P2 と P3 は独立して push 可能だが、**P2 のペナルティ期間判定は P3 の rules 投入で初めて効く**（P3 を先に済ませると裁定リスクゼロで P2 を出せる。逆順なら P2 リリース〜P3 rules 投入までの間は現行どおりキャンセル料ゼロ＝変更も自由で、リスクは現状と同等）。
- migration は機能ごとに独立ファイル（`YYYYMMDDHHMMSS_book_option_items.sql` 等・`new-migration.sh` で実UTC秒生成）。
- 各 Phase のリリース時に HANDOFF.md のテストチェックリストへ項目追加（例: 「オプションを追加→締切超過でエラー」「提供日前日まで取消できる／当日は取消ボタンが消える」「1泊→2泊へ変更で差額が現地精算表示」「3回目の変更がブロックされる」）。

---

## 9. 残る未決事項・リスク

### 9.1 運用入力待ち（機能はブロックしない・管理画面から投入）

| # | 項目 | 状態 |
|---|---|---|
| 1 | キャンセル規定の具体数値（グレード別ルール表） | 方式は確定（決定 #1）。**数値は `/admin/cancel-policies` から運用者が投入**。standard 行の投入が公開前必須 |
| 2 | ペナルティ期間内の日程変更を許可するグレード | `allow_amend_in_penalty` の初期値は全 false。許可するグレード（例: platinum のみ true）は管理画面から設定 |
| 3 | オプション 2 品の単価（0 円か有償か）・締切・公開 | seed は is_active=false・0 円。管理画面で確定後に公開 |
| 4 | 先行販売プランの割引率・対象期間・切替運用 | rms 側の運用（handoff 済み）。book 側は関与しない |

### 9.2 技術リスク・依存

| # | リスク | 対応 |
|---|---|---|
| 1 | 先行期間の daily_rates が生成できない（TL day_rank 依存） | rms_rank_calendar 恒久化＋sync の rank 取得差替え（rms 側・handoff 済み）。P4 の前提 |
| 2 | 先行期間の availability が存在しない | `seed_advance_availability` 管理 RPC で手動 seed。TL 配信開始後の差分適用と衝突しないこと（`on conflict do nothing` + tl_remaining 初回記録）は確認済みだが、P4 実装時に PROD で再検証 |
| 3 | cancellation_policy_snapshot の型ゆらぎ（`[]` 配列 vs `{rules:[...]}`） | v0.18.3 でアプリ側は吸収済み。`_cancel_fee` ヘルパも防御的パースにする。rank_cancel_policies.rules は snapshot と同一スキーマで統一 |
| 4 | 変更と TL 同期の同時実行 | 差分適用は tl_remaining 基準のためローカル振替は保持される（§5）。ただし同期間隔（2–3h）内の OTA 同時販売リスクは既存と同じ（buffer 運用） |
| 5 | チェックアウト確定 cron と rank 変動の時差 | 「チェックアウト時 rank」を cron 実行時点で近似（§3.4）。rank の自動昇格ロジック自体が未実装のため当面実害なし。昇格ロジック導入時に順序（昇格→確定 or 確定→昇格）を決める |
| 6 | Stripe 修正決済の詳細（オーソリ期限・返金手数料等） | Stripe 接続時に別途設計。本設計は settlement 列と finalize フックの口だけ確保 |
| 7 | plan_offers 等の互換差替えの回帰 | rank フィルタ追加時、anon 導線（公開予約フロー）の挙動が変わらないことをテストチェックリストで担保（min_rank_order NULL なら完全に従来どおり） |
