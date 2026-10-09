# 認証の強化（取引先・管理画面・会員）と運用のセキュリティ — 設計書

> 作成: 2026-10-09（セキュリティレビュー A〜D を設計に起こしたもの）。対象 v0.106.2（main `f783c00`）。
> 実装は本書を元に Opus エージェントが行う。本書は実装者が迷わない粒度を目指し、**推測・未確認の事項は【未確認】と明記**した。
> 関連: `docs/partner-multi-facility.md`（取引先の複数施設化・S1〜S7 済）、`docs/saved-cards.md`（保存カード）、`docs/ADMIN_APP_OPS.md` §5（service_role を増やさない方針）。

ユーザーの問い（2026-10-09）: 「取引先専用ページのログインは ID・パスワードだけだが、パスキーなども設定できるようにしたほうがいいか。AI ハッキングやランサムウェア対策を万全にしたい。」

レビューの結論（要約）:
- パスキーは「設定できるようにする」価値があるが、**順番が重要**。先に (1) IP×限定URL のレート制限と Turnstile、(2) ログイン通知、(3) 共有カードの権限とステップアップ OTP を入れ、その後に第2要素（メール OTP → パスキー任意 → 取引先ごとに必須化）を載せる。
- 取引先は設計上 `auth.users` に入れない（migration `20260926025319` 冒頭）ため **Supabase Auth の MFA は使えず自前**。管理画面は Supabase Auth の **TOTP MFA がそのまま使え、乗っ取り時の被害が最大**なので取引先より先に必須化する。つなぎは Cloudflare Access。
- ランサムウェア対策の本丸はコードではなく設定（PITR・Supabase 外のイミュータブルなバックアップ・全 SaaS の MFA・main のブランチ保護・MCP の read-only 化）。§12 にチェックリスト。

---

## 1. 目的と範囲

| # | 範囲 | 本書の節 |
|---|---|---|
| 1 | 取引先ログインの第1段階（レート制限・Turnstile・ログイン通知・ログイン履歴・他端末ログアウト・文言統一） | §4 |
| 2 | 保存カードの権限（マスタのみ登録・削除・既定）と、カード登録・保存カードでの確定へのステップアップ OTP | §5 |
| 3 | 取引先の第2要素（メール OTP・`mfa_policy`・パスキー・TOTP 任意・復旧・「1人1ID」） | §6 |
| 4 | 管理画面の Supabase Auth TOTP MFA（enroll・aal2 強制・復旧）とつなぎの Cloudflare Access | §7 |
| 5 | 会員 OTP 送信のメール単位の制限 | §8 |
| 6 | anon 実行可 RPC の権限見直し | §9 |
| 7 | 運用・設定作業（コード外）のチェックリストとインシデント対応 1 ページ | §12・§13 |
| 8 | 実装分割 S1〜・工数・依存・未決事項・テストチェックリスト | §10・§11・§14 |

範囲外: CSP の本格導入（`security-headers.ts` のコメントどおり別途・Report-Only から）、会員のパスキー（UX 目的・低優先・§6.9 に将来形だけ）、取引先 API（Bearer）の変更（§4.7 に監視だけ）。

---

## 2. 用語

| 用語 | 意味 |
|---|---|
| 取引先ページ | `/p/<url_token>/…`。独自セッション（Cookie `rms_partner_session`・path `/p/<token>`・7日） |
| マスタ／子ユーザー | `rms_partner_accounts.is_master`。マスタは宿が発行、子はマスタが最大 30 人まで発行（`portal-users.ts`・`store.ts createChildAccount`） |
| 第1要素 | ログインID＋パスワード（PBKDF2-SHA256 100,000 回・`partners/crypto.ts`） |
| 第2要素 | メール OTP・パスキー・TOTP のいずれか |
| ステップアップ | 普段はパスワードだけで入れるが、高リスク操作の直前に第2要素を求める方式。セッションに `aal`（1 または 2）と `mfa_at` を持つ |
| `aal` | Authentication Assurance Level。1 = 第1要素のみ、2 = 第2要素済み。Supabase Auth の `aal1` / `aal2` と同じ考え方 |
| `mfa_policy` | 取引先ごとの第2要素の方針（`step_up` / `always` / `passkey_only`）。宿が管理画面で設定。既定 `step_up` |
| KV | Cloudflare KV。`AB_CONFIG`（設定・手入力コードの試行制限）と `AB_RATE`（FAQ の制限）。edge 間で共有・結果整合 |
| Turnstile | Cloudflare の CAPTCHA 代替（非表示モードあり）。サーバ側 `siteverify` で検証 |

---

## 3. 現状（調査結果・2026-10-09）

### 3.1 取引先ログイン（実コード）

| 項目 | 現状 | 所在 |
|---|---|---|
| ログイン処理 | `loginPartner(db, partner, loginId, password, meta)`。該当なしでもダミーハッシュで同じ計算（応答時間で有無を漏らさない）。統一エラー `ログインIDまたはパスワードが違います。` | `lib/server/partners/store.ts` L1319〜 |
| ロック | **アカウント単位**: 5 回失敗 → 15 分（`failed_attempts` / `locked_until`）。存在しない ID への試行は数えない。**IP 単位・限定URL 単位の制限は無い**。ロック中は `ログインの失敗が続いたため、一時的にロックしています。15分ほどおいてからお試しください。` と返し、**ID の存在が分かる** | 同 L200-201・L1341-1356 |
| セッション | 乱数 32B → DB は SHA-256（`rms_partner_sessions.token_hash`）。`ip` / `user_agent` / `last_seen_at`（5 分に 1 回更新）を持つ。`is_master` / `is_active` は毎リクエスト DB で確認 | 同 `startSession` / `getPartnerSession` |
| セッション失効 | 停止・削除・パスワード設定で当該アカウントの全セッション削除。**本人が「他端末をログアウト」する UI は無い** | 同 L1192・L1239・L1456・L1639-1646 |
| パスワード忘れ | セルフサービス無し。マスタ（ユーザー管理）または宿（管理画面）が設定リンク（7日）を再発行 | `routes/p/[token]/account/users/+page.server.ts deliverSetupLink`・`staff.ts sendSetupEmail` |
| 監査 | `rms_partner_access_logs`（`login` / `login_failed` / `login_locked` / `password_set` / `child_*` / `card_profile_*` / `book` ほか約 30 種・IP 付き）。管理画面の取引先詳細で閲覧 | `routes/admin/partners/[id]/+page.server.ts` |
| 通知 | ログイン通知メール無し | — |
| メール基盤 | `sendPartnerMail(db, facilityId, { to, subject, html, text })`（Cloudflare Email Sending・差出人は施設）。子ユーザー設定メールは `portal-users.ts sendChildSetupEmail`（差出人は `partnerSetupBrand`＝既定の施設） | `lib/server/partners/mail.ts`・`setup-brand.ts` |
| フォーム | `autocomplete="username"` / `current-password` 済み | `routes/p/[token]/+page.svelte` |
| KV の試行制限（流用元） | `claim-rate-limit.ts`（`AB_CONFIG`・`claimRateCheck` / `claimRecordFailure` / `claimRecordSuccess`・5 回で 10 分ロック・KV 無しはメモリ）。FAQ は `lib/server/faq/public.ts allowRequest(kv, key, limit, windowSec)`（`AB_RATE`・固定窓カウンタ） | — |
| DB 側の試行上限（雛形） | 客室コード照合 `book.claim_stay_by_code(p_short_code, p_client_key)`: 失敗を `book.stay_code_failures` に記録し、同一キー 10 分 10 回・全体 10 分 300 回で `rate_limited`。service_role 専用 | autumn-shared `20261009131735` |

### 3.2 保存カード（取引先）

- 取引先に 1 つの Stripe Customer（`rms_partners.stripe_customer_id`）。**マスタ・子ユーザーのどちらも**登録（`cards/api` の `prepare` / `confirm`）・削除（form action `remove`）・既定変更（`set_default`）・予約時の選択（`payment/+server.ts` の `customer_session`）ができる（`docs/saved-cards.md` D2・§6.1）。
- オフセッション請求は台帳の `stripe_customer_id + stripe_payment_method_id` の組だけを見る（`booking.ts chargeBooking` L966〜・`chargeCancelFee` L1408〜）。
- → **子ユーザー 1 人の乗っ取りで、会社のカードで予約（＝請求）ができる**。取引先アカウントの価値を上げている最大の要因。

### 3.3 管理画面

- Supabase Auth のメール＋パスワード（`routes/admin/login/+page.server.ts signInWithPassword`）。`app_metadata.role` が admin / staff のときだけ通す。MFA 未実装（ログイン画面に「パスキーは正式ドメイン移行後に有効化予定です」の文言）。
- `hooks.server.ts` → `resolveSupabaseSessionUser` が `getUser()` で検証。`routes/admin/+layout.server.ts` が role を見て `/admin/login` へ。
- Supabase セキュリティアドバイザ（2026-10-09 取得）: ERROR 0。WARN 5（`auth_leaked_password_protection`＝**漏えいパスワード照合が無効**、`function_search_path_mutable`、`extension_in_public`、`anon_security_definer_function_executable`、`authenticated_security_definer_function_executable`）。INFO 1（`rls_enabled_no_policy`＝取引先表の意図どおり）。アドバイザの応答に対象の関数名は含まれていなかった（§9 で候補を列挙）。

### 3.4 会員

- メール OTP（8桁）のパスワードレス。再送クールダウンは **Cookie `ab_otp_cooldown`（60 秒）だけ**＝Cookie を捨てれば無制限に `signInWithOtp` を叩け、任意のメールアドレスへ OTP メールを送り付けられる（`routes/(public)/auth/login/+page.server.ts sendCode`）。Supabase 側の送信レート（既定 1 通/60 秒/メール【未確認・プロジェクト設定次第】）が最後の砦。

