# support-inbound（会員サポートの受信用 Worker）

support@yamado.app に届いたメールを Book の会員サポート（`/admin/support`）に取り込む Worker。設計は `docs/member-support.md`「受信」。

```
お客様のメール → Cloudflare Email Routing（yamado.app）→ この Worker（email()）
  → postal-mime で 差出人・名前・件名・本文（テキスト優先／無ければ HTML を文字に）・Message-ID を取り出す
  → POST https://book.yamado.app/api/support/inbound
      x-support-timestamp: UNIX 秒
      x-support-signature: hex(HMAC-SHA256(SUPPORT_INBOUND_SECRET, `${timestamp}.${body}`))
  → Book が book.support_inbound で取り込み（件名の [YS-XXXXXX] と差出人が合えば続き、無ければ新しい問い合わせ・新しければ宿へ通知）
```

- 添付ファイルは受け取らない（件数だけ本文の末尾に残す）
- support@yamado.app・noreply@yamado.app から来たメールは取り込まない（送信のループを作らない）
- 自動送信のメール（Auto-Submitted が no 以外・Precedence が bulk / junk / list・差出人が mailer-daemon / postmaster）は `auto: true` を付けて渡す。Book は取り込むが、新しい問い合わせでも宿へ通知しない
- Message-ID が無いメールは、差出人＋件名＋本文の SHA-256 を `<hash@support-inbound>` として代わりに使う（送り直しで二重に入らない）
- 失敗しても `setReject` はしない
  - Book の 5xx・429・通信の失敗、401 / 403 / 404（鍵や URL の設定の誤り）は throw して Email Routing に送り直させる
  - 400（形の誤り）・413（大きすぎ）は送り直しても同じなので、`FALLBACK_FORWARD`（任意）があればそこへ転送してから終える。無ければログだけ
  - ⚠ **throw で本当に送り直されるか（何回・どれくらいの間か）は、本番の前に確かめる**: Book の `SUPPORT_INBOUND_SECRET` を一時的に外す（＝503 を返す）か、`BOOK_INBOUND_URL` を 503 を返す先に向けてテストのメールを送り、`wrangler tail` で再送が来ること、戻したあとに取り込まれることを見る。送り直されない場合は `FALLBACK_FORWARD` を必ず設定する
- Pages（apps/web）とは別にデプロイする。pnpm のワークスペースには入れていない（このフォルダで `npm install` する）

## Cloudflare 側の設定（ユーザーの確認を取ってから行う）

1. **Email Routing を yamado.app で有効にする**
   - ダッシュボード → yamado.app → Email → Email Routing → 有効化。MX と SPF の DNS レコードが追加される
   - ⚠ yamado.app に既に別の受信（MX）がある場合は置き換わる。先に `dig MX yamado.app` で確かめる
   - Email Sending（送信）はすでに有効（`wrangler email sending enable yamado.app` 済み）。受信を足しても送信の SPF/DKIM はそのまま
2. **Worker をデプロイする**
   ```bash
   cd workers/support-inbound
   npm install
   npx wrangler login            # 未ログインなら
   npx wrangler secret put SUPPORT_INBOUND_SECRET   # 下の 4 と同じ値（長いランダム文字列。例: openssl rand -hex 32）
   npx wrangler deploy
   ```
   - `BOOK_INBOUND_URL` は `wrangler.jsonc` の vars（既定 `https://book.yamado.app/api/support/inbound`）。secret にしたいときは vars から消してから `wrangler secret put BOOK_INBOUND_URL`
   - 任意: `FALLBACK_FORWARD`（取り込めないメールの逃がし先・例 info@yamado.co.jp）。Email Routing の「宛先アドレス」に登録して検証を済ませてから、vars か secret で入れる
3. **ルートを作る**: Email Routing → ルーティングルール → カスタムアドレス `support@yamado.app` → アクション「Worker に送信」→ `autumn-book-support-inbound`
4. **Book（Pages）に同じ secret を入れる**
   ```bash
   wrangler pages secret put SUPPORT_INBOUND_SECRET --project-name autumn-book
   wrangler pages secret put SUPPORT_NOTIFY_TO --project-name autumn-book   # 任意。宿への通知の送り先（カンマ区切り可・無ければ info@yamado.co.jp）
   ```
   - Book 側に `SUPPORT_INBOUND_SECRET` が無いと `/api/support/inbound` は 503 を返す（Worker は送り直し続ける）
   - 受信が動くのを確かめてから `SUPPORT_MAIL_ENABLED=true` を入れる（`wrangler pages secret put SUPPORT_MAIL_ENABLED`）。'true' のときだけ、会員向けメール・ヘルプページに support@yamado.app を載せ、控え・返信を support@ から（Reply-To も support@）送る。それまでは控え・返信は既定の差出人から返信先なしで送り、「ご返信はヘルプページのフォームから」と案内する
5. **確かめる**: 外のアドレスから support@yamado.app に送る → `/admin/support` に新しい問い合わせが出る → 宿への通知が届く → 返信して、お客様側で返信した（件名の番号を残した）メールが同じ問い合わせの続きに入る
   - Worker のログ: `npx wrangler tail autumn-book-support-inbound`

## 手で試す（デプロイせずに）

`wrangler dev` は email() の受信を `/cdn-cgi/handler/email` で試せる（Cloudflare のドキュメント「Local development」）。
`BOOK_INBOUND_URL` をローカルの Book（`http://localhost:5173/api/support/inbound`）に向け、Book の `.env` に同じ `SUPPORT_INBOUND_SECRET` を入れる。
⚠ ローカルの `.env` は本番の Supabase を向いていることがある。取り込むと本番の会員サポートに入るので注意。
