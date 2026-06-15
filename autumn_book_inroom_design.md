# autumn-book 客室電子インフォメーション（モバイル）＋ 内線電話 設計

> 本書は設計書 §15.3「客室用電子インフォメーション」を実装方式まで具体化し、新要件
> **「客室からの内線電話」**と**「客室SONY Braviaへのインフォ配信（TV）」**を加えたもの。
> TV配信は本フェーズでは**保留**し、当面は**チェックイン時の印刷QRスリップ**でモバイル面へ
> ハンドオフする。本設計は **P3予約/P4決済の後に実装**する前提で、設計のみ先行確定する。
>
> 関連 migration: `autumn-shared/supabase/migrations/20260615120000_book_inroom.sql`（下書き・未適用）

---

## 0. 決定サマリ（敵対的レビュー反映済み）

| 論点 | 決定 | 根拠 |
|---|---|---|
| 物理内線電話 | **無い**（→ 内線は"再発明"でなく物理電話の置換＝正当な中核機能） | ユーザー確認。talkappi VERY / MOT HOT/TEL と同型の業界トレンド |
| ゲスト発信の通信路 | **Wi-Fi データ通話（WebRTC）** を主 | 西和賀/男鹿は**キャリアにより電波が弱く `tel:` が不発**。室内で確実なのは旅館Wi-Fi |
| ブリッジ | **Twilio**（ゲスト WebRTC → TwiML `<Dial>` → 受電） | 受電を「普通の電話」に変換・両側アプリ不要 |
| 受電（既定） | **固定電話（ビジネスフォン＝光IP）** | 有線で堅牢・通話料が携帯の約40%・常駐画面の世話不要・ネイティブ着信 |
| 受電（任意併用） | iPhone を **simring**（同時呼出）。弱電波なら **Wi-Fi Calling** で受ける | 少人数で館内を動くオペ向け |
| iOS WebRTC 脆弱性 | **Screen Wake Lock API（iOS 16.4+）＋「画面を表示したまま」UX ＋ 切断検知→再接続** | 自動ロックでの切断を抑止。手動バックグラウンドの残存リスクは許容 |
| ネイティブiOSアプリ | **不要**（受電＝普通の着信／発信＝Wi-Fi WebRTC＋手当） | レビュー結論 |
| トークン配布 | **チェックイン時の印刷スリップ**（QR＋手入力コード） | ユーザー確認。室内常設QRの長命トークン露出を回避 |
| claim 方式 | スリップQR `/r/c/<token>` → **httpOnlyセッションCookieへ交換** → `/r` へ。滞在中**再claim可**（多端末）、**チェックアウト即時失効** | レビュー F1（長命bearer露出）の根治 |
| 通話録音 | **既定OFF** | PII・同意・米国越境の論点回避（必要時のみ後付け・自社ストレージ前提） |
| TV配信 | **保留**。MVPは印刷スリップ。将来は業務用Pro BRAVIA or 外付けプレーヤー+CMS | レビュー：コンシューマBravia+キオスクAPKは焼き付き/保証/MDM不在で本番第一候補に不適 |

---

## 1. 敵対的レビューの要点（26エージェント・Web裏取り済み）

- **元案の致命傷**：「ゲストのSafariでWebRTC」は iOS/WebKit がロック・バックグラウンドでマイクをミュート/通話切断。**Twilio公式自身が非推奨**。→ 一般論は「`tel:`へ縮退」だが、**本立地は弱電波で `tel:` が不発**のため逆転し、**Wi-Fi WebRTCを"確実側"として採用＋脆弱性を手当**する。
- **TVのキオスクAPK**：OLED焼き付き（SonyはBravia OLEDを焼き付き保証対象外）、コンシューマTVの商用保証無効化、Fully KioskのAndroid TV制限、MDM不在の手作業、番組視聴との占有衝突 → **本番第一候補から外す**。「TV＝表示＋QRハンドオフのみ」分割は妥当なので将来用に維持。
- **セキュリティ**：長命トークンの画面常設（→ 印刷スリップ＋claim/Cookie で根治）、TwiML webhook の **X-Twilio-Signature 検証必須（トール詐欺）**、Cloudflare 秘密は **暗号化Secret**、`/api`・`/tv` を **i18n対象外**、受電番号はサーバ専用RPCのみ。
- **データ依存**：current stay 解決は PMS 依存。**PMSが `book.issue_stay_token` を呼びに来る疎結合**にし、`book` は core/pms を直読みしない。PMS未完でも `house_guides`＋ウェルカムで **degradeリリース可**。
- **オペ**：受電SLA（誰が・何時〜・取れない時）を別途定義。**緊急回線ではない（110/119不可）**＝室内に非常時導線の掲示が必要。

