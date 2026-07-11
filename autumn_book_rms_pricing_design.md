# autumn-book × rms 料金・在庫接続 設計（v2・2026-07-11）

- **目的**: 直販予約サイト（autumn-book）が、自社マスタを源泉とする実売価格・実在庫・実プランで販売できるようにする。
- **v1（2026-07-10）からの変更**: SoT を「TL-リンカーン実売」から「自社マスタ」へ再定義した（§0）。v1 の実査結果・突合ロジックは付録（§A）として保持。
- **関連 migration**: `20260710150415`（v1 sync 初版）→ `20260710162029`（チャンク化・cron 不成立）→ **`20260711012200`（v2 理論式切替・現行）**
- **rms 側の対応設計**: `autumn-rms/docs/book-plan-master-design.md`

---

## 0. SoT の再定義（2026-07-11 決定）

| データ | SoT | TL-リンカーンの位置づけ | 状態 |
|---|---|---|---|
| **料金** | **rms マスタの理論計算**（室料・ランク・食事/加算） | OTA 向け配信チャネル（読まない） | ✅ Phase B 適用済み |
| **プラン** | **book 独自**（定義は rms・`autumnBooking` チャネル。当初 tripla 踏襲 → 以後 TL 非依存） | 無関係 | ✅ 43プランフラグ済み・公開は管理画面判断 |
| **在庫** | **PMS**（PMS⇄TL 同期は実装済み・**既存 PMS からの切替待ち**） | 双方向同期相手（上り=在庫送信・下り=予約取込） | ⏸ Phase C/D 未着手。切替まで TL 残室の差分適用を継続 |

### 判断の背景

- **理論式こそが価格の源泉**。TL の実売価格は理論値の写像（+OTA プランは手数料マークアップ ×1.25 等）であり、直販がそれを読み戻すのは因果が逆。実査で理論式は TL 実売と一致することを確認済み（§2）。
- v1 が TL 実売を採用した理由（rms 理論式の「税二重計上」）は、**現 PROD データでは前提が崩れていた**：`prices_by_guest_count` は税抜で保存されており（メゾネット2名=30,000・TL実売33,000=×1.1）、`(室料+ランク+食事)×1.1` はそのまま正しい。
- **直販＝ベース価格**。yamado の現行 TL 稼働プランは `国内OTA(+20%)`・`海外(+40%)` のマークアップ変種で、ベースプラン（a000）は旧プラン化済み。直販サイトがベース価格で売ることが「公式サイトならベストレート」の実体になる。
- 在庫の SoT を PMS に置く前提は「**OTA 予約が PMS にリアルタイム流入していること**」。PMS⇄TL 同期は実装済みだが、実運用の予約台帳がまだ既存 PMS にあるため、切替までは book 側の暫定方式（TL 残室差分適用）を維持する。

## 1. 現行アーキテクチャ（Phase B 適用後）

```
rms マスタ（SoT）                          book 同期（3h毎 + 日次400日）
  rms_base_room_rates   室料（税抜・人数帯） ──┐
  rms_rate_rank_prices  ランク差額（税抜）   ──┼─ 理論計算 → booking.daily_rates（price_adult_1..6）
  rms_plan_templates    プラン+料金式        ──┘        └→ booking.rate_plans（metadata.theory_pricing）
                        （autumnBooking フラグ）
TL キャッシュ（暫定・構造情報のみ。価格は読まない）
  rate_cache.day_rank        → 日付→ランク（恒久: rms_rank_calendar・rms設計書§3.1）
  rate_cache.planGroupName   → プラン×客室 membership（恒久: rms_plan_room_links・rms設計書§3.2）
  stock_cache.remaining      → booking.availability 差分適用（恒久: PMS 切替後に廃止）
```

### 理論式（PROD 実査で確定・migration `20260711012200` の `book._theory_pp`）

