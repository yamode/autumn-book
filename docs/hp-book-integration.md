# 施設 HP から公式予約システム（Book）への接続（設計）

2026-10-29 ユーザー指示:
- 2026-11-30 に公式予約システム **Book（`book.yamado.app`）が tripla に代わる**（`docs/launch-tripla-cutover.md`）。
- 両施設の HP（西和賀 `www.yamado.co.jp`＝リポジトリ hp-yamado、男鹿 `oga.yamado.co.jp`＝リポジトリ hp-oga）から Book への接続をどうするか決める。
- tripla は HP に SDK を埋め込む「予約ウィジェット方式」（同一ドメイン上のモーダル）だった。Book は別ドメインなので、ウィジェット・リンク遷移・iframe のどれにするか、動線を丁寧に設計する。

**2026-10-29 ユーザー決定（本書に反映済み）**:
1. 方式は **P1（通常リンク・同一タブ）＋ P2（検索フォーム）で確定**。ウィジェット（案 B）・iframe（案 D）は採らない。
2. P2 の検索フォームは、**取引先ページ `/p/[token]/calendar` のバー方式**（チェックイン／泊数／ご利用人数・室数／検索）を**ほぼ踏襲**する。複数部屋タイプ横断の室数検索（Book に実装済み）と接続する。→ §3.8
3. Q6: **HP に会員ログイン／マイページのリンクを置く**。→ §3.3
4. Q8: 西和賀ヘッダーの「ご予約」は Book へ直接。**HP の `/reservation/` ページは廃止予定**。旧マイページ動線の置き場は別に設ける。→ §3.6・§3.9
5. Q2（UTM の命名）は本書で決める。Q7（GTM の編集者）＝ユーザー。Q9・Q11 は平易な説明を付ける（§5）。
6. ドメインは **`book.yamado.app` に統一**（決定済み）。

**2026-10-29 追加決定（確認事項への回答・反映済み）**:
7. **P2 の検索バーは最初からスクリプト版**（Book が配る Web Component `embed/search-bar.js`）。「素のフォームだけで先に出す」案は採らない（Q15 解消）。素の GET フォームは **JS が読めないときの代替としてスクリプト版の中身に残すだけ**。段階は P2-a／P2-b の 2 本ではなく 1 本にし、**ローンチ（11/30）必須**に入れる。Book 側の作業（`embed/search-bar.js`・`/api/stay-calendar` の CORS・契約 v1.1）は **P1-Book に前倒し**（§3.8.4・§6）。
8. 特商法ページの料金表は **Book のプラン一覧の参照に変えてよい**（Q14 解消）。
9. 言語は「段階移行」で確定（`docs/hp-i18n-design.md`）。簡体字は作らない。**韓国語は Book にも足す**（L3・ローンチ必須ではない）。HP の `/korean/` からの着地は Book に `ko` ができるまで `/en/`。
10. 本番でしか確かめられない Q5（`www` への 301）・Q13（西和賀トップで signIn が開くか）は**要確認のまま残す**。

状態: **設計案（未実装・コード変更なし）**。「コードを読んで確かめた事実」と「提案・推測」を分けて書く。事実には出典（ファイル・行）を付け、未確認の前提には ★ を付ける（一覧は §5）。推測は【推測】と書く。
関連: `docs/launch-tripla-cutover.md`（§3 旧マイページ動線・§7 P1-HP・§2.2 当日手順 B。本書 §3.9 で `/reservation/` 廃止に合わせて改めた）、`autumn_book_deeplink_contract.md`（HP が叩く URL 契約 v1。§3.8 で v1.1 の追記が要る）、`autumn_book_architecture_decision.md`（ADR-0001・HP とポータルの分離）、`docs/pre-checkin.md`（§8 OTA 経由のお客様向けバナー）、`docs/analytics-and-experiments.md`（GA4）、`docs/hp-i18n-design.md`（HP の言語設計。本書の `{lang}` の対応表はそちらに合わせる）。

---

## 0. 結論（先に）

- **確定: 案 A「通常リンクで Book へ同一タブ遷移」＋案 C「HP 上の検索バーから Book へパラメータ付きで遷移」を、どちらもローンチ必須（P1）とする**（当初は C を P2 としていたが 2026-10-29 の決定で同段に繰り上げ）。ウィジェット（案 B）・iframe（案 D）は採らない。
- 理由の要点: Book は全応答に `X-Frame-Options: SAMEORIGIN` と `frame-ancestors 'self'` を付けており（§1.4）、埋め込みは Book 側のセキュリティ方針を崩す。さらに別ドメインの iframe 内では **Safari などで Book の Cookie（ログイン・予約の下書き・ホールド）が第三者扱いになって動かない**（§2.2）。tripla のウィジェットが成り立っていたのは「同一ドメインで動く SDK」だったからで、Book には当てはまらない。
- 動線の骨子: HP の「ご予約」は**施設を URL に載せたディープリンク E1**（`/yamado/nishiwaga`・`/yamado/oga`）へ、言語プレフィックスと UTM を付けて飛ばす（§3.1）。Book からは施設予約セクションの上部に既にある「← {施設名}のサイトへ戻る」（§1.4）で HP に戻る。完了画面にも戻りリンクを足す（§3.2）。
- **P2 の検索バー（§3.8・決定）: 最初からスクリプト版**。Book が配る Web Component `https://book.yamado.app/embed/search-bar.js` が、HP に置いた `<yamado-search-bar>` を取引先ページ風のバー（4 区画＋空き日パネル）として描く。要素の中身には**素の GET フォームを代替として入れておく**（スクリプトが読めないときだけそれが見える）。遷移先は施設トップ E1 ではなく**プラン一覧 E2 `/yamado/{facility}/plans`**（`rooms` を読んで部屋タイプ横断の組み合わせを出すのはプラン一覧だけ・§1.4）。**ローンチ必須**に含め、Book 側の作業は P1-Book に前倒し。
- **会員ログイン／マイページ（§3.3）**: 両 HP のフッターとスマホメニューに「会員ログイン／マイページ」を 1 本。リンク先は Book の `/account`（未ログインなら Book が `/auth/login?next=/account` に自動で回す）。
- **西和賀 `/reservation/` は廃止**（§3.6・§3.9）。ヘッダーの「ご予約」は Book 直接。料金表の参照（特商法ページ）は Book のプラン一覧へ、キャンセル規定は Book のプラン詳細・特商法へ、旧 tripla マイページの入口は **Book の `/booking/lookup` に集約**し、HP からはフッターの「ご予約の確認」リンク 1 本で辿る。`/reservation/` の URL は Book E1 へ 301。
- DB 変更は **なし**。HP 側は文字列の置換＋検索バーのタグ 1 組、Book 側は小修正 4 点＋検索バーのスクリプト（新規・見積り 2〜3 人日）＋CORS（§6）。

---

## 1. 現状（調査結果）

### 1.1 西和賀 HP（hp-yamado）の予約導線

