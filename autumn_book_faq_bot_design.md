# autumn-book FAQ ボット（C1：登録済みFAQの検索）設計書

> 位置づけ: `autumn_book_design.md` §15.1「チャットボット Q&A」の **C1（LLMなし・静的FAQ検索）** を具体化する。
> C2（LLM応答・P9）は本書の対象外。ただし C2 で再利用できるよう、データ（`book.faqs` / 質問ログ）は共通にする。
> 作成: 2026-10-03

---

## 1. 目的と決定事項

各施設HPに入っている他社ボット（男鹿: **talkappi** と **tripla bot**）を、autumn-book の自前FAQに置き換える。

| 項目 | 決定 | 経緯 |
|---|---|---|
| 回答の作り方 | **登録済みFAQの検索のみ**（AIによる文章生成はしない） | 2026-10-03 ユーザー決定（誤回答・捏造を避ける） |
| 初期データ | 現行の talkappi / tripla の Q&A を取り出して初期登録 | 同上（1-A） |
| 進め方 | oga HP の静的化・Xserver 置き換え完了後に着手 | 同上（2-A）。oga 置き換えは 2026-10-03 完了 |
| 未回答の扱い | 検索された質問をすべて記録し、**回答できなかった質問を管理画面で回答 → FAQ に追加**して育てる | ユーザー要望 |
| HP への提供 | autumn-book が配信する **1本の `<script>` タグ** を各HPに貼る | ユーザー要望（「各HPから autumn-book の QA 機能を読み込む」） |
| 他社サービス | **tripla はボットだけ止めて予約エンジンは継続、talkappi は解約** | 2026-10-03 ユーザー決定 |
| 未回答時の誘導 | **電話とお問い合わせフォーム** | 同上 |
| 導入範囲 | **oga と西和賀を同時期に導入**。西和賀の既存 `/faq/` ページの内容も初期データに含める | 同上 |
| 多言語 | **英語・繁体字も i18n で対応**（`content_translations` を使い、ウィジェットは表示言語で切替） | 同上 |

### スコープ外（今は作らない）
- LLM による回答生成・要約（C2 / P9）
- 有人チャットへの引き継ぎ（未回答時は電話・問い合わせフォームへ誘導するだけ）
- 空室照会・予約操作（予約は既存の予約導線へリンクするだけ）
- 翻訳の自動生成（英語・繁体字の訳文は管理画面で登録する。既存の FAQ 翻訳タブを本番接続して使う）

---

## 2. 全体構成

```
[施設HP]  oga.yamado.co.jp（Xserver 静的） / www・nishiwaga.yamado.co.jp（hp-yamado）
   │  <script src="https://book.yamado.app/faq/widget.js" data-facility="oga" defer>
   ▼
[ウィジェット]  widget.js（依存なしの素の JS・Shadow DOM で HP の CSS と干渉しない）
   │  fetch（CORS 許可済みのオリジンのみ）
   ▼
[autumn-book]  SvelteKit サーバールート（Cloudflare Pages: booking.yamado.co.jp）
   │  GET  /api/faq/{facility}            … 公開FAQ一覧（カテゴリ別・初期表示用）
   │  POST /api/faq/{facility}/search     … 検索（サーバー側でスコアリング）＋質問ログ記録
   │  POST /api/faq/{facility}/feedback   … 「解決した／しなかった」・候補クリック
   ▼
[Supabase autumn-platform]  book.faqs（既存＋列追加） / book.faq_queries（新規）
   ▲
[管理画面]  /admin/faqs（本番接続化）＋「未回答の質問」タブ（新規）
```

設計判断:
- **検索はサーバー（TypeScript）で行う**。1施設の公開FAQは多くて数百件なので、全件を読み込んでスコアリングしても十分速い。
  日本語は pg_trgm（3文字単位）との相性が悪く、`pgroonga` は Supabase で使えないため、DB 側の全文検索に頼らない。
  FAQ 一覧はリクエストごとに DB から読まず、5分間メモリにキャッシュする（Workers のアイソレート内）。
- **質問ログの書き込みは SECURITY DEFINER の RPC 経由**（anon にテーブルの直接 INSERT 権限を与えない）。既存 book の RPC 方式に合わせる。
- 既存の施設HP（autumn-book 内の `FaqSection`）も同じ API・同じデータを使う。

---

## 3. データモデル（autumn-shared の migration、`book` スキーマ内で完結）

### 3.1 `book.faqs`（既存）への列追加

| 列 | 型 | 用途 |
|---|---|---|
| `keywords` | `text[] not null default '{}'` | 言い換え・別表現（例: 「チェックイン」に「何時から入れる」「到着時間」）。検索の当たりを良くする。未回答の質問を既存FAQに紐付けると、その質問文がここに追加される |
| `source` | `text not null default 'manual'` | `manual` / `seed_talkappi` / `seed_tripla` / `from_query`（未回答から作成） |
| `view_count` | `integer not null default 0` | 回答として表示・クリックされた回数（並び順や改善の目安） |

