# 会員サポート（support@yamado.app・ヘルプページ）

2026-11-22 ユーザー指示。会員システム（Book の会員登録・ログイン・マイページ・公式サイトの予約）についての問い合わせ窓口を作る。
施設のお問い合わせ（`book.inquiries`・西和賀の info@ を IMAP で取り込む仕組み・docs/inquiries.md）とは別の仕組みにする。

## 決めたこと

- 窓口のアドレスは **support@yamado.app**。会員向けのメールの「お問い合わせ先」はここにする（「宿までご連絡ください」だけで連絡先が無かった）
- 受信は **Book に直接取り込む**。Cloudflare Email Routing（yamado.app）で support@ を受け、受信用 Worker が Book の `/api/support/inbound` に渡す
- 管理は **専用の「会員サポート」画面**（`/admin/support`）。施設のお問い合わせ画面には混ぜない
- 返信は support@yamado.app から送る（Reply-To も support@）。件名に `[YS-XXXXXX]` を入れ、お客様の返信を同じ問い合わせにつなぐ
- お客様向けには **ヘルプページ**（`/help`）を作る。よくある質問（カテゴリ別）と、いちばん下に問い合わせフォーム

## DB（autumn-shared `20261121224620_book_member_support.sql`・適用済み）

テナント単位（施設に属さない）。テーブルは RLS で直接は触らせず、関数だけで読み書きする。

| テーブル | 内容 |
|---|---|
| `book.support_tickets` | 問い合わせ 1 件。`code`（YS-XXXXXX）・`status`（open 対応中 / waiting お客様の返事待ち / closed 完了）・`category`・`name`・`email`・`member_user_id`・`subject`・`source`（form / email）・`needs_reply`（お客様の最新のメッセージに未返信）・`last_message_at` |
| `book.support_messages` | やりとり。`direction`（in お客様から / out 宿の返信 / note 宿の中のメモ）・`body`・`mail_message_id`（受信の二重取り込み防止）・`send_status`（sending / sent / failed） |
| `book.support_faqs` | ヘルプページのよくある質問。`category`・`question`・`answer`（プレーンテキスト・改行あり）・`sort_order`・`is_published`。初期データ 10 件 |

カテゴリ（`category` の値と表示名）: `login` ログイン・会員登録 / `legacy` 旧会員の移行 / `booking` ご予約 / `points` ポイント・会員ランク / `other` その他

関数:

| 関数 | 呼ぶ人 | 内容 |
|---|---|---|
| `support_submit(name, email, category, subject, body, member_user_id)` | service_role（フォーム） | 問い合わせを作る → `{id, code}` |
| `support_inbound(from_email, from_name, subject, body, message_id)` | service_role（受信） | 件名の `[YS-…]` と差出人が合えば続きに足す（状態を open・needs_reply）。無ければ新しい問い合わせ → `{id, code, new}`、同じ Message-ID は `{duplicate:true}` |
| `support_mark_sent(message_id, ok, error)` | service_role / スタッフ | 返信メールの送信結果 |
| `support_faqs_public()` | anon | 公開中のよくある質問 |
| `admin_support_list(status)` / `admin_support_counts()` / `admin_support_get(id)` | スタッフ | 一覧（未返信が上）・件数・詳細（やりとり・会員番号） |
| `admin_support_reply(id, body)` | スタッフ | 返信を記録（send_status=sending）し、状態を waiting に → `{message_id, code, email, name, subject}`。**送信はアプリ**、結果は `support_mark_sent` |
| `admin_support_note(id, body)` / `admin_support_set_status(id, status)` | スタッフ | メモ・状態 |
| `admin_support_faqs()` / `admin_support_faq_save(...)` / `admin_support_faq_delete(id)` | スタッフ | よくある質問の編集 |

スタッフ＝テナントの所属（`book._require_staff`）。管理者に限らない。

## アプリ

### お客様側
- `/help`（(public) 配下）: 見出し「ヘルプ」。よくある質問をカテゴリごとに折りたたみ（details/summary）で並べる。いちばん下に「お問い合わせ」フォーム
  - フォーム: お名前・メールアドレス（会員はログイン中のアドレスを初期値）・お問い合わせの種類（カテゴリ）・件名（任意）・内容・プライバシーポリシーの同意・Turnstile
  - 送信: Turnstile と回数制限（IP ごと・`RATE_RULES` に足す）を通してから `support_submit`（service_role）。完了表示に問い合わせ番号
  - 受付の控えメールをお客様へ（support@yamado.app から・件名 `【YAMADO】お問い合わせを受け付けました [YS-…]`・本文に内容の控え）
  - 宿への通知メール（新しい問い合わせ）: 送り先は環境変数 `SUPPORT_NOTIFY_TO`（無ければ info@yamado.co.jp）
- 入口: A面のフッターに「ヘルプ・お問い合わせ」。マイページにも「ヘルプ・お問い合わせ」
- 会員向けメールの文言: 「宿までご連絡ください」「お心当たりがない場合…」の箇所に「お問い合わせ: support@yamado.app（https://book.yamado.app/help）」を足す（`lib/server/legacy-members.ts` の FOOTER・完了メール、電話での会員登録メール等）