| 場所 | 現在のリンク先 | 出典 |
|---|---|---|
| ヘッダーの「ご予約」ボタン（日本語ページ共通・各 body 断片に 1 つ） | `/reservation/`（HP 内の「ご予約」ページ） | `src/lib/content/top.body.html:29`（`<a href="/reservation/" class="global-nav__button">`・日本語 22 ページ＋`korean.body.html`） |
| フッター（スマホ非表示）の「ご予約」 | `/reservation/` | 各 body 断片の `<a href="/reservation/" class="sp-none">ご予約</a>` |
| トップのバナー「ベストレート保証 山人宿泊プランはこちら」 | `https://reserve.489ban.net/client/yamado/0/plan?`（tripla がホストする予約画面・新規タブ）。画像に `data-tripla-booking-widget="search"` | `top.body.html:72-73` |
| `/reservation/` ページ | 料金表（`#price`）・キャンセル料金（`#cancel`）・下部に同じバナー・末尾に tripla SDK | `reservation.body.html:48-57, 190-232` |
| tripla SDK | `https://tripla.jp/sdk/javascript/tripla.min.js`（`data-triplabot-code="9a93b90f…"`）。**トップは head**、`/reservation/`・`/english/`・`/chinese/`・`/korean/` は body 末尾 | `top.head.html:1`・`reservation.body.html:232`・`english.body.html:403`・`chinese.body.html:428`・`korean.body.html:450` |
| 英語・中国語ページ | **ヘッダー（グローバルナビ）も予約ボタンも無い**。`<div id="contents" class="contents contents--language">` から始まる 1 枚の長いページで、ページ内リンク（Hot Spring／Room Charges／Access…）とフッターの著作権表示だけ。SDK だけ読み込んでいる | `english.body.html:1-50, 403-423`（`global-nav` の出現 0 件）・`chinese.body.html`（同 0 件） |
| 韓国語ページ | **日本語のヘッダー付き**（「客室／お料理／…／ご予約」が日本語のまま出る）。「ご予約」は `/reservation/` | `korean.body.html:12-29`（`global-nav` 14 件） |
| 言語切替 | ヘッダー内 `JP／EN／KO／CH` の 4 リンク。**すべて `target="_blank"`（新規タブ）** | `top.body.html:17-22` |
| 特商法ページ | 「料金の目安は ご予約ページの料金表」として `/reservation/` を参照 | `tokushoho.body.html:88` |

- 配信は Xserver の静的 HTML＋PHP。`src/lib/content/*.{head,body}.html` を `src/app.html` の枠で静的化し `npm run build:xserver` → `npm run deploy:xserver`（FTP・削除しない）。`hp-yamado/HANDOFF.md:87-93`・`scripts/build-xserver.mjs:1-45`
- GA4 は GTM（`GTM-MKFGGV6J`・中身 `G-RN88NPRMNX`）を `src/app.html` で読み込み、同意判定に Book の `/api/geo` を使っている（既に Book と連携済み）。`hp-yamado/src/app.html:20-24`
- hp-yamado に CSP・X-Frame-Options の設定は見当たらない（`hooks.server.ts` はエラーハンドラのみ）。`.htaccess`・`sitemap.xml`・`robots.txt` は `scripts/build-xserver.mjs:125-146` が生成する（sitemap の URL は `manifest.json` の固定ページ＋お知らせ）。

### 1.2 男鹿 HP（hp-oga）の予約導線

| 場所 | 現在のリンク先 | 出典 |
|---|---|---|
| ヘッダー右の「宿泊予約」（全ページ） | `/?tripla_booking_widget_open=search`（**新規タブ**で HP トップを開き、SDK が検索ウィジェットを開く） | `site/index.php:336-339` |
| トップのアクセス横「宿泊予約」・フッターの RESERVE カード | 同上 | `site/index.php:274-277, 731` |
| 計 | **33 ファイル・約 100 か所**に `tripla_booking_widget_open=search` | `grep -o` の集計 |
| tripla SDK | `data-triplabot-code="01944fb1-…"`・`data-triplabot-draggable="true"`。`index.php` と 28 枚の `index.html` の head | `site/index.php:61` |
| CSP（Report-Only） | `script-src` に `https://tripla.jp` **と `https://book.yamado.app`**、`connect-src` に `https://*.tripla.io https://tripla.jp https://book.yamado.app`、`frame-src` に `https://*.tripla.io https://tripla.jp`（**Book は無い**）、`frame-ancestors 'self'` | `tools/postprocess.mjs:407`・`site/.htaccess:59` |
| 言語 | `lang="ja"` のみ。英語ページは無い | `site/index.php:3` |

- 生成は `site/` が正本で `node tools/postprocess.mjs`（冪等）→ `npm run deploy:xserver`。`hp-oga/HANDOFF.md:7-8`
- GA4 は GTM（`G-30DJVL8YLG`）。tripla SDK は自前の GA（`G-57GFG9HB11`）を読み込み、同意と無関係に動く。`hp-oga/HANDOFF.md:37-39`
- 「tripla ボットはそのまま（ユーザー指示）」（`HANDOFF.md:17`）。SDK を残す前提は cutover 設計書 ★Q4 と同じ。

### 1.3 tripla の方式（なぜウィジェットで成り立っていたか）

- SDK は HP と同じドキュメントに script として読み込まれ、`?tripla_booking_widget_open=search|signIn` や `data-tripla-booking-widget` を拾ってモーダルを開く。モーダルの中身は tripla のドメイン（`*.tripla.io`・CSP の `frame-src` から）の iframe【推測】。
- 【推測】tripla が iframe 内でログイン・決済を成立させているのは、自社ドメインで Cookie 以外の手段（URL トークン・`postMessage`・ストレージアクセス API 等）を設計しているからで、Book はそのように作られていない（§1.4 の Cookie 前提）。

### 1.4 Book 側の入口と制約