既存の RLS（`faqs_public_read`：公開分は anon 読み取り可／`faqs_staff_all`：施設アクセス権で編集可）はそのまま使う。

### 3.2 `book.faq_queries`（新規）— 検索された質問のログ

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` / `facility_id` | uuid | |
| `query` | text（最大200文字） | 入力された質問（原文） |
| `normalized` | text | 正規化後（全角半角・ひらがなカタカナ・空白・記号を統一）。管理画面で同じ質問をまとめる鍵 |
| `top_faq_id` | uuid null | 最も一致したFAQ |
| `top_score` | numeric(4,3) | 一致度（0〜1） |
| `answered` | boolean | しきい値以上の候補を返せたか |
| `clicked_faq_id` | uuid null | 利用者が開いた候補 |
| `helpful` | boolean null | 「解決した／しなかった」 |
| `status` | text | `open`（未対応） / `resolved`（FAQ を作成・紐付け済み） / `ignored`（対象外） |
| `resolved_faq_id` | uuid null | 対応で作成・紐付けたFAQ |
| `locale` | text | `ja` など |
| `page_path` | text null | 質問されたページのパス（どのページで迷っているかの分析用） |
| `created_at` | timestamptz | |

- **個人情報**: IP アドレスや Cookie ID は保存しない。質問文に個人情報（電話番号・メールアドレス）が含まれた場合は、記録前にマスクする（`***`）。
- **保持期間**: 1年。`resolved` / `ignored` で1年を過ぎたものは定期削除（既存の cron に相乗り）。
- **RLS**: anon / authenticated からの直接の読み書きは不可。スタッフは施設アクセス権で SELECT / UPDATE 可（`status` 等の更新）。

### 3.3 RPC（SECURITY DEFINER・anon 実行可）

| 関数 | 役割 |
|---|---|
| `book.faq_log_query(p_facility_id, p_query, p_normalized, p_top_faq_id, p_top_score, p_answered, p_locale, p_page_path) returns uuid` | 質問ログを1件記録して id を返す。文字数・施設の存在・公開状態を関数内で検証 |
| `book.faq_feedback(p_query_id, p_clicked_faq_id, p_helpful) returns void` | クリック・評価を記録。同じ質問への評価は1回だけ（2回目以降は無視）。クリック時に `faqs.view_count` を加算 |

`p_query_id` は推測できない uuid なので、他人のログを書き換えられない（評価の上書きも不可）。

---

## 4. 検索の仕組み（サーバー側）

1. **正規化**: NFKC（全角英数→半角）、カタカナ→ひらがな、小文字化、空白・記号の除去、よくある表記ゆれの辞書（「チェックイン/チェックイン時間/入室」「駐車場/パーキング」「Wi-Fi/wifi/ワイファイ」など、施設共通の小さな辞書をコードに持つ）。
2. **スコア**: FAQ ごとに次を合成して 0〜1 に正規化。
   - 質問文と FAQ の `question` の **文字2-gram の一致率**（日本語の言い換えに強い）
   - `keywords` のいずれかとの2-gram一致率（最大値）
   - 回答本文への部分一致（弱めの加点）
   - カテゴリ名の一致（弱めの加点）
3. **結果**: 上位3件を返す。最上位のスコアが **0.35 以上** なら「回答あり」、未満なら「回答なし」として記録する。
   しきい値は運用しながら調整できるよう、施設設定（`AB_CONFIG` KV）に置く。
4. 回答本文は Markdown 原文で保存し、サーバーで既存の `renderMarkdown`（生 HTML 不許可）を通して返す。

---

## 5. 公開 API（autumn-book の SvelteKit サーバールート）

| メソッド・パス | 入力 | 出力 |
|---|---|---|
| `GET /api/faq/{facility}` | `?locale=ja` | `{ categories: [{ name, items: [{ id, question }] }], popular: [...] }`（回答本文は含めない・軽量） |
| `GET /api/faq/{facility}/{id}` | | `{ id, question, answerHtml, category }`（一覧から開いたとき） |
| `POST /api/faq/{facility}/search` | `{ q, locale, page }` | `{ queryId, answered, results: [{ id, question, answerHtml, score }] }` |
| `POST /api/faq/{facility}/feedback` | `{ queryId, faqId?, helpful? }` | `{ ok: true }` |

- `{facility}` は短い識別子（`oga` / `nishiwaga`）。サーバー側で施設 uuid に変換する（既存の `FACILITY_UUID` に追加）。
- **CORS**: 施設ごとの許可オリジンだけに `Access-Control-Allow-Origin` を返す。
  - oga: `https://oga.yamado.co.jp`
  - nishiwaga: `https://www.yamado.co.jp` / `https://nishiwaga.yamado.co.jp`
  - 共通: `https://book.yamado.app`（autumn-book 自身の施設HP）
