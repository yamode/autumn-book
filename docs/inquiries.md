# お問い合わせ管理

山人-yamado-先行運用。男鹿HPは変更しない。DBはAutumn Platformのbookスキーマ、migrationはautumn-sharedで管理する。

## 構成

西和賀HPのPHPで入力・Turnstile・回数制限を検証し、公開ディレクトリ外の秘密でJSONをHMAC署名する。Bookの`POST /api/inquiries/nishiwaga`は署名と時刻を確認してservice専用RPCで保存する。施設・通知先はサーバー固定。受付成功の基準はDBへの保存で、メール送信の成否に依存しない。リクエストUUIDで通信再試行時の二重受付を防ぐ。

`/admin/inquiries`はBookの認証・MFAと利用者JWTを使う。DBの施設権限で問い合わせ・履歴を絞り、直接の更新を禁止する。編集・送信・知識の承認は施設権限を検証するRPCから行い、操作を記録する。通知から詳細画面を開くと、西和賀に施設表示を切り替える。

## AI下書き

Autumn共通Supabase Functionsに登録済みの`ANTHROPIC_API_KEY`を、スタッフJWTで保護した`draft-inquiry-reply`から使用する。Bookへキーを複製しない。問い合わせ・参照資料は利用者JWTと施設RLSで再確認し、クライアントから任意のプロンプトを渡す方式にはしない。モデルは共通の`core.tenants.metadata.ai_models.mail_draft`を読み、未設定時の既定もPMSと同じ`claude-haiku-4-5-20251001`。確認時の設定値は`claude-sonnet-5`。

同じ施設の公開FAQ、スタッフが一般化して承認した送信済み回答、infoメールから取り込んだ過去回答を検索する。過去メールは「参考」と明示し、回答日と元の履歴へのリンクを表示する。現行FAQ・承認済み回答を優先し、過去メールだけの料金・条件は要確認とする。参考利用を停止した回答や期限切れの回答例は除く。本文から既知の氏名・メール・電話番号を置換し、住所等のプロフィールを送らない。ただし自由記入中のすべての個人情報を完全に匿名化する保証はない。プロンプトは問い合わせや参照文書内の命令に従わず、不明点を【要確認】として残す。参照資料と元のAI下書きを保存し、送信内容との比較ができる。AIは送信しない。

回答例は質問・回答を一般化して登録し、個別の氏名・予約番号・特別対応を外す。これは検索に使う知識の蓄積で、モデル自体の自動再学習ではない。

## メール送信と返信取り込み

受付控え・担当者通知・担当者の回答は`book.inquiry_messages`にキューとして保存し、既存の`send-booking-mail`のSMTP処理で送る。施設の`pms.mail_settings`を利用し、返信先は`info@yamado.co.jp`にする。件名の`[YI-ランダム32桁]`と決定的なMessage-IDで会話を識別する。

`sync-inquiry-mail`は既存のinfoメールボックスをIMAPで読み取り、件名またはReferences/In-Reply-Toの識別子と元のお客様のメールアドレスを照合する。UIDVALIDITYとUIDを保存し、同じメールを二重に取り込まない。メールボックスの既読状態・移動・削除は変更しない。Edgeでは期限付きのネイティブTLS接続でEXAMINEとBODY.PEEKを使い、受信処理が停止したまま残らないようにする。1回500 UIDの範囲を処理する。初回・UIDVALIDITY変更時は直近500 UIDから開始する。問い合わせ番号のない従来メールや別の差出人は自動取込しない。

添付はファイル名を会話に記録し、原本はメールボックスで確認する。本文は28,000文字まで取り込み、8MiBを超える対象メールは同期エラーとして止める。エラーと最終同期時刻は一覧に表示する。受信が止まった場合は管理者が対象メールを確認して対処する。

SMTPには厳密な一度だけの送信保証がない。送信開始後のエラー・10分を超えた送信処理は「送信結果不明」とし、自動再送しない。サーバーの履歴で送信済み／未送信を確認して画面で確定する。送信前の設定エラーは「送信失敗」として画面から再試行できる。新しいお客様の返信が届いたら未送信回答を停止し、内容を作り直す。新しい返信・同時編集があれば古いrevisionでの保存・送信を拒否する。

## 必要な設定

