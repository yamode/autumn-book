# Autumn Book 仕様書（MVP〜実運用設計）

## 1. 概要
Autumn Book は宿泊施設向け予約システムであり、会員向け予約体験・在庫連携・柔軟な料金設計を実現する。

## 2. システム構成
- FastAPI + DB + TL-リンカーン連携
- 在庫は外部（TL）を正とする

## 3. ドメインモデル
Facility → RoomType → RatePlan → Reservation
Reservation → ReservationOptions
RoomType → Inventory（日別）

## 4. 主要テーブル
### room_types
- id, facility_id, code, name, capacity_min, capacity_max

### reservations
- id, room_type_id, rate_plan_id, status, guest_count, total_amount

### options
- id, code, selectable_type, unit_price

### reservation_options
- reservation_id, option_id, selected_value, total_price

## 5. 在庫設計
- TLから同期（Push + 定期）
- 上書き方式
- 有効期限付き

## 6. API一覧
- GET /availability
- POST /reservations
- POST /reservations/{id}/confirm
- POST /reservations/{id}/cancel
- POST /reservations/{id}/checkout
- POST /inventory/sync
- GET /options
- GET /options/recommend
- PATCH /reservations/{id}/options

## 7. 料金設計
total_amount = 宿泊料金 + オプション料金

## 8. カート設計
- 仮予約 = PENDING
- オプション追加可能
- 確定でCONFIRMED

## 9. メール
- 予約確定
- キャンセル
- チェックアウトサンクス

## 10. 外部連携
- TL：在庫受信・予約送信
- Benchmark：会員同期のみ

## 11. 実装順序
1. 基盤
2. マスタ
3. 在庫
4. 検索
5. 予約
6. 決済
7. メール