### 管理画面
- メニュー「会員・サイト」に「会員サポート」（未返信の件数バッジ）
- `/admin/support`: 状態のタブ（対応中・返事待ち・完了・すべて）と件数。行は 未返信の印・番号・お名前・メール・カテゴリ・件名・最新の抜粋・最終日時
- `/admin/support/[id]`: やりとりを時系列で（お客様 / 宿の返信 / メモ を色分け）。返信欄（送ると support@ からメール・件名 `Re: <件名> [YS-…]`）。メモ欄。状態の切替。会員なら会員番号とマイページの会員詳細へのリンク
- `/admin/support/faqs`: よくある質問の一覧・追加・編集・公開/非公開・削除・並び順

### 受信
- `workers/support-inbound/`（別の Worker・Pages とは別にデプロイ）: Email Routing の `email()` で受け、`postal-mime` で本文（テキスト優先・無ければ HTML を文字に）・差出人・件名・Message-ID を取り出し、`https://book.yamado.app/api/support/inbound` に HMAC 署名つきで POST
- `/api/support/inbound`（アプリ）: 署名（`SUPPORT_INBOUND_SECRET`）と時刻を検証して `support_inbound`。新しい問い合わせなら宿へ通知
- 引用部分（「>」で始まる行・「On … wrote:」以降）は本文から落とさずにそのまま保存（画面で折りたたむ）

### 実装で決めたこと（2026-11-22・設計からの補足と変更）
- 共通の部品: `lib/support.ts`（カテゴリ・状態・件名の番号・引用の分け方・デモのよくある質問）、`lib/server/member-support.ts`（service_role の呼び出し・署名・メールの文面・返信の送信）。service_role の例外は `partners/admin-client.ts` の「例外その15」
- **宿への通知の差出人は support@ にしない**（既定の REPORT_EMAIL_FROM・返信先なし）。support@ から送ると、宿の人が通知に返信したとき support@ に戻って新しい問い合わせになるため。お客様向け（控え・返信）は設計どおり From・Reply-To とも support@yamado.app（名前「YAMADO サポート」）
- 回数制限（`RATE_RULES`）: `supportSubmitIp` 1 IP 1 時間 5 件・`supportSubmitEmail` 1 メール 1 時間 3 件（控えのメールを送るので送信の踏み台にさせない）。超えたら「しばらくしてから」を出す
- 受信: support@yamado.app 自身から来たメールは Worker で捨てる（ループ防止）。添付は件数だけ本文の末尾に「［添付ファイル N 件がありましたが、受け取っていません］」と残す。続きのメール（既存の問い合わせ）では宿へ通知しない（新しい問い合わせだけ）。`/api/support/inbound` はメンテナンス中も通す（`maintenance.ts`）
- 返信の送信に失敗したとき: 返信は記録済みのまま（send_status=failed）画面に赤字で出し、返信欄は空にする（同じ返信を二重に記録させない）。やりとりの「再送」で同じ本文を送り直す
- 管理メニュー: 「会員・サイト」に子の無い項目「会員サポート」（全施設共通・スタッフにも出す・未返信のバッジ）。よくある質問の編集は一覧の右上のボタンから
- マイページの入口: パソコンの左のナビ（アカウント設定の下）と、アカウント設定の一覧（スマホはここから）
- 本文の引用は保存はそのまま、画面で「>」の行・「On … wrote:」・「…:」の次が「>」の行などから後ろを折りたたむ
- お客様側の文言は ja / en / zh-TW の 3 つ（キー help_* / support_*）。メール（控え・返信）は日本語だけ

### レビューを受けて（2026-11-22）
- **`SUPPORT_MAIL_ENABLED`（Pages の secret / 環境変数・既定は無し）が `'true'` のときだけ support@yamado.app を表に出す**。support@ の受信（Email Routing・受信用 Worker）が動く前にアドレスを載せると、お客様のメールが届かないため
  - 'true': 会員向けメールの問い合わせ先に support@（＋ヘルプページ）、ヘルプページに「返信は support@ から」「メールでのお問い合わせ」、控え・返信は From・Reply-To とも support@
  - それ以外: 会員向けメールの問い合わせ先はヘルプページの URL だけ。控え・返信は REPORT_EMAIL_FROM から Reply-To なしで送り、本文に「このメールには返信できません。ご返信はヘルプページのフォームから受付番号を添えて」と書く
- 件名・名前の改行などの制御文字は空白に置き換える（フォーム・受信・通知と控えの件名）
- 控えの本文に載せる内容は先頭 500 字まで（「…」付き）
- 受信用 Worker: Book の応答が 401/403/404/429/5xx・通信の失敗なら throw（送り直してもらう）、400/413 だけ捨てる。捨てる前に `FALLBACK_FORWARD`（任意・検証済みの転送先）があれば転送する。自動送信のメール（Auto-Submitted が no 以外・Precedence bulk/junk/list・mailer-daemon/postmaster）は `auto: true` を付け、Book は取り込むが宿へ通知しない。support@ と noreply@yamado.app からのメールは捨てる。Message-ID が無いときは 差出人＋件名＋本文 の SHA-256 を `<hash@support-inbound>` として使う
- 返信の再送: failed はいつでも、sending（結果の記録が無い）は作成から 5 分たってから、画面内で「届いている可能性があります」を確かめてから
- 返信・状態の変更・メモの後は、その人のサイドバーのバッジの覚え（60 秒）を消す（`lib/server/admin-badges.ts`）

## 未定・あとで
- Cloudflare の設定（Email Routing を yamado.app で有効にして MX を足す・support@ → Worker のルール・Worker のデプロイ・secret）はユーザーの確認を取ってから
- 添付ファイルは受けない（本文だけ。添付があったことだけ記録）
