# autumn-book × rms 料金・在庫接続 設計（v1・2026-07-10）

- **目的**: 直販予約サイト（autumn-book）が、rms が管理する**実売価格・実在庫・実プラン**で販売できるようにする。
- **関連 migration**: `autumn-shared/supabase/migrations/20260710150415_book_rms_rate_sync.sql`
- **前提**: 本書の記述はすべて **PROD（`opkocyapzmsjzhbwlguh`）の実データ実査**と `autumn-rms` のコード読解に基づく。

---

## 0. 決定サマリ

| 論点 | 決定 | 根拠 |
|---|---|---|
| 価格の正 | **TL-リンカーンの実売価格**（`rms_tl_lincoln_rate_cache.rows[].priceRanges[].pricePerPerson`） | rms の理論式は室料の消費税を二重計上する（§2）。実売価格は OTA と同一で、単位も `booking.daily_rates.price_adult_N` と一致 |
| 理論式（`pricing.ts`）の移植 | **しない** | 同上。移植すると約10%高い価格を提示してしまう |
| 受け皿 | **`booking.rate_plans` / `daily_rates` / `availability` を同期で埋める** | book の RPC 群（search/quote/create_hold/confirm_booking）は既にこの3表を前提に実装済み。RPC を書き換えず接続できる |
| 直販プラン判定 | `rms_plan_templates.is_active` かつ `sales_channels.channels.autumnBooking <> ''` | rms の台帳に「autumnBooking」チャネル列が既にある（一休・じゃらん・楽天と並列） |
| 販売単位 | `pms.room_types`（yamado 7・oga 8） | `code` が rms の `room_number` とも TL 在庫の `roomCode` とも一致 |
| 在庫の正 | `rms_tl_lincoln_stock_cache`（TL 由来・施設×日×部屋タイプ） | `booking.availability` は空、PMS 連携も未実装。TL が唯一の残室ソース |
| 在庫の更新方法 | **差分適用**（`available_rooms += 今回TL − 前回TL`） | 上書きすると hold/予約による減算が消える（§4） |
| プランの公開 | 同期は `plan_contents` を**下書き**で作るだけ。公開は人が管理画面で判断 | 29+13 プランには県民限定・日帰り・セール等が混在し、全部を直販に出すのは誤り |
| キャンセル料・子供料金・事前決済 | **未モデル化のまま**（キャンセル料は空＝無料） | rms 側にも構造化データが無い（`cancellation_policy_code` は "基本" 等の文字列） |

---

## 1. データの地形（実査結果）

```
rms_plan_templates(73)          ─ 直販フラグ sales_channels.channels.autumnBooking
  └ tl_plan_group_name          ─ "a000桂■基本■2食■スタンダード(+17050円)"
rms_base_room_rates(31)         ─ prices_by_guest_count（人数別・部屋総額・税込）/ short_name / linked_rooms
rms_rate_rank_prices(52)        ─ A=0 … Z=50,000（+2,000円刻み・税抜・部屋あたり）
rms_meal_rates(15)              ─ 1名単価（税抜）
rms_tl_lincoln_rate_cache(839)  ─ ★ stay_date × day_rank × rows[](planGroup × priceRanges[人数→1名単価・税込])
rms_tl_lincoln_stock_cache(808) ─ ★ stay_date × remaining_by_room_type[](roomCode → remaining)
rms_daily_rates(0)              ─ 理論値の実体化テーブル。PROD では未生成（手動フロー未実行）
booking.rate_plans/daily_rates/availability(0) ─ 空の器。rms は一切書かない
pms.room_types(15) / pms.rooms(32)
```

## 2. なぜ理論式を使わないか（税の二重計上）

`autumn-rms/src/lib/server/workbook-parser.ts` は `prices_by_guest_count` を Excel の室料セル**そのまま**（＝税込）保存する一方、`pricing.ts` / `daily-rates.ts` はそれを税抜として扱い、最後に `×1.1` する。

実データでの検算（yamado メゾネット・2名・`day_rank=E`）:

```
TL 実売    : 37,950円/人 × 2 = 75,900円
内訳の再現 : 室料 33,000（税込） + ランクE 8,800（=8,000×1.1） + 食事 17,050×2（=15,500×1.1×2）
           = 75,900 ✓ 完全一致
理論式     : (33,000 + 8,000 + 15,500×2) × 1.1 = 79,200 ✗
差         : 3,300 = 33,000 × 0.1   ← 室料に税を二重に掛けている
```

→ **TL 実売価格をそのまま採用する**。副次的に、`priceRanges[].pricePerPerson` は「その人数で泊まるときの1名あたり税込単価」であり、`booking.daily_rates.price_adult_N`（＝N名利用時の1名単価。総額 = 単価 × N）と**定義が完全に一致**する。変換不要。

> 入湯税 150円/人 は TL 価格に含まれない（消費税対象外・現地徴収）。プラン説明に明記すること。

## 3. 突合ロジック

TL のプラングループ名は施設ごとに形式が違う。先頭4文字が常にグループコード。

| 施設 | 例 | 部屋トークン | プランキー |
|---|---|---|---|
| yamado | `a000桂■基本■2食■スタンダード(+17050円)` | `桂`（5文字目以降） | `a000■基本■2食■スタンダード(+17050円)` |
| oga | `e300■綿津見和洋室■県民■2食■県民限定(-10%)` | `綿津見和洋室`（第2フィールド） | `e300■県民■2食■県民限定(-10%)` |

