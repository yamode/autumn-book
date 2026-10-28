# 施設 HP の言語設計（ゼロベース再検討）

2026-10-29 ユーザー要望: 「HP の言語設計をどうするか、ゼロベースで検討しなおしてほしい。男鹿も西和賀も統一の方式にしたい。i18n がグローバル標準ならそうしたい。」

**2026-10-29 ユーザー決定（反映済み）**:
1. **段階移行で確定**。11/30 は最小案 **L0**（URL も中身も変えない）。その後 L1 → L2 → L3。
2. **簡体字は作らない**。
3. **韓国語は Book にも足す**（HP だけ作って予約の途中で言語が切れる状態にしない）。時期は L3 に合わせ、ローンチ必須には入れない。作業内容と見積りは §4.6・§5.4・§6。
4. 本番でしか確かめられない事項（`hp-book-integration.md` Q5・Q13）は要確認のまま。

状態: **設計案（未実装・コード変更なし）**。「コードを読んで確かめた事実」と「提案・推測」を分けて書く。事実には出典（ファイル・行）を付け、未確認の前提には ★ を付ける（一覧は §7）。推測は【推測】。
対象: 西和賀 HP（hp-yamado・`www.yamado.co.jp`）、男鹿 HP（hp-oga・`oga.yamado.co.jp`）、および両 HP が着地させる公式予約システム Book（`book.yamado.app`）。
関連: `docs/hp-book-integration.md`（HP → Book の URL。`{lang}` の対応は本書 §4.5 が正）、`autumn_book_i18n_design.md`（Book の i18n 設計 v1・実装済み）、`docs/launch-tripla-cutover.md`（11/30 ローンチ）。

---

## 0. 結論（先に）

- **「i18n がグローバル標準か」への答え**: はい。現在の標準は「**言語ごとに別 URL（サブディレクトリ `/en/` 等）＋ `<html lang>` ＋ 相互参照する hreflang（x-default 付き）＋ 利用者が自分で切り替える言語メニュー（自動リダイレクトはしない）＋ 翻訳は原文から鍵（キー）で管理して単一ソース化**」。Book は既にこの形で動いている（§1.3）。西和賀 HP は「`/english/` 1 枚の別ページ」方式で、URL は標準に近いが **`<html lang>`・hreflang・切替 UI・ページ構成**が標準から外れている（§1.1）。男鹿 HP は日本語のみ（§1.2）。
- **決定（両 HP 共通・1 つ）**: **段階移行**（2026-10-29 確定）。URL は両 HP とも **サブディレクトリ `/en/`・`/zh-TW/`（・将来 `/ko/`・`/zh-CN/`）** に統一し、日本語はプレフィックス無し。Book と同じ規則にする（§4.1）。各言語は**全ページではなく「主要ページ」を翻訳**し、未翻訳ページは言語切替に出さない（§4.3）。翻訳は**日本語の HTML を原本に、言語別の HTML を生成物として持つ**（キー管理は HP の静的 HTML には重く、Book のような messages JSON は使わない。§4.4）。
- **ローンチ（2026-11-30）に間に合わせる最小案（§5.1・「L0」）**: HP の URL も中身も**変えない**。やることは 4 つだけ。① 西和賀の `/english/`・`/chinese/`・`/korean/` に `<html lang>`・hreflang・正しい canonical を付ける ② 言語切替の `target="_blank"` を外す ③ 各言語ページに Book への予約リンク（`/en/…`・`/zh-TW/…`）と会員ログインの段を足す ④ 男鹿は日本語のまま、hreflang は付けない（`x-default` と `ja` の 2 本だけ任意）。**DB 変更なし・Book 変更なし**。
- **その後の拡張（§5.2〜5.4）**: L1 で西和賀の `/english/` → `/en/`（301）とヘッダー・フッターの英語化、L2 で男鹿に `/en/` を新設、L3 で `/zh-TW/`（男鹿）と **韓国語（Book への `ko` 追加＋両 HP の `/ko/`）**。**簡体字は作らない（決定）**。韓国語は **Book 側を先に（または同時に）やる**＝HP だけ作って予約の途中で英語に切り替わる状態を作らない（§4.6。Book 側は 1,159 キーの翻訳＋ロケール一覧の集約リファクタ＋メール・FAQ・content_translations。見積り 5〜8 人日）。
- 言語コードは **BCP 47** で `ja`／`en`／`zh-TW`（繁体字・台湾）／`zh-CN`（簡体字・中国）／`ko`。Book が `zh-TW` を既に使っているので HP も揃える（`zh-Hant` ではなく `zh-TW`。§3.2）。

---

## 1. 現状（調査結果）

### 1.1 西和賀 HP（hp-yamado）