| 項目 | 事実 | 出典 |
|---|---|---|
| 入口（ディープリンク契約 v1） | E1 `/yamado/nishiwaga`・`/yamado/oga`（基本形）、E2 `/plans`、E5 `/search`。クエリ `checkin=YYYY-MM-DD`・`nights=1..5`・`adults=1..4`（すべて省略可・不正値は黙って既定へ）。言語は `/en/…`・`/zh-TW/…` のプレフィックス（ja は無し） | `autumn_book_deeplink_contract.md` §2-4 |
| 契約のホスト | 契約書は `booking.yamado.co.jp` と書いているが、**実運用の本番は `book.yamado.app`**（決定済み）。契約書 §1 は追記が要る（§6 P1-Book） | 同 §1・`launch-tripla-cutover.md` §4 Q1 |
| 施設トップ E1 が読むクエリ | **`checkin` だけ**（料金カレンダーの初期月に使う）。`nights`・`adults`・`rooms` は読まない | `[brand]/[facility]/+page.server.ts:36-40` |
| プラン一覧 E2 が読むクエリ | `checkin`・`nights`（1〜7 に丸め）・`adults`（1〜6）・**`rooms`（1〜4・`MAX_ROOMS_PER_BOOKING`）**・`tag`。`rooms`≥2 のときは残室の足りない部屋タイプを一覧から外し、**部屋タイプ横断の組み合わせ `combos` を別枠で返す** | `plans/+page.server.ts:94-133`・`lib/multi-room.ts:15` |
| `/search` E5 が読むクエリ | `checkin`・`nights`・`adults`（`rooms` は読まない） | `search/+page.server.ts:7-9` |
| 公開側の検索バー | トップ・ヘッダー: `SearchBar.svelte`（GET フォーム・`checkin/nights/adults`・action `/search`・泊数 1〜7・人数 1〜4）。客室・プラン一覧: `PlanSearchBar.svelte`（日付〜泊数／人数 1〜6／室数 1〜4／検索。`goto(base/plans?…)`・`rooms` は 2 以上のときだけ付ける・日付パネル `StayDatePanel` は `/api/stay-calendar` から空き日を取る） | `SearchBar.svelte:28-71`・`PlanSearchBar.svelte:81-88, 92-112`・`lib/stay-days.svelte.ts:1,46` |
| 取引先ページの検索バー（踏襲元） | `PartnerSearchBar.svelte`: PC は白い角丸 1 本の「チェックイン／泊数／ご利用人数・室数＋検索ボタン」、スマホは縦積みカード。区画を押すと下に浮いたパネル（日付＝`PartnerStayPanel` 2 か月・泊数±・空き日、人数・室数＝± のパネル、「この条件で検索」）。下書きを変えただけでは検索せず、「検索」で URL の `?date&nights&guests&rooms` に反映。`crossType=true` で「必要な室数（お部屋タイプは問いません）」。**取引先トークン付きの月 JSON（`fetchPortalMonth(token, …)`）と `$app/navigation` に依存**しており、そのまま他サイトには置けない | `PartnerSearchBar.svelte:1-5, 63-131`・`PartnerStaySearch.svelte:45-66, 97-104, 351-358`・`p/[token]/calendar/+page.svelte:25` |
| 部屋タイプ横断の組み合わせ | 取引先: `crossTypeCombos(offers, rooms, guests)`（`lib/partner-room-combos`）。公式: プラン一覧の `combosFor(...)`（上記） | `PartnerStaySearch.svelte:353-358`・`plans/+page.server.ts:125` |
| HP へ戻る動線 | 施設予約セクション `/[brand]/[facility]/**` では、ヘッダーの上に「← {施設名}のサイトへ戻る」の帯（`facilityBackLink`）。リンク先は `facility.websiteUrl`。**`/booking/*`・`/account`・`/search` には出ない**。ロゴは常にポータルトップ `/` | `(public)/+layout.svelte:21-22, 74-77`・`[facility]/+layout.server.ts:30,55` |
| `websiteUrl` の値 | Supabase モードでは `websiteUrlForSlug(slug)` のハードコード。デモ定義は `https://yamado.co.jp/`・`https://oga.yamado.co.jp/`（西和賀は `www` 無し） | `supabase-data.ts:2456-2457, 2552`・`store.ts:97,132` |
| 埋め込み禁止 | **全応答**に `x-frame-options: SAMEORIGIN`・`content-security-policy: frame-ancestors 'self'`（2026-10-09 セキュリティレビュー M-2） | `lib/server/security-headers.ts:3-4, 17-19` |
| Cookie | 予約の下書き・ホールド遷移・OTP クールダウン・A/B の訪問者 ID 等は **`sameSite: 'lax'`・`httpOnly` の Cookie**。会員セッション（Supabase Auth）も第一者 Cookie 前提 | `lib/server/auth.ts:62`・`supabase-data.ts:2849-2945`・`auth/login/+page.server.ts:56` |
| 会員ログインと `next` | メール宛 8 桁 OTP。`/auth/login` は**会員でログイン済みなら即 `next`（既定 `/account`）へ 303**。`next` は `safeNext()` で**同一サイト内の相対パスのみ**（外部 URL・`//`・`\` は既定へ）。**`/account` を未ログインで開くと `/auth/login?next=/account…` に自動転送** | `auth/login/+page.server.ts:16-19, 32`・`lib/safe-next.ts:4-17`・`account/+layout.server.ts:10` |
| 決済 | Stripe Payment Element。3D セキュアは Stripe のモーダル。リダイレクトが要るときは `return_url` へ**トップレベル遷移** | `components/payment/StripePayment.svelte:7, 259` |
| noindex | `app.html` に **全ページ `noindex,nofollow`**（公開前）。cutover 2.1 手順 1 で外す | `app.html:9` |
| GA4 | 測定 ID `G-JFW5QS8QKH`（HP とは別プロパティ）。`page_location` はクエリをすべて落とした URL。UTM もこの時点で落ちる | `wrangler.jsonc:36`・`AnalyticsConsent.svelte:111-127` |
| 既存のクロスドメイン連携 | FAQ ウィジェット `static/faq/widget.js`（HP に `<script src="https://book.yamado.app/faq/widget.js" data-facility="oga" defer>` を置き、Book の API を fetch して DOM を描く・iframe ではない）、お知らせ API、`/api/geo`（CORS で HP の 3 オリジンを許可）。**`/api/stay-calendar` には CORS ヘッダが無い** | `static/faq/widget.js:4,41`・`routes/api/geo/+server.ts:9-14`・`routes/api/stay-calendar`（`Access-Control-Allow-Origin` の設定なし） |
| 言語 | Book のロケールは ja／en／zh-TW のみ。判定は URL → Cookie → Accept-Language → ja | `project.inlang/settings.json:4`・`vite.config.ts:21-31` |

### 1.5 既存の設計との関係

- ADR-0001 は「**マーケティング HP ＋ 予約ポータル（リダイレクト）型**」を採用済み。HP の「ご予約」は施設を URL に載せてポータルに着地させ、汎用トップに落とさない。`autumn_book_architecture_decision.md:18`・契約 §0
- 契約 §6 は「`target=_blank` は不要（同タブ遷移を推奨）」「HP に日程ピッカーを置く場合: 選択値を `checkin / nights / adults` に載せて E1 へ」としている。**E1 は `checkin` しか読まない（§1.4）ので、日付・人数・室数を効かせるなら E2 に着地させる**（§3.8）。契約 v1.1 で直す。
- cutover 設計書 §7 P1-HP は「`/reservation/` に旧マイページの段」としていたが、`/reservation/` 廃止（本書 §3.9）に合わせて改めた。

---

## 2. 方式の比較（決定の記録）

### 2.1 案

| 案 | 内容 | 結論 |
|---|---|---|
| **A. 通常リンクで Book へ遷移** | HP の「ご予約」「宿泊予約」バナーを `https://book.yamado.app/yamado/<施設>?utm_…` へ。**同一タブ**。HP に Book のスクリプトは置かない | **P1・確定** |
| B. HP に Book の軽量ウィジェット（モーダル iframe） | HP に script を置き、ボタン押下でモーダルの iframe に Book を出す | **採らない** |
| **C. HP 上の検索バー → Book** | HP に日付・泊数・人数・室数のバーを置き、パラメータ付きで Book へ遷移。A の上乗せ | **P1・確定**（Book 配布スクリプト・形は §3.8） |
| D. iframe 常設 | HP のページに Book を iframe で常時表示 | **採らない** |

### 2.2 ドメインが違うことで起きる問題（案ごと）

| 観点 | A リンク遷移 | B ウィジェット（モーダル iframe） | C 検索バー→遷移 | D iframe 常設 |
|---|---|---|---|---|
| Book の埋め込み禁止ヘッダ | 影響なし | **Book 側で緩める必要**（M-2 の後退） | 影響なし | B と同じ |
| Cookie の第三者扱い（Safari ITP 等） | 影響なし | **致命的**（ログイン・下書き・ホールドが動かない） | 影響なし | B と同じ |
| 会員ログイン・`next` | Book 内で完結 | OTP メールのリンクでモーダルの外に出る | A と同じ | B と同じ |
| Stripe・3DS | Book 内で完結 | 入れ子 iframe で崩れる例・`return_url` が戻らない | A と同じ | B と同じ |
| スマホ | 普通のページ遷移 | iframe の高さ・キーボードで崩れる | A と同じ | 二重スクロール |
| 計測 | 別 GA4 プロパティ → **UTM** で繋ぐ（§3.5） | 同じ | A と同じ | A と同じ |
| 障害時 | Book が落ちていればエラーページ（HP は無事） | script が落ちるとボタンが**無反応** | **素の GET フォームを残せば**script が落ちても検索できる（§3.8） | 空白の枠 |

### 2.3 判断（2026-10-29 確定）

- **A を採る**。(1) Book の会員・予約フローは Cookie 前提で iframe では iPhone の Safari で動かない。(2) Book は「他サイトへの埋め込み禁止」を全応答で宣言しており、B/D はこれを自分で崩すことになる。
- **C もローンチ時に出す**。tripla ウィジェットで「日付を選んでから予約画面へ」に慣れたお客様への配慮。形は取引先ページのバーを踏襲し（Book 配布スクリプト）、Book 側の受け口（E2 の `rooms`）に接続する（§3.8）。
- B は将来も要件にしない。離脱対策は着地ページ（施設トップ・プラン一覧）の改善で取る【推測】。

---

## 3. 動線設計

### 3.1 HP → Book：URL の仕様（P1・ボタンとリンク）

基本形（契約 v1 のとおり。ホストだけ `book.yamado.app`）:

```
https://book.yamado.app{/lang}/yamado/{facility}?utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…
```