### 3.5 周辺（v0.106.1〜2 で入ったもの）

- 全応答にセキュリティヘッダ（`lib/server/security-headers.ts`: nosniff・`X-Frame-Options: SAMEORIGIN`・`frame-ancestors 'self'`・`Referrer-Policy`・本番のみ HSTS）。
- `lib/safe-next.ts` で `?next=` を同一サイトの相対パスに限定（会員ログイン済み）。
- 客室コード照合は service_role ＋ DB 側試行上限（§3.1 最終行）。
- `service_role` は取引先モジュール以外（`direct-payments.ts`・`member-saved-cards.ts`・`staff-member-register.ts`）でも使用。`docs/ADMIN_APP_OPS.md` §5 の「autumn-book に service_role は一切無い」は古い。
- 確認モード（`preview.ts`）の署名鍵は `SUPABASE_SERVICE_ROLE_KEY` から派生 → キーをローテーションすると確認モードのクッキーが切れる（想定内・§12）。

---

## 4. 取引先ログインの第1段階【提案】

### 4.1 IP × 限定URL 単位のレート制限（KV）

`loginPartner` の**前**（`routes/p/[token]/+page.server.ts` の action 冒頭）と、パスワード設定（`setup/+page.server.ts` の action）に入れる。既存のアカウント単位ロックはそのまま残す（二段構え）。

- 新ファイル `lib/server/login-rate-limit.ts`（`claim-rate-limit.ts` をコピーして汎用化。`PREFIX` と閾値を引数にする。`claim-rate-limit.ts` 自体は触らない＝回帰を避ける）。
  - `loginRateCheck(platform, scope: 'partner'|'admin'|'member', key)` → `{ locked, retryInSec }`
  - `loginRecordFailure(platform, scope, key)` / `loginRecordSuccess(platform, scope, key)`
  - バインドは `AB_RATE`（`AB_CONFIG` は設定用。`app.d.ts` に型あり）。KV が無い環境はメモリ。
- キーと閾値（固定窓・KV の TTL 下限 60 秒を守る）:

| キー | 失敗上限 | 窓 | ロック | 目的 |
|---|---|---|---|---|
| `partner:<token>:<ip>` | 10 | 10 分 | 15 分 | 1 IP からの総当たり（ID を変えても止まる） |
| `partner:<token>` | 60 | 10 分 | 15 分 | 分散 IP からの 1 取引先への集中（平常時の打ち間違いでは届かない） |
| `setup:<token>:<ip>` | 10 | 10 分 | 15 分 | 設定トークンの総当たり（128 文字上限はあるが念のため） |
| `admin:<ip>` | 10 | 10 分 | 15 分 | §7 で使う |
| `member_otp:<ip>` / `member_otp:<email_hash>` | §8 | | | |

- 成功時は IP キーを `loginRecordSuccess`（取引先キーは減らさない）。
- ロック中の応答は**統一文言**（§4.5）。`logPartnerAccess` に `login_rate_limited`（detail: `{ scope: 'ip'|'partner' }`）を残す。
- IP は `requestMeta(event).ip`（`cf-connecting-ip`）。無ければ `'unknown'` を 1 つのキーとして扱う（締め出し側に倒さない）。
- 二重化: Cloudflare 側の Rate Limiting ルール（§12.2）も入れる。KV は結果整合で数回取りこぼすが、総当たりは確実に頭打ちになる（`claim-rate-limit.ts` の設計コメントと同じ理屈）。

### 4.2 Turnstile

| 画面 | 入れ方 | 失敗時 |
|---|---|---|
| 取引先ログイン `/p/[token]`（POST） | フォームに widget（**非表示モード**。見た目を変えない）→ action 冒頭で `siteverify` | `fail(400, { message: '確認に失敗しました。ページを読み直してください。' })` |
| 取引先パスワード設定 `/p/[token]/setup`（POST） | 同上 | 同上 |
| 管理ログイン `/admin/login`（`login` action） | 同上 | 同上 |
| 会員 OTP 送信 `/auth/login`（`sendCode` action） | 同上（`verify` には付けない＝コード入力の体験を壊さない。試行は §8 の制限で守る） | `fail(400, { step:'email', message: m.auth_turnstile_failed() })`（Paraglide 文言を追加） |

- 共通: `lib/server/turnstile.ts`（新設）`verifyTurnstile(token, ip, secret) → boolean`。`TURNSTILE_SECRET_KEY` は Cloudflare Pages の秘密、`PUBLIC_TURNSTILE_SITE_KEY` は `wrangler.jsonc` の vars。**両方未設定なら検証をスキップして通す**（ローカル dev・プレビューを止めない。本番は必ず設定・§12）。
- クライアント: `lib/components/Turnstile.svelte`（`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer>` を `<svelte:head>`、`<div class="cf-turnstile" data-sitekey data-size="invisible"|"normal">`）。SvelteKit の `use:enhance` と相性のため、トークンは hidden `cf-turnstile-response` に自動で入る既定の挙動を使う。
- ドメイン: widget は `book.yamado.app` と `*.autumn-book.pages.dev` を登録（プレビューでも動く）。`turnstile-spin` スキルで widget 作成〜埋め込みまで一気にできる（実装時に使う）。
- 取引先 API（Bearer）・Webhook・cron には付けない。

### 4.3 ログイン通知メール（新端末／新 IP）

- `loginPartner` 成功後、`startSession` の前に判定: 直近 90 日の `rms_partner_sessions`（同じ `account_id`）に **同じ `device_id`** が無い、または **同じ IP** が無い → 「新しい環境」とみなす。
  - `device_id`: 新クッキー `rms_partner_device`（path `/p/<token>`・httpOnly・secure・Lax・**1 年**・乱数 16B）。無ければ発行。`rms_partner_sessions.device_id` に保存（新列・§6.6）。
  - 両方が無いときだけ送る（IP だけ変わる＝モバイル回線の切替で頻発するので、`device_id` が一致すれば送らない）。
- 宛先: `account.email`。無ければマスタの `email`。それも無ければ送らず `logPartnerAccess('login_new_device', { notified:false })`。
- 本文（`portal-users.ts` に `sendLoginNoticeEmail` を追加。差出人は `partnerSetupBrand`）:
  - 件名 `【<施設名>】取引先専用ページに新しい環境からログインがありました`
  - 本文: 日時（JST）・ログインID・接続元（IP と、`request.cf.country` / `city` があれば【未確認: Pages Functions の `platform.cf` で取れる想定】）・ブラウザ（UA を短く）・「心当たりがない場合は、貴社のマスタユーザーに連絡してパスワードの再設定とログアウトを依頼するか、宿までご連絡ください（電話番号）」・「宿がメールでパスワードや認証コードを尋ねることはありません」。
- 送信失敗はログインを止めない（`then(() => undefined, () => undefined)` の既存流儀）。

### 4.4 ログイン履歴と他端末ログアウト

- 「アカウント」に新タブ **`security`（セキュリティ）** を追加（`lib/partner-account-roles.ts accountTabs`: `''`・`invoices`・`cards`・`security`・`users`〔マスタのみ〕の順。テスト `partner-account-roles.test.ts` を更新）。§6 の第2要素の設定もこのタブに載る。
- 表示: 自分のアクティブなセッション一覧（`rms_partner_sessions` を `account_id` で・`created_at` / `last_seen_at` / `ip` / UA 要約 / 「このブラウザ」印）と、直近 30 件の `login` / `login_failed` / `login_locked` / `login_new_device` / `mfa_*` / `passkey_*`（`rms_partner_access_logs` を `account_id` で）。
- 操作: 「他の端末からログアウト」（form action `logout_others`: 自分の `sessionId` 以外を削除）・個別の「この端末をログアウト」（`logout_session`: id 指定・自分の account のものだけ）。
- マスタは「ユーザー管理」から子ユーザーの **「すべての端末からログアウト」**（既存の停止処理のセッション削除を単独で呼べるように `revokeAccountSessions(db, partnerId, actorId, accountId)` を切り出す）。

### 4.5 ロック中の文言の統一

- `GENERIC_LOGIN_ERROR` に寄せる。`login_locked` と `login_rate_limited` は**同じ文言**: `ログインIDまたはパスワードが違うか、しばらくの間ログインを制限しています。数分おいてからお試しください。`（ID の存在・ロック中かを外から区別できないようにする）。
- 内部ログ（`access_logs`）には従来どおり `login_locked` / `login_rate_limited` を区別して残す（宿が原因を追える）。
- 管理画面のアクセスログ表示に `login_rate_limited` / `login_new_device` のラベルを追加。

### 4.6 セッション期限の見直し【相談】

- 現在 7 日固定（アイドル延長なし）。第2要素を入れるなら「7 日 or 最終アクセスから 24 時間のどちらか早い方」【推奨】にして、放置端末のセッションが生き残る時間を短くする。`getPartnerSession` に `last_seen_at + 24h` の判定を 1 行足すだけ。→ §10 の M3。

### 4.7 取引先 API（Bearer）

- 変更なし。監視だけ: 週次の異常検知（§12.6）で `rms_partner_api_keys.last_used_at` と `access_logs(channel='api')` の IP の急変・件数急増を見る。

---

## 5. 保存カードの権限とステップアップ【提案】

### 5.1 権限

| 操作 | 現状 | 変更後 |
|---|---|---|
| カードの一覧表示 | 全ユーザー | 全ユーザー（末尾 4 桁・ブランド・期限のみ・変更なし） |
| 登録（`cards/api` `prepare` / `confirm`） | 全ユーザー | **マスタのみ**（`requireMasterAccount`）＋ **aal2**（§5.2） |
| 削除（`remove`）・既定（`set_default`） | 全ユーザー | **マスタのみ**＋ aal2 |
| 予約時に保存カードを選んで確定 | 全ユーザー | 全ユーザー（子ユーザーも業務上必要）＋ **aal2** |
| 予約の「カードの登録し直し」（`resumePartnerPayment`） | 全ユーザー | 全ユーザー＋ aal2 |