| 項目 | 事実 | 出典 |
|---|---|---|
| 言語ページ | `/english/`・`/chinese/`・`/korean/` の **3 ページ**（それぞれ 1 枚の長いページ）。日本語の固定ページは 19 ページ（`manifest.json`） | `src/lib/content/manifest.json`（`/english/`・`/chinese/`・`/korean/`） |
| 中身 | 英語は「Hot Spring／Breakfast & Dinner／Guest Suites／Facilities & Services／Room Charges／Access／General Information」のページ内リンク付き 1 枚（423 行）。中国語 449 行・韓国語 492 行で同構成 | `english.body.html:21-45`・`wc -l` |
| 中国語の字体 | **繁体字**（「歡迎」「溫泉」「隱私權」「中文」） | `chinese.body.html`（`grep` で 歡迎 3 件・簡体字の「欢迎」0 件）・`manifest.json`「岩手縣　溫泉旅館」 |
| ヘッダー・フッター | **英語・中国語ページにはグローバルナビ（ヘッダー）が無い**。`<div id="contents" class="contents contents--language">` から始まり、末尾は住所ブロック（日本語のまま）と著作権表示だけ。**韓国語ページだけ日本語のヘッダー付き**（「客室／お料理／…／ご予約」が日本語で出る） | `english.body.html:1-10, 405-423`（`global-nav` 0 件）・`chinese.body.html`（同 0 件）・`korean.body.html:12-29`（14 件） |
| 言語切替 UI | 日本語ページのヘッダー内 `JP／EN／KO／CH` の 4 リンク。**全部 `target="_blank"`（新しいタブで開く）**。言語ページ側には切替が無い（英語・中国語はヘッダー自体が無い） | `top.body.html:17-22` |
| `<html lang>` | **全ページ `lang="ja"` 固定**（`src/app.html` の枠をそのまま使う。言語ページも `ja`） | `src/app.html:2`・`scripts/build-xserver.mjs:21-27`（`app` の枠に head/body を流し込むだけ） |
| hreflang | **無し**（`hreflang` の出現 0 件） | `grep -rn hreflang src/` → 0 件 |
| canonical・OGP | 言語ページの `<link rel="canonical" href="/english/">`・`og:url` が**相対 URL**（絶対 URL が標準）。`og:description`・`keywords` は英語のまま 3 言語共通 | `english.head.html`・`chinese.head.html`・`korean.head.html` |
| `og:locale` | 無し | 同上 |
| sitemap | `scripts/build-xserver.mjs` が `manifest.json` の固定ページから `sitemap.xml` を生成（言語ページも 1 URL ずつ入る。`xhtml:link` の言語注釈は無い） | `scripts/build-xserver.mjs:125-133` |
| GA 同意バナー | URL の先頭で `en／zh／ko／ja` を判定し、バナー文言を 4 言語で出す（**HP 内で唯一の「言語を判定する」コード**） | `src/app.html:58-66` |
| 翻訳の保守 | 旧 WordPress から書き出した HTML を手で編集。原文（日本語）との対応表・翻訳メモリ・キーは無い。日本語ページを直しても言語ページは追随しない | `src/lib/content/*.body.html`（`scripts/extract.mjs` は旧 WP からの書き出し・`HANDOFF.md:104`） |
| 技術スタック | SvelteKit で `src/lib/content/*.{head,body}.html` を `src/app.html` の枠に流し込み、`npm run build:xserver` で静的 HTML＋PHP を `xserver/` に書き出し、FTP で Xserver へ。`.htaccess`（`www.yamado.co.jp` 限定の Rewrite）・`sitemap.xml`・`robots.txt` も同スクリプトが生成 | `scripts/build-xserver.mjs:1-10, 125-146`・`HANDOFF.md:87-93` |

### 1.2 男鹿 HP（hp-oga）

| 項目 | 事実 | 出典 |
|---|---|---|
| 言語 | **日本語のみ**。`<html … lang="ja">`・`og:locale ja_JP`・構造化データ `inLanguage: "ja"` | `site/index.php:3, 30, 44` |
| 英語の痕跡 | 無し（`english`・`/en/`・`hreflang` の出現 0 件） | `grep -rl` → 0 件 |
| ページ数 | 23 ディレクトリ・`index.html` 28 枚＋PHP（お知らせ・プレス・問い合わせ） | `ls -d site/*/`・`find` |
| 技術スタック | `site/` の静的 HTML が正本。`node tools/postprocess.mjs`（冪等）が WP 残骸の除去・CSP 入りの `.htaccess`・404・メニューのお知らせ等を生成し、FTP で Xserver へ。sitemap は `sitemap.php`（固定ページ＋Book のお知らせ） | `tools/postprocess.mjs:1-10, 405-470`・`site/sitemap.php:1-40`・`HANDOFF.md:7-8` |
| CSP | Report-Only。`script-src`・`connect-src` に `book.yamado.app` あり | `tools/postprocess.mjs:407` |

### 1.3 Book（book.yamado.app）

| 項目 | 事実 | 出典 |
|---|---|---|
| ロケール | **ja（基準）／en／zh-TW の 3 つ** | `project.inlang/settings.json:3-4` |
| URL | ja はプレフィックス無し、`/en/…`、`/zh-TW/…`（サブディレクトリ方式）。ルートファイルはプレフィックス無しで、`reroute` が外す | `vite.config.ts:22-31`・`src/hooks.ts:4-8` |
| 言語の決め方 | **URL → Cookie → Accept-Language → ja** の順（Paraglide の strategy）。URL に言語があればそれが最優先。URL に無いときだけ Cookie・ブラウザの言語を見る＝「自動で別 URL に転送する」のではなく「プレフィックス無し URL の表示言語を決める」 | `vite.config.ts:21` |
| 言語切替 UI | ヘッダーの `LocaleSwitcher`（🌐 ＋現在の言語名のドロップダウン・同じパスの別言語 URL へ `data-sveltekit-reload` で遷移）。表示名は「日本語／English／繁體中文」 | `LocaleSwitcher.svelte:12-24, 58` |
| `<html lang>` | `%lang%` をミドルウェアが置換（ロケール連動） | `app.html:2`・`hooks.server.ts:108-112` |
| hreflang | 公開面の全ページに `ja`・`en`・`zh-TW`・`x-default`（＝ja）の 4 本。絶対 URL | `(public)/+layout.svelte:16-19, 48-52` |
| 文言 | Paraglide JS 2・`messages/{ja,en,zh-TW}.json`・**各 1,159 キー**（3 言語とも同数） | `node -e` で集計 |
| コンテンツ翻訳 | DB の `book.content_translations`（施設・客室・プランの項目単位・ja フォールバック）。管理画面に翻訳欄 | `autumn-shared …/20260612000100_book_content_translations.sql:7-41`・`autumn_book_i18n_design.md` §2 |
| 会員の言語 | `book.members.locale`（確定メールの言語） | `autumn_book_i18n_design.md` §2.1 |
| 言語を参照する箇所 | `'zh-TW'` のリテラルがソース 54 ファイル・94 か所（Paraglide 生成物を除く）。LocaleSwitcher・hreflang・メンテナンス画面・Stripe の `locale`・メールテンプレート・日付書式など | `grep -rn "'zh-TW'" src --include=*.ts --include=*.svelte` |
| 韓国語・簡体字 | **無し**。HP の `/korean/` からは `/en/` に着地させる前提（`hp-book-integration.md` §3.1） | — |
| noindex | 公開前は全ページ noindex（11/30 に外す） | `app.html:9` |

### 1.4 まとめ: 何がずれているか