---

## 2. 全体構成 — 2サーフェス（TVは保留）

```
[ゲスト自身のスマホ（アプリ不要）]                  ← 当面の唯一サーフェス
  /r/[token]（claim 済み・httpOnly セッション）
   ・滞在カード（部屋名・夕朝食時刻・チェックアウト ※時刻はPMS連携後）
   ・館内案内（house_guides 多言語）
   ・【フロントを呼ぶ】内線（WebRTC over Wi-Fi）
   ・autumn-order 注文 / 貸切風呂（将来）/ チャットボット（§15.1）
        ▲ スキャン
        │
[チェックイン時の印刷スリップ] QR(/r/c/<token>) ＋ 手入力コード ＋ 案内(JP/EN/TW)

[客室 SONY Bravia] ……（保留）将来 /tv/[device] を表示専用で追加。
                      表示＋QRハンドオフのみ・WebRTCしない、の分割は維持。
```

---

## 3. 内線電話アーキテクチャ

### 3.1 呼制御フロー
```
[ゲストのスマホ]                 [autumn-book / Cloudflare]        [Twilio]        [事務室]
 /r/[token]「フロントを呼ぶ」tap
   └ マイク許可 + Screen Wake Lock
   └ WebRTC ── 旅館Wi-Fi ─▶ POST /api/intercom/token
                            ├ book.intercom_start(token)  ← 認可+レート制限+記帳
                            └ HS256 JWT(VoiceGrant・TTL数分)を Web Crypto で自前生成
   Device.connect() ───────────────────────────────────▶ 着信
                            ◀── POST /api/intercom/voice (TwiML)
                                ├ X-Twilio-Signature 検証(失敗=403)
                                ├ book.intercom_dial_target(call_id) ← service_role
                                └ <Say>○号室です</Say>
                                  <Dial callerId=所有番号><Number>固定電話</Number>
                                       （任意で simring / 時間外は fallback・留守電）
   PSTN ───────────────────────────────────────────────────────▶ ビジネスフォンが鳴る
 通話終了 → POST /api/intercom/status（署名検証）→ book.intercom_update_status 記帳
```

### 3.2 受電ルーティング（施設別 `book.facility_intercom`）
- 主＝`dial_primary`（固定電話）。任意で `dial_simring`（iPhone同時呼出）。
- `business_hours`（JST）外・不応答は `fallback_number` / `voicemail_url`（留守電TwiML）へ。UIにも「受付時間外」を表示。
- `caller_id` は Twilio 所有番号（**事務室の実番号は callerId に出せない**＝なりすまし規制。部屋識別は `<Say>` whisper で）。

### 3.3 iOS WebRTC の手当（残存リスクの明示）
- 通話開始時に **Screen Wake Lock**（iOS 16.4+）で自動ロック抑止。
- 通話UIに「**通話中はこの画面を表示したままに**」。`visibilitychange` でバックグラウンド化を検知→再接続/警告。
- 想定：滞在中の**短い能動的通話**（タオル追加・確認等）。手動でアプリを閉じると切れる点は許容し、失敗時フォールバック（再試行／要望テキスト／電波あれば `tel:`）を用意。

### 3.4 安全設計（必須・Web外の運用要件）
- 物理電話なし＋弱電波で **Wi-Fi内線が室→フロントの生命線**。ただし **050/WebRTCは110/119不可**。
- 客室に「**非常時は廊下の非常ベル／スタッフへ直接**」の掲示、受付時間外の導線を別途確保。
- 受電SLA（誰が・何時〜何時・取れない時）を紙で定義してから実装着手。

### 3.5 代替（将来・参考）
- **自前WebRTC P2P（料金ゼロ・全Wi-Fi）**：ゲスト⇄事務室の据置きiPad、Supabase Realtime＋TURN。Twilio従量・Regulatory Bundle不要・全行程Wi-Fiで弱電波に最強だが、**事務室端末の常時前面固定**とシグナリング/再接続の自作保守が要る。通話量が増えたら移行候補。

---

## 4. ゲスト向け画面 `/r/[token]`（スマホ・アプリ不要）

### 4.1 claim フロー（印刷スリップ）
1. チェックイン時、PMS（将来）or 管理画面が `book.issue_stay_token(stay, facility, room, valid_to, name)` → token＋手入力コード。
2. **ウェルカムカード印刷**：QR(`/r/c/<token>`)＋8桁コード＋案内文（JP/EN/TW）。
3. ゲストがQRスキャン → `/r/c/<token>`（server route）でトークン検証 → **httpOnly Cookie（`stay_session`・チェックアウトまで）発行** → `/r` へ302（以降URLにトークン非表示）。
4. `/r` 以下は Cookie の token で `book.stay_info(token)` を引いて表示。**滞在中は再claim可**（同室の2台目）。
5. チェックアウトで `book.revoke_stay_token` → 全セッション失効。`/r` は「ご滞在は終了しました」。
6. QR読めない客は `/r` で手入力コード（**レート制限＋ロック**）。