- `lib/partner-account-roles.ts` に純関数 `canManageSavedCards(actor)`（= `is_master && is_active`）を追加しテスト。画面（`cards/+page.svelte`）は子ユーザーには登録フォーム・削除・既定ボタンを出さず「カードの登録・削除は貴社のマスタユーザーが行えます」と案内。サーバは毎回 DB で確認（表示だけに頼らない・既存流儀）。
- 「お支払いカード」の説明文（`saved-cards.md` §6.1）を「ここで登録したカードは、御社の全ユーザーが予約時に選べます。**登録・削除はマスタユーザーのみ**。選んで確定するときは本人確認（メールの認証コード）が必要です。」に変更。

### 5.2 ステップアップ（aal2）が要る操作の一覧

`requirePortalSession` / `requirePortalApi` の戻り値 `session` に `aal: 1|2` と `mfaAt` を載せ（§6.6 の列から）、以下で `requireAal2(event, session, { next })` を呼ぶ。

| ルート | 操作 | 画面での扱い |
|---|---|---|
| `POST /p/[token]/account/cards/api`（`prepare`） | カード登録 | JSON は `403 { code:'mfa_required', next:'/p/<token>/mfa?next=…' }` → クライアントが遷移 |
| `/p/[token]/account/cards` の `remove` / `set_default` | 削除・既定 | form action は `redirect(303, '/p/<token>/mfa?next=<元のURL>')` |
| `POST /p/[token]/payment`（`prepare` / `confirm` で **保存カード**を選んだとき＝`customer_session` を発行した予約、または `confirm` の PaymentIntent/SetupIntent の `payment_method` が共有 Customer の PM） | 保存カードでの予約確定 | 予約画面は `customer_session` 取得時に `aal` を返し、未満なら Payment Element を描く前に「本人確認」ボタン → `/mfa?next=/p/<token>/book?…` へ。サーバは `confirm` 時にも必ず検査（`payment_method` を Stripe から取り直して Customer 一致を見る既存の `confirmPartnerIntent` の直後） |
| `/p/[token]/bookings/[id]` のカード登録し直し（`resumePartnerPayment`） | 同上 | 同上 |
| `/p/[token]/account/users` の全 action | ユーザー管理 | form action → `/mfa` |
| `/p/[token]/account/security` の第2要素の変更（登録・解除） | 自分の MFA 設定 | 同上（パスワード再入力でも可【相談 M4】） |
| `/p/[token]/memorandum/files`（覚書ファイルの閲覧） | 機密文書 | **対象外【推奨】**（閲覧頻度が高く、aal2 を求めると現場が止まる。要望が出たら `mfa_policy='always'` で対応） |

- 新しいカード（保存しない・その場で入力）での予約と、後払いの予約は aal 不要（現状どおり）。
- `aal2` の有効期間: `mfa_at` から **12 時間**【推奨】。期限切れで再度求める。`mfa_policy='always'` の取引先はログインの直後に `/mfa` を必ず通す（§6.3）。

---

## 6. 取引先の第2要素【提案】

### 6.1 方式の比較と採用

| 方式 | 採用 | 位置づけ |
|---|---|---|
| メール OTP（6 桁・10 分） | **標準**（全アカウントで使える。`email` 未登録のアカウントは登録を促す） | ステップアップの既定手段。フィッシングには弱いが、共有 ID・代表メール運用でも成立する |
| パスキー（WebAuthn・`@simplewebauthn`） | **任意登録 → 取引先ごとに必須化できる** | フィッシング耐性あり。端末ごとに登録するので「1人1ID」が前提 |
| TOTP（認証アプリ） | **任意**（パスキーが使えない環境向け） | 秘密を共有されやすいので推奨はしない。バックアップコード付き |
| Supabase Auth MFA | 不採用 | 取引先は `auth.users` に入れない設計（migration `20260926025319` 冒頭の理由） |
| SMS OTP | 不採用 | 費用・SIM スワップ・電話番号の収集。要望が出たら再検討 |

### 6.2 発動条件（ステップアップ方式・`mfa_policy='step_up'`）

次のいずれかで `/p/<token>/mfa` へ:

1. §5.2 の操作の直前で `session.aal < 2` または `mfa_at` が 12 時間より古い
2. ログイン時に「新しい環境」（§4.3 の判定・`device_id` も IP も初見）**かつ**アカウントに `email` がある → ログイン直後に `/mfa`（通知メールと同時）。`email` が無ければ通知だけ（登録を促すバナー）
3. 前回の `mfa_at` から **30 日**以上

`mfa_policy='always'`: ログインのたびに `/mfa`（`device_id` によらず）。`passkey_only`: パスワード入力後に必ずパスキー認証、メール OTP へのフォールバック無し（登録済みパスキーが 0 のアカウントはログイン不可＝宿・マスタがリセットする）。

### 6.3 `mfa_policy`（取引先ごと・宿が設定）

- `rms_partners.mfa_policy text not null default 'step_up' check (mfa_policy in ('step_up','always','passkey_only'))`。
- 管理画面 `/admin/partners/[id]` の共通セクション（ログイン ID の近く）にセレクト＋説明。変更は `access_logs(channel='admin', action:'mfa_policy_change')`【§6.7 で `channel` に `admin` を追加】。
- マスタユーザーは取引先ページから **厳しくする方向のみ**変更可（`step_up` → `always`）。緩める方向は宿だけ【推奨】。

### 6.4 メール OTP の仕様

- 生成: `crypto.getRandomValues` で 6 桁（`000000`〜`999999`・先頭 0 可）。保存はハッシュ（`sha256Hex(code + ':' + challengeId)`）。有効 10 分。1 チャレンジの試行上限 5 回。再送は 60 秒に 1 回、1 アカウント 1 時間に 5 通（DB で数える）。
- **置き場は DB**（KV は結果整合で「成功で即無効化」「試行回数の厳密な加算」に向かない）: `rms_partner_mfa_challenges`（§6.6）。
- 送信: `sendPartnerMail`（差出人は `partnerSetupBrand`）。件名 `【<施設名>】認証コード: 123456`（件名にコードを入れると通知欄で見える。利便性と覗き見のトレードオフ→【相談 M5】）。本文に「このコードを宿や第三者に伝えないでください。宿が電話やメールでコードを尋ねることはありません」。
- 検証後: `rms_partner_sessions.aal=2, mfa_at=now()`。チャレンジ行は `used_at` を立てる。`access_logs('mfa_ok', { method:'email' })`。失敗は `mfa_failed`、上限到達で `mfa_locked`（チャレンジ無効化・新規発行は 60 秒後）。
- 宛先の変更: `email` の変更自体を aal2 の操作にする（乗っ取り後に宛先を書き換えて OTP を自分に向ける手口を防ぐ）。

### 6.5 パスキー（WebAuthn）

- ライブラリ: `@simplewebauthn/server`（v10 以降・WebCrypto ベース・Cloudflare Workers で動く）＋ `@simplewebauthn/browser`。`rpID='book.yamado.app'`、`expectedOrigin='https://book.yamado.app'`。**プレビュー（`*.pages.dev`）では登録・認証とも無効**（`PASSKEY_RP_ID` 環境変数が hostname と一致するときだけ画面に出す。ローカルは `localhost` を許可）。
- 登録（`/account/security` → 「パスキーを追加」。aal2 が必要）:
  1. `POST /p/[token]/account/security/passkey/options`（`generateRegistrationOptions`: `userID` は `account.id` の bytes、`userName` は `login_id`、`userDisplayName` は `display_name ?? login_id`、`residentKey:'preferred'`、`userVerification:'preferred'`、`excludeCredentials` に既存）。チャレンジは **KV `AB_RATE`**（`passkey_reg:<account_id>`・TTL 5 分・短命なので KV で可）または `rms_partner_mfa_challenges(kind='passkey')`（統一のため後者【推奨】）。
  2. ブラウザ `startRegistration` → `POST …/passkey/verify`（`verifyRegistrationResponse`）→ `rms_partner_passkeys` に保存（`credential_id`・`public_key`・`counter`・`transports`・`aaguid`・`backed_up`・`device_name`〔ユーザー入力・既定は UA から〕）。`access_logs('passkey_registered')`。登録完了メールを `email` へ（勝手に登録された場合の検知）。
- 認証（ステップアップ画面 `/mfa` と、ログイン画面の「パスキーでログイン」）:
  - ステップアップ: `POST /p/[token]/mfa/passkey/options`（`generateAuthenticationOptions`・`allowCredentials` にそのアカウントの登録分）→ `startAuthentication` → `POST …/passkey/verify`（`verifyAuthenticationResponse`・`counter` 更新）→ `aal=2`。
  - ログイン画面: 「パスキーでログイン」ボタン（Conditional UI `autocomplete="username webauthn"` も付ける）。`allowCredentials` 無し（discoverable）で呼び、返ってきた `credential_id` から `account` を引き、**その取引先（`partner_id = partner.id`）のアカウントであること**を確認してから `startSession(aal=2)`。パスワード不要。失敗は通常のパスワードフォームへ戻す。
- 管理: 一覧（名前・登録日・最終使用・同期済みか `backed_up`）・名前変更・削除（最後の 1 つを消すときは `passkey_only` なら拒否、それ以外は警告）。
- 「1人1ID」の案内（画面・覚書・設定メール共通の文言）:
  > パスキーはご利用の端末（または Apple / Google アカウント）に保存されます。**ログインIDは 1 人につき 1 つ**発行してください（複数名で 1 つの ID を共有すると、パスキーの登録・紛失時の復旧ができず、操作の記録も個人に紐づきません）。ユーザーの追加は「アカウント」→「ユーザー管理」から 30 名まで無料で行えます。

