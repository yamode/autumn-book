# Autumn Book 完全仕様書（Full Spec）

## 1. システム概要
Autumn Book は宿泊施設向け予約システムであり、会員向け予約体験・在庫連携・柔軟な料金設計・ECカート型UXを実現する。

## 2. システム構成
[ユーザー] → [Autumn Book（FastAPI）] → [DB] → [TL-リンカーン]

## 3. 基本思想
- 在庫：TLが正
- 予約：Autumn Book
- 料金：Autumn Book
- 会計：チェックアウト基準

## 4. ドメインモデル
Facility → RoomType → RatePlan → Reservation
Reservation → ReservationOptions
RoomType → Inventory（日別）

## 5. データモデル

### room_types
- id
- facility_id
- code
- name
- capacity_min
- capacity_max

### rate_plans
- id
- room_type_id
- code
- name

### inventories
- id
- facility_id
- room_type_id
- date
- stock
- synced_at

### reservations
- id
- room_type_id
- rate_plan_id
- member_id
- status
- checkin_date
- checkout_date
- guest_adult_count
- guest_child_count
- total_amount

### options
- id
- facility_id
- code
- name
- selectable_type
- unit_price
- min_value
- max_value

### reservation_options
- id
- reservation_id
- option_id
- selected_value
- total_price

### option_recommend_rules
- id
- option_id
- condition_type
- condition_value
- priority

## 6. 在庫設計
- TLから同期（Push + 定期）
- 上書き方式
- 有効期限付き
- 期限切れは売止

## 7. API一覧
- GET /availability
- POST /reservations
- POST /reservations/{id}/confirm
- POST /reservations/{id}/cancel
- POST /reservations/{id}/checkout
- POST /inventory/sync
- GET /options
- GET /options/recommend
- PATCH /reservations/{id}/options

## 8. 料金設計
total_amount = 宿泊料金 + オプション料金

## 9. カート設計
- 仮予約 = PENDING
- オプション追加可能
- 確定でCONFIRMED

## 10. メール設計
- 予約確定
- キャンセル
- チェックアウトサンクス

## 11. 外部連携
- TL：在庫受信・予約送信
- Benchmark：会員同期のみ

## 12. 実装順序
1. 基盤
2. マスタ
3. 在庫
4. 検索
5. 予約
6. 決済
7. メール

## 13. 設計原則
- API → DB → UI
- 在庫は外部依存
- 予約は二段階
- 金額は固定
- 拡張可能設計

## 14. まとめ
Autumn Book は拡張性・安全性・実運用耐性を満たす予約システムである。