- **レート制限**: 既存の KV（`AB_CONFIG` とは別に `FAQ_RATE` を作る）で IP あたり 10分30回（検索）。超過時 429。
- **キャッシュ**: 一覧と個別回答は `Cache-Control: public, max-age=300`。検索・評価は `no-store`。
- **Bot 対策**: 書き込みは質問ログだけで、メール送信などの副作用が無いため Turnstile は使わない（レート制限と入力長の制限で十分）。

---

## 6. ウィジェット（`/faq/widget.js`）

### 6.1 埋め込み

```html
<!-- 画面右下の「よくある質問」ボタン（talkappi の吹き出しと置き換え） -->
<script src="https://book.yamado.app/faq/widget.js" data-facility="oga" defer></script>

<!-- FAQ ページなどにページ内で一覧表示したい場合（任意） -->
<div data-autumn-faq="oga" data-mode="inline"></div>
```

### 6.2 画面（スマホ優先）
1. 右下の丸ボタン（既存 talkappi と同じ位置・同程度の大きさ）。初回だけ「ご質問はこちら」の吹き出し（閉じたら24時間出さない・`localStorage`）。
2. パネルを開くと:
   - 検索欄（「例: チェックインは何時から？」）
   - カテゴリ別のよくある質問（アコーディオン）
3. 検索すると上位3件を表示 → 開くと回答 → 「解決しましたか？ はい／いいえ」。
4. 「回答が見つからない」「いいえ」のとき: 電話番号（タップで発信）と問い合わせフォームへのリンクを表示。
   文言「いただいたご質問は今後の回答の参考にいたします」。

### 6.3 実装方針
- 依存ライブラリなし・1ファイル（目標 15KB 以下）。**Shadow DOM** で HP 側の CSS と相互に干渉しない。
- 配色・フォントは `data-theme` で施設ごとに指定（oga: 生成り＋墨、yamado: 既存HPの色）。既定は白基調。
- アクセシビリティ: ボタン・パネルに `aria-*`、Esc で閉じる、フォーカス管理。
- 計測: GA4 があれば `faq_open` / `faq_search` / `faq_answer_click` / `faq_unanswered` を `dataLayer` に送る（HP 側に GTM がある前提・無ければ何もしない）。
- **キャッシュ対策**: `widget.js` は短いキャッシュ（5分）にし、本体ロジックは内容ハッシュ付きの別ファイルを読み込む（Xserver の nginx が同一URLを古いまま返す問題を2026-10-03 に確認済み）。

---

## 7. 管理画面（`/admin/faqs`）

現状の `/admin/faqs` はデモストアにしか繋がっていない（`demoOnly`）。お知らせ管理（`/admin/news`）と同じ方式で本番接続する。

### 7.1 「FAQ」タブ（既存の改修）
- 一覧（カテゴリ・公開状態・表示回数・出所で絞り込み）、並べ替え
- 編集: 質問 / 回答（Markdown・プレビュー）/ カテゴリ / **言い換え（keywords）** / 公開
- 「この質問で検索テスト」: その場で検索結果とスコアを確認できる（しきい値の調整用）

### 7.2 「未回答の質問」タブ（新規）
- `answered = false` または `helpful = false` の質問を、**正規化文字列でまとめて件数の多い順**に表示（最終日時・質問されたページ付き）。
- 各行の操作:
  - **回答を作成** … 質問文を入れた新規FAQの編集画面を開く。保存すると、まとめた質問すべてを `resolved`・`resolved_faq_id` に更新（`source = from_query`）
  - **既存FAQに紐付け** … FAQ を選ぶと、その質問文を `keywords` に追加して `resolved` にする（次回から当たるようになる）
  - **対象外** … 意味のない入力・いたずら等を `ignored` に
- 画面上部に直近30日の指標: 質問数 / 回答率 / 「解決した」率 / 未対応件数

### 7.3 権限
- 閲覧・編集とも、その施設のアクセス権を持つスタッフ（既存 RLS の `has_facility_access`）。

---

## 8. 初期データの移行（現行ボットからの取り出し）

| 取り出し元 | 方法（優先順） | 備考 |
|---|---|---|
| talkappi（`oga-yamado-hp`） | ① talkappi の管理画面から FAQ を CSV 等で書き出し ② できなければ、ウィジェットの公開 FAQ を画面から収集 | 管理画面のログイン情報が必要 |
| tripla bot（hotel_id 6608） | ① tripla 管理画面の Q&A 書き出し ② できなければ、ボットの定型メニューを画面から収集 | tripla は AI 応答も混在するため、**定型の Q&A だけ**を対象にする |