| 観点 | 標準（§3） | 西和賀 HP | 男鹿 HP | Book |
|---|---|---|---|---|
| URL | 言語別サブディレクトリ | `/english/`（言語**名**。コードではない） | 日本語のみ | `/en/`・`/zh-TW/` ✓ |
| `<html lang>` | ページの言語 | 全部 `ja` ✗ | `ja` ✓ | 連動 ✓ |
| hreflang | 相互参照＋x-default | 無し ✗ | 無し（単一言語なら不要） | 4 本 ✓ |
| 切替 UI | 同一タブ・言語名は自言語表記 | 新規タブ・`EN/KO/CH`（CH は言語コードではない）✗ | 無し | ドロップダウン ✓ |
| ページ構成 | 言語ごとに同じサイト構造 | 1 枚の長いページ・ヘッダー無し ✗ | — | 同じ構造 ✓ |
| 翻訳の管理 | 原文との対応・単一ソース | 無し ✗ | — | messages JSON＋DB ✓ |
| 中国語の字体 | 繁体字＝`zh-TW`（または `zh-Hant`） | 繁体字だが URL は `/chinese/` △ | — | `zh-TW` ✓ |
| 韓国語 | — | あり | 無し | **無し**（HP→Book で言語が切れる） |

---

## 2. 要件（ユーザー要望の分解）

1. **両 HP で統一の方式**（URL・切替 UI・言語コード・翻訳の作り方）。
2. **グローバル標準に沿う**（SEO・アクセシビリティ・運用の 3 面）。
3. **Book と言語が途切れない**（HP の言語ページから Book の同じ言語に着地し、予約の途中で日本語に戻らない）。
4. 2026-11-30 のローンチを妨げない（最小案と拡張案を分ける）。
5. 現場で保守できる（翻訳の更新手順が 1 人でも回る）。

---

## 3. グローバル標準の確認

出典は Google 検索セントラル「多言語・多地域サイトの管理」「hreflang」、W3C「Internationalization: Language on the Web」、BCP 47（RFC 5646）、WCAG 2.x 達成基準 3.1.1（ページの言語）・3.1.2（部分的な言語）。いずれも公開仕様の一般論で、本書では要点だけを日本語で書く【知識ベース・2026 年時点】。

### 3.1 URL 構造

| 方式 | 例 | 長所 | 短所 | 判断 |
|---|---|---|---|---|
| **サブディレクトリ** | `www.yamado.co.jp/en/` | 1 ドメインで済む・証明書・解析・配信が共通・Google も推奨の 1 つ・Book と同形 | 地域ターゲティングは hreflang で明示 | **採用** |
| サブドメイン | `en.yamado.co.jp` | 言語別にサーバーを分けられる | DNS・証明書・解析が増える・ブランド認知が割れる | 不採用 |
| ccTLD | `yamado.tw` | 地域最強 | 取得・維持コスト・本件は「言語」であって「地域」ではない | 不採用 |
| パラメータ | `?lang=en` | 実装が最小 | Google が非推奨（索引が不安定）・共有 URL が崩れる | 不採用 |

- 日本語は**プレフィックス無し**（既存 URL を維持し、Book と同じ規則にする）。

### 3.2 言語タグ（BCP 47）

| 言語 | タグ | 備考 |
|---|---|---|
| 日本語 | `ja` | |
| 英語 | `en` | 地域を付けない（`en-US` 等に分ける理由が無い） |
| 中国語・繁体字 | **`zh-TW`**（Book と同じ）。純粋な「字体」指定は `zh-Hant` | hreflang は `zh-Hant` と `zh-TW` のどちらも有効。**Book が `zh-TW` を使っている**ので揃える。台湾・香港どちらの読者にも繁体字を出す場合は hreflang に `zh-Hant` を**併記**できる（同じ URL を 2 行書く） |
| 中国語・簡体字 | `zh-CN`（または `zh-Hans`） | 作る場合のみ |
| 韓国語 | `ko` | |

- `<html lang>` は**ページ本文の言語**（WCAG 3.1.1）。西和賀の言語ページが `ja` のままなのは読み上げ・翻訳機能・検索の 3 面で不利。
- 本文中に別言語の部分（住所の日本語表記など）があれば `<span lang="ja">`（WCAG 3.1.2。任意）。

### 3.3 hreflang

- 各ページの `<head>` に、**そのページの全言語版**（自分自身を含む）を `<link rel="alternate" hreflang="…" href="絶対URL">` で列挙し、**`x-default`** を 1 本付ける（言語が合わない人の既定＝通常は日本語ページか言語選択ページ）。
- **相互参照が必須**: A が B を指すなら B も A を指す。片方向は無視される。
- 代替は sitemap の `<xhtml:link rel="alternate" hreflang>`（HTML に書けないとき）。HP は HTML に書ける。
- **翻訳が無いページには付けない**（他言語版が無いページは `ja` と `x-default` だけ、または何も付けない）。

### 3.4 言語切替と自動転送

- **Accept-Language や IP で別 URL に自動リダイレクトしない**のが標準（Google のクローラは米国から日本語ページを見られなくなる・利用者が選べない・ブラウザの言語と読みたい言語は一致しない）。許されるのは「バナーで提案する」まで。
- 切替 UI は**同一タブ**・**各言語を自言語表記**（日本語／English／繁體中文／한국어／简体中文）・**同じページの別言語版へ**（無ければその言語のトップへ）。国旗は使わない（言語≠国）。
- Book の「URL → Cookie → Accept-Language」は、**URL に言語があるときは URL が勝つ**のでこの標準に反しない（事実: `vite.config.ts:21`）。

### 3.5 翻訳の単一ソース化

- 原文（日本語）を正とし、翻訳は原文の**どの部分の訳か**が追える形で持つ（キー管理・翻訳メモリ・段落 ID のいずれか）。
- 機械翻訳（DeepL・LLM）＋**人手確認**が現実解。確認済みの訳は翻訳メモリとして残し、原文が変わった箇所だけ再翻訳する。
- Web アプリ（Book）は messages JSON のキー管理。**静的な HP に同じ仕組みを持ち込むと、HTML を全部テンプレート化し直す**ことになる（§4.4 で別の形を採る）。

### 3.6 sitemap・OG・構造化データ