| 配置 | 設定 |
|---|---|
| Book Cloudflareシークレット | `INQUIRY_HP_SECRET`：新規32バイトhex秘密 |
| Book Cloudflare変数 | `INQUIRY_NISHIWAGA_ENABLED=true`（受付を有効化） |
| Supabase Functionsシークレット | `BOOK_INQUIRIES_ENABLED=true`、`BOOK_INQUIRY_REPLY_TO=info@yamado.co.jp` |
| Supabase Functionsシークレット | `BOOK_INQUIRY_IMAP`：`{"facilityId":"10000000-0000-0000-0000-000000000001","email":"info@yamado.co.jp","host":"実際のIMAPホスト","port":993,"username":"実際のユーザー名","password":"実際のパスワード"}` |
| 既存設定を流用 | `ANTHROPIC_API_KEY`（Autumn共通・登録済み）、`SUPABASE_SERVICE_ROLE_KEY`、`BOOK_SEND_BOOKING_MAIL_SECRET`、SMTPの施設設定、Vaultの`book_send_booking_mail_url`／`book_send_booking_mail_secret` |
| Xserver公開領域外 | `yamado-private/book-inquiry-config.php`の`enabled`と`secret`（Book側と同じ値） |

秘密はチャット・git・デバッグログに出さない。受付本文のDEBUGログも出さず、エラー種別だけ記録する。

## 公開手順

1. autumn-sharedのmigrationをチェックリストで確認してmainへ直接commit/pushし、`supabase db push --linked`で適用する。Branching／Preview Branch／PRはユーザーが明示的に指示した場合だけ使う。StudioやMCPでDDLを実行しない。
2. `send-booking-mail`・`sync-inquiry-mail`・`draft-inquiry-reply`を`--no-verify-jwt`でデプロイする。メール送受信は既存の共有秘密を定数時間比較で検証し、AIは本人JWTと施設RLSを検証する。cronはmigrationで追加する。
3. BookのシークレットとFunctionsの設定を登録し、Bookをビルド・公開する。受信同期の最終時刻とSMTP設定を確認する。
4. 西和賀HPを`build:xserver`で生成して公開する。既存のフォームは切替までメール直送のまま動く。
5. 同じ`INQUIRY_HP_SECRET`を環境変数に設定し、`INQUIRY_ENABLE=false`で`node scripts/setup-book-inquiry.mjs`を実行する。既存configを保全して専用設定を追加する。
6. 社内アドレスだけで受付・回答・返信の一巡を確認した後、`INQUIRY_ENABLE=true`で同スクリプトを実行して西和賀の受付を切り替える。

送信テストは明示的に許可された社内宛先だけを使用する。一般のお客様を試験に使わない。

## 切り戻し

Xserverの`enabled=false`に戻すと新規受付は従来のメール直送へ戻る。Bookの保存済み履歴は残す。進行中の問い合わせの返信取込・送信を止める必要がある場合だけ、Functionsの`BOOK_INQUIRIES_ENABLED=false`にする。既存の予約メールは引き続き動く。

## 運用上の確認事項

初期版のAI下書きは担当者がボタンで作成する。完了した問い合わせの自動削除は行わず、保存期間・削除手順は運用開始前に決める。男鹿への展開時は公開API、画面の先行施設制限、IMAP設定を施設別に拡張してから男鹿HPを切り替える。

## 過去infoメールの取り込み（v0.159.0／autumn-shared v2.11.0）

- 過去の受信・アーカイブ・送信済みをEXAMINE／BODY.PEEKで読み、返信ヘッダーと同じお客様のメールアドレスを照合する。ヘッダーがない場合は同じ件名・同じ相手で直前30日間の問い合わせが1件だけの場合に限る。迷惑メール・ゴミ箱・下書きは対象外。
- メール内のMessage-IDで重複を防止し、履歴は「完了」で取り込む。取り込みでは受付控え・担当者通知・回答の送信キューを作らない。ライブ受信のUIDカーソルも変更しない。
- 原文は施設権限のあるスタッフ向けの履歴に保存。AIへ渡す参考文は引用・署名を除き、既知の氏名・メール・電話・予約番号・日付を置換する。自由文の完全な匿名化を保証する方式ではない。
- 未承認の過去メールは「過去メール（参考）」と表示し、回答日・元のやり取りをたどれる。現在のルールとして承認した回答とは区別する。利用停止は承認状態も解除し、再取り込みでも停止を上書きしない。
- 日本語2文字単位の検索語にGIN索引を付けて候補を取得し、既存のFAQ検索で再評価する。施設RLSで絞った資料をAI Function側でも再確認する。
- 元メールのMessage-IDも保存するため、古い回答への返信はReferences／In-Reply-Toと元のお客様のアドレスが一致し、紐付く履歴が1件の場合に同じ履歴へ入る。
- 8MiBを超えるメール、本文不足、同じ相手と確認できないメールは保留。添付は名前を記録し原本はメールボックスで確認する。