| 要素 | 値 | 決め方 |
|---|---|---|
| `{facility}` | 西和賀 `nishiwaga`・男鹿 `oga` | 契約 §2（恒久 slug） |
| `{lang}` | HP の日本語ページ → 無し／`/english/` → `/en`／`/chinese/` → `/zh-TW`（HP の中国語は**繁体字**。`chinese.body.html` に「歡迎」「溫泉」「隱私權」）／`/korean/` → **当面 `/en`**（Book に韓国語が無い）。**決定: Book に `ko` を足す（L3・`docs/hp-i18n-design.md` §4.6）**ので、できた時点で `/ko` に切り替える | 契約 §4 |
| `utm_source` | `hp_nishiwaga`／`hp_oga` | 流入元の HP を区別（**決定・Q2**） |
| `utm_medium` | `referral` | 固定 |
| `utm_campaign` | `reserve`（予約ボタン・バナー・検索バー）／`member`（会員ログイン・マイページ）／`lookup`（ご予約の確認） | 目的別。GA4 の探索で「予約導線」「会員導線」を分ける（**決定・Q2**） |
| `utm_content` | 置き場所: `header`／`banner_top`／`footer`／`menu`（スマホのハンバーガー内）／`search_bar`／`page_<slug>`（男鹿の客室・プランページ等の本文ボタン） | どのボタンが効いているかを Book 側の GA4 で見る（**決定・Q2**） |

- **同一タブ**で遷移する（契約 §6・ADR-0001）。hp-oga の現行 `target="_blank" rel="noopener"` は外す。★Q4 は「同一タブ」を既定として進める。
- HP 側の `Referrer-Policy` は触らない。ページ単位の出所は `utm_content` で持つ。
- 日程未定のボタンは E1（施設トップ）。**ローンチ時は全部 E1 に揃える**（E2 への振り分けは効果を見てから。Q9）。

### 3.2 Book → HP：戻る動線

| 場面 | いま | 提案 |
|---|---|---|
| 施設予約セクション（施設トップ・客室・プラン） | ヘッダー上の帯「← {施設名}のサイトへ戻る」→ `facility.websiteUrl` | そのまま。**西和賀の `websiteUrl` を `https://www.yamado.co.jp/` に**（HP の正規ホストは `www`。`hp-yamado/HANDOFF.md:87-88`。`yamado.co.jp` → `www` の 301 はチェックリストに「転送される」とある＝設定済みの前提。★Q5 は本番で 1 回確認） |
| ロゴ | ポータルトップ `/` | そのまま |
| ホールド・決済 | 戻り帯なし | **足さない** |
| 完了画面（`/booking/complete/[code]`） | HP へのリンクなし | **「{施設名}のサイトへ戻る」を 1 つ足す**（P1-Book） |
| マイページ（`/account`） | なし | 足さない（会員はポータルの利用者） |

- パンくずは**作らない**。

### 3.3 会員ログイン／マイページのリンク（Q6・決定: 置く）

**置く理由**: tripla 時代は HP 上のウィジェットから「アカウント」に入れた（cutover §1.2）。Book でも「HP から会員の入口が見える」状態を保たないと、会員登録を勧めても次回に HP から辿れない。

| 項目 | 設計 | 根拠 |
|---|---|---|
| 遷移先 | **`https://book.yamado.app{/lang}/account?utm_source=hp_<施設>&utm_medium=referral&utm_campaign=member&utm_content=<場所>`**。未ログインなら Book が `/auth/login?next=/account` へ自動転送し、ログイン後に `/account` へ戻る。ログイン済みならそのままマイページ | `account/+layout.server.ts:10`・`auth/login/+page.server.ts:17` |
| `?next` の扱い | HP 側は **`next` を付けない**（`/account` への転送時に Book が付ける）。HP に戻す `next` は作れない（`safeNext` が同一サイト内に限る・セキュリティレビュー M-1）。ログイン後の戻り先は常に Book の `/account` | `lib/safe-next.ts:4-17` |
| `/auth/login` を直接指さない理由 | `/account` を指せば「ログイン済みの人はマイページ、未ログインはログイン」が Book 側の 1 本の判断で済む。HP は会員かどうかを知らなくてよい | — |
| 置き場所（西和賀） | ① フッターのナビ（`footer__nav`・`sp-none` の並び）に「会員ログイン／マイページ」を 1 本 ② スマホのハンバーガー（`#h-nav` の `global-nav__links__inner`）の最下段に同じ 1 本。**ヘッダーの PC 表示には置かない**（「ご予約」ボタンの横は狭く、予約ボタンの目立ちを削がない） | `top.body.html:7-24, 179-186` |
| 置き場所（男鹿） | ① ドロワーメニュー（`#js-drawer`）の最下段 ② フッターの RESERVE カード付近に小さなテキストリンク。ヘッダー右の「宿泊予約」の横には置かない | `site/index.php:67-70, 731` |
| 文言 | ja「会員ログイン／マイページ」、en「Member login / My page」、zh-TW「會員登入／我的頁面」（Book のナビ文言 `common_login`・`nav_membership` と揃える。実装時に `messages/*.json` の訳語を正とする） | `(public)/+layout.svelte:89-96` |
| 多言語 | 西和賀 `/english/`→`/en/account`、`/chinese/`→`/zh-TW/account`、`/korean/`→`/en/account`。**英語・中国語ページにはヘッダーもフッターのナビも無い**（§1.1）ので、ページ末尾の「General Information」の近くに「Member login / Reservation」の小さな段を足す（`docs/hp-i18n-design.md` でヘッダーを揃える案が通ればそちらに吸収） | `english.body.html:395-423` |
| 会員登録の誘導 | HP には「新規登録」ボタンを別に置かない。Book の `/membership`（会員制度の紹介）へは、必要なら「会員制度について」としてフッターに 1 本（`utm_campaign=member`・`utm_content=footer_membership`）。初期は置かず、効果を見て足す | `(public)/+layout.svelte:89, 189` |
| 計測 | GTM の `reserve_click` とは別に `member_click`（同じトリガーで `link_url` に `/account` を含むもの） | §3.5 |

### 3.4 ほかの導線との区別

| 導線 | 入口 | 本書との関係 |
|---|---|---|
| OTA 経由のお客様向けバナー（`docs/pre-checkin.md` §8） | 事前チェックインのフォーム・SMS・メール → 施設トップ E1 | **同じ URL 形式**。`utm_source=precheckin`・`utm_medium=ota`。HP のボタンと GA4 上で区別できる |
| 取引先ページ（`/p/<token>`・`/partner`） | 取引先に個別案内（noindex） | HP からは**リンクしない** |
| 旧 tripla マイページ（cutover §3） | Book `/booking/lookup` に集約 | HP からは**フッターの「ご予約の確認」→ `/booking/lookup`** の 1 本だけ（§3.9）。HP 側に旧マイページの段は作らない |
| FAQ ウィジェット・お知らせ API | 既存 | 変更なし |

### 3.5 計測

- HP 側（GTM・コード変更なし。編集者＝ユーザー・Q7）: 「`book.yamado.app` へのリンクのクリック」をトリガーに `reserve_click`（`link_url`・`link_text`）を送る。`link_url` に `/account` を含むものは `member_click`、`/booking/lookup` は `lookup_click` に分ける（同じトリガーに条件を足すだけ）。検索バーは部品（Web Component）が送信時に `dataLayer.push({event:'search_submit', …})` を自分で出す（§3.8。Shadow DOM の中の操作は GTM の自動リンク計測に乗らないため）。代替フォームで送られたときは「フォーム送信」トリガー（`form_destination` が `book.yamado.app`）で同じ `search_submit` を送る。
- Book 側: `pageLocation()` で **`utm_*` だけ残す**（予約コード・トークン・検索条件は引き続き落とす）。P1-Book。
- 成果は Book の `purchase` で見る。HP の `reserve_click` 数 ÷ Book の `utm_source=hp_*` のセッション数で「遷移の離脱」を把握する。

### 3.6 HP 側の画面（西和賀・`/reservation/` 廃止後）

```
ヘッダー: [ご予約] → https://book.yamado.app/yamado/nishiwaga?utm_source=hp_nishiwaga&utm_medium=referral&utm_campaign=reserve&utm_content=header   ← 直接 Book へ（Q8 決定）
トップのバナー「ベストレート保証…」 → 同上（utm_content=banner_top）。data-tripla-booking-widget 属性と target=_blank を外す
トップ: バナーの直下に検索バー <yamado-search-bar>（Book 配布スクリプト・§3.8）→ E2 /yamado/nishiwaga/plans?…（utm_content=search_bar）
フッター: [ご予約]（sp-none）→ Book E1（utm_content=footer）
        [会員ログイン／マイページ] → Book /account（utm_campaign=member・utm_content=footer）
        [ご予約の確認] → Book /booking/lookup（utm_campaign=lookup・utm_content=footer）   ← 旧 tripla マイページはこの先（§3.9）
スマホメニュー: 同じ 3 本を最下段に
/reservation/: 廃止。URL は 301 で Book E1 へ（utm_content=redirect_reservation）
/english/ /chinese/: ページ末尾に「Reservation / Member login」の段 → /en/… へ（ヘッダーが無いため。hp-i18n-design で統一する）
/korean/: ヘッダーの「ご予約」→ /en/yamado/nishiwaga
```