- sitemap: 各言語 URL を**それぞれ** `<url>` に入れる。hreflang を HTML に書いているなら sitemap の注釈は任意。
- OGP: `og:locale`（`ja_JP`・`en_US`・`zh_TW`・`ko_KR`）と `og:locale:alternate`。`og:url`・canonical は**絶対 URL**。
- 構造化データ（`Hotel`／`LodgingBusiness`・`WebPage`）: `inLanguage` をページの言語に。
- `<title>`・`description` は言語ごとに書く（西和賀の言語ページは `description` が英語で共通＝直す）。

### 3.7 検索エンジンごとの事情

| 圏 | 主な検索 | 注意 |
|---|---|---|
| 英語圏・台湾・香港 | Google | 上記の標準どおり |
| 韓国 | Naver（シェア 5〜6 割【推測】）・Google | Naver は hreflang の解釈が弱く、**韓国語ページの `<html lang="ko">`・`<title>`・`description` の韓国語化とサイトマップ登録（Naver Search Advisor）**が効く |
| 中国本土 | Baidu | Baidu は `zh-CN` ページを中国国内サーバー優遇・hreflang 非対応。簡体字ページを作っても本土からの到達は限定的【推測】。**本土向けは OTA（Ctrip 等）経由が現実**で、HP の簡体字は「来日後・台湾香港以外の繁体字非対応者の補助」程度の位置づけ |

---

## 4. 設計（両 HP 共通の方式）

### 4.1 言語の一覧・コード・URL

| 言語 | コード | 西和賀 URL | 男鹿 URL | Book 着地 | 位置づけ |
|---|---|---|---|---|---|
| 日本語 | `ja` | `/`（変更なし） | `/`（変更なし） | `/yamado/…` | 基準 |
| 英語 | `en` | **`/en/`**（`/english/` → 301） | **`/en/`**（新設） | `/en/yamado/…` | 第 1 外国語・両 HP 必須 |
| 繁体字 | `zh-TW` | **`/zh-TW/`**（`/chinese/` → 301） | `/zh-TW/`（L3） | `/zh-TW/yamado/…` | 台湾・香港 |
| 韓国語 | `ko` | **`/ko/`**（`/korean/` → 301・L1） | `/ko/`（L3） | **L3 で Book に `ko` を追加**（§4.6）。それまでは `/en/` | 西和賀に既存。**決定: Book にも足す** |
| 簡体字 | `zh-CN` | **作らない** | **作らない** | — | **決定: 作らない**（§3.7） |

- プレフィックスの大文字小文字は **Book と同じ `zh-TW`**（URL は大文字小文字を区別するので、`/zh-tw/` も 301 で `/zh-TW/` に寄せる）。
- 旧 URL（`/english/`・`/chinese/`・`/korean/`）は **301** で新 URL へ（`.htaccess`・`scripts/build-xserver.mjs:136-146` に追記）。外部リンク・検索結果・Book の FAQ 等が旧 URL を指していても切れない。
- 言語ページのパスは**日本語と同じスラッグ**を使う（`/en/guestroom/`・`/en/cuisine/`…）。翻訳が無いページは作らない（§4.3）。

### 4.2 `<html lang>`・hreflang・canonical・OG（両 HP の共通テンプレート規則）

```html
<html lang="en">                                     ← ページ本文の言語
<link rel="canonical" href="https://www.yamado.co.jp/en/">   ← 絶対 URL・自分自身
<link rel="alternate" hreflang="ja"        href="https://www.yamado.co.jp/">
<link rel="alternate" hreflang="en"        href="https://www.yamado.co.jp/en/">
<link rel="alternate" hreflang="zh-TW"     href="https://www.yamado.co.jp/zh-TW/">
<link rel="alternate" hreflang="ko"        href="https://www.yamado.co.jp/ko/">
<link rel="alternate" hreflang="x-default" href="https://www.yamado.co.jp/">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="ja_JP"> …
```

- **「そのページに存在する言語版だけ」を列挙**する（トップは 4 言語、客室ページが en だけなら `ja`・`en`・`x-default` の 3 本）。
- hp-yamado: `scripts/build-xserver.mjs` の `page()` に「言語」と「対応表」を渡して head を生成する（`manifest.json` に `lang` と `alternates` を持たせる。§6）。
- hp-oga: `tools/postprocess.mjs` に同じ関数を置く（`site/en/**/index.html` を読み、`lang` と hreflang を差し込む）。**関数は 2 リポで同一内容にする**（プレス共通部品 `taskul-press.php` と同じ運用・`hp-oga/HANDOFF.md:14`）。

### 4.3 各言語の対象範囲（全ページか主要ページか）

- **主要ページだけ**。理由: 翻訳は 1 ページあたり本文 1,000〜3,000 字。全ページ（西和賀 19・男鹿 23）を 3 言語にすると 100 ページ超の翻訳と保守になり、現場で回らない。外国人のお客様が HP で見るのは「どんな宿か・部屋・料理・温泉・料金の目安・アクセス・予約」に集中する【推測・tripla 時代の英語ページが 1 枚で済んでいたことと整合】。
- **主要ページの定義（両 HP 共通・7 ページ）**: トップ／客室／お料理／温泉・施設／アクセス／よくある質問（Book の FAQ ウィジェットが多言語なら HP 側は枠だけ）／プライバシー・特商法（法定表示は日本語を正とし、英語は「参考訳」注記付き。★Q5）。お知らせ・プレス・ふるさと納税・四季・周辺観光は**日本語のみ**（言語切替に出さない）。
- 言語ページの**ヘッダー・フッター**は日本語と同じ構造で、ナビは翻訳が存在するページだけを並べる（西和賀の「英語ページにヘッダーが無い」状態を解消）。「ご予約」は Book の `/en/…` へ（`hp-book-integration.md` §3.1）。
- 日本語にしかないページを英語の文脈で開いたら（例: `/en/furusato/` は存在しない）、404 ではなく **`/furusato/`（日本語）に 302** し、ページ上部に「This page is available in Japanese only」の 1 行（`.htaccess` の RewriteRule と小さな帯。L2）。

### 4.4 翻訳の作り方と更新手順

HP は「テンプレート＋データ」ではなく**完成品の HTML**（旧 WP の書き出し）なので、Book 流のキー管理は向かない。代わりに **「日本語 HTML を原本、言語別 HTML を生成物」として管理**する。