### 6.6 データモデル（autumn-shared・`<実UTC秒>_rms_partner_mfa.sql`・RLS 有効ポリシー無し＝service_role 専用の既存流儀）

```sql
-- 取引先ごとの方針
alter table public.rms_partners
  add column if not exists mfa_policy text not null default 'step_up'
    check (mfa_policy in ('step_up','always','passkey_only'));

-- アカウントの第2要素
alter table public.rms_partner_accounts
  add column if not exists email_verified_at timestamptz,        -- OTP を 1 度でも通した宛先
  add column if not exists totp_secret_enc text,                 -- base32 を AES-GCM で暗号化（鍵: MFA_ENC_KEY・§12）
  add column if not exists totp_confirmed_at timestamptz,
  add column if not exists totp_backup_codes_hash text[],        -- 10 個・sha256・使ったら配列から除く
  add column if not exists mfa_reset_at timestamptz,             -- 宿・マスタがリセットした時刻
  add column if not exists mfa_reset_by text;                    -- 'admin:<uuid>' / 'master:<account_id>'

-- セッションの保証レベルと端末
alter table public.rms_partner_sessions
  add column if not exists aal smallint not null default 1 check (aal in (1,2)),
  add column if not exists mfa_at timestamptz,
  add column if not exists mfa_method text,                      -- 'email' / 'passkey' / 'totp' / 'backup'
  add column if not exists device_id text;
create index if not exists idx_rms_partner_sessions_device on public.rms_partner_sessions (account_id, device_id);

-- パスキー
create table if not exists public.rms_partner_passkeys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.rms_partner_accounts(id) on delete cascade,
  credential_id text not null unique,      -- base64url
  public_key text not null,                -- base64url(COSE)
  counter bigint not null default 0,
  transports text[],
  aaguid text,
  backed_up boolean not null default false,
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists idx_rms_partner_passkeys_account on public.rms_partner_passkeys (account_id);
alter table public.rms_partner_passkeys enable row level security;

-- OTP・WebAuthn のチャレンジ（短命・1 日より古い行は発行のたびに掃除）
create table if not exists public.rms_partner_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.rms_partner_accounts(id) on delete cascade,
  kind text not null check (kind in ('email','passkey_reg','passkey_auth','totp')),
  code_hash text,                          -- email のとき
  challenge text,                          -- webauthn のとき（base64url）
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rms_partner_mfa_challenges_account on public.rms_partner_mfa_challenges (account_id, created_at desc);
alter table public.rms_partner_mfa_challenges enable row level security;

-- アクセスログの channel に admin を足す（宿の操作も同じ表で追う）
alter table public.rms_partner_access_logs drop constraint if exists rms_partner_access_logs_channel_check;
alter table public.rms_partner_access_logs add constraint rms_partner_access_logs_channel_check
  check (channel in ('web','api','admin'));
```

- `action` の追加（CHECK は無い・文字列）: `login_rate_limited` / `login_new_device` / `logout_others` / `mfa_sent` / `mfa_ok` / `mfa_failed` / `mfa_locked` / `mfa_reset` / `passkey_registered` / `passkey_removed` / `passkey_login` / `totp_enrolled` / `totp_removed` / `mfa_policy_change` / `email_change`。
- ログイン画面のパスキー検索は `credential_id` で引くので `partner_id` の確認を忘れない（別の取引先のパスキーで入れてはいけない）。
- 既存のセッション行は `aal=1` のまま → 配備直後は全員が初回の高リスク操作で OTP を求められる（意図どおり）。

### 6.7 画面・ルート・関数の一覧

| 種別 | パス／名前 | 内容 |
|---|---|---|
| 画面 | `/p/[token]/mfa` | ステップアップ。方法の選択（登録済みに応じてパスキー／認証アプリ／メール）・コード入力・再送・「別の方法」・`next`（`safeNext` と同じ検証を `/p/<token>` 配下に限定した `safePortalNext(token, next)`＝既存 `facilitySwitchTarget` の流儀） |
| 画面 | `/p/[token]/account/security` | ログイン履歴・端末一覧・他端末ログアウト・メール（確認済み印・変更）・パスキー一覧と追加／削除・認証アプリの有効化／解除・バックアップコード |
| 画面 | `/p/[token]`（ログイン） | 「パスキーでログイン」ボタン・Conditional UI・Turnstile |
| 画面 | `/p/[token]/account/users` | 子ユーザーの「すべての端末からログアウト」「第2要素をリセット」 |
| 画面 | `/admin/partners/[id]` | `mfa_policy`・アカウントごとの第2要素の状態（メール確認／パスキー数／TOTP）・「第2要素をリセット」「全端末ログアウト」・アクセスログの新ラベル |
| API | `POST /p/[token]/mfa/email/send` / `…/email/verify` | OTP |
| API | `POST /p/[token]/mfa/passkey/options` / `…/passkey/verify` | ステップアップの WebAuthn |
| API | `POST /p/[token]/passkey/login/options` / `…/login/verify` | パスキーでログイン（セッション無しで呼ぶ・レート制限 §4.1 の `partner:<token>:<ip>` を共用） |
| API | `POST /p/[token]/account/security/passkey/options` / `…/verify` / `DELETE …/[id]` | 登録・削除 |
| API | `POST /p/[token]/account/security/totp/enroll` / `…/confirm` / `…/disable` | TOTP（`otpauth` ライブラリ・QR は `qrcode` で data URL） |
| サーバ | `lib/server/partners/mfa.ts`（新設） | `issueEmailOtp` / `verifyEmailOtp` / `markSessionAal2` / `requireAal2` / `isNewEnvironment` / `resetMfa` / `revokeAccountSessions` |
| サーバ | `lib/server/partners/passkeys.ts`（新設） | simplewebauthn の薄い包み（options 生成・検証・保存・counter） |
| サーバ | `lib/server/login-rate-limit.ts`・`lib/server/turnstile.ts` | §4 |
| 純関数 | `lib/partner-mfa.ts`（新設）＋テスト | `needsStepUp(session, policy, now)`・`mfaMethodsFor(account, passkeyCount)`・`otpProblem(code)`・`isNewEnvironment(sessions, deviceId, ip)` |
| 純関数 | `lib/partner-account-roles.ts` | `accountTabs`（`security` 追加）・`canManageSavedCards`・`canResetMfa(actor, target)` |

### 6.8 復旧手段

| 状況 | 手段 | 記録 |
|---|---|---|
| メールが届かない | 再送（60 秒）・迷惑メール案内・別方法（パスキー／TOTP があれば） | `mfa_sent` |
| パスキーの端末を紛失 | メール OTP へフォールバック（`passkey_only` 以外）→ `security` で古いパスキーを削除 | `passkey_removed` |
| TOTP の端末を紛失 | バックアップコード（10 個・1 回限り）→ 新しい端末で再登録 | `mfa_ok {method:'backup'}` |
| 子ユーザーが全部失った | マスタが「ユーザー管理」→「第2要素をリセット」（パスキー・TOTP を全削除・`email_verified_at` を null・全セッション削除・設定リンク再発行）。本人確認はマスタの責任 | `mfa_reset {by:'master'}` |
| マスタが全部失った | 宿の管理画面（**admin のみ**）で同じリセット。**本人確認の運用ルール**: 登録済みの電話番号へ宿から折り返し、担当者名と直近の予約を口頭で確認（AI 音声のなりすまし対策。先方からの着信・メールだけで実行しない）。手順書を §13 に | `mfa_reset {by:'admin'}` |
| `passkey_only` でパスキー 0 | ログイン不可。宿がリセットして `step_up` に戻すか、設定リンクで入らせてパスキー登録を促す | — |

### 6.9 会員（公式サイト）への適用

- 既にパスワードレス（メール OTP）なので、セキュリティ目的の追加は不要。将来「パスキーでログイン（OTP 省略）」を UX 目的で足す場合は Supabase Auth の WebAuthn を使う（提供状況【未確認】）。本書の範囲外。

---

## 7. 管理画面の MFA【提案】

### 7.1 つなぎ: Cloudflare Access（コード変更なし・今週）

- Zero Trust → Access → Applications → Self-hosted。ドメイン `book.yamado.app`、パス `/admin*`。ポリシー: Allow・Include「Emails ending in `@yamado.co.jp`」【要確認: 管理者のメールドメイン】・認証方法は One-time PIN（メール）または Google。セッション 24 時間。
- 注意: `/admin/login` も Access の後ろに入る（Access の認証 → Supabase のログイン、の二段）。`/api/*`・`/p/*` は含めない。50 ユーザーまで無料【推測: 2026 年時点の Free プラン】。
- Supabase MFA（§7.2）が入っても **残してよい**（多層）。運用が煩雑なら外す。

### 7.2 Supabase Auth の TOTP MFA（1 か月以内）

- ダッシュボード: Authentication → Multi-Factor → TOTP を有効化（無料枠）。
- 画面 `/admin/security`（新設・admin / staff 本人）: `supabase.auth.mfa.enroll({ factorType:'totp', friendlyName })` → QR（`totp.qr_code`）と手入力用 `secret` → `challenge` → `verify`。有効化後に **リカバリーコードは Supabase が提供しない**ので、代替として「管理者（admin）が別の管理者の factor を `unenroll` できる」運用にする（§7.4）。
- 強制: `hooks.server.ts` の `resolveSupabaseSessionUser` で role が admin / staff のとき `client.auth.mfa.getAuthenticatorAssuranceLevel()` を呼び、`{ currentLevel, nextLevel }` を `locals.adminAal = { current, next }` に載せる。`routes/admin/+layout.server.ts` で:
  - `nextLevel === 'aal2' && currentLevel !== 'aal2'` → `/admin/mfa`（チャレンジ画面: `mfa.challengeAndVerify({ factorId, code })`）へ
  - 登録済み factor が 0（`mfa.listFactors()` の `totp` が空）→ `ADMIN_MFA_REQUIRED=true`（`wrangler.jsonc` vars・既定 false で段階導入）なら `/admin/security?enroll=1` へ強制。false なら上部にバナー「○月○日から必須」
  - `/admin/login`・`/admin/mfa`・`/admin/security` は除外