### 4.2 画面構成
| セクション | 内容 |
|---|---|
| ホーム | 「ようこそ ◯◯のお部屋へ」＋滞在カード＋クイック操作（フロントを呼ぶ／要望／Wi-Fi／チャット） |
| 館内案内 | `house_guides`（営業時間・館内図・お風呂・食事処・Wi-Fi・注意事項）多言語・Markdown（既存 `MarkdownView` 流用） |
| 内線（通話シート） | 大ボタン→マイク許可→WebRTC発信→通話中UI（Wake Lock・経過時間・ミュート・注意書き）→終了。失敗時フォールバック |
| 注文・オプション | autumn-order リンク、貸切風呂（将来 §15.2） |
| チェックアウト | スマートチェックアウト連動（将来） |
| 言語 | ja / `/en` / `/zh-TW`（既存 Paraglide・ゲスト端末の言語） |

- 個人端末なので滞在情報フル表示OK（氏名最小化は共有面=TVの話）。

---

## 5. 管理画面 `/admin/inroom`（既存 `/admin/news`・`/admin/faqs` と同パターン）

| タブ | 機能 | RPC |
|---|---|---|
| 館内案内 | `house_guides` CRUD（section/title/body(MD)/lang/並び順/公開） | `house_guide_upsert` / `house_guide_delete` / `list_house_guides` |
| 内線設定 | 受電番号（固定電話＝主＋simring）／受付時間／時間外フォールバック（留守電・第2番号）／録音ON-OFF（既定OFF）／有効化／レート制限 | `facility_intercom_upsert` |
| トークン/スリップ | 滞在トークン発行（PMS連携 or 手動）・**印刷用QRカードPDF生成**・有効スリップ一覧・失効 | `issue_stay_token` / `list_stay_tokens` / `revoke_stay_token` |
| 通話ログ | `intercom_calls`（日時・部屋・通話秒・結果）。監査・異常検知 | `list_intercom_calls` |
| （将来）TV端末 | `tv_devices` 登録（後フェーズ） | — |

---

## 6. データモデル（`book` スキーマ）

`20260615120000_book_inroom.sql`（下書き）に対応。全テーブル **RLS deny-all＋RPC-first**、`facility_id → core.facilities(id)`（安定ディメンションのみFK）、`stay_id`=論理参照（FKなし）、`room_code`=文字列（pms.rooms と疎結合）。

```
house_guides(id, facility_id, section, title, body, lang, sort_order, is_published, ...)   ← PMS非依存・最優先
stay_access_tokens(id, stay_id, facility_id, room_code, token unique, short_code,
                   guest_name, valid_from/to, revoked_at, last_used_at, ...)
facility_intercom(facility_id PK, is_enabled, dial_primary, dial_simring, fallback_number,
                  voicemail_url, business_hours jsonb, caller_id, record_calls, rate_per_min, ...)
intercom_calls(id, facility_id, stay_id, room_code, from_surface, status, twilio_call_sid,
               started_at, answered_at, ended_at, duration_sec)
```
※ TV用の使い捨て handoff code（`stay_handoff_codes`）と `tv_devices` は**本migrationに含めず**、TVフェーズで追加。

---

## 7. RPC / API ルート

**RPC（migration 内）**
- 読み取り（anon・token内部検証）：`stay_info(token)` / `list_house_guides(facility, lang)` / `intercom_status_for(token)`
- 内線：`intercom_start(token, surface)`（anon・認可+レート制限+記帳）／`intercom_dial_target(call_id)`・`intercom_update_status(...)`（**service_role のみ**＝秘匿/webhook）
- 発行/失効：`issue_stay_token(...)`・`revoke_stay_token(...)`（authenticated+facility access / service_role=PMS）
- 管理：`house_guide_upsert/delete`・`facility_intercom_upsert`・`list_intercom_calls`・`list_stay_tokens`

**SvelteKit ルート**
- `/r/c/[token]/+server.ts`：claim → httpOnly Cookie → 302 `/r`
- `/r/[...]/+page.server.ts`：Cookie 検証 → `stay_info` / `list_house_guides`
- `/api/intercom/token`（POST）：`intercom_start` で認可 → **Web Crypto で HS256 JWT 自前生成**（twilio-node SDK 不使用）
- `/api/intercom/voice`（POST）：**X-Twilio-Signature 検証** → `intercom_dial_target`（service_role）→ TwiML 文字列を返す
- `/api/intercom/status`（POST）：署名検証 → `intercom_update_status`
- `/admin/inroom/...`：管理RPC（既存 admin 認証に乗る）