| 要素 | 方式 |
|---|---|
| 原本 | 日本語の `*.body.html`（西和賀）／`site/**/index.html`（男鹿）。**ここだけ人が直す** |
| 翻訳単位 | `<p>`・見出し・`alt`・`title`・`description` の**ブロック単位**。各ブロックに原文のハッシュを付けた対応表（`i18n/<lang>/<page>.json`: `{ "<原文ハッシュ>": "<訳文>" }`）＝簡易な翻訳メモリ |
| 生成 | ビルド時にスクリプト（`scripts/i18n-build.mjs`・両リポ同一）が原本を読み、対応表にある訳で置換して `en/…/index.html` を出す。**対応表に無いブロック（原文が変わった・新規）は原文のまま出し、一覧を標準出力に出す**＝翻訳漏れが見える |
| 翻訳の作成 | 漏れ一覧を LLM／DeepL で下訳 → 人が確認 → 対応表に追記（Claude Code のセッションでも回せる）。**訳文を HTML に直書きしない** |
| 固有名詞・用語 | `i18n/glossary.json`（山人 -yamado-・湯川温泉・鵜ノ崎・露天付スイート・会席…）を下訳のプロンプトに渡す。両リポで共有（Dropbox `96_Claude/` に正本・★Q6） |
| 画像内の文字 | 翻訳しない（`alt` だけ訳す）。文字入り画像はなるべく CSS テキストに置き換える（L3 以降） |
| 更新手順（日常） | ① 日本語 HTML を直す ② `npm run build:xserver`（西和賀）／`node tools/postprocess.mjs`（男鹿）を流す ③ 標準出力の「未翻訳ブロック」を確認 ④ 下訳 → 確認 → 対応表に追記 ⑤ もう一度ビルド → デプロイ。②〜⑤を飛ばしても**日本語は即公開でき、言語版は該当ブロックだけ日本語のまま出る**（壊れない） |

- Book 側の翻訳（施設・客室・プランの紹介文）は従来どおり `book.content_translations`・管理画面で行い、HP の対応表とは**混ぜない**（対象が違う・Book は DB）。用語集だけ共有する。

### 4.5 言語切替 UI（両 HP 共通）

- 置き場所: ヘッダー右（PC）／ハンバーガー内の最上段（スマホ）。**同一タブ**。
- 表示: 🌐 ＋ 現在の言語名（日本語／English／繁體中文／한국어）のドロップダウン（Book の `LocaleSwitcher` と同じ見た目・同じ並び）。国旗は使わない。
- リンク先: **同じページの別言語版**。無ければその言語の**トップ**（ドロップダウン内で薄く「トップへ」と添える）。
- 自動転送はしない。初回訪問時に「ブラウザの言語が英語で、日本語ページを開いている」場合だけ、ページ上部に「English page is available →」の細い帯を出す（閉じたら `localStorage` に記憶。L2・任意）。これは標準の範囲内（リダイレクトではなく提案）。

### 4.6 Book との言語対応表と、韓国語・簡体字を作る場合の Book 側作業

| HP の言語 | Book の着地 | 途切れ | 対策 |
|---|---|---|---|
| ja | `/yamado/…` | なし | — |
| en | `/en/yamado/…` | なし | — |
| zh-TW | `/zh-TW/yamado/…` | なし | — |
| **ko** | L3 まで `/en/yamado/…`、**L3 で Book に `ko` を追加して `/ko/yamado/…`** | L3 まで英語に切り替わる | L0〜L2: HP の韓国語ページに「ご予約は英語ページで承ります（예약은 영어 페이지에서）」の注記。L3: Book の `ko` を**先に**出してから HP の着地を `/ko/` に切り替える（**決定**） |
| zh-CN | — | — | **作らない（決定）** |

**Book に韓国語を足す作業（決定・L3・ローンチ必須外）。内容と見積り**:

| 作業 | 内容 | 規模 |
|---|---|---|
| 設定 | `project.inlang/settings.json` の `locales`・`vite.config.ts` の `urlPatterns` に 1 行 | 小 |
| UI 文言 | `messages/ko.json` を **1,159 キー**（en と同数）翻訳。下訳＋人手確認で **2〜4 人日**【推測】。法務文面（約款・特商法・キャンセル規定）は参考訳の注記か専門家確認（★Q7） | 大 |
| コード | `'zh-TW'` を列挙している **54 ファイル・94 か所**のうち、ロケール一覧をハードコードしている箇所（`LocaleSwitcher.svelte:12-19`・`(public)/+layout.svelte:16-19, 48-52` の hreflang・メンテナンス画面 `maintenance.ts`・Stripe の `locale`・日付書式・メールテンプレート `send-booking-mail/templates.ts:17`・管理画面の翻訳欄の言語タブ）を追う。多くは配列に 1 要素足すだけだが、**配列を 1 か所（`lib/locales.ts` 等）に集約するリファクタを先にやる**と 2 言語目以降が楽になる | 中（1〜2 人日） |
| コンテンツ翻訳 | `book.content_translations` に `ko` の行を追加（施設・客室・プランの紹介文）。**DB スキーマ変更は不要**（`locale` 列の値が増えるだけ。★Q8: `locale` に check 制約があるか） | 中（翻訳量次第） |
| メール | 確定・取消メールの `ko` テンプレート（autumn-shared の Edge Function） | 中 |
| FAQ | `book.faqs` の翻訳欄に `ko`（管理画面に言語タブが増える） | 中 |
| 検証 | HANDOFF のチェックリストの「ja/en/zh-TW」を全部 `ko` でも流す | 中（1 人日） |
| HP 連携 | `hp-book-integration.md` の `{lang}` 対応（`/korean/`→`/ko/`）・検索バー `embed/search-bar.js` に ko 文言・FAQ ウィジェットの ko | 小（0.5 人日） |