- `getAuthenticatorAssuranceLevel()` は追加のネットワーク往復を伴わない（JWT の `aal` クレームを読む）【未確認: SDK 版による】。`getUser()` の直後に呼んでよい。
- Supabase 側のセッション: aal2 に昇格すると JWT が差し替わる。`createSupabaseServerClient` の cookie 連携（`setAll`）で書き戻されるので追加実装は不要。
- 管理ログインのレート制限: `admin:<ip>`（§4.1）＋ Turnstile（§4.2）。Supabase 側にもサインインのレート制限がある【未確認: 既定値】。
- 漏えいパスワード照合（`auth_leaked_password_protection`）: ダッシュボードで ON（§12.1）。既存の管理者パスワードが HIBP に載っていると次回ログインで変更を求められる【未確認: 挙動はサインイン時の拒否】。

### 7.3 スタッフ会員登録・RMS との関係

- Supabase Auth のセッションは `*.yamado.app` で autumn-rms と共有（`auth.ts` のコメント）。RMS 側が aal2 を要求しない限り、Book で aal2 に上げても RMS には影響しない（JWT の `aal` が増えるだけ）。**RMS でも同じ強制を入れるかは別件**（§10 M7）。
- `staff-member-register.ts`（service_role で会員を作る）は変更なし。

### 7.4 復旧

- 認証アプリを失った管理者: 別の **admin** が `/admin/security/users`（新設・admin のみ・`auth.admin.mfa.deleteFactor` は service_role が要る → `partnerServiceClient()` 経由の管理 API を `lib/server/admin-mfa.ts` に閉じ込める）で factor を削除 → 本人が再登録。`book.admin_audit_logs` に `admin_mfa_reset` を残す（既存の監査表）。
- admin が 1 人しかいない場合: Supabase ダッシュボード（Owner）で Authentication → Users → 該当ユーザー → Factors を削除。**admin は必ず 2 名以上**（§12.1）。

---

## 8. 会員 OTP 送信のメール単位の制限【提案】

- 現状の Cookie クールダウンは残しつつ（UX のため）、**サーバ側の KV 制限**を足す（`sendCode` action の冒頭・`login-rate-limit.ts`）:

| キー | 上限 | 窓 | 応答 |
|---|---|---|---|
| `member_otp:ip:<ip>` | 10 通 | 10 分 | 429・`m.auth_otp_resend_wait()`（既存文言） |
| `member_otp:email:<sha256(lower(email))>` | 5 通 | 1 時間 | 同上（**存在の有無を漏らさない**: 未登録メールでも同じ応答） |
| `member_otp:global` | 300 通 | 10 分 | 同上（送信基盤の保護。平常時のピークを超えない値に調整【未確認: 実績】） |

- Turnstile（§4.2）を `sendCode` に付ける。`verify`（コード検証）は Supabase 側の試行上限（既定 5 回程度【未確認】）に任せ、アプリでは `member_otp_verify:<email_hash>` 10 回/10 分だけ足す。
- Supabase ダッシュボードの Auth Rate Limits（メール送信・OTP 検証）も確認して明示的に設定（§12.1）。
- `/auth/register`・`/account` 側の OTP 再送があれば同じヘルパーを通す（実装時に grep `signInWithOtp`）。

---

## 9. anon 実行可 RPC の権限見直し【方針】

アドバイザ `anon_security_definer_function_executable` / `authenticated_…` の対象は応答に含まれていなかった。migration から anon に `grant execute` している、または `revoke … from public` が無い（＝Postgres 既定で PUBLIC に EXECUTE が付く）候補:

| 関数 | 現在の grant | 呼び出し元 | 方針 |
|---|---|---|---|
| `book.create_hold(…)`（2 署名） | anon, authenticated, service_role | `supabase-data.ts sbCreateHold`（公式サイトの仮押さえ・会員はログインクライアント、非会員は anon） | **当面 anon のまま**（非会員予約に必要）。DB 側に試行上限を持たせる（`claim_stay_by_code` と同じ流儀: `p_session_id` と、新引数 `p_client_key`（IP）で 10 分 20 件・全体 10 分 500 件・超過は `rate_limited`）。アプリは `partnerServiceClient()` から呼ぶ形に変え anon を外す【中期・S8】。それまでは Turnstile を `/booking/hold` に付け（§4.2 に追加）、KV の `hold:<ip>` 10 分 20 件 |
| `book.release_hold(uuid, text)` | anon, authenticated, service_role | `sbReleaseHold` | `p_session_id` 一致が条件なので実害は小さい。`create_hold` と同時に service_role 化 |
| `book.faq_log_query(…)` / `book.faq_feedback(…)` | anon, authenticated | `/api/faq/[facility]/search`・`feedback`（既に `allowRequest` で IP 制限） | **service_role 専用にする**（サーバ経由でしか呼ばない。anon からの直叩きでログ汚染・集計の改ざんができる）。`revoke … from anon, authenticated; grant … to service_role`。アプリは `partnerServiceClient().schema('book').rpc(...)`（注意: 既定スキーマは public＝v0.106.2 の教訓） |
| `book._pb_store(uuid)` / `book._pb_token(text)` | migration に grant / revoke の記述なし → **PUBLIC 既定で実行可能と推測【未確認】** | 貸切風呂 RPC の内部ヘルパー（他の SECURITY DEFINER 関数から呼ばれる想定） | `revoke all on function … from public, anon, authenticated;`（呼び出し元の DEFINER 関数は所有者権限で動くので影響なし）。実装前に `select proname, proacl from pg_proc where pronamespace='book'::regnamespace and prosecdef` で実態を確認 |
| そのほか | — | — | 同じクエリで `proacl` が null（＝PUBLIC 実行可）の SECURITY DEFINER 関数を全部列挙し、`anon` 不要なものは一括 revoke。`book.claim_stay_by_code` の修正（`20261009131735`）が雛形 |

- `function_search_path_mutable` / `extension_in_public`: 同じ migration で `alter function … set search_path = ''`、拡張は `extensions` スキーマへ（`create extension … with schema extensions` は既存 DB では `alter extension … set schema` 不可のものがあるため【未確認】、対象拡張名を確認してから）。

---

## 10. ユーザーに決めてもらう事項（未決・推奨つき）

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| **M1** | 第2要素の標準方式 | A. メール OTP を標準・パスキー／TOTP は任意 ／ B. パスキーを標準（メールはフォールバック） | **A**。取引先の現場（共有 PC・代表メール）で確実に成立する。パスキーは「1人1ID」に移行した取引先から |
| **M2** | 子ユーザーのカード権限 | A. 登録・削除・既定はマスタのみ、使用は全員 ／ B. 使用もマスタのみ ／ C. 現状維持（全員） | **A**。予約担当（子）が保存カードで確定できないと業務が止まる。確定時は aal2 で守る |
| **M3** | セッション期限 | A. 7 日固定（現状） ／ B. 7 日 or 最終アクセスから 24 時間 ／ C. 最終アクセスから 8 時間 | **B** |
| **M4** | 自分の第2要素を変更するときの再認証 | A. aal2（第2要素）を要求 ／ B. パスワード再入力 | **A**（登録済みなら）。まだ何も登録していない初回だけパスワード再入力 |
| **M5** | OTP メールの件名にコードを入れるか | 入れる（通知欄で見える・楽） ／ 入れない（覗き見対策） | **入れない**（本文冒頭に大きく） |
| **M6** | `mfa_policy` の既定 | `step_up` ／ `always` | **`step_up`**。法人・大口は宿が個別に `always` |
| **M7** | 管理画面 MFA の必須化時期と RMS への展開 | Book だけ先行 ／ RMS と同時 | **Book 先行**（`ADMIN_MFA_REQUIRED` で切替）。RMS は別件で同じ hooks を移植 |
| **M8** | Cloudflare Access のつなぎ | 入れる（今週） ／ 入れずに §7.2 を急ぐ | **入れる**。実装ゼロで今日から第2層 |
| **M9** | ログイン通知の送り先 | 本人の `email` のみ ／ 本人＋マスタ | **本人のみ**（マスタには週次のダイジェスト【将来】）。本人に `email` が無ければマスタ |
| **M10** | 覚書ファイルの閲覧に aal2 を求めるか | 求める ／ 求めない | **求めない**（§5.2） |
| **M11** | TOTP を提供するか | 提供（任意） ／ 提供しない（メール＋パスキーのみ） | **提供しない（初版）**。パスキーで足りる。要望が出たら S6 に追加（設計は §6 に残す） |
| **M12** | `create_hold` の service_role 化の時期 | S8（中期） ／ S1 と同時 | **S8**。先に Turnstile＋KV で守る |
| **M13** | オフサイトバックアップの置き場 | Cloudflare R2（Object Lock） ／ 別 AWS アカウントの S3 ／ 両方 | **R2**（既存アカウント・Egress 無料）。鍵は書き込み専用トークン、保持 90 日 |
| **M14** | 本人確認（マスタの MFA リセット）の運用 | 電話折り返し ／ 書面 ／ 両方 | **電話折り返し＋担当者名と直近予約の口頭確認**。§13 に手順 |

---

## 11. 実装の分割案（Opus エージェントに渡す粒度）