再実行用スクリプトはautumn-sharedの `scripts/import-book-inquiry-history.ts`。Denoで `scan → plan → download → prepare → import` の順に実行する。各コマンドへ `--cache=非公開作業フォルダ` を渡し、scan／downloadには `--account-env=既存Functions設定ファイル`、importには `--db-env=既存Autumnサーバー設定ファイル` を渡す。キャッシュには個人情報があるためgitへ入れず、Dropboxのsecrets配下で管理する。同じスナップショットの再実行では重複登録・再通知しない。

### infoへの受付通知

新しいHP問い合わせは引き続きinfo@yamado.co.jpにも受付通知する。本文に「返信は autumn-book 管理画面からお願いします。」と詳細画面へのURL、お客様名・メール・件名・問い合わせ本文を記載する。お客様本人向けの受付控えも維持する。通常は既存の2分ごとのメール送信処理で届く。

## 受信時の自動下書き・自動保存（Book v0.160.0／autumn-shared v2.12.0）

新規受付・お客様の返信をDBへ保存すると、同一トランザクションでAI下書きジョブを作り、コミット後にpg_netでworkerを起動する。1分ごとのcronが起動失敗・一時エラーを再処理する。自動workerと担当者のAI再作成は同じ検索・生成処理を使い、Autumn共通モデルを参照する。過去798件の一括取り込みは起動対象外。

ジョブは1問い合わせに1件、最新の受信を対象にする。リースと下書きのバージョンを照合し、担当者が入力を保存した場合・新着返信・送信処理中・完了の場合は古い生成結果を保存しない。生成後はdraft／元AI本文／参照元を記録するだけで、回答の送信キューは作らない。担当者の送信操作だけが回答をキューに入れる。

返信本文は入力が1秒止まるとDBへ自動保存し、保存時刻を表示する。自動保存は通信を直列化し、別の担当者や新しい返信との競合では本文を保持して再確認を求める。ネットワーク障害時は再試行とコピーを用意。AI完了の直前に書き始めた本文は、AI以外の変更がない場合だけ安全に引き継いで保存する。

管理画面は未完了を既定の受信トレイとし、状態別件数・検索・過去メールのタブを用意する。返信画面はお客様との履歴と編集欄を並べ、受付控え・info通知を折りたたむ。スマホは履歴／返信のタブで切替。送信前の確認画面に宛先と全文を表示し、【要確認】が残る場合は送信前に編集する。

Functionsは `auto-draft-inquiries` と `draft-inquiry-reply`。自動workerは既存 `BOOK_SEND_BOOKING_MAIL_SECRET`、手動は本人JWTと施設RLSで保護する。migrationは `20261018223753_book_inquiry_auto_drafts`。`admin_inquiry_edit`に任意の `p_expected_draft_version` が追加され、旧引数でも呼べる。新画面は保存・送信・AI再作成でこの値を照合する。

## メール表示・添付・署名（v0.161.0／autumn-shared v3.0.0）

メール表示は今回の本文と引用・署名を分ける推定処理。引用記号で囲まれていない途中の返信は本文として残す。各メール・引用・署名をdetailsで開閉でき、原文も取得可能。DBに保存した原文は変更しない。

添付は非公開Storageのbook-inquiry-filesに保存し、book.inquiry_attachmentsから施設RLSで参照する。アップロード後に所有者・実サイズを照合し、下書きの版を更新して登録。送信時は問い合わせ行をロックし、同じトランザクションで送信メッセージに添付を固定する。SMTP workerが実データを読み、既存のmultipart MIME処理で送る。送信失敗・結果不明時も添付を保持する。受信メールの添付については従来どおりファイル名を記録し、原本はメールボックスで確認する。

送信可能形式はPDF・画像（SVGを除く）・Excel・Word・CSV、最大10件・合計5MiB。送信前に添付取得に失敗した場合は添付を省いて送らず失敗とする。Storageは新規アップロードのみで上書き不可、登録済み／送信済みファイルを直接削除するポリシーはない。

署名はbook.inquiry_signaturesに施設共通テンプレートとして保存。{担当者名}を差し込み、担当者名が空欄なら付加しない。UIは編集本文の下に署名を表示し、autosave時にDBが同じテンプレート版で全文を構成する。draft_signatureで署名スナップショットを保持し、読み込み時に一度だけ分離する。送信確認・SMTP本文は署名を含む全文。テンプレート同時編集・下書き版・新着返信の競合は上書きしない。