- **順番**: ① `lib/locales.ts` にロケール一覧を集約するリファクタ（`'zh-TW'` の 54 ファイルを整理・テスト）→ ② `locale` 列の check 制約の確認（★Q8。あれば autumn-shared に migration 1 本）→ ③ `messages/ko.json` 下訳 → ④ 設定・LocaleSwitcher・hreflang・メンテ画面・Stripe・日付書式 → ⑤ content_translations・FAQ の ko 入力 → ⑥ メールテンプレート → ⑦ 人手確認・検証 → ⑧ HP の着地を `/ko/` へ。
- **合計見積り【推測】: 5〜8 人日**（翻訳の人手確認 2〜4・コード 1〜2・コンテンツ入力 1・メール 0.5・検証 1・HP 連携 0.5）。翻訳確認の担当（★Q7）で幅が出る。
- 結論: **韓国語は Book 側が主戦場**（HP の韓国語ページは 1 枚で既にある）。11/30 には入れず、L3 の時期に Book 側を先に進め、できた時点で HP の着地を切り替える。簡体字は作らない（決定）。

### 4.7 男鹿の英語ページの作り方（L2）

- 原本は日本語 `site/{index.html, room/, cuisine/, onsen/, facility/, access/, faq/}`。§4.4 の生成で `site/en/**/index.html` を出す（`postprocess.mjs` の前段）。
- Book の男鹿の英語訳（`content_translations`）と文体を揃える（用語集）。
- 構造化データの `inLanguage`・`og:locale` は生成時に差し替え。`sitemap.php` の固定ページ一覧に `en/` を足す。

---

## 5. 移行案の比較と推奨

### 5.0 3 案の比較

| 案 | 内容 | 良い点 | 悪い点 |
|---|---|---|---|
| **現状維持** | 西和賀 `/english/` 等をそのまま。男鹿は日本語のみ | 作業ゼロ | `<html lang>`・hreflang が無いままで検索・読み上げに不利。男鹿は外国人に何も出せない。Book（多言語）との落差が大きい。「統一」の要望を満たさない |
| **段階移行（推奨）** | L0（11/30 まで・メタと導線だけ）→ L1（西和賀の URL を `/en/` 等に・ヘッダー整備）→ L2（男鹿 `/en/`）→ L3（zh-TW 男鹿・ko の判断） | ローンチを妨げない。各段が独立に戻せる。翻訳の仕組み（§4.4）は L1 で作り L2 で再利用 | 完成まで数か月。途中は西和賀と男鹿の言語数が違う期間がある |
| **全面作り直し** | 両 HP を 1 つの SvelteKit（or Astro）に統合し、Paraglide＋コンテンツ翻訳で Book と同じ i18n に | 最も標準的・長期の保守が最も楽 | 11/30 に間に合わない。両 HP は旧 WP 書き出しの HTML（デザイン・JS が異なる）で、テンプレート化のやり直しは数週間〜。hp-oga の PHP（お知らせ・プレス・問い合わせ）・CSP・Turnstile も作り直し。**切替の直前に HP を大改修するリスク** |

**決定: 段階移行（2026-10-29）。** 最終形（L3 到達時）は「両 HP ともサブディレクトリ方式・7 主要ページ×（ja/en/zh-TW[/ko]）・共通の生成スクリプトと用語集・Book と同じ言語コードと切替 UI」で、全面作り直しと同じ到達点になる。全面作り直しは、将来 HP を Book と同じ基盤（SvelteKit＋Cloudflare）に戻す判断をしたときに改めて（★Q9）。

### 5.1 L0: ローンチ（2026-11-30）に間に合わせる最小案（URL・中身は変えない）

| # | 何を | どこ | 備考 |
|---|---|---|---|
| 1 | 西和賀の言語ページ 3 枚に **`<html lang>`** を付ける（`en`・`zh-TW`・`ko`） | `scripts/build-xserver.mjs` の `page()` に `lang` 引数を足し、`manifest.json` に `"lang": "en"` を持たせる。`src/app.html` の `lang="ja"` を `%lang%` 相当に（SvelteKit の dev でも崩れないよう `lang="ja"` を既定に置換） | 読み上げ・翻訳・検索の基本 |
| 2 | **hreflang 4 本＋x-default** をトップと言語ページ 3 枚に（相互参照）。canonical・`og:url` を絶対 URL に。`og:locale` を付ける | 同上（`manifest.json` に `alternates` を持たせる）。`english.head.html` 等の相対 canonical を直す | トップ⇄3 言語ページの相互参照だけ。他の日本語ページには付けない（対応する言語版が無い） |
| 3 | 言語切替の **`target="_blank"` を外す**。`CH` を `繁體中文`、`KO` を `한국어`、`EN` を `English`、`JP` を `日本語` に | 全 body 断片の `langagelinks`（一括置換） | 標準どおり同一タブ・自言語表記 |
| 4 | 言語ページ 3 枚の**末尾に「Reservation／Member login」の段**（Book の `/en/…`・`/zh-TW/…` へ。韓国語は `/en/…` に「Reservations in English」注記）と、先頭に**日本語トップへ戻るリンクと言語切替** | `english.body.html`・`chinese.body.html`・`korean.body.html` | `hp-book-integration.md` §3.3・§3.6 と同じ作業。韓国語ページの日本語ヘッダーは L1 まで据え置き |
| 5 | `<title>`・`description` を言語ごとに（中国語・韓国語ページの英語 description を直す） | `*.head.html` 3 枚・`manifest.json` の `title` | 小 |
| 6 | 男鹿: **変更なし**（単一言語に hreflang は不要） | — | L2 まで待つ |
| 7 | GA 同意バナーの言語判定（`/english/` 等の URL 判定）はそのまま。L1 で `/en/` に変えるときに正規表現を直す | `src/app.html:58` | — |

- **DB 変更なし・Book 変更なし**。hp-yamado の変更ファイル: `scripts/build-xserver.mjs`・`src/app.html`・`manifest.json`・`*.head.html`×4・`*.body.html`（切替リンクの一括置換＋言語ページ 3 枚）。
- L0 は `hp-book-integration.md` の P1-HP 西和賀と**同じデプロイ**に乗せる（当日 09:00・§4 同書）。

### 5.2 L1: 西和賀の URL と構造を標準化（切替後 1〜2 か月・2026-12〜2027-01）