依存: S0（設定・ユーザー） → S1（migration） → S2 → (S3 ∥ S4 ∥ S5) → S6 → S7。S8 は独立。S0 は今週・コード不要。

| # | 内容 | 触るもの | 工数 | 受け入れ |
|---|---|---|---|---|
| **S0 設定作業（ユーザー・今週）** | §12 のチェックリスト（Supabase: 漏えいパスワード照合 ON・Org MFA 必須・PITR 確認、Cloudflare: Access `/admin*`・Rate Limiting・Turnstile widget 作成・Bot Fight Mode、GitHub: ブランチ保護ほか、Stripe、各 SaaS の MFA、MCP read-only、secrets の Dropbox 外し） | ダッシュボードのみ | 半日 | §12 の各項目にチェック |
| **S1 autumn-shared migration** | §6.6 の全 DDL（`mfa_policy`・accounts の列・sessions の列・`rms_partner_passkeys`・`rms_partner_mfa_challenges`・`access_logs.channel` に admin）＋ §9 の `faq_*` / `_pb_*` の revoke と `search_path` 修正 | `supabase/migrations/<実UTC秒>_rms_partner_mfa.sql`・`<実UTC秒>_book_rpc_grants_hardening.sql`（`new-migration.sh`・`git pull` 後） | 半日 | `migration list --linked` 両側に version・`information_schema.columns` で列の実体・既存の取引先ログインが従来どおり通る・FAQ 検索がサーバ経由で動く |
| **S2 第1段階（§4・§8）** | `login-rate-limit.ts`・`turnstile.ts`・`Turnstile.svelte`・取引先ログイン／setup／管理ログイン／会員 `sendCode` への組み込み・ロック文言統一・`device_id` クッキーとログイン通知メール・`security` タブ（履歴・端末・他端末ログアウト）・マスタの「全端末ログアウト」・会員 OTP の KV 制限・管理画面ログの新ラベル | `lib/server/login-rate-limit.ts`（新）・`lib/server/turnstile.ts`（新）・`lib/components/Turnstile.svelte`（新）・`routes/p/[token]/+page.server.ts`・`setup/+page.server.ts`・`routes/admin/login/+page.server.ts`・`routes/(public)/auth/login/+page.server.ts`・`lib/server/partners/store.ts`（`loginPartner` の通知判定・`startSession` の `device_id`）・`portal-users.ts`（通知メール）・`lib/partner-account-roles.ts`＋テスト・`routes/p/[token]/account/security/**`（新）・`account/users/**`・`routes/admin/partners/[id]/**`・`wrangler.jsonc`（`PUBLIC_TURNSTILE_SITE_KEY`）・`.env.example` | 2〜3 日 | §14「第1段階」。KV 無し環境（vitest・vite dev）でメモリに落ちる。Turnstile 未設定で通る |
| **S3 ステップアップ基盤＋メール OTP（§5.2・§6.2〜6.4）** | `lib/server/partners/mfa.ts`・`lib/partner-mfa.ts`＋テスト・`/p/[token]/mfa`（メール OTP のみ）・`requireAal2`・`getPartnerSession` が `aal` / `mfa_at` を返す・`mfa_policy` の `step_up` / `always` の分岐・新環境ログイン直後の `/mfa`・`email` 変更を aal2 操作に・OTP メール | `lib/server/partners/mfa.ts`（新）・`lib/partner-mfa.ts`（新）・`store.ts`・`portal.ts`・`routes/p/[token]/mfa/**`（新）・`account/+page.server.ts`（メール変更） | 2〜3 日 | §14「ステップアップ・OTP」 |
| **S4 保存カードの権限と aal2（§5）** | `canManageSavedCards`・`cards/+page.server.ts` / `cards/api` のマスタ限定と aal2・`payment/+server.ts`（`customer_session` に `aal` を返す・`confirm` で保存カードなら aal2 検査）・`booking.ts`（`confirmPartnerIntent` 直後の検査）・予約画面の「本人確認」導線・`bookings/[id]` の登り直し・説明文 | `lib/partner-account-roles.ts`＋テスト・`routes/p/[token]/account/cards/**`・`routes/p/[token]/payment/+server.ts`・`routes/p/[token]/book/+page.svelte`・`lib/server/partners/booking.ts`・`docs/saved-cards.md`（§6.1 の説明文・D2 の注記） | 1〜2 日 | §14「保存カード」。S3 の `requireAal2` に依存 |
| **S5 管理画面 MFA（§7.2・7.4）** | `/admin/security`（enroll）・`/admin/mfa`（challenge）・hooks の `adminAal`・`+layout.server.ts` の強制（`ADMIN_MFA_REQUIRED`）・`/admin/security/users`（admin が他人の factor を削除・監査ログ）・`lib/server/admin-mfa.ts` | `hooks.server.ts`・`lib/server/auth.ts`・`routes/admin/+layout.server.ts`・`routes/admin/security/**`（新）・`routes/admin/mfa/**`（新）・`lib/server/admin-mfa.ts`（新）・`wrangler.jsonc` | 1〜2 日 | §14「管理画面」。S1〜S4 と独立（Supabase 側の TOTP 有効化が前提） |
| **S6 パスキー（§6.5）＋ `mfa_policy` の管理（§6.3）＋復旧（§6.8）** | `@simplewebauthn/server` / `browser` 追加・`passkeys.ts`・登録／認証／ログインの API・`security` タブの一覧・ログイン画面のボタンと Conditional UI・`passkey_only`・管理画面の `mfa_policy` セレクトと「第2要素をリセット」・マスタの子ユーザーリセット・登録完了メール・「1人1ID」文言（画面・設定メール） | `package.json`（apps/web）・`lib/server/partners/passkeys.ts`（新）・`routes/p/[token]/{mfa,passkey,account/security}/**`・`routes/p/[token]/+page.svelte`・`routes/admin/partners/[id]/**`・`portal-users.ts`・`staff.ts`（設定メール文言） | 3〜5 日 | §14「パスキー」。本番ドメインでのみ有効 |
| **S7 仕上げ（親が行う）** | HANDOFF.md（本節・チェックリスト転記）・`package.json` ×2（**MINOR**: 後方互換あり。S1 の列追加は既定値付き）・`ADMIN_APP_OPS.md` §5 の service_role 記述の訂正・`docs/saved-cards.md` D2 の注記・リリース前に `ADMIN_MFA_REQUIRED=true` の切替日を決める | `HANDOFF.md`・`package.json`・docs | 半日 | `npm run check`・`npm test`・本番で §14 を流す |
| **S8 `create_hold` / `release_hold` の service_role 化（§9・中期）** | 新署名 `create_hold(…, p_client_key)` に DB 側試行上限・アプリは `partnerServiceClient().schema('book')`・anon から revoke・`/booking/hold` に Turnstile と KV `hold:<ip>` | autumn-shared 1 本・`lib/server/supabase-data.ts`・`routes/(public)/booking/hold/+page.server.ts` | 1 日 | 非会員・会員の仮押さえが従来どおり・anon で `/rest/v1/rpc/create_hold` が 401/403 |

工数は Opus エージェントの実装＋親のレビュー込みの目安。S2〜S5 は並行可能（S4 だけ S3 の `requireAal2` を待つ）。

---

## 12. 運用・設定作業（コード外・ユーザーが手で進める）

各項目は「どこで・何を・確認方法」。できたら `[x]` にせず日付を書く（CLAUDE.md のテスト方針と同じく次回も流す）。

### 12.1 Supabase（Autumn Platform `opkocyapzmsjzhbwlguh`）

- [ ] Authentication → Settings（または Attack Protection）→ **Leaked password protection を ON**（アドバイザ WARN の解消）。確認: `get_advisors(security)` から `auth_leaked_password_protection` が消える
- [ ] Organization → Settings → Security → **Enforce MFA for organization を ON**。全メンバーが TOTP を登録。Owner は 2 名まで、日常作業は Developer ロール
- [ ] Settings → Database → Backups: **プランと PITR の状態を確認**【未確認】。Pro なら日次 7 日。**PITR（アドオン）を有効化**（7 日以上）。確認: Backups 画面に「Point in time」タブが出て `Earliest recovery point` が表示される
- [ ] Authentication → Rate Limits: メール送信（既定 1 通/60 秒/メール【未確認】）・OTP 検証・サインインの値を確認し、§8 と整合する値に
- [ ] Authentication → Multi-Factor → **TOTP を有効化**（S5 の前提）。WebAuthn の提供有無も確認【未確認】
- [ ] Settings → API → **新 API キー（`sb_secret_…`）へ移行**: Book 用・RMS 用・バックアップ用（読み取り専用ロール）を別々に発行 → Cloudflare Pages の `SUPABASE_SERVICE_ROLE_KEY` を差し替え → 旧 JWT 形式の service_role を無効化。注意: `preview.ts` の署名鍵が変わるので確認モードのクッキーは切れる（再度「確認ページを開く」で可）
- [ ] Logs → Auth: 管理者のサインインログを月 1 回目視。異常は §13

### 12.2 Cloudflare（ゾーン `yamado.app`・Pages `autumn-book`）

- [ ] アカウントの **2FA（ハードウェアキー推奨）**。メンバー全員
- [ ] Zero Trust → Access → Applications → **`book.yamado.app/admin*` を Self-hosted アプリとして追加**（§7.1）。確認: シークレットウィンドウで `/admin` が Access のログイン画面になる
- [ ] Security → WAF → Rate limiting rules:
  - `(http.request.method eq "POST" and http.request.uri.path matches "^/p/[^/]+/?$")` → 同一 IP 10 回/1 分 → Block 10 分
  - `(http.request.method eq "POST" and http.request.uri.path in {"/admin/login" "/auth/login"})` → 同一 IP 10 回/1 分 → Managed Challenge
  - `(http.request.uri.path matches "^/api/partner/v1/")` → 同一 IP 120 回/1 分 → Block（API の正常利用を見て調整）
  - 本数の上限はプラン次第【未確認】。足りなければ 1 本目を優先