- `/reservation/` にあった中身の行き先（§3.9 の表）: 料金表 → Book のプラン一覧（E2・日付なしは「今後 3 か月の最安」が出る）、キャンセル料金 → Book のプラン詳細の規定と `/legal/tokushoho`、旧マイページ → Book `/booking/lookup`、特商法ページの「ご予約ページの料金表」リンク → E2。
- **SDK は HP に残す**（tripla ボット・cutover ★Q4）。西和賀の SDK は `top.head.html:1`（トップの head）にあるので、`/reservation/` を消しても **トップで `?tripla_booking_widget_open=signIn` が開く**はず（★Q13: 本番で確認。開かなければ `/english/` 等の body 末尾の SDK と同じものをトップ body に残す）。

### 3.7 HP 側の画面（男鹿）

```
全ページの「宿泊予約」（ヘッダー・フッター RESERVE・本文ボタン）→ https://book.yamado.app/yamado/oga?utm_source=hp_oga&utm_medium=referral&utm_campaign=reserve&utm_content=<header|footer|page_<slug>>
  置換: href="/?tripla_booking_widget_open=search" target="_blank" rel="noopener" → href="https://book.yamado.app/yamado/oga?…"
  postprocess.mjs に正規表現（冪等・ヘッダー/フッター/本文で utm_content を変えるならクラス名で 3 本）
トップ: KV 直下か RESERVE カードの上に検索バー <yamado-search-bar>（Book 配布スクリプト・§3.8）→ E2 /yamado/oga/plans?…
ドロワー最下段・フッター: [会員ログイン／マイページ] → /account、[ご予約の確認] → /booking/lookup
SDK（ボット）は残す。CSP は変更不要（検索バーの Book スクリプト・空き日取得とも script-src・connect-src に book.yamado.app が既にある・§1.2）
```

### 3.8 検索バー（取引先ページのバーを HP に置く・ローンチ必須）

#### 3.8.1 何を踏襲するか（事実）

取引先ページ `/p/[token]/calendar` のバーは `PartnerSearchBar.svelte`（§1.4）。要素は「チェックイン／泊数／ご利用人数・室数／検索」の 4 区画＋浮いたパネル（2 か月カレンダーに空き日、人数・室数の ±）。室数は「必要な室数（お部屋タイプは問いません・各室同じ人数）」で、1 つの部屋タイプで足りないときは部屋タイプ横断の組み合わせを別枠で出す（`PartnerStaySearch.svelte:351-358, 516-540`）。

公式サイト側で同じ役目を持つのは `PlanSearchBar.svelte`（客室・プラン一覧の上。日付〜泊数／人数 1〜6／室数 1〜4／検索）で、遷移先は `{base}/plans?nights&adults[&rooms][&checkin]`。プラン一覧が `rooms` を読んで組み合わせ `combos` を出す（§1.4）。**公式サイトの「複数部屋タイプ横断の室数検索」の受け口はプラン一覧 E2 だけ**で、施設トップ E1 は `checkin` しか読まない。

#### 3.8.2 遷移先 URL（契約書 v1.1 として追記）

```
https://book.yamado.app{/lang}/yamado/{facility}/plans?checkin=YYYY-MM-DD&nights=N&adults=A&rooms=R
    &utm_source=hp_{facility}&utm_medium=referral&utm_campaign=reserve&utm_content=search_bar
```

| パラメータ | 値 | Book 側の扱い（事実） |
|---|---|---|
| `checkin` | `YYYY-MM-DD`・省略可 | 省略時は「今後 3 か月の最安」（`referenceMode`）。`plans/+page.server.ts:96, 131` |
| `nights` | 1〜7（既定 1） | 範囲外は丸め。同 `:97` |
| `adults` | 1〜6（既定 2） | 1 室あたりの大人。同 `:98` |
| `rooms` | 1〜4（既定 1）。**1 のときは付けない**（`PlanSearchBar` と同じ） | 2 以上で残室フィルタ＋組み合わせ。同 `:99, 124-125` |

- 契約書 v1 の「`nights` 1〜5・`adults` 1〜4・E1 へ」は実装より狭い／古い。v1.1 で「検索バーは E2 へ・`rooms` 追加・範囲は実装どおり」に改める（P1-Book ④）。
- 子ども人数は Book の公式側に欄が無い（`SearchBar.svelte:24` の注記「施設は基本的に子ども不可」）ので HP のバーにも置かない。

#### 3.8.3 HP 上で動かす方式の比較

| 方式 | 内容 | 良い点 | 悪い点 |
|---|---|---|---|
| **(a) HP 側に素の HTML/CSS で作り直す（GET フォーム）** | `<form method="GET" action="https://book.yamado.app/yamado/<施設>/plans">` に `<input type="date" name="checkin" min=今日>`・`<select name="nights">`1〜7・`<select name="adults">`1〜6・`<select name="rooms">`1〜4・hidden の `utm_*`・検索ボタン。見た目だけ取引先バー風（白い角丸 1 本・スマホは縦積み） | JS 不要・Book が落ちても送信はできる・CSP 無関係・GTM の「フォーム送信」でそのまま計測。HP 2 つとも静的 HTML なので置くだけ | **空き日・最安が出ない**（日付パネルの中身が無い）。ブラウザ既定の日付ピッカー（iPhone はドラム）になり「踏襲」とは言い難い。HP ごとに HTML を 2 回書く（hp-yamado は body 断片、hp-oga は `index.php`） |
| **(b) Book が配る小さなスクリプト（Web Component）** | Book の `static/embed/search-bar.js`（FAQ ウィジェット `faq/widget.js` と同じ配布方式）。HP に `<yamado-search-bar facility="oga" lang="ja" utm-content="search_bar">` と `<script src="https://book.yamado.app/embed/search-bar.js" defer>`。Shadow DOM に取引先バーと同じ 4 区画＋パネルを描き、空き日は Book の `/api/stay-calendar` から取る（**CORS を HP の 3 オリジンに許可する変更が要る**・§1.4）。「検索」で `location.href = E2 URL`（同一タブ） | **1 実装で両 HP**・Book 側で改善すれば両 HP に即反映・空き日・最安を出せる＝取引先バーをほぼ踏襲できる・Cookie もフレームも使わないので §2.2 の問題は無い | HP が Book のスクリプトに依存（落ちると無反応 → (a) のフォールバックが要る）・Shadow DOM の中のクリックは GTM の自動リンク計測に乗らない（部品が `dataLayer.push` する）・Book 側の新規開発（Svelte の `customElement` でビルドするか素の JS で書く。見積り: 2〜3 日）・hp-oga の CSP は `script-src`・`connect-src` に `book.yamado.app` が既にあるので追加不要 |
| (c) iframe で Book の検索バーだけ埋める | Book に `/embed/search` ページを作り iframe | 実装が最小 | 浮いたパネルが iframe の枠で切れる・`frame-ancestors` を 1 ルートだけ緩める運用になる・高さの同期が要る。**採らない**（§2 と同じ理由） |
| (d) Book の `PlanSearchBar.svelte` をそのまま再利用 | — | — | `$app/navigation`・Paraglide・`StayDatePanel` に依存し、SvelteKit の外では動かない。**不可**（事実） |

#### 3.8.4 決定: 最初からスクリプト版（b）。素のフォームは代替の中身としてだけ残す

**2026-10-29 決定（Q15 解消）**: 「素のフォームだけで先に出す」段階は設けない。ローンチ時点で Book 配布の Web Component を両 HP に置く。