- **プランキー**で `rms_plan_templates.tl_plan_group_name` と `rate_cache` の行を突合する（templates は代表室のみ持つため、部屋トークンを除去して比較）。
- **部屋トークン**は `room_types.metadata.siteControllerName`（`│` 除去）または `rms_base_room_rates.short_name` の `<` 前（yamado の略称 "メゾネット" 等）と突合。**PROD 実査で 1トークン→1部屋タイプ**（多重マッチなし）を確認済み。
- `旧プラン` 等の派生名はプランキーが一致しないため自動的に除外される。`削除予定` / トリプラ専用の行は部屋トークンが解決できず除外される。

生成量（実測・14日窓からの外挿）: yamado 約131行/日・oga 約72行/日 → **365日で約74万行**。

## 4. 在庫の同期（差分適用）

`book.create_hold` / `book.confirm_booking` は `booking.availability.available_rooms` を**減算**する。TL 残室で単純上書きすると、その減算が同期のたびに消える。

```
新規日:  available_rooms = min(TL残室, total_rooms)          , metadata.tl_remaining = TL残室
既存日:  available_rooms += (今回TL残室 − metadata.tl_remaining)   ※ 0..total_rooms にクランプ
         metadata.tl_remaining = 今回TL残室
```

これで「OTA が売った分（TL残室の減少）」だけを取り込み、「自社が売った分（ローカル減算）」を保持する。hold 失効時の復元（pg_cron）とも整合する。

## 5. 同期のスケジュール

| ジョブ | cron（UTC） | 窓 | 意図 |
|---|---|---|---|
| `book_sync_rms_rates` | `15 */3 * * *` | 60日 | 直近の在庫・料金を高頻度で追随 |
| `book_sync_rms_rates_full` | `15 16 * * *`（JST 01:15） | 365日 | 1年分のカレンダーを1日1回フル更新 |

rms の TL プリフェッチ（2〜3時間おき）の後に走る想定。

## 6. ⚠ 公開前に必ず解消すべきリスク

1. **オーバーブッキング（最重要）**: 直販予約を **TL へ書き戻していない**。したがって自社サイトで売れた部屋を OTA が売り続ける。
   - 暫定対策: `booking.availability.buffer_rooms` を **1 以上**に設定して安全域を取る。
     - ⚠ 同期関数は **INSERT 時のみ buffer=0**、**UPDATE 時は buffer に触れない**。よって運用者が既存日に設定した buffer は維持されるが、**未来の新規日は毎回 buffer=0 で入る**。恒久的に効かせるには、同期関数の INSERT 側デフォルトを施設別設定（例 `book.facility_booking_settings.default_buffer`）から取る改修が要る（今は未実装＝施設運用値が 0〜1 で未確定のため。設計書 §14-7）。
   - 恒久対策: TL への在庫書き戻し（SC 連携）か、TL 側の在庫を自社直販ぶんだけ手動で絞る運用。
2. **鮮度**: TL 残室は prefetch 依存（数時間）。同期間隔より短い窓の同時販売は防げない。
3. **キャンセル料が無料**: `cancellation_policy = []` で作成される。実際の規定を `booking.rate_plans.cancellation_policy`（JSONB・日数別料率）に投入するまで、キャンセル料を請求できない。
4. **子供料金**: `price_child_a..e` は未使用。当面「大人のみ予約可」で運用する（設計書 §14-11）。
5. **事前決済**: 全プラン `payment_method='onsite'`。Stripe 接続（P4）時に `metadata.prepay` で切替。

## 7. autumn-book 側の接続

`DATA_SOURCE=supabase` のとき、以下は既存 RPC をそのまま呼べば実データになる（RPC 改修不要）:

| 画面 | RPC |
|---|---|
| 地図検索 `/search` | `book.search_availability(checkin, nights, adults)` |
| ポータル参考料金 | `book.reference_min_price(adults, days)` |
| **プラン一覧・プラン詳細（泊まれる客室と料金）** | `book.plan_offers(facility, checkin, nights, adults, rate_plan_id?)` ★新規 |
| プラン詳細の料金カレンダー | `book.get_plan_calendar(rate_plan_id, month, adults)` |
| 見積 → 仮押さえ | `book.quote(...)` → `book.create_hold(...)` |
| 予約確定 | `book.confirm_booking(hold_id, session_id, guest, points_used, locale, member_coupon_id)`（**6引数**） |

### `book.plan_offers`（migration `20260710153135`）

デモ実装の `plan.roomTypeIds`（プランが売れる客室の配列）に相当する関係は**実データに存在しない**。実際の可否は `booking.daily_rates` に `(rate_plan_id, room_type_id, date)` の行があり価格が入っているかで決まる。客室ごとに `quote()` を叩くと N 往復になるため、`search_availability` と同じ流儀で単一クエリに集約した。

- `rate_plan_id` を渡すとそのプランのみ（プラン詳細）、`null` なら施設の全公開プラン（一覧）。
- 日付未指定は 0 行（料金不明）。呼び出し側は「日付を選択してください」を出す。
- 返り値: `(rate_plan_id, room_type_id, total, per_person, remaining)`・総額昇順。

### 画面に出る条件

- **プラン**: `rate_plans.public_on_direct AND is_active` かつ `plan_contents.is_published`。同期は**下書き**で作るだけなので、**管理画面で公開するまで 1 件も出ない**（安全側）。
- **客室**: `room_types.is_active` かつ `room_type_contents.is_published`。客室は販売単位そのもので出す/出さないの経営判断が無いため、同期が **`is_published=true` で自動生成**する（migration `20260710152624`）。headline/description/photos は空なので管理画面で肉付けする。
