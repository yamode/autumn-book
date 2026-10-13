# 取引先ページのアクセス制限（IP・国外）

> 2026-10-13 決定。最初の取引先（再春館製薬所）がセキュリティを重視しているため。取引先ごとの任意設定・**既定はオフ**。

## 1. 設定（取引先ごと・宿の管理画面だけ）

| 項目 | 列（rms_partners） | 既定 | 意味 |
|---|---|---|---|
| 許可するIPアドレス | `access_allowed_ips text[]` | 空 | IPv4・IPv6・CIDR。空なら IP の制限なし。最大 50 件。「IP # メモ」の形でメモも残す |
| 国外からのアクセスを拒否 | `access_block_foreign boolean` | false | Cloudflare の国判定が JP 以外なら拒否。判定できない（`XX`・無し）ときも拒否（ローカル開発だけ通す） |

- 両方設定したら、両方を満たすときだけ入れる。
- 範囲が広すぎるもの（IPv4 /8 未満・IPv6 /16 未満）は誤入力として保存しない。
- 変更できるのは宿（管理画面・admin）だけ。取引先のマスタは変更できない（自分で締め出されると戻せないため）。
- 変更はアクセスログ（`access_restriction_change`・channel admin）に残る。
- 管理画面に直近 60 日のログイン元 IP を並べ、「追加」で入力欄に足せる（登録の誤りを防ぐ）。

## 2. 判定する場所
- **取引先ページのすべての入口**（`resolvePortal`）: ログイン画面・設定リンク・各画面・API（`/p/<token>/…` の JSON）まで、毎回。拒否は 403「許可された場所からのみご利用いただけます」（どの条件かは出さない）。
- **共通ログイン画面**（`/partner`）: ID・パスワード（またはパスキー）を確かめてから判定。誤りなら統一文言、正しいときだけ制限の案内（制限の有無で ID の有無を漏らさない）。セッションは作らない。
- 対象外: 宿の「確認ページを開く」（確認モード）、特別会員の専用ページ（`kind='member'`）、取引先 API（`/api/partner/v1`・必要になったらキーごとに付ける）。
- 拒否はアクセスログ `access_denied`（理由 ip / country・国・path）。取引先の「セキュリティ」画面のログにも出る。
- 取引先の設定は表示用に最大 30 秒使い回すため、変更の反映は最大 30 秒遅れる。

## 3. 運用の注意
- 光回線の家庭向け契約などは IP が予告なく変わる。**固定IPの会社に限って**使う。登録前に取引先（情報システム部門）へ出口IPと、社外利用（VPN の有無）を確かめる。
- 国外の拒否は、海外出張中・海外経由の VPN からも入れなくなる。
- 締め出されたら、管理画面で解除すれば 30 秒ほどで戻る。拒否の記録（アクセスログ）で、どの IP から来たかが分かる。

## 4. 実装
- `lib/partner-ip-access.ts`（IP・CIDR の照合・入力の検査・判定）＋テスト
- `lib/server/partners/portal.ts`（`portalAccessDenial` / `assertPortalAccess` / `requestCountry`、`resolvePortal` の `skipAccessCheck`）
- `routes/partner/**`（共通ログイン画面の判定）、`routes/p/[token]/+error.svelte`（拒否の画面）
- 管理画面 `routes/admin/partners/[id]`（`?/setAccessRestriction`・直近のログイン元）
- migration: autumn-shared `20261013024605_rms_partner_access_restriction.sql`（**Book より先に適用**。列を読むので、未適用のまま Book を出すと取引先ページが読み込みエラーになる）