- HP に置くもの（両 HP 同じ 2 行）:
  ```html
  <yamado-search-bar facility="oga" lang="ja" utm-source="hp_oga" utm-content="search_bar">
    <!-- JS が読めないときだけ見える代替（素の GET フォーム・E2 へ） -->
    <form method="GET" action="https://book.yamado.app/yamado/oga/plans">…checkin／nights／adults／rooms／hidden utm_*…</form>
  </yamado-search-bar>
  <script src="https://book.yamado.app/embed/search-bar.js" defer></script>
  ```
  スクリプトが読めたら、要素の中身を取引先バー風（PC 1 本・スマホ縦積み・パネルに空き日と最安・人数・室数の ±）に置き換える。送信先・パラメータは代替フォームと同一（§3.8.2）。送信時に `dataLayer.push({event:'search_submit', facility, checkin, nights, adults, rooms})`。
- 理由: 「踏襲」の肝は**パネルの空き日**で、それは Book のデータが要る＝スクリプト版でしか出せない。代替フォームは「script が落ちたら予約できない」（tripla ウィジェットの弱点）を防ぐ保険であって、**単体で出す段階ではない**。CSP も Cookie も触らず、既存の FAQ ウィジェットと同じ配布形。
- Book 側の変更（**P1-Book に前倒し**・§6）: ① `static/embed/search-bar.js`（新規・素の JS、または Svelte の custom element を別エントリでビルド。Shadow DOM・文言は ja/en/zh-TW を同梱＝Paraglide の外で動くため） ② `/api/stay-calendar` に CORS（`/api/geo` と同じ `ALLOWED_ORIGINS` の 3 オリジン） ③ 契約書 v1.1（E2・`rooms`・範囲）。DB 変更なし。
- 工数の見積り【推測】: ① 2〜3 人日（バー UI・2 か月パネル・空き日取得・言語切替・`dataLayer`・iPhone 確認）、② 0.5 人日、③ 0.5 人日。HP 側はタグ 2 行＋CSS 調整で各 0.5 人日。**11 月第 3 週までに Book 側をデプロイ**し、HP 側は 11/29 までのビルドに含める（§4）。
- 間に合わないときの退路: Book 側のスクリプトが 11/29 時点で未完成でも、HP のタグはそのまま置いてよい（`script` が 404 でも代替フォームが見える＝検索はできる）。ただしこれは**退路であって計画ではない**。
- バーの初期値: 空（日付なし・1 泊・2 名・1 室）。HP の客室・プランの各ページに置くときは `data-room`・`data-tag` を付けて E2 の `#room-…`・`tag` に流す拡張を後で足せる（P3）。

### 3.9 `/reservation/` 廃止と旧マイページ動線の置き場（Q8 の決定に伴う変更）

#### 3.9.1 `/reservation/` にあった役目と行き先

| 役目 | いま | 行き先（提案） | 理由 |
|---|---|---|---|
| 「ご予約」の説明ページ（ヘッダーから 1 クリック目） | `/reservation/` | **無し**（ヘッダーは Book E1 へ直接） | Q8 決定。Book の施設トップに料金カレンダー・プラン・規定がある |
| 料金表（`#price`・特商法ページが参照） | `reservation.body.html:55-176` | **Book のプラン一覧 E2**（日付なしで「今後 3 か月の最安」）。特商法ページの文言を「料金はご予約サイトのプラン一覧に表示」に変え、リンクを `https://book.yamado.app/yamado/nishiwaga/plans?utm_…&utm_content=page_tokushoho` へ | 料金の正は Book（RMS）。HP に静的な料金表を残すと二重管理になる。**Q14 決定（2026-10-29）: この変更でよい** |
| キャンセル料金（`#cancel`） | `reservation.body.html:190-226` | Book のプラン詳細（プラン別の規定）と `/legal/tokushoho`。HP の FAQ（Book の FAQ ウィジェット）に「キャンセル料は？」の項目があれば Book の規定へリンク | 規定もプラン別に Book が持つ |
| 旧 tripla マイページ（cutover §3） | `/reservation/` に段を置く案だった | **Book `/booking/lookup` に集約**（cutover 案 B のとおり）。HP からは**フッター「ご予約の確認」→ `/booking/lookup`** の 1 本。`/booking/lookup` の旧マイページのリンク先は `https://www.yamado.co.jp/?tripla_booking_widget_open=signIn`（**トップ**。SDK は `top.head.html:1`）と `https://oga.yamado.co.jp/?tripla_booking_widget_open=signIn` | 期限付きの動線は 1 か所に。HP に段を作ると外すときに HP の再デプロイが要る |
| URL `/reservation/` 自体 | 検索結果・外部リンクが指している可能性 | **301 → Book E1**（`utm_content=redirect_reservation`）。`manifest.json` から `/reservation/` を外し、`.htaccess` に 1 行（★Q12: hp-yamado の `.htaccess` の生成元） | リンク切れを作らない |
| SDK の読み込み場所 | `reservation.body.html:232` | トップの head に既にある。英語・中国語・韓国語の body 末尾も残す | signIn ウィジェットはトップで開く（★Q13） |

#### 3.9.2 `docs/launch-tripla-cutover.md` との整合（同日に直した箇所）

- §3.1 (ii) の西和賀の URL を `/reservation/?…` → **トップ `https://www.yamado.co.jp/?tripla_booking_widget_open=signIn`** に。
- §3.2 案 C（HP 側だけに置く）は「`/reservation/` 廃止により成立しない」と明記。推奨 B は変わらない。
- §7 P1-HP の「`/reservation/` に旧マイページの段」を削除し、「HP フッターに『ご予約の確認』→ `/booking/lookup`」に置換。
- §8 チェックリストの「`/reservation/` の『以前の予約システムでご予約の方』から…」を「HP トップで signIn が開く」に置換。

---

## 4. 切替当日の手順との接続（`docs/launch-tripla-cutover.md` §2 に差し込む）

| 時点 | 本書の作業 | cutover の手順 |
|---|---|---|
| 11 月第 3 週まで | P1-Book（§6）をデプロイ。UTM 保持・完了画面の戻りリンク・`www`・契約書 v1.1・**検索バーのスクリプト `embed/search-bar.js`・`/api/stay-calendar` の CORS**。デプロイ後、ローカルの HP ビルドからスクリプトを読み込んで動作確認 | 2.1 手順 2 と同じデプロイに同乗 |
| 11/29 まで | hp-yamado は git ブランチで `build:xserver` まで済ませる（`/reservation/` の 301・フッター 3 本・トップの `<yamado-search-bar>`・L0 の言語メタ）。hp-oga は `postprocess.mjs` の置換とトップの `<yamado-search-bar>` を足して `site/` をローカルで確認（`npm run check`） | 2.1 手順 5 |
| 11/30 09:00 | 両 HP をデプロイ。確認: PC・iPhone・英語ページから Book の施設トップに着地、`utm_source` が付いている、**トップの検索バーがバー表示になり空き日が出る・検索でプラン一覧に着地**、tripla のボットは出る、HP トップで signIn が開く、`/reservation/` が Book に 301 | **2.2 手順 B そのもの** |
| 戻し方 | 直前のビルドを再デプロイ（FTP 上書き・削除しない）。`/reservation/` は FTP で消していないので旧ファイルが残る＝301 を外せば復活 | 2.2 B の戻し |

- 順番は変えない: 「Book 公開（A）→ HP を Book に向ける（B）→ tripla の受付停止（C）」。

---

## 5. 要確認（コードからは分からないこと）と決定の記録

