# 会員限定の空室通知

会員が指定した条件の空室を確認し、本人の確認済みAuthメールに1回通知する。予約・在庫確保はしない。メールマガジンと別の受信同意を登録ごとに記録。

## 画面と条件

マイページ `/account/availability-alerts` に登録・直近100件の履歴・停止。施設のプラン一覧から宿泊日・泊数・人数を引き継ぐ。loadとactionで会員認証を確認し、DBもAuth本人IDと有効な会員行で制限する。

明日〜365日後、1〜7泊、大人1室1〜6名、同じ部屋タイプ・プランで1〜4室。部屋・プランは指定なしも可。子ども条件は未対応。予算は全室全泊の税込宿泊料金、クーポン・ポイント・特別会員ページの個別料金を適用する前。有効10件まで、会員行ロックで上限と同条件の重複を守る。

## 判定と送信

`book_availability_alert_scan`（5分毎）→既存 `book.plan_offers`→専用キュー→既存 `book_mail_outbox_drain`（2分毎）→`send-booking-mail/availability.ts`→施設SMTP。

公開施設／部屋／プラン、全泊の料金・残室・販売停止・最低泊数・人数・必要室数・予算を判定。最安の一致を1件案内。在庫ソースは現行公式検索と同じ `booking.availability` で、TL連携更新の遅延を含む。複数室のメールは必要室数を予約かごに追加する案内を載せる。

登録状態は `active → queued → notified`。送信前に条件が消えるとactiveへ戻る。停止はstopped、JST宿泊日当日／退会／受信資格喪失はexpired、恒久SMTPエラー／最大5回の失敗はfailed。10分経過したprocessingを回収。attempt番号で古い結果を拒否、並行ワーカーはSKIP LOCKEDで分担する。

停止・送信結果のロック順は登録→キューで統一。SMTP中はDBロックを保持しないため停止時にすでに送信中の1通は到着する場合がある。SMTP成功直後のDB保存障害では、回収後に重複する可能性がある（既存予約メールと同じ制約）。

## DBと権限

共通リポ `autumn-shared/supabase/migrations/20261012230534_book_availability_alerts.sql` のみで管理。

| 対象 | 会員 | ワーカー |
|---|---|---|
| availability_alerts | RLSで本人SELECTのみ | service_role |
| register／stop RPC | 本人・有効会員・テナント・確認済みメールを検証 | 不要 |
| availability_alert_mail／内部RPC | アクセス不可 | service_roleのみ（cronはpostgres） |

書き込みRPCはSECURITY DEFINER・空search_path・完全修飾名。キューにメールアドレスは保存せずSMTP直前にAuthから取得。送信済み／取消payloadは消去。宿泊日から90日を過ぎた通知は週次削除し、キューもCASCADE。

## リリースと確認

1. Deno型チェック後、既存EFを `supabase functions deploy send-booking-mail --no-verify-jwt --use-api --project-ref opkocyapzmsjzhbwlguh` で更新。新RPC未適用でも従来予約メールは動く。
2. 共通リポのmigrationを既定の運用で適用。history・権限・cronを確認。
3. Book v0.122.0をデプロイ。既存Vault（book_send_booking_mail_url／_secret）、BOOK_SITE_BASE_URL、施設SMTPを使い追加secretなし。
4. HANDOFFのチェックリストを社内テスト会員で確認。一般会員へ試験メールを送らない。

緊急停止は空室通知の入口を外してscan cronを停止し、専用キューのpending／processingをcancelled、登録のactive／queuedをstoppedにする。予約メールdrainは止めない。DDLの巻き戻しは共通リポの後続migrationで行う。