- 取り込みは `source = seed_talkappi / seed_tripla`、**`is_published = false`（下書き）** で登録し、管理画面で内容確認 → 公開する。
- 両方に同じ質問がある場合は、内容が新しい方を残す（取り込みスクリプトで重複候補を一覧化）。
- 回答中の古い情報（料金・営業時間など）は、公開前に施設側で確認する。

---

## 9. 施設HPへの組み込み

### 9.1 oga（Xserver 静的サイト）
- `site/` の全ページの talkappi スクリプトを削除し、`widget.js` を追加（hp-oga の `tools/postprocess.mjs` で一括）。
- `.htaccess` の CSP に `booking.yamado.co.jp`（script-src / connect-src）を追加し、talkappi を外す。
- ⚠ **tripla の SDK（`tripla.min.js`）は外さない**。予約の検索バー（SearchBar）も同じ SDK から読まれているため。
  tripla の**ボット部分だけ**を止める方法（`data-triplabot-code` 属性の削除で済むか、tripla 管理画面でボットを無効化するか）を、着手時に検証する。

### 9.2 西和賀（hp-yamado・SvelteKit）
- `src/app.html` に `widget.js` を1行追加。CSP を設定していれば同様に許可を追加。
- 現状（2026-10-03 確認）: **tripla の予約ウィジェット＋tripla ボット**を使用（`data-triplabot-code`）。talkappi は無し。
  oga と同じく、予約ウィジェットは残してボット部分だけを止める。
- 既存の静的な `/faq/` ページ（旧WPから移植）は、ウィジェットのページ内表示（`data-mode="inline"`）に置き換えると、FAQ の管理が1か所にまとまる。

---

## 10. 実装の順序

| 段階 | 内容 | 完了条件 |
|---|---|---|
| 1 | migration（`faqs` 列追加・`faq_queries`・RPC 2本・RLS） | `migration list --linked` で適用確認 |
| 2 | 公開 API 4本 ＋ 検索ロジック ＋ CORS・レート制限 | ローカルで検索・記録・評価が動く |
| 3 | 管理画面（FAQ タブ本番接続・未回答タブ） | 未回答の質問から FAQ を作成できる |
| 4 | 現行ボットからの取り出しと下書き登録 → 施設側で確認・公開 | 公開FAQが揃う |
| 5 | `widget.js` ＋ oga への組み込み（talkappi 撤去、tripla ボットの停止方法を検証） | oga 本番で動作・旧ボット非表示 |
| 6 | 西和賀への組み込み | |

---

## 11. 未決事項

1. talkappi / tripla の**管理画面のログイン情報**（書き出しができるか）。未回答のため、当面は**画面からの収集**で進める。書き出しができれば差し替える。

### 決定済み（2026-10-03）
- tripla はボットのみ停止・予約エンジン継続、talkappi は解約
- 未回答時は電話（oga 0185-47-7776 / 西和賀 0197-82-2222）とお問い合わせフォームへ誘導
- oga と西和賀を同時期に導入。西和賀の既存 `/faq/` も初期データに含める
- 英語・繁体字は i18n（`content_translations`、entity_type=`faq`）で対応。ウィジェットは `data-locale` または HP の `<html lang>` で言語を決め、訳が無い項目は日本語で表示

### 多言語の扱い（追記）
- 検索はその言語の質問文・言い換えに対して行う（英語なら単語単位、日本語・繁体字は文字2-gram）。
- `content_translations` の `fields` に `question` / `answer` / `category` / `keywords` を持たせる。
- 質問ログの `locale` で言語別の未回答を管理画面で絞り込めるようにする。

---

## 12. テストチェックリスト（HANDOFF.md に転記して使う）

### FAQ ボット（ウィジェット）
- [ ] oga の各ページ右下にボタンが出て、開閉できる（PC・iPhone・Android）
- [ ] カテゴリ別の一覧が開き、回答が表示される
- [ ] 「チェックインは何時から」「駐車場ある？」など言い換えでも正しい FAQ が上位に出る
- [ ] 回答が無い質問で、電話・フォームへの案内が出る
- [ ] 「解決した／しなかった」が記録される
- [ ] HP 側のデザイン（フォント・ボタン）が崩れない（Shadow DOM）
- [ ] 許可していないドメインに貼っても動かない（CORS）
- [ ] 短時間に大量に検索すると 429 になる

### 管理画面
- [ ] FAQ の追加・編集・言い換えの追加・公開／非公開ができる
- [ ] 未回答の質問が件数順にまとまって表示される
- [ ] 「回答を作成」で作った FAQ が、次回の同じ質問で当たる
- [ ] 「既存FAQに紐付け」で、その質問文が言い換えに追加される
- [ ] 「対象外」にした質問が一覧から消える
- [ ] 他施設のスタッフには表示されない（RLS）
