# 取引先の共通ログイン画面（/partner）

> 2026-10-13 決定。きっかけ: 再春館製薬所から「以前いただいたURLが切れていた」（実際は使用済みのパスワード設定リンクを開いていた）。
> 取引先ごとの限定URL（`/p/<token>`）を覚えてもらう前提をやめ、**ログイン画面は全取引先で共通**、ログイン後の画面を取引先ごとに分ける（一般的な業務システムの形）。

## 1. 方針

| 項目 | 決定 |
|---|---|
| 共通ログイン画面 | `https://book.yamado.app/partner`（ログインID・パスワード・パスキー） |
| 取引先の特定 | ログインIDから（`rms_partner_accounts.login_id` は全取引先で一意・`uq_rms_partner_accounts_login_id`） |
| ログイン後 | 今と同じ `/p/<token>/calendar`（本人確認が要れば `/p/<token>/mfa`）。セッション・画面・権限は一切変えない |
| 今の `/p/<token>` | そのまま使える（配布済みURL・ブックマーク・設定リンク・特別会員の専用ページ） |
| 案内するURL | 管理画面の表示・設定メール・新しい環境の通知メールの「次回以降のログイン」は共通画面にする |
| 特別会員の専用ページ（`kind='member'`） | 対象外（取引先アカウントが無い・公式の会員ログイン）。共通画面では「見つからない」扱い |
| 停止中・公開期間外の取引先 | ID・パスワードが正しいときだけ、その案内を出す（セッションは作らない） |

## 2. 仕組み

### 2.1 クッキー
- セッションクッキー `rms_partner_session` は今と同じ path `/p/<token>`。共通画面の応答から、特定した取引先の path に書く（同一オリジンなので可）。
- 端末クッキー `rms_partner_device`（新しい環境の判定）は、読んだ値を **`/p/<token>` と `/partner` の両方の path に書く**（ログイン時だけ）。
  どちらの画面から入っても同じ端末と分かる。初回だけ共通画面に端末クッキーが無いが、判定は「端末も IP も初見」のときだけ新しい環境なので、いつもの事務所からなら通知は出ない。

### 2.2 試行の制限（KV）
| キー | 回数 | 目的 |
|---|---|---|
| 新 `common_ip:<ip>` | 10 回/10 分 → 15 分 | 共通画面への 1 IP からの総当たり（ID を変えても止まる） |
| 既存 `partner_ip:<partner>:<ip>`・`partner:<partner>` | 既存どおり | ID から取引先が分かったら、取引先ごとの数えも共用する（どちらの画面から打っても合算） |
| 既存 アカウント単位 5 回 → 15 分 | 既存どおり | |

存在しないIDでもパスワードの照合と同じ計算をして、応答時間で ID の有無が分からないようにする。失敗の文言は統一（`GENERIC_LOGIN_ERROR`）。

### 2.3 パスキー
- 共通画面では、ログイン用チャレンジを**取引先なし**で発行する（`rms_partner_mfa_challenges` の `account_id`・`partner_id` とも null）。
  → owner_check を緩める migration（autumn-shared `*_rms_partner_common_login.sql`）。取引先URL用（partner_id あり）と本人用（account_id あり）とは互いに使い回せない（take 時に両方 null のものだけ）。
- 応答のパスキー → アカウント → 取引先を引き、取引先が有効か・会員ページでないかを確かめてからセッションを作る。

## 3. 変更点
- `routes/partner/+page.server.ts`・`+page.svelte`（共通ログイン）、`routes/partner/passkey/options|verify/+server.ts`
- `lib/server/partners/common-login.ts`（ログインID → 取引先の解決・共通のログイン手順）
- `lib/server/partners/portal.ts` `partnerDeviceId`（両 path に書く）
- `lib/server/partners/passkeys.ts`（取引先なしのチャレンジ）
- `lib/server/login-rate-limit.ts`（`commonIp`）
- `lib/server/maintenance.ts` `isPartnerPath` に `/partner`（メンテナンス対象外・会員セッションを持ち込まない）、root layout の解析除外
- `lib/partner-passkey-client.ts`（URL の土台を渡せるように）
- 管理画面の取引先詳細: 「ログイン画面（共通）」を先頭に、限定URLは従来の入口として残す。設定メールの「次回以降のログイン」は共通画面
- 使用済みの設定リンクの移り先（v0.123.1 の `?setup=expired`）は取引先URLのまま（取引先が分かっているので）

## 4. テストチェックリスト（HANDOFF に転記）
- [ ] `/partner` で ID・パスワード → その取引先の料金カレンダー。2 取引先それぞれの ID で正しい取引先に入る
- [ ] 本人確認が要るログイン（新しい環境・`mfa_policy=always`）は `/p/<token>/mfa` へ
- [ ] 誤ったパスワード・存在しない ID は同じ文言。同じ IP で 10 回失敗 → 11 回目は正しくても止まる（15 分）
- [ ] 停止中の取引先は、正しい ID・パスワードのときだけ「公開を停止しています」
- [ ] パスキーでログイン（ボタン・ID 欄の候補）→ その取引先へ。取引先URLで登録したパスキーで共通画面から入れる
- [ ] 取引先URL（`/p/<token>`）のログインも従来どおり
- [ ] 管理画面の取引先詳細に共通ログインURLとコピー、設定メールの「次回以降のログイン」が共通画面