```
base_pp(N) = round( (室料税抜[N名] + rank_delta) × 1.1 / N )   … 室料は部屋総額
amount 型 : pp(N) = base_pp(N) + 符号付き加算額(税込/人)        … TL名 "(±N円)" サフィックスが正
percent 型: pp(N) = round( (base_pp(N) + refBR) × factor )     … price_expression "17050BR*0.85" が正
```

- プラン別パラメータは masters 同期が構造化し `booking.rate_plans.metadata.theory_pricing` に保存
- ランク: 施設ごと1セット（A=0 … 2,000円刻み・部屋あたり税抜）。`不可`/欠損日は `is_closed=true`
- 入湯税 150円/人 は含まれない（現地徴収・プラン説明に明記）

## 2. 検算（Phase A・2026-07-11 PROD 実査）

| 対象 | 結果 |
|---|---|
| yamado ひとり旅(±17050円) | **100% 一致**（252比較点） |
| oga 素泊/朝食/カジュアル/フルコース（部屋05/07・ランクB/C/D/F/I） | **サンプル全点一致**（理論値=TL実売がゼロ差） |
| yamado 国内OTAスタンダード(+20%) | ベース理論値 ×1.25（=÷(1-0.2)）で一致 → マークアップ構造も理論どおり |
| 検算の代表例 | メゾネット2名 rank E: (30,000+8,000+15,500×2)×1.1 = 75,900 = TL実売 ✓ |

- TL 全点との照合では一部乖離が残る（oga a003 スタンダード等）。**TL 側の手動調整・特日運用による drift** とみられ、
  理論値を SoT とする本設計では直販に影響しない（むしろ SoT を一本化する動機）。
- 丸め: `round()`（四捨五入）。実データの価格設計は人数帯で割り切れる構成が基本。

## 3. 同期のスケジュール（migration `20260711012200` で修正）

| ジョブ | cron（UTC） | 実行内容 |
|---|---|---|
| `book_sync_rms_rates` | `15 */3 * * *` | `select book.sync_rms_rates_range(0, 60, true)` |
| `book_sync_rms_rates_full` | `15 16 * * *`（JST 01:15） | `select book.sync_rms_rates_range(0, 400, true)` |

> ⚠ **教訓**: v1 チャンク化（`20260710162029`）の procedure+COMMIT 方式は pg_cron（background worker 実行）では
> `invalid transaction termination` となり**一度も成功していなかった**。理論式生成は TL jsonb の日付展開パースが
> 不要で軽量（約200行/日）のため、単一トランザクションの `select` 実行に戻して解消。

## 4. フェーズ計画と現在地

| Phase | 内容 | 状態 |
|---|---|---|
| **A** | 理論式の確定と PROD 実データ検算（移行ゲート） | ✅ 完了（§2） |
| **B** | daily_rates 生成を理論式に切替・cron 修正 | ✅ 適用済み（`20260711012200`） |
| B+ | rms 側マスタ昇格（rank_calendar / plan_room_links / 構造化列） | 📋 設計済み（rms設計書§3・§6） |
| **C** | OTA 予約の PMS 取込を book 在庫の正へ（在庫=PMS 導出） | ⏸ **既存 PMS からの切替待ち** |
| **D** | 直販予約の TL 在庫送信（NetStockAdjustment）・buffer 撤廃 | ⏸ 同上 |

Phase C/D の技術部品（TL SOAP: 在庫調整 3002/3005・予約出力 5001）は autumn-shared `tl-lincoln/` に実装済み。
切替判断はユーザー（宿運営）のオペレーション都合で行う。

## 5. ⚠ 公開前に必ず解消すべきリスク（v1 から更新）

1. **オーバーブッキング**: 直販→TL の在庫書き戻しは Phase D。それまでの暫定対策は `booking.availability.buffer_rooms ≥ 1`。
   - 同期関数は INSERT 時 buffer=0・UPDATE 時は buffer に触れない。運用者が設定した既存日の buffer は維持されるが、
     新規日は 0 で入る（恒久化は施設別既定値の導入が必要・未実装）。