- [ ] Security → Bots → **Bot Fight Mode ON**。`/api/partner/*` と `/api/cron/*` と Stripe Webhook `/api/partner/stripe/webhook` は WAF の Skip ルールで除外
- [ ] Security → WAF → Managed rules: 利用可能な Managed Ruleset を ON【プラン次第・未確認】
- [ ] SSL/TLS → Edge Certificates → **HSTS を ON**（max-age 12 か月・includeSubDomains・preload は RMS 等の全サブドメインが HTTPS であることを確認してから）。アプリ側でも付けているが二重でよい
- [ ] Turnstile → **widget を作成**（Managed・ドメイン `book.yamado.app`・`autumn-book.pages.dev`）→ `PUBLIC_TURNSTILE_SITE_KEY` を `wrangler.jsonc` vars、`TURNSTILE_SECRET_KEY` を `wrangler pages secret put`（S2 の前提）
- [ ] Manage Account → Audit Log: 通知（メール）を ON
- [ ] API Tokens: GitHub Actions 用トークンが **Pages 編集のみ**か確認（現状そのはず・`deploy.yml` のコメント）。期限を 1 年に
- [ ] R2: バケット `autumn-backups` を作成 → **Object Lock（Retention 90 日・Compliance）**【未確認: R2 の Object Lock 提供状況。無ければ別 AWS アカウントの S3 Object Lock】→ 書き込み専用 API トークンを GitHub Secrets へ

### 12.3 GitHub（`yamode/autumn-book`・`yamode/autumn-shared` ほか）

- [ ] アカウントの **2FA 必須**（パスキー推奨）
- [ ] Settings → Branches → **main のブランチ保護**: 直 push 禁止・PR 必須（レビュー 0 人でも可・自分でマージ）・force push 禁止・削除禁止・「Require status checks」に CI があれば追加。**autumn-shared も同じ**（migration の誤 push 防止）。注意: CLAUDE.md の「autumn-shared は main 直 push」ルールと矛盾するので、**PR 必須にするなら CLAUDE.md を直す**（§10 に追加の判断・推奨は PR 必須）
- [ ] Settings → Code security → **Secret scanning＋Push protection ON**・**Dependabot alerts / security updates ON**
- [ ] Actions → `deploy.yml`: `permissions: { contents: read }` を追加・`actions/checkout@v4` 等を **SHA 固定**・`pnpm dlx wrangler` のバージョン固定（コード変更は S7 で親が行う）
- [ ] Secrets: `CLOUDFLARE_API_TOKEN` の期限と権限を確認。バックアップ用に `SUPABASE_BACKUP_DB_URL`（読み取り専用ロール・§12.5）と `R2_*` を追加

### 12.4 Stripe

- [ ] チーム全員 **2FA**。Owner は 2 名
- [ ] Developers → API keys → **Restricted key** を作成（PaymentIntents / SetupIntents / Customers / PaymentMethods / Refunds の write・それ以外 none）→ Cloudflare Pages の `STRIPE_SECRET_KEY` を差し替え → 旧 Secret key をロール
- [ ] Radar: ルールが有効か確認（カードテスト攻撃の自動ブロック）
- [ ] Webhook: 署名検証は実装済み。エンドポイントの「失敗通知メール」を ON

### 12.5 オフサイト・イミュータブルバックアップ（週次・GitHub Actions）

- [ ] Supabase に読み取り専用ロール `backup_reader`（`grant usage on schema book, public, pms, core, booking to backup_reader; grant select on all tables in schema … to backup_reader; alter default privileges …`）を作る → **この DDL も autumn-shared の migration で**（手順どおり）
- [ ] 新ワークフロー `.github/workflows/backup.yml`（S7 で親が作成）: `schedule: '0 18 * * 0'`（JST 月曜 3:00）＋ `workflow_dispatch`。`pg_dump --no-owner --schema=book --schema=public --schema=pms --schema=core --schema=booking "$SUPABASE_BACKUP_DB_URL" | zstd | age -r <公開鍵>` → `rclone copy` で R2 へ（`autumn-backups/db/YYYY-MM-DD.sql.zst.age`）。Storage は `rclone sync supabase:reservation-attachments r2:autumn-backups/storage/ --backup-dir r2:autumn-backups/storage-history/YYYY-MM-DD`
- [ ] `age` の秘密鍵は **Dropbox に置かない**（1Password / Bitwarden に保管・紙にも印刷して金庫）
- [ ] 四半期の復旧訓練: Supabase の Free プロジェクトを 1 つ作り、最新ダンプを `psql` でリストア → `select count(*) from public.rms_partner_bookings` と直近 10 件の `booking_code` が本番と一致 → 所要時間を記録 → プロジェクト削除。初回は S7 と同時に行う

### 12.6 各 SaaS の MFA・端末・秘密情報

- [ ] Dropbox・Google Workspace・LINE WORKS・freee・Notion・Anthropic（claude.ai）: 管理者全員 **MFA**（パスキー対応のものはパスキー）
- [ ] 端末: BitLocker（Windows）・FileVault（Mac）ON。OS 自動更新 ON。Defender／XProtect を切らない
- [ ] **`96_Claude/secrets/*.env` を Dropbox 同期から外す**: 中身を 1Password / Bitwarden の「Secure Note」へ移し、必要時は `op run --env-file` か手で `.env` に展開。Dropbox 側は削除（ゴミ箱からも）。CLAUDE.md の該当記述を更新（別件）
- [ ] Claude Code / claude.ai の **Supabase MCP を read-only＋project-ref 固定**に（コネクタ設定 or `--read-only --project-ref opkocyapzmsjzhbwlguh`）。書き込みが要る作業は別プロファイル。**開発セッションでは Gmail・Notion コネクタを無効**（プロンプトインジェクションの経路を減らす）
- [ ] `gitleaks` を pre-commit に（`~/.claude` のフック、または `lefthook`）。`sk_live_` / `sb_secret_` / `eyJ` を含むコミットを止める
- [ ] 週次の異常検知ルーティン（claude.ai Routines・UTC cron）: 「取引先 `login_failed` / `login_rate_limited` の急増」「`login_new_device` の件数」「管理者サインインの新 IP」「Stripe の失敗決済」「`rms_partner_api_keys.last_used_at` の急変」を Notion の指定ページに保存。MCP は read-only で足りる

---

## 13. インシデント対応（1 ページ・印刷して事務所に置く）

**発動基準**: 取引先・会員・スタッフから「身に覚えのないログイン／予約／請求」の申告、ログイン通知の異常、Stripe の不審な請求、GitHub / Cloudflare / Supabase からのセキュリティ通知、端末のマルウェア検知。

**0. 記録を始める**（誰が・いつ・何を見たか。Notion に 1 ページ。時刻は JST）

**1. 封じ込め（30 分以内）**
- 取引先アカウント: 管理画面 `/admin/partners/[id]` → 該当ユーザーを **停止**（セッション全削除される）→ 必要なら取引先ごと **公開停止**（`is_active=false`＝ログイン・API とも止まる）→ API キー失効
- 管理者アカウント: Supabase ダッシュボード → Authentication → Users → 該当ユーザーの **Sessions を全失効**・パスワードリセット・Factors 削除。Cloudflare Access のセッションも失効（Zero Trust → Logs → Revoke）
- キーの漏えいが疑われる: **`SUPABASE_SERVICE_ROLE_KEY`（`sb_secret_`）・`STRIPE_SECRET_KEY`・`CRON_SECRET`・`CF_EMAIL_API_TOKEN`・GitHub の `CLOUDFLARE_API_TOKEN` をローテーション**（新キー発行 → Pages secret 差し替え → 旧キー無効化。確認モードのクッキーが切れるのは想定内）
- 攻撃継続中: Cloudflare → Security → **Under Attack Mode**＋攻撃元 IP / ASN をブロック。必要なら管理画面の `メンテナンスモード`（取引先ページ・会員を一時停止）
- 端末感染: ネットワークから切断・Dropbox を一時停止（他端末への波及を防ぐ）・その端末でログイン中の全 SaaS セッションを別端末から失効

**2. 被害範囲の把握**
- `rms_partner_access_logs`（該当 `account_id` / IP の `login` 以降の `book` / `card_profile_*` / `child_*`）、`rms_partner_bookings`（`account_id`・`created_at`）、`book.admin_audit_logs`、Supabase Auth Logs、Cloudflare Security Events、Stripe の Payments / Events
- 個人情報の閲覧・持ち出しの有無を判定（予約者名・電話・メール・覚書ファイル）

**3. 復旧**
- データが消された／書き換えられた: **復元前に現 DB のダンプを取る**（証拠保全）→ Supabase PITR で侵害直前の時刻へ復元（または §12.5 のダンプを別プロジェクトへリストアして差分を手で戻す）→ 復元後に Stripe と台帳の照合（`payment_status` と Stripe の実態の差）
- 不正予約: 取消・返金（Stripe）・PMS 側の取消通知
- 被害者への連絡（取引先: 電話＋メール。会員: メール）。文面テンプレを Notion に用意（実装時に下書き）

**4. 報告・再発防止**
- 個人情報の漏えい: 個人情報保護委員会への**速報は概ね 3〜5 日以内、確報は 30 日以内**（要配慮情報・不正目的・1,000 人超・財産的被害のおそれのいずれかに該当する場合は報告義務）【要確認: 最新の規則】。カード番号は Stripe 保管のため当サイトからは漏れない
- 原因・時系列・対策を 1 ページにまとめ、HANDOFF.md と本書を更新