- `/english/` → **`/en/`**、`/chinese/` → **`/zh-TW/`**、`/korean/` → **`/ko/`** に移し、旧 URL は 301（`build-xserver.mjs:136-146` の Rewrite に 3 行）。sitemap・hreflang・GA 判定を新 URL に。
- 言語ページに**日本語と同じヘッダー・フッター**（ナビは翻訳のあるページだけ）。1 枚ページを**主要 7 ページに分割**（`/en/guestroom/`・`/en/cuisine/`…）。既存の英語・繁体字・韓国語の本文を**原文ブロックと突き合わせて対応表（§4.4）に移す**＝翻訳の仕組みをここで作る。
- 言語切替 UI をドロップダウンに（§4.5）。
- Book の FAQ ウィジェット（`/faq/`）が多言語なら `/en/faq/` に `data-lang="en"` で埋め込む（★Q10: ウィジェットの言語指定の有無）。

### 5.3 L2: 男鹿に `/en/` を新設（2027-01〜02）

- §4.7。生成スクリプトと用語集は L1 のものを流用。7 主要ページ。言語切替 UI・hreflang・`og:locale`・`inLanguage`・`sitemap.php`。
- 「日本語のみのページ」への 302 ＋帯（§4.3）。
- CSP: 変更なし（同一オリジンの HTML が増えるだけ）。

### 5.4 L3: 繁体字（男鹿）・韓国語（2027-02 以降）

- 男鹿 `/zh-TW/`（Book に zh-TW があるので HP だけ作れば途切れない）。
- 韓国語（**決定: Book にも足す**）: §4.6 の順番で **Book の `ko` を先に**（5〜8 人日）→ 西和賀 `/ko/` の着地を `/ko/yamado/…` に切り替え → 男鹿 `/ko/` を生成（L2 の仕組みで 7 ページ）。Book 完成前は西和賀 `/ko/` に「予約は英語」の注記を維持。
- 簡体字: **作らない（決定）**。

---

## 6. 実装の段階・変更ファイルの見込み・DB 変更

| 段階 | 変更ファイル（見込み） | DB |
|---|---|---|
| **L0（hp-yamado）** | `scripts/build-xserver.mjs`（`page()` に lang・alternates・og:locale）／`src/app.html`（`lang` の差し込み）／`src/lib/content/manifest.json`（`lang`・`alternates`）／`english.head.html`・`chinese.head.html`・`korean.head.html`・`top.head.html`（canonical 絶対化・description）／全 `*.body.html`（`langagelinks` の一括置換）／`english.body.html`・`chinese.body.html`・`korean.body.html`（先頭の戻り・切替、末尾の Reservation／Member login）／`HANDOFF.md`（チェックリスト） | なし |
| **L1（hp-yamado）** | 新規 `scripts/i18n-build.mjs`・`i18n/{en,zh-TW,ko}/*.json`・`i18n/glossary.json`／`manifest.json`（`/en/…` 7 ページ×3 言語の項目）／`build-xserver.mjs`（301・sitemap・生成の呼び出し）／`src/app.html`（GA 判定の正規表現）／言語版のヘッダー・フッター部品（日本語 body からの抽出）／既存の `english/chinese/korean.body.html` は対応表へ移して削除 | なし |
| **L2（hp-oga）** | 新規 `tools/i18n-build.mjs`（hp-yamado と同一内容）・`i18n/en/*.json`・`i18n/glossary.json`（共有）／`tools/postprocess.mjs`（lang・hreflang・og:locale・inLanguage・`.htaccess` の 302・言語切替の差し込み）／`site/en/**/index.html`（生成物・コミットする）／`site/sitemap.php`・`site/sitemap.xml`（`en/` の固定ページ）／`site/js/analytics-consent.js`（バナー文言の言語判定）／`HANDOFF.md` | なし |
| **L3（Book に ko を追加・決定）** | `apps/web/project.inlang/settings.json`・`vite.config.ts`・新規 `messages/ko.json`（1,159 キー）・新規 `lib/locales.ts`（一覧の集約）と参照 54 ファイルの整理・`LocaleSwitcher.svelte`・`(public)/+layout.svelte`（hreflang）・`lib/server/maintenance.ts`・`components/payment/StripePayment.svelte`（locale）・`lib/format.ts`・autumn-shared `send-booking-mail/templates.ts`（ko 文面）・管理画面の翻訳欄 | **原則なし**（`content_translations.locale`・`members.locale` は text 列。★Q8 の check 制約があれば autumn-shared に migration 1 本） |

- 実装順: L0（11/29 までに用意・11/30 デプロイ・`hp-book-integration.md` の P1-HP と同じビルド）→ L1 → L2 → L3（Book の `ko` → HP の `/ko/`）。L1 と L2 は生成スクリプトを共有するので直列。Book の `ko` は HP の L1・L2 と並行して進めてよい（別リポ）。
- 2 リポで同一内容にするファイル（`i18n-build.mjs`・`glossary.json`）は、プレス共通部品と同じく「同一内容を両リポに置く」運用（★Q6: 正本の置き場）。

---

## 7. 要確認事項（ユーザーの判断が要るもの）