**実装メモ（レビュー反映）**
- Twilio 秘密鍵は **Cloudflare 暗号化 Secret**（`wrangler.jsonc` の `vars` 禁止・`$env/dynamic/private`）。SID/番号は非機密だが番号は `.env`/Secret 寄せ推奨。
- **`/api/*`・`/tv/*` を Paraglide の i18n 対象外**（reroute で webhook 署名が壊れる）。webhook URL は非ローカライズ固定で登録・署名計算。
- メンテ503は `/api/intercom` を除外（電話を止めない）。
- Twilio Voice JS SDK(~410KB) は通話シートで **動的import**。QRは **純JS SVG**（canvas不可）。
- 内線webhook用に **service_role の Supabase クライアント**を新設（受電番号RPCは service_role 限定）。

---

## 8. セキュリティ要件チェックリスト
- [ ] トークンは印刷スリップのみ／claim後はhttpOnly Cookie（URL/JS/履歴に残さない）
- [ ] チェックアウトで `revoke_stay_token`（即時失効）
- [ ] 手入力コードのレート制限＋ロック
- [ ] `/api/intercom/voice|status` で X-Twilio-Signature 検証（403）
- [ ] 受電番号は `intercom_dial_target`（service_role）のみ・クライアントに渡さない
- [ ] `intercom_start` のレート制限（部屋あたり N回/分）
- [ ] Twilio AccessToken は VoiceGrant のみ・TTL 数分
- [ ] 秘密鍵は Cloudflare Secret
- [ ] 録音は既定OFF（録音時は多言語告知＋自社ストレージ＋保持期間）
- [ ] 緊急時導線（非常ベル/スタッフ）の客室掲示（Web外）

---

## 9. フェーズ（P3/P4 の後・設計は確定）
1. **P8a**：`house_guides` migration（PMS非依存・即可）＋ `/r/[token]`（デモトークン）＋館内案内＋滞在カード。`store.ts`/`supabase-data.ts` に `resolveStay(token)` / `listHouseGuides()` を**対称実装**（デモは固定の擬似stay）。
2. **P8c**：内線 `/api/intercom/*`＋通話シート（デモトークンでE2E・**事務室の固定電話で実機テスト**）。Twilio 番号は **Regulatory Bundle（株式会社山人の登記書類）申請を1本通してから**。
3. **P8b**：PMS完成後に「部屋→current stay 解決」と本番トークン発行（`issue_stay_token` を PMS チェックインが呼ぶ）を差し込む。PMS依存はここだけ。

---

## 10. コスト（Twilio・固定電話受電版）
- 前提：28室・稼働60%・0.5回/泊室・平均2分・録音OFF・JP番号2本・1USD=160円。
- **期待 ≈ ¥8,500/月**（受電を固定電話 $0.0746/分）。iPhone受電なら ¥17〜20k/月（$0.185/分）。低 ¥2,500 / 高 ¥70k。
- コストドライバーは**受電レッグ**＝固定電話で約半減。**両レッグ同時課金**に注意（「WebRTCだから安い」は誤り）。
- 関門：**JP番号の Regulatory Bundle**（月額でなくリードタイム数日）。為替・カード手数料 ~2%。

---

## 11. TV配信（保留・将来設計メモ）
- 当面は**印刷スリップ**で代替。常時TVインフォは焼き付き・保証・MDM・番組占有の課題が大きい。
- 実施する場合の方針：**業務用 Sony Pro BRAVIA（BZ系・REST/Pro mode・長期保証）** か **外付けHDMIプレーヤー＋サイネージCMS（Yodeck/OptiSigns 等）**。コンシューマBravia+キオスクAPKは「1室PoC」まで。
- 設計：`/tv/[device_id]`（10-foot UI・自動ローテ・夜間消灯・QR位置移動）、`tv_devices`（部屋bind・device_secretで認証）、TVのQRは**使い捨てhandoffコード**（長命トークンを共有画面に出さない）。`/tv` は i18n 対象外。

---

## 12. 未決事項
1. 受電を固定電話に確定（simring iPhone を併用するか）。受付時間とその外の導線。
2. Twilio 採用の最終可否（Regulatory Bundle 申請の実施）。あるいは将来の自前WebRTC P2P 移行の判断点。
3. 印刷スリップの様式（カードサイズ・多言語文面・QRと手入力コードの配置）と発行オペ（PMS前は管理画面で手動発行＋印刷）。
4. house_guides 初期コンテンツ（営業時間・館内図・Wi-Fi・注意事項）の各施設分の用意。
5. 緊急時導線の客室掲示の文面（Web外）。