| # | 項目 | 状態 | 内容 |
|---|---|---|---|
| Q1 | 方式 | **決定** | A（P1）＋ C（P2・§3.8 の形）。B は将来も要件にしない |
| Q2 | `utm_*` の命名 | **決定（本書）** | §3.1 の表。`utm_campaign` を `reserve`／`member`／`lookup` の 3 値で分ける |
| Q3 | 中国語の字体・韓国語の着地 | **決定** | 繁体字 → `/zh-TW`。韓国語は**当面 `/en/`**、**Book に `ko` を足す（L3・`docs/hp-i18n-design.md` §4.6）**のでできた時点で `/ko/` へ |
| Q4 | 同一タブか | 既定で進める | 同一タブ。新規タブ希望なら `target` を戻すだけ |
| Q5 | `yamado.co.jp` → `www` の 301 | ★（本番で 1 回確認） | hp-yamado のチェックリストにある＝設定済みの前提 |
| Q6 | 会員ログイン／マイページのリンク | **決定（置く）** | §3.3。`/account` へ・フッターとスマホメニュー |
| Q7 | GTM の編集者 | **決定** | ユーザー。設定内容は §3.5 |
| Q8 | 西和賀ヘッダーの「ご予約」 | **決定** | Book 直接。`/reservation/` は廃止・301（§3.9） |
| Q9 | 男鹿の各ページから E1 か E2 か | 任意（既定 E1） | **何の話か**: 男鹿 HP の客室ページ（`/room/…`）やコース料理のページ（`/course/…`）にも「宿泊予約」ボタンがあり、そこから Book の**施設トップ**（E1・カレンダーと全プラン）に飛ばすか、**プラン一覧**（E2・その部屋やプランに近い一覧）に飛ばすかという選択。**決めないと何が起きるか**: 何も起きない。全部 E1 に揃う（§3.1 の既定）。お客様は施設トップで部屋・プランを選び直す 1 手間が増えるだけ。**既定の扱い**: ローンチは全部 E1。切替後に GA4 で「`utm_content=page_room_…` から来た人の離脱」が目立てば、そのページだけ E2（`/plans?tag=…` や `#room-…`）に変える（P3） |
| Q10 | 契約書のホスト・館内図 QR のホスト | 契約書は P1-Book で追記 | 館内図の紙 QR をどちらのホストで刷ったかは ★ |
| Q11 | hp-oga の CSP を enforce にするか | 任意（既定そのまま） | **何の話か**: 男鹿 HP は「このページで読み込んでよいスクリプト・接続先」のルール（CSP）を **Report-Only**（違反しても止めずに報告だけ）で出している（`site/.htaccess:59`）。これを **enforce**（違反したら実際にブロック）に切り替えるかどうか。**決めないと何が起きるか**: 何も起きない。今のまま報告だけで動く。**本書との関係**: P1 のリンク遷移は CSP の対象外。検索バーの代替フォーム（GET）も `form-action` を書いていないので影響なし。検索バーの Book スクリプト（`script-src`）と空き日の取得（`connect-src`）は **`book.yamado.app` が既に許可されている**ので enforce にしても動く。**既定の扱い**: そのまま。enforce にするときは Book の埋め込み部品が全部動くかをコンソールで確認してから（P3 以降） |
| Q12 | hp-yamado の `.htaccess` の生成元 | **解消** | `scripts/build-xserver.mjs:136-146` が `server/security.htaccess` ＋ `www.yamado.co.jp` 限定の Rewrite を書き出している。`/reservation/` の 301 はここに `RewriteRule ^reservation/?$ https://book.yamado.app/yamado/nishiwaga?utm_… [R=301,L]` を 1 行足す。sitemap も同スクリプト（`:125-133`）が `manifest.json` から作るので、`manifest.json` から外せば sitemap からも消える |
| Q13 | 西和賀 HP トップで `?tripla_booking_widget_open=signIn` が開くか | ★（本番で確認） | SDK はトップの head にある（`top.head.html:1`）。開かなければ `/booking/lookup` の西和賀リンクを `/english/?…`（body 末尾に SDK あり）にする手もあるが、英語ページに日本人を送るのは避けたい |
| Q14 | 特商法ページの「販売価格」を Book のプラン一覧参照にしてよいか | **決定（よい）** | §3.9.1 のとおり文言とリンクを変える |
| Q15 | 検索バーを素のフォームだけで先に出すか | **決定（出さない）** | 最初からスクリプト版。素のフォームは代替の中身だけ（§3.8.4）。Book 側の作業は P1-Book に前倒し |

---

## 6. 実装タスク（段階・変更ファイルの見込み・DB 変更の有無）

| 段階 | 内容 | 変更ファイルの見込み | DB |
|---|---|---|---|
| **P1-Book（ローンチ前・11 月第 3 週までにデプロイ）** | ① `pageLocation()` で `utm_*` だけ残す＋テスト ② 完了画面に「{施設名}のサイトへ戻る」 ③ 西和賀の `websiteUrl` を `https://www.yamado.co.jp/` ④ 契約書 v1.1: ホスト `book.yamado.app`・検索バーは E2・`rooms` 追加・`nights` 1〜7／`adults` 1〜6 に実装を反映 ⑤ **検索バーのスクリプト `embed/search-bar.js`**（Web Component・取引先バー風 UI・2 か月パネルに空き日と最安・人数室数の ±・ja/en/zh-TW 同梱・`dataLayer.push`・E2 へ遷移）⑥ **`/api/stay-calendar` に CORS**（HP 3 オリジン） | ①〜④: `lib/components/AnalyticsConsent.svelte`（純関数を切り出してテスト）／`routes/(public)/booking/complete/[code]/+page.svelte`・`+page.server.ts`／`lib/server/supabase-data.ts:2457`・`lib/server/store.ts:97`／`autumn_book_deeplink_contract.md`。⑤⑥: `static/embed/search-bar.js`（新規。または `src/lib/embed/search-bar.ts`＋別エントリのビルド）／`routes/api/stay-calendar/+server.ts`（CORS）／`HANDOFF.md`。**工数【推測】: ①〜④ 1 人日・⑤ 2〜3 人日・⑥ 0.5 人日** | **なし** |
| **P1-HP 西和賀（hp-yamado・別リポ・11/29 までに用意、当日デプロイ）** | ヘッダー「ご予約」と `sp-none` フッターを Book E1 へ（日本語 22 ページ＋韓国語）。トップのバナーを Book へ（`data-tripla-booking-widget`・`target=_blank` を外す）。**トップのバナー直下に `<yamado-search-bar>`（代替フォーム入り）＋ `<script src=…/embed/search-bar.js defer>`**。フッターとスマホメニューに「会員ログイン／マイページ」「ご予約の確認」。英語・中国語のページ末尾に Reservation／Member login の段、韓国語ヘッダーの「ご予約」を `/en/…` へ。`/reservation/` を `manifest.json` から外し 301。特商法の料金表リンクを E2 へ（Q14 決定）。SDK は残す。言語メタ（L0・`docs/hp-i18n-design.md` §5.1）も同じビルドで | `src/lib/content/*.body.html`（`global-nav__button`・`sp-none`・`footer__nav` の一括置換）／`top.body.html:72-73`（バナー・検索バー）／`english.body.html`・`chinese.body.html`・`korean.body.html`／`tokushoho.body.html:88`／`manifest.json`／`scripts/build-xserver.mjs:136-146`（301）。工数: 1 人日 | なし |
| **P1-HP 男鹿（hp-oga・別リポ・同上）** | `postprocess.mjs` に `href="/?tripla_booking_widget_open=search" target="_blank" rel="noopener"` → Book E1（`utm_content` はクラス名で 3 系統）の置換を追加 → `site/` 全体（33 ファイル）。**トップの KV 直下か RESERVE カードの上に `<yamado-search-bar>`＋`<script>`**。ドロワー・フッターに「会員ログイン／マイページ」「ご予約の確認」。SDK・CSP は触らない（`script-src`・`connect-src` に `book.yamado.app` あり）。`llms.txt` に予約 URL の記述があれば合わせる | `tools/postprocess.mjs`／`site/index.php`（検索バー・ドロワー・フッター）／生成される `site/**/index.html`／`HANDOFF.md`。工数: 0.5〜1 人日 | なし |
| **P3（効果測定後）** | GA4 で HP→Book の離脱を見て、着地の改善・E2 への振り分け（Q9）・hp-oga CSP の enforce（Q11）・検索バーを客室・プランの各ページにも置く（`data-room`・`data-tag`） | Book の施設トップ・プラン一覧・`embed/search-bar.js`／hp-oga `postprocess.mjs` | なし |
| **P4（tripla 契約終了後・cutover P5 と同時）** | HP から tripla SDK を外す。hp-oga の CSP から `tripla.jp`・`*.tripla.io` を外す。`/booking/lookup` の旧マイページ段は `LEGACY_MYPAGE_UNTIL` で自動停止 | cutover §7 P5 と同じ | なし |
| **（別線）Book に韓国語を追加（L3・ローンチ必須外）** | `docs/hp-i18n-design.md` §4.6・§5.4。完了後に HP の `/korean/`（→L1 以降 `/ko/`）の着地を `/ko/yamado/…` に切り替え、`embed/search-bar.js` に ko 文言を足す | 同書 §6 L3 の行 | 原則なし |