| # | 確認したいこと | なぜ要るか | 決まるまでの仮置き |
|---|---|---|---|
| Q1 | ~~段階移行でよいか~~ | — | **決定（2026-10-29）: 段階移行。11/30 は L0** |
| Q2 | **主要 7 ページ**（トップ／客室／お料理／温泉・施設／アクセス／FAQ／プライバシー・特商法）の範囲でよいか。四季・周辺観光・ふるさと納税・お知らせは日本語のみでよいか | 翻訳量と保守量 | 7 ページ |
| Q3 | ~~韓国語を Book に足すか~~ | — | **決定: 足す（L3・ローンチ必須外・§4.6 の順番と見積り）** |
| Q4 | ~~簡体字~~ | — | **決定: 作らない** |
| Q5 | **法定表示（特商法・プライバシー・約款）の外国語**: 「参考訳（日本語が正）」の注記で出してよいか、専門家確認を入れるか | L1 の対象ページ | 参考訳の注記 |
| Q6 | 共通ファイル（生成スクリプト・用語集）の**正本の置き場**: 両リポに同一内容を置く（現行のプレス部品と同じ）か、Dropbox `96_Claude/` に正本を置いてコピーするか | 2 リポの版ズレ防止 | 両リポに同一内容＋HANDOFF に「同期する」と明記 |
| Q7 | 翻訳の**人手確認を誰がするか**（社内の英語・中国語話者／外注／LLM 下訳＋社内の読み合わせ） | §4.4 の運用が回るか | LLM 下訳＋社内確認、法務文面だけ外注 |
| Q8 | Book の `book.content_translations.locale`・`book.members.locale` に **check 制約**（`in ('ja','en','zh-TW')`）があるか | `ko` 追加時の migration の有無 | autumn-shared の migration を確認してから（コードからは text 列としか読めない） |
| Q9 | 将来、両 HP を Book と同じ基盤（SvelteKit＋Cloudflare）に戻す構想があるか | 全面作り直しの時期。あるなら L1 の生成スクリプトを**その基盤でも使える形**（HTML in → HTML out の純関数）にしておく | 構想なし・純関数で作る |
| Q10 | Book の FAQ ウィジェット（`faq/widget.js`）に**言語指定**があるか（無ければ `/en/faq/` は Book 側の対応待ち） | L1 の `/en/faq/` | 無い前提・Book 側に `data-lang` を足す（小） |
| Q11 | 西和賀の現行の英語・繁体字・韓国語の**訳文の品質**（そのまま L1 で分割して使ってよいか、作り直すか） | L1 の翻訳量 | そのまま使い、原文と突き合わせて差分だけ直す |
| Q12 | Naver Search Advisor・Google Search Console の**言語別の登録**を誰がやるか | 韓国語・多言語の到達 | ユーザー（Search Console の管理者） |

---

## 8. テストチェックリスト（各リポの HANDOFF.md に転記する）

### L0（西和賀・11/30）
- [ ] `/english/`・`/chinese/`・`/korean/` の `<html lang>` がそれぞれ `en`・`zh-TW`・`ko`。日本語ページは `ja` のまま
- [ ] トップと言語ページ 3 枚の `<head>` に hreflang 4 本＋`x-default`（絶対 URL・相互参照）。他の日本語ページには付いていない
- [ ] canonical・`og:url` が絶対 URL。`og:locale` が言語ごとに正しい
- [ ] 言語切替（JP/EN/KO/CH → 日本語/English/한국어/繁體中文）が**同一タブ**で開く
- [ ] 言語ページ末尾の Reservation が `book.yamado.app/en/yamado/nishiwaga`（韓国語も `/en/`・注記あり）、繁体字は `/zh-TW/`。Member login が `/en/account` 等
- [ ] 言語ページの `<title>`・`description` がその言語
- [ ] Google Search Console の「国際ターゲティング／hreflang」にエラーが出ない（デプロイ後 1 週間）
- [ ] GA の同意バナーが言語ページでその言語で出る（既存の動作が壊れていない）

### L1（西和賀）
- [ ] `/english/`→`/en/`、`/chinese/`→`/zh-TW/`、`/korean/`→`/ko/`、`/zh-tw/`→`/zh-TW/` が 301
- [ ] `/en/`・`/en/guestroom/`… の 7 ページが開き、ヘッダー・フッターが英語で、ナビに日本語のみのページが出ない
- [ ] 言語切替ドロップダウンが同じページの別言語版へ行く。無い言語はトップへ
- [ ] `npm run build:xserver` の標準出力に「未翻訳ブロック」の一覧が出る。対応表に訳を足して再ビルドすると消える
- [ ] 日本語の原本を直してビルドすると、該当ブロックだけ未翻訳一覧に現れ、言語版はそのブロックだけ日本語で出る（壊れない）
- [ ] sitemap に `/en/…` が入り、`/english/` が入っていない
- [ ] `/en/faq/` で FAQ ウィジェットが英語（★Q10）

### L2（男鹿）
- [ ] `/en/`・`/en/room/`… の 7 ページ。`<html lang="en">`・hreflang・`og:locale`・構造化データの `inLanguage`
- [ ] `/en/press/` のような日本語のみのページは `/press/` に 302 し、上部に「Japanese only」の帯
- [ ] `node tools/postprocess.mjs` を 2 回流しても差分なし（冪等）
- [ ] CSP の報告がコンソールに増えていない
- [ ] 「宿泊予約」が `/en/yamado/oga` へ、ドロワーの言語切替が同一タブ

### L3（Book に ko を追加）
- [ ] `/ko/yamado/nishiwaga` が開き、`<html lang="ko">`・hreflang に `ko` が増え、LocaleSwitcher に 한국어 が出る
- [ ] 予約フロー（検索→プラン→ホールド→決済→完了→確定メール）が韓国語で通る
- [ ] メンテナンス画面・取消画面・マイページが韓国語
- [ ] HP の `/ko/` の「ご予約」が `/ko/yamado/…` に変わっている

---

## 9. 設計判断の理由（まとめ）

- **サブディレクトリ＋BCP 47 ＋ hreflang ＋ `<html lang>`**: 検索エンジン・支援技術・ブラウザの翻訳機能が共通に読む「言語の宣言」はこの 4 つ。Book が既にこの形なので、HP を揃えれば「HP → Book」で言語が途切れない。
- **自動リダイレクトはしない**: クローラと利用者の両方から選択の自由を奪う。提案の帯まで。
- **主要ページだけ翻訳**: 全ページ翻訳は現場で回らず、放置された古い訳が残る方が害。翻訳の無いページは切替に出さないことで「無い」ことが分かる。
- **キー管理ではなくブロック対応表**: HP は完成品の HTML で、テンプレート化のやり直しは全面作り直しに等しい。ブロック単位の対応表なら、日本語を直しても言語版が壊れず、未翻訳が一覧で見える。
- **段階移行**: 11/30 の直前に HP を大改修しない。L0 はメタと導線だけで、Book のローンチと同じデプロイに乗る。
- **韓国語は Book を先に、簡体字は作らない**: HP だけ作っても予約の途中で言語が変わる。Book 側の作業（1,159 キー＋コード 54 ファイル＋メール・FAQ・content_translations）が主で、HP は従。簡体字は本土の検索・流入経路の事情から HP に置く価値が薄い。
- **DB 変更なし**: HP は静的。Book に言語を足す場合も列の値が増えるだけ（check 制約が無ければ）。
