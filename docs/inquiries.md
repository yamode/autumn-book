# お問い合わせ管理

山人-yamado-先行運用。男鹿HPは変更しない。DBはAutumn Platformのbookスキーマ、migrationはautumn-sharedで管理する。

## 構成

西和賀HPのPHPで入力・Turnstile・回数制限を検証し、公開ディレクトリ外の秘密でJSONをHMAC署名する。Bookの`POST /api/inquiries/nishiwaga`は署名と時刻を確認してservice専用RPCで保存する。施設・通知先はサーバー固定。受付成功の基準はDBへの保存で、メール送信の成否に依存しない。リクエストUUIDで通信再試行時の二重受付を防ぐ。

`/admin/inquiries`はBookの認証・MFAと利用者JWTを使う。DBの施設権限で問い合わせ・履歴を絞り、直接の更新を禁止する。編集・送信・知識の承認は施設権限を検証するRPCから行い、操作を記録する。通知から詳細画面を開くと、西和賀に施設表示を切り替える。

## AI下書き

Autumn PMSと同じ`ANTHROPIC_API_KEY`をBookのCloudflareシークレットにも登録する。PMSのシークレットを読み出す処理は作らない。モデルは共通の`core.tenants.metadata.ai_models.mail_draft`を読み、未設定時の既定もPMSと同じ`claude-haiku-4-5-20251001`。確認時の設定値は`claude-sonnet-5`。

同じ施設の公開FAQと、スタッフが一般化して承認した送信済み回答だけを検索する。期限切れ・利用停止の回答例は除く。本文から既知の氏名・メール・電話番号を置換し、住所等のプロフィールを送らない。ただし自由記入中のすべての個人情報を完全に匿名化する保証はない。プロンプトは問い合わせや参照文書内の命令に従わず、不明点を【要確認】として残す。参照資料と元のAI下書きを保存し、送信内容との比較ができる。AIは送信しない。

回答例は質問・回答を一般化して登録し、個別の氏名・予約番号・特別対応を外す。これは検索に使う知識の蓄積で、モデル自体の自動再学習ではない。

## メール送信と返信取り込み

受付控え・担当者通知・担当者の回答は`book.inquiry_messages`にキューとして保存し、既存の`send-booking-mail`のSMTP処理で送る。施設の`pms.mail_settings`を利用し、返信先は`info@yamado.co.jp`にする。件名の`[YI-ランダム32桁]`と決定的なMessage-IDで会話を識別する。

`sync-inquiry-mail`は既存のinfoメールボックスをIMAPで読み取り、件名またはReferences/In-Reply-Toの識別子と元のお客様のメールアドレスを照合する。UIDVALIDITYとUIDを保存し、同じメールを二重に取り込まない。メールボックスの既読状態・移動・削除は変更しない。1回100 UIDの範囲を処理する。初回・UIDVALIDITY変更時は直近500 UIDから開始する。問い合わせ番号のない従来メールや別の差出人は自動取込しない。

添付はファイル名を会話に記録し、原本はメールボックスで確認する。本文は28,000文字まで取り込み、8MiBを超える対象メールは同期エラーとして止める。エラーと最終同期時刻は一覧に表示する。受信が止まった場合は管理者が対象メールを確認して対処する。

SMTPには厳密な一度だけの送信保証がない。送信開始後のエラー・10分を超えた送信処理は「送信結果不明」とし、自動再送しない。サーバーの履歴で送信済み／未送信を確認して画面で確定する。送信前の設定エラーは「送信失敗」として画面から再試行できる。新しいお客様の返信が届いたら未送信回答を停止し、内容を作り直す。新しい返信・同時編集があれば古いrevisionでの保存・送信を拒否する。

## 必要な設定

| 配置 | 設定 |
|---|---|
| Book Cloudflareシークレット | `ANTHROPIC_API_KEY`：既存Autumnと同じキー。`INQUIRY_HP_SECRET`：新規32バイトhex秘密 |
| Book Cloudflare変数 | `INQUIRY_NISHIWAGA_ENABLED=true`（受付を有効化） |
| Supabase Functionsシークレット | `BOOK_INQUIRIES_ENABLED=true`、`BOOK_INQUIRY_REPLY_TO=info@yamado.co.jp` |
| Supabase Functionsシークレット | `BOOK_INQUIRY_IMAP`：`{"facilityId":"10000000-0000-0000-0000-000000000001","email":"info@yamado.co.jp","host":"実際のIMAPホスト","port":993,"username":"実際のユーザー名","password":"実際のパスワード"}` |
| 既存設定を流用 | `SUPABASE_SERVICE_ROLE_KEY`、`BOOK_SEND_BOOKING_MAIL_SECRET`、SMTPの施設設定、Vaultの`book_send_booking_mail_url`／`book_send_booking_mail_secret` |
| Xserver公開領域外 | `yamado-private/book-inquiry-config.php`の`enabled`と`secret`（Book側と同じ値） |

秘密はチャット・git・デバッグログに出さない。受付本文のDEBUGログも出さず、エラー種別だけ記録する。

## 公開手順

1. autumn-sharedのmigrationをチェックリストで確認してmainへ直接commit/pushし、`supabase db push --linked`で適用する。Branching／Preview Branch／PRはユーザーが明示的に指示した場合だけ使う。StudioやMCPでDDLを実行しない。
2. `send-booking-mail`と`sync-inquiry-mail`を`--no-verify-jwt`でデプロイする。どちらも既存の共有秘密を定数時間比較で検証する。cronはmigrationで追加する。
3. BookのシークレットとFunctionsの設定を登録し、Bookをビルド・公開する。受信同期の最終時刻とSMTP設定を確認する。
4. 西和賀HPを`build:xserver`で生成して公開する。既存のフォームは切替までメール直送のまま動く。
5. 同じ`INQUIRY_HP_SECRET`を環境変数に設定し、`INQUIRY_ENABLE=false`で`node scripts/setup-book-inquiry.mjs`を実行する。既存configを保全して専用設定を追加する。
6. 社内アドレスだけで受付・回答・返信の一巡を確認した後、`INQUIRY_ENABLE=true`で同スクリプトを実行して西和賀の受付を切り替える。

送信テストは明示的に許可された社内宛先だけを使用する。一般のお客様を試験に使わない。

## 切り戻し

Xserverの`enabled=false`に戻すと新規受付は従来のメール直送へ戻る。Bookの保存済み履歴は残す。進行中の問い合わせの返信取込・送信を止める必要がある場合だけ、Functionsの`BOOK_INQUIRIES_ENABLED=false`にする。既存の予約メールは引き続き動く。

## 運用上の確認事項

初期版のAI下書きは担当者がボタンで作成する。完了した問い合わせの自動削除は行わず、保存期間・削除手順は運用開始前に決める。男鹿への展開時は公開API、画面の先行施設制限、IMAP設定を施設別に拡張してから男鹿HPを切り替える。