2. **鮮度**: OTA が売った分の反映は TL prefetch（2〜3h）依存。同期間隔より短い窓の同時販売は防げない。
3. **キャンセル料が無料のまま**: `cancellation_policy = '[]'`。実規定の JSONB 投入までキャンセル料を請求できない。**公開前必須**。
4. **子供料金**: 未モデル化（大人のみ予約可で運用）。
5. **事前決済**: 全プラン `onsite`。Stripe 接続（P4）時に `metadata.prepay` で切替。
6. **プラン公開**: 同期は `plan_contents` を**下書き**で作るだけ。管理画面で公開するまで直販サイトには 1 件も出ない（安全側）。
   公開作業 = headline/説明/写真の肉付け + `is_published=true`。

## 6. autumn-book 側の接続（v0.18.x で接続済み・変更不要）

`DATA_SOURCE=supabase` で以下の RPC が実データを返す（RPC は daily_rates/availability を読むため、
生成方式の v1→v2 切替はアプリ層に影響しない）:

| 画面 | RPC |
|---|---|
| 地図検索 `/search` | `book.search_availability(checkin, nights, adults)` |
| ポータル参考料金 | `book.reference_min_price(adults, days)` |
| プラン一覧・詳細（泊まれる客室と料金） | `book.plan_offers(facility, checkin, nights, adults, rate_plan_id?)` |
| 料金カレンダー | `book.get_plan_calendar(rate_plan_id, month, adults)` |
| 見積 → 仮押さえ | `book.quote(...)` → `book.create_hold(...)` |
| 予約確定 | `book.confirm_booking(hold_id, session_id, guest, points_used, locale, member_coupon_id)` |

---

## §A. 付録: v1 実査記録（2026-07-10・歴史的経緯）

<details>
<summary>v1 の決定サマリと突合ロジック（クリックで展開）</summary>

### v1 決定サマリ（→ v2 で置換）

| 論点 | v1 決定 | v2 での扱い |
|---|---|---|
| 価格の正 | TL 実売価格（`rate_cache.priceRanges[].pricePerPerson`） | ❌ 廃止 → rms マスタ理論式 |
| 理論式の移植 | しない（税二重計上と判断） | ✅ 採用（前提が誤り：室料は税抜保存だった） |
| 受け皿 | `booking.rate_plans / daily_rates / availability` | ✅ 継続（生成方式のみ変更） |
| 直販プラン判定 | `is_active` かつ `sales_channels.channels.autumnBooking <> ''` | ✅ 継続 |
| 在庫 | TL 残室の差分適用 | ✅ 暫定継続（PMS 切替後に Phase C/D） |

### v1 の「税二重計上」判定について（訂正）

v1 は「`prices_by_guest_count` は Excel セルそのまま＝税込で保存され、理論式が ×1.1 を重ねるため約10%高い」と
判定したが、**現 PROD データの室料は税抜**（メゾネット2名=30,000）であり、×1.1 は正しい。
（v1 検算の 33,000 は税込値で、それを税抜として式に入れたため 79,200 という誤値になった。）

### TL プラングループ名の突合ロジック（v2 でも構造情報の暫定取得に使用）

- 先頭4文字がグループコード。部屋トークン: yamado=5文字目以降 / oga=第2フィールド
- プランキー = 部屋トークンを除去した名前。`book._tl_plan_key` / `book._tl_room_token` / `book._tl_norm`
- 部屋トークン → `room_types.metadata.siteControllerName` または `rms_base_room_rates.short_name` の `<` 前
- PROD 実査で 1トークン→1部屋タイプ（多重マッチなし）確認済み

### 在庫の差分適用（v2 でも Phase C まで継続）

```
新規日:  available_rooms = min(TL残室, total_rooms)、metadata.tl_remaining = TL残室
既存日:  available_rooms += (今回TL残室 − metadata.tl_remaining)  ※ 0..total_rooms にクランプ
```

「OTA が売った分（TL残室の減少）」だけ取り込み「自社が売った分（ローカル減算）」を保持する。
hold 失効の復元（pg_cron）とも整合。

</details>