**連絡先（記入）**: Supabase サポート（ダッシュボード）・Cloudflare サポート・Stripe サポート・顧問（弁護士／社労士）・警察（サイバー犯罪相談窓口 #9110）

---

## 14. テストチェックリスト（実装時に HANDOFF.md へ転記する）

環境依存の項目は明記。Turnstile は本番キーでしか動かないので「本番で確認」。

### 第1段階（S2）
- [ ] 取引先ログイン: 同じ IP で 10 回失敗 → 11 回目から統一文言（ID を変えても同じ）。15 分後に通る。`access_logs` に `login_rate_limited {scope:'ip'}`
- [ ] 取引先ログイン: アカウント単位ロック（5 回）の文言がレート制限と同一で、`login_locked` は内部ログだけ区別される
- [ ] 成功で IP キーがリセットされる（成功直後に別 ID を 9 回失敗しても通る）
- [ ] KV 無し（vitest / vite dev）でメモリに落ち、テストが通る
- [ ] Turnstile 未設定（ローカル）で通る。本番で widget が出て（非表示モード）、トークン無しの POST は 400【本番で確認】
- [ ] 新しいブラウザ（`rms_partner_device` 無し）でログイン → 通知メールが `email` に届く（日時・ID・IP・UA）。同じブラウザで 2 回目は届かない。`email` 無しのアカウントは `login_new_device {notified:false}` だけ
- [ ] 「アカウント」→「セキュリティ」: 端末一覧に「このブラウザ」印。別ブラウザでログインしてから「他の端末からログアウト」→ 別ブラウザが `/p/<token>` に戻される
- [ ] マスタ「ユーザー管理」→ 子ユーザーの「すべての端末からログアウト」→ 子のセッションが切れる。子は実行できない（403）
- [ ] 管理ログイン `/admin/login`: 同じ IP 10 回失敗で制限。Turnstile【本番で確認】
- [ ] 会員 `sendCode`: Cookie を消しても同じメールへ 1 時間に 6 通目は 429。別メールでも同じ IP で 10 分 11 通目は 429。未登録メールと登録済みメールで応答が同じ
- [ ] パスワード設定 `/setup`: 無効トークンを同じ IP で 10 回 → 制限
- [ ] 管理画面のアクセスログに新ラベル（`login_rate_limited` / `login_new_device` / `logout_others`）が日本語で出る

### ステップアップ・メール OTP（S3）
- [ ] 初回のカード登録（マスタ）→ `/mfa?next=…` へ → OTP メール（6 桁・件名にコード無し〔M5〕）→ 正しいコードで元の画面へ戻り操作が続く。`rms_partner_sessions.aal=2, mfa_method='email'`
- [ ] 間違いを 5 回 → チャレンジ無効（`mfa_locked`）→ 60 秒後に再送できる。期限 10 分切れは無効
- [ ] 再送は 60 秒に 1 回・1 時間に 5 通
- [ ] 12 時間後（`mfa_at` を手で古くする）に同じ操作 → 再び `/mfa`
- [ ] `mfa_policy='always'` の取引先: ログイン直後に必ず `/mfa`。`step_up`: 新環境のログイン直後だけ `/mfa`（`email` があるとき）
- [ ] `next` に外部 URL・別トークンのパス → `/p/<token>/calendar` へ（オープンリダイレクトにならない）
- [ ] メールアドレスの変更が aal2 を要求し、変更後は新しい宛先で OTP が届く。`email_change` がログに残る
- [ ] 確認モード（管理画面の「確認ページを開く」）は `/mfa` を要求されず、書き込みは従来どおり 403

### 保存カード（S4）
- [ ] 子ユーザー: 「お支払いカード」に一覧は見えるが登録フォーム・削除・既定ボタンが無い。直接 POST（`cards/api prepare`・`remove`・`set_default`）は 403
- [ ] マスタ: 登録・削除・既定は aal2 を要求。aal2 済みなら従来どおり
- [ ] 子ユーザーの予約: 保存カードを選ぶ前に「本人確認」→ `/mfa` → 戻って Payment Element に保存カードが出る → 確定できる。aal1 のまま `payment confirm`（保存カードの PM）を直接叩くと 403 `mfa_required`
- [ ] 新しいカードを入力しての予約・後払いの予約は aal 不要（従来どおり）
- [ ] オフセッション請求（チェックアウト日決済・キャンセル料）は変更なし（aal を見ない）
- [ ] 予約一覧の「カードの登録し直し」が aal2 を要求

### 管理画面（S5）
- [ ] `/admin/security` で TOTP を登録（QR・手入力）→ 確認コードで有効化。`listFactors` に出る
- [ ] ログアウト→ログイン → `/admin/mfa` でコード入力 → `/admin`。コードなしで `/admin/partners` を開くと `/admin/mfa` へ
- [ ] `ADMIN_MFA_REQUIRED=false`: 未登録でもバナーのみ。`true`: 未登録は `/admin/security?enroll=1` から出られない（`/admin/login`・`/admin/mfa` 以外）
- [ ] admin が `/admin/security/users` で他の管理者の factor を削除 → `admin_audit_logs` に `admin_mfa_reset` → 本人が再登録できる。staff は開けない
- [ ] RMS（`*.yamado.app` 共有セッション）が従来どおり動く【RMS で確認】
- [ ] Cloudflare Access が入っている間: `/admin` が Access → Supabase ログイン → MFA の順。`/p/*`・`/api/*` は Access の影響を受けない【本番で確認】

### パスキー（S6・本番ドメインまたは localhost）
- [ ] 「セキュリティ」→「パスキーを追加」（aal2 要求）→ 端末の生体認証 → 一覧に名前・日付・同期済み印。登録完了メールが届く
- [ ] ログイン画面の「パスキーでログイン」→ パスワード無しで `/calendar`。`aal=2, mfa_method='passkey'`。別の取引先の `/p/<token>` で同じパスキーは使えない（アカウントが見つからない扱い）
- [ ] Conditional UI: ログインID欄のフォーカスでパスキー候補が出る（Chrome / Safari）
- [ ] ステップアップで「パスキーで確認」→ aal2。`counter` が増える。古い counter の応答（リプレイ）は拒否
- [ ] パスキー削除: 最後の 1 つで `passkey_only` なら拒否、`step_up` なら警告の上で削除
- [ ] `passkey_only` でパスキー 0 のアカウント → ログイン不可の案内。宿がリセット → `step_up` で入れる
- [ ] 管理画面の `mfa_policy` 変更が `access_logs(channel='admin', action='mfa_policy_change')` に残る。マスタは厳しくする方向のみ変更できる
- [ ] マスタの「第2要素をリセット」（子）／宿のリセット（マスタ）→ パスキー・TOTP が消え全セッション切断・設定リンクが届く。`mfa_reset {by}`
- [ ] プレビュー（`*.pages.dev`）ではパスキーの UI が出ない

### RPC 権限（S1・S8）
- [ ] anon キーで `POST /rest/v1/rpc/faq_log_query`・`faq_feedback`・`_pb_store`・`_pb_token` → 401/403。FAQ 検索・フィードバックは画面から従来どおり
- [ ] （S8 後）anon キーで `rpc/create_hold` → 401/403。非会員・会員の仮押さえは画面から従来どおり。同じ IP で 10 分 21 件目は `rate_limited`
- [ ] `get_advisors(security)` の `anon_security_definer_function_executable` / `function_search_path_mutable` が減る

### 運用（S0・§12）
- [ ] シークレットウィンドウで `https://book.yamado.app/admin` → Cloudflare Access の画面
- [ ] `curl -X POST https://book.yamado.app/p/<token>` を 1 分に 11 回 → 11 回目が Cloudflare の 429/Block
- [ ] `get_advisors(security)` から `auth_leaked_password_protection` が消えている
- [ ] バックアップ: R2 に今週のファイルがあり、Object Lock で削除できない。復旧訓練の記録がある
- [ ] `(Get-Item ~/.claude/CLAUDE.md -Force).LinkType` など既存の確認と合わせ、`96_Claude/secrets/` が Dropbox に無い

---

## 15. 補足（調査で分かった注意点）

- `partnerServiceClient()` の既定スキーマは `public`。`book.*` の RPC は必ず `.schema('book').rpc(...)`（v0.106.2 の不具合の原因。S1・S8 で `faq_*` / `create_hold` を service_role 化するときも同じ）。
- KV `AB_RATE` は `app.d.ts` で `KVNamespace`（`expirationTtl` 付き `put` を持つ型）。`claim-rate-limit.ts` は `AB_CONFIG` を自前の `KvLike` 型で受けている。新しい `login-rate-limit.ts` は `AB_RATE` を同じ `KvLike` で受ければ型の差を気にしなくてよい。
- `rms_partner_sessions` のクッキー path は `/p/<token>` なので、`/mfa` や `/passkey/login/*` も同じ配下に置く（別パスだとクッキーが届かない）。
- `getPartnerSession` は毎リクエスト DB を 1 回読む。`aal` / `mfa_at` / `device_id` を同じ select に足すだけで追加の往復は増えない。
- `access_logs.detail` に OTP コード・パスキーの公開鍵・メールアドレス全体を入れない（ログは管理画面で広く見える）。メールはマスク（`ab***@example.com`）。
- Supabase Auth の aal2 は JWT の再発行を伴う。`createSupabaseServerClient` の `setAll` で cookie に書き戻されるが、`hooks` で `getUser()` を呼んだ後に `challengeAndVerify` を行う `/admin/mfa` の action では、同じ `event` の client を使い直すこと（新しい client を作ると cookie の更新が競合する）。
- ブランチ保護（§12.3）を autumn-shared に入れると CLAUDE.md の「main 直 push」ルールと矛盾する。PR 必須にするなら CLAUDE.md と本リポの `CLAUDE.md`（「migration は autumn-shared の main に直接 push」）を同時に直す。