- 実装順: **P1-Book（検索バー含む・11 月第 3 週）→ P1-HP 西和賀・男鹿（並行可・11/29 まで）→ 当日デプロイ（§4）→ P3 → P4**。韓国語の Book 追加は L3 の時期に別線で進める。
- 旧案の「P2-a（素のフォームだけ先に出す）／P2-b（後からスクリプト）」は **採らない**（2026-10-29 決定）。
- hp-yamado / hp-oga は別リポなので、Book 側の HANDOFF には「HP 側の変更は各リポの HANDOFF に記録」とだけ書く。

---

## 7. テストチェックリスト（HANDOFF.md に転記する）

### Book 側（P1-Book）
- [ ] `?utm_source=hp_oga&utm_content=header&checkin=2026-12-20` 付きで `/yamado/oga` を開き GA4 に同意すると、`page_location` に `utm_*` だけが残り `checkin` は落ちている
- [ ] `/booking/complete/<code>` の `page_location` が `:code` に置き換わったまま
- [ ] 予約完了画面に「← 山人 -oga- のサイトへ戻る」が出て `https://oga.yamado.co.jp/` へ。西和賀は `https://www.yamado.co.jp/`
- [ ] 施設トップの戻り帯の西和賀リンクが `www` 付きで 200
- [ ] `/en/yamado/nishiwaga`・`/zh-TW/yamado/oga` が言語付きで開く
- [ ] 未ログインで `/account?utm_source=hp_oga&utm_campaign=member` を開くと `/auth/login?next=/account…` に飛び、ログイン後に `/account` に戻る。ログイン済みなら直接マイページ

### 西和賀 HP（P1-HP）
- [ ] 全ページのヘッダー「ご予約」が `book.yamado.app/yamado/nishiwaga?utm_source=hp_nishiwaga&utm_campaign=reserve&utm_content=header` に**同一タブ**で着地する（PC・iPhone）
- [ ] トップのバナーが Book へ。クリックで tripla のウィジェットが**開かない**（`data-tripla-booking-widget` が残っていない・grep）
- [ ] `/english/`・`/chinese/` のページ末尾の Reservation が `/en/…`・`/zh-TW/…` へ。`/korean/` のヘッダー「ご予約」が `/en/…` へ
- [ ] フッターとスマホメニューに「会員ログイン／マイページ」（→ `/account`）「ご予約の確認」（→ `/booking/lookup`）が出て、`utm_campaign` が `member`／`lookup`
- [ ] `https://www.yamado.co.jp/reservation/` が Book の施設トップに 301 で着地する
- [ ] `https://www.yamado.co.jp/?tripla_booking_widget_open=signIn` で tripla のログインが開く【本番 HP・★Q13】
- [ ] tripla のボットが従来どおり出る
- [ ] `489ban.net`・`/reservation/` へのリンクが HP に残っていない（grep。特商法の料金表リンクは E2 に変わっている）

### 男鹿 HP（P1-HP）
- [ ] 全ページの「宿泊予約」が `book.yamado.app/yamado/oga?utm_source=hp_oga&…` に同一タブで着地する（PC・iPhone・`/room/…`・`/course/…`）
- [ ] `tripla_booking_widget_open=search` が `site/` に残っていない（grep）。`postprocess.mjs` を 2 回流しても差分が出ない
- [ ] `utm_content` がヘッダー／フッター／本文で異なる
- [ ] ドロワーとフッターに「会員ログイン／マイページ」「ご予約の確認」が出る
- [ ] tripla のボットが出る。コンソールに CSP の報告が増えていない
- [ ] `npm run check` でリンク切れなし

### 計測（P1・GTM）
- [ ] HP で予約ボタンを押すと GA4（HP）に `reserve_click`、マイページで `member_click`、ご予約の確認で `lookup_click`
- [ ] Book の GA4 のリアルタイム「セッションの参照元」に `hp_oga`／`hp_nishiwaga`

### 検索バー（P1・Book 配布スクリプト・両 HP）
- [ ] 両 HP のトップで取引先バー風（PC 1 本・スマホ縦積み）に描かれ、日付パネルに空き日と最安が出る（`/api/stay-calendar` が HP のオリジンから 200・CORS ヘッダあり）
- [ ] 日付・泊数・人数・室数を選んで「検索」すると Book の**プラン一覧** `/yamado/<施設>/plans` に `checkin`・`nights`・`adults`・`rooms`・`utm_*` 付きで**同一タブ**で着地し、Book のバーに値が入っている
- [ ] 室数 2 以上で、1 つの部屋タイプで足りないとき「お部屋タイプを組み合わせると…」の枠が出る
- [ ] 日付を空のまま送っても「今後 3 か月の最安」で表示される
- [ ] 過去日・8 泊以上・7 名以上・5 室以上を送っても Book が黙って丸める
- [ ] **スクリプトをブロック（または 404 に）しても、中の素の GET フォームで検索できる**（iPhone の `<input type=date>` で選べる）
- [ ] `/english/` では英語、`/chinese/` では繁体字で出て、送信先に `/en`・`/zh-TW` が付く（韓国語ページは英語・`/en`）
- [ ] 送信時に `dataLayer` に `search_submit` が入り、GTM 経由で GA4（HP）に届く
- [ ] hp-oga のコンソールに CSP の報告が出ない（Report-Only のまま）
- [ ] Book 側のスクリプトを更新すると、HP を再デプロイせずに両 HP に反映される（キャッシュ期間を確認）

### 撤去（P4）
- [ ] SDK と CSP の tripla を外したあと、両 HP のコンソールにエラーが無く、予約ボタンは Book へ行く

---

## 8. 設計判断の理由（まとめ）

- **リンク遷移（A）にした**: Book の会員・予約フローは `sameSite=lax` の Cookie 前提で、別ドメインの iframe の中では iPhone の Safari で動かない。Book は全応答で埋め込み禁止を宣言しており、ウィジェット化はそれを自分で緩めることになる。
- **検索バー（C）は最初から Book 配布スクリプト（Web Component）**: 取引先バーの肝である「パネルの空き日」は Book のデータが要るので Book 配布のスクリプトでしか出せず、素のフォームだけの段階を挟む価値が無い（決定・Q15）。script 依存だけにすると tripla ウィジェットと同じ「落ちたら予約できない」になるので、素の GET フォームを**代替の中身として**残す。遷移先は `rooms` を読むプラン一覧 E2。ローンチ必須に入れ、Book 側の作業を P1-Book に前倒し。
- **会員の入口は `/account` 1 本**: ログイン済み・未ログインの判断を Book に任せ、HP は会員状態を知らない。`next` は同一サイト内に限られるので HP に戻す遷移は作らない。
- **`/reservation/` は廃止し、役目を Book と `/booking/lookup` に移す**: 料金・規定の正は Book にあり、HP に静的な料金表を残すと二重管理になる。旧マイページの入口は期限付きなので HP ではなく Book の 1 ページに集約し、HP からはフッターの 1 本で辿る。URL は 301 で生かす。
- **UTM で流入を残す**: HP と Book は別の GA4 プロパティなのでリンカーでは繋がらない。`utm_campaign` を予約／会員／確認の 3 値で分け、導線ごとの効果を見る。
- **DB 変更なし**: 接続はすべて URL・ヘッダー・静的な部品の話で、データの形は変わらない。
