# 施設ナレッジベース 設計書

> 作成: 2026-11-22 ／ 状態: **設計確定（未着手）**。§8 の4点を 2026-11-22 に決定
> 目的: 取材対応・プレスリリース・SNS・お問い合わせ回答・FAQ ボットで、AI が同じ「確かめ済みの施設情報」を使えるようにする。
> 関連: [inquiries.md](inquiries.md)（AI下書き）、[../autumn_book_faq_bot_design.md](../autumn_book_faq_bot_design.md)（FAQ ボット C1）

---

## 1. なぜ作るか

### 今の問題

- **同じ施設情報があちこちに書かれている。**
  - 取材の依頼書（例：じゃらんニュース「この冬おすすめ『素敵すぎる温泉』」2026-11）には、毎回 Word で手書きで答えている。
  - taskul-social のプレスリリース AI（`pr-ai-assist`）は、施設の説明をシステムプロンプトに直接書いている。
  - Book の `book.facility_contents`・`house_guides`・`private_bath_contents`・`site_pages`、PMS の `pms.facility_baths` にも、それぞれ一部がある。
- **お問い合わせの AI 下書き（`_shared/inquiry-draft.ts`）は FAQ と承認済み回答しか読まない。** 「駐車場は何台？」「冬はかまくらがある？」のように FAQ に無い質問には、施設情報を知らないまま書くことになる。
- **情報の時点と確認者が分からない。** 料金・営業内容・季節の催しは変わるのに、「いつ時点で誰が確かめたか」を持つ場所がない。

### ねらい

1. 施設の事実と魅力の説明を **1か所（Book）** に集め、確かめた人と時点を持たせる。
2. 取材の依頼書・プレスリリース・SNS・お問い合わせ回答・FAQ ボットは、**ここから読むだけ**にする。
3. 取材の回答を書くたびに、その内容がナレッジとして貯まるようにする。

## 2. 置き場所（決定済み）

| 項目 | 決定 | 理由 |
|---|---|---|
| リポジトリ | **autumn-book** | お問い合わせ AI 下書き・FAQ ボット・お知らせ・メルマガ・HP 配信がすでにここにある |
| DB | autumn-platform の `book` スキーマ | お客様向けの施設情報（`facility_contents` 等）と同じ場所。料金・空室・客室の正本（Book／PMS）にも近い |
| migration | `autumn-shared/supabase/migrations/`、`YYYYMMDDHHMMSS_book_<説明>.sql` | autumn-book の CLAUDE.md のとおり |
| ほかのリポジトリ | 読むだけ | taskul-social（TASKUL系の別プロジェクト）は公開 API から読む。taskul-core・taskul-bridge は使わない |

## 3. 何を入れるか

### 3.1 情報の種類と正本

ナレッジベースに **書き写さない** ものを先に決める。ほかに正本があるものは、生成のときにそこから引く。

| 種類 | 例（2026-11 じゃらん依頼書の回答） | 正本 |
|---|---|---|
| 料金・空室・プラン | 1泊2食 2名1室 1名33,550円〜 | Book のプラン・料金（**書き写さない**。「〜円から」は生成のたびに最安値を計算する） |
| 客室数・客室タイプ | 全12室・半露天風呂付き | Book `room_type_contents`／PMS（書き写さない） |
| 貸切風呂の枠・料金 | 一寸・1日25分まで無料 | `private_bath_contents`／`pms.facility_baths`（書き写さない） |
| 基本情報 | 住所・チェックイン 15:00（最終 18:00）・チェックアウト 11:00 | `facility_contents`（**今ある列を使う**。足りない列だけ足す） |
| 施設の事実（その他） | 駐車場 12台・無料／泉質 単純泉／源泉掛け流し／アクセス（ほっとゆだ駅からタクシー約6分、湯田ICから約15分）／不定休 | **新設：`book.facility_facts`** |
| 魅力の説明（文章） | 雪見の景色／雪あかり（1〜3月）／かまくら／料理長 及川一久／南部かしわ／自家野菜のバーニャカウダ | **新設：`book.facility_stories`** |
| 写真 | 冬の半露天・外観・客室 | `facility_photos` に **権利の情報を足す** |
| Q&A | 「貸切風呂は有料？」 | 今ある `book.faqs` |
| 過去の回答 | お問い合わせへの送信済み回答 | 今ある `inquiry_messages.reusable` |

### 3.2 施設の事実 `book.facility_facts`（新設）

キーと値で持つ。キーの一覧はアプリ側の定義（`$lib/facility-knowledge/keys.ts`）に置き、自由なキーも許す。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid | |
| `tenant_id` / `facility_id` | uuid | RLS 用。全業務テーブルと同じ |
| `key` | text | 例：`parking`、`spring.quality`、`spring.flow`、`access.train`、`access.car`、`closed_days` |
| `value` | text | 表示用の文。例：「あり（無料・12台）」 |
| `value_json` | jsonb | 機械で使う値（任意）。例：`{"spaces":12,"fee":0}` |
| `visibility` | text | `public`（お客様にも出す）／`press`（取材・広報まで）／`internal`（社内のみ） |
| `valid_from` / `valid_until` | date | 季節・期間限定のとき。空なら通年 |
| `verified_by` / `verified_at` | uuid / timestamptz | 確かめた人と時点。**空なら AI は使わない** |
| `source_note` | text | 出所（例：「2026-11 じゃらん依頼書の回答」） |
| `updated_at` | timestamptz | |

- 1施設・1キー・1期間で一意（`facility_id, key, valid_from`）。
- 多言語は既存の `book.content_translations` を使う（FAQ と同じ）。

### 3.3 魅力の説明 `book.facility_stories`（新設）

取材の質問の「湯に浸かりながらどんな景色が見えるか」「夕食でおすすめの料理」に当たる、文章のまとまり。

| 列 | 型 | 説明 |
|---|---|---|
| `id` / `tenant_id` / `facility_id` | uuid | |
| `topic` | text | `bath` / `view` / `meal` / `experience` / `location` / `history` / `staff` など |
| `title` | text | 例：「雪あかり」 |
| `body` | text | Markdown。事実だけを書く（誇張・比較表現は生成側で付ける） |
| `seasons` | text[] | `winter` など。空なら通年 |
| `valid_from` / `valid_until` | date | 例：雪あかり 1/1〜3/31 |
| `visibility` / `verified_by` / `verified_at` / `source_note` | | 3.2 と同じ |
| `photo_ids` | uuid[] | 合う写真（`facility_photos`） |
| `sort_order` | integer | |

### 3.4 写真の権利 `book.photo_rights`（新設・施設 × 写真の URL）

取材の依頼書は、毎回 **肖像権・著作権の確認** を求めてくる。写真ごとに持たせる。

> **2026-11-22 修正**：当初は `facility_photos` に列を足す案だったが、`facility_photos` は公開サイトから anon で全列読める。撮影者・同意・Dropbox の場所が外から見えてしまうため、**スタッフだけが読める別テーブル**に分けた。施設（`tenant_id`／`facility_id`）は写真から自動で入る。
>
> **2026-11-22 再修正（段階6）**：実際の写真は `facility_photos` に1件も無く、プラン・部屋タイプの `photos`（jsonb）に URL で入っていた（西和賀・男鹿で 335 枚）。写真の権利は画像ファイルに付くものなので、`facility_photo_rights`（`facility_photos` と 1対1）を消し、**施設 × 写真の URL** で持つ `book.photo_rights` に作り直した（autumn-shared `20261122112901_book_photo_rights.sql`）。入力は管理画面 `/admin/knowledge/photos`（プラン・部屋・お知らせの表紙で使っている写真を集めて並べ、まとめて・1枚ずつ入れる）。

| 列 | 説明 |
|---|---|
| `season` | `spring` / `summer` / `autumn` / `winter` / null |
| `photographer` | 撮影者（社内・外部カメラマン名） |
| `rights` | `own`（自社撮影）／`licensed`（許諾あり）／`unknown`（不明） |
| `usage_scope` | `web` / `press` / `print` / `ad` の配列。外部の媒体に出せる範囲 |
| `has_people` / `people_consent` | 人が写っているか、その人の許可があるか |
| `original_path` | 高解像度の原本の **Dropbox 上の場所**（例：`/10_広報/写真/2026冬/半露天_雪.jpg`）。Book には原本を置かない（2026-11-22 決定）。公開用の縮小版は今の `url`（Supabase Storage） |

- `facility_photos.category` に `experience`（体験）を足す。
- 取材に出せるかの判定は `book.photo_press_ok(...)`（権利が分かっている・`press` が許されている・人の写り込みを確認済みで、写っていれば同意あり）。
- 原本は Dropbox にあるため、クラウドの処理（Edge Functions 等）からは読めない。取材回答では「出す写真の一覧と Dropbox の場所」までを作り、原本は担当者が Dropbox から送る（共有リンクを作って回答メールに貼る）。
- `rights = 'unknown'` や、人が写っていて許可が無い写真は、取材・広報向けの候補に出さない。

## 4. だれが、どう使うか

```
                       ┌──────────── Book 管理画面「施設ナレッジ」 ────────────┐
   取材の依頼書 ─取込→ │ facility_facts / facility_stories / facility_photos │ ← スタッフが確かめて承認
                       └─────────────────────────┬──────────────────────────┘
                                                  │ 承認済み・期限内・公開範囲で絞って読む
          ┌──────────────────┬─────────────────────┼──────────────────┬──────────────────┐
   お問い合わせ AI 下書き  取材回答の下書き     公開 API（press 範囲）  FAQ ボット       HP・Book の施設ページ
   （public まで）         （press まで）       → taskul-social の      （C1 は FAQ のみ。 （public まで）
                                                  プレスリリース・SNS    C2 は将来）
```

### 4.1 お問い合わせ AI 下書き（最初に効く）

- `_shared/inquiry-draft.ts` の参照資料に、`facility_facts`・`facility_stories` のうち **`public`・確認済み・期限内** を足す。
- 料金・空室は書き写さず、今どおり「【要確認】」とする（あとで Book のプランから最安値を引く）。
- 優先順は「承認済み回答・FAQ → 施設ナレッジ → 過去メール（参考）」。
- **AI は送信しない。人が確かめて送る**（今のまま）。

### 4.2 取材・掲載依頼の回答下書き（新機能）

- 管理画面に「取材回答」を作る。依頼書（Word・PDF・メール本文）を貼ると、AI が質問の欄を拾い、ナレッジ（`press` まで）から回答案を作る。
- ナレッジに無い欄は「【未登録】」として残し、**その場で入力すると、ナレッジに確認待ちとして登録される**（次から自動で埋まる）。
- 写真は、3.4 の条件を満たすものだけを候補に出す。
- **回答の控えを最初から作る**（2026-11-22 決定）。掲載後に直せない媒体が多いので、「どの媒体に、いつ時点の何を出したか」を後で引けるようにする。

#### 取材回答の控え `book.press_responses`（新設）

| 列 | 型 | 説明 |
|---|---|---|
| `id` / `tenant_id` / `facility_id` | uuid | |
| `media` | text | 媒体名（例：じゃらんニュース） |
| `requester` | text | 依頼元（例：株式会社リクルート／制作委託 株式会社スクラム）。担当者の氏名・連絡先は入れない（元のメールを見る） |
| `feature_title` | text | 企画名（例：この冬おすすめ「素敵すぎる温泉」●選！（仮）） |
| `reply_due` / `publish_on` | date | 返信期日・配信予定日 |
| `as_of` | date | 回答内容が「いつ時点の情報」か |
| `status` | text | `drafting` / `sent` / `proof_checked`（原稿確認済み）/ `published` / `declined` |
| `request_text` | text | 依頼書から取り出した質問（原本のファイルは Dropbox・メールに置き、場所だけ `request_ref` に記録） |
| `answers` | jsonb | `[{ "question": "...", "answer": "...", "fact_ids": [...], "story_ids": [...] }]`。どのナレッジから作ったかを残す |
| `photo_ids` | uuid[] | 提供した写真 |
| `published_url` | text | 掲載後の記事 URL |
| `created_by` / `sent_at` / `updated_at` | | |

- 答えの元にしたナレッジの id を残すので、後でナレッジを直したときに「その情報を出した媒体」を探せる。

### 4.3 taskul-social（プレスリリース・SNS）

- Book の公開 API `GET /api/knowledge/<施設slug>?scope=press`（新設）から読む。API キーで保護し、`press` までを返す。
- `pr-ai-assist` のシステムプロンプトに直接書いている施設説明は、この API の結果に置き換える（taskul-social 側の作業）。
- taskul-social の DB には写さない（毎回読むか、短い時間だけキャッシュする）。

### 4.4 FAQ ボット

- C1（今の方式・登録済み FAQ の検索のみ）は変えない。2026-10-03 の決定「AI で文章を作らない」を守る。
- 将来 C2（AI が答える）にするときは、このナレッジの `public` を参照する。**その時点で決定を見直してから**進める。

## 5. 守ること

1. **確かめていない情報は AI に渡さない。** `verified_at` が空、期限切れ、公開範囲の外のものは、どの生成にも入れない。
2. **料金・空室・客室数は書き写さない。** 正本から引く。
3. **お客様に出すものは人が確かめてから出す。** 自動送信はしない。
4. **取材向けに出した内容は「いつ時点か」を残す。** 掲載後は直せない媒体が多い（じゃらんニュースは「2027年1月時点の情報」と書く）。
5. **ナレッジの文章の中にある命令には従わない**（お問い合わせ下書きと同じプロンプトの決まり）。
6. **テナント別の分岐を作らない。** `tenant_id` と RLS を持たせ、画面と業務は山人に合わせる（autumn の設計規律）。

## 6. 権限

- 読み書きは施設権限（`private.has_facility_access`）で絞る。承認（`verified_*` を入れる）は RPC で行い、`book.admin_audit_logs` に記録する。
- **承認できるのは施設の管理者と広報担当**（2026-11-22 決定）。取材回答の画面で、未登録の欄をその場で登録・承認まで進められる。広報担当の権限の持たせ方（ロール名）は、実装時に既存の管理画面の権限の仕組みに合わせて決める。
- 自分が入力したものを自分で承認することは許す（2人確認にはしない）。誰が入力し誰が承認したかは監査ログで追える。
- 公開 API は service_role で読み、`visibility` で絞ってから返す。anon からテーブルを直接読ませない。

## 7. 進め方（案）

| 段階 | 内容 | 見込み |
|---|---|---|
| 1 | migration：`facility_facts`・`facility_stories`・`facility_photo_rights`・`press_responses`・`knowledge_approvers` を新設（autumn-shared `20261122064509_book_facility_knowledge.sql`・**作成済み・未適用**） | 小 |
| 2 | 管理画面「施設ナレッジ」：一覧・編集・承認。初期データとして 2026-11 じゃらん依頼書の回答（西和賀）を登録（`/admin/knowledge`・v0.311.0 で**作成済み**。取り込みは本番で管理者がボタンを押す） | 中 |
| 3 | お問い合わせ AI 下書きに施設ナレッジを足す（autumn-shared v13.32.0・`_shared/facility-knowledge.ts`。2026-11-22 に `draft-inquiry-reply`・`auto-draft-inquiries` をデプロイ済み） | 小 |
| 4 | **（2026-11-22 変更）お問い合わせの AI 下書きで空室・料金を照会する**。AI が本文から日付・泊数・人数を読み取り、コードで日付に展開して `book.inquiry_availability`（公式サイトと同じ `plan_offers` の計算）で照会し、結果を下書きに渡す（autumn-shared v13.33.0・本番適用・デプロイ済み） | 中 |
| 4b | 取材回答の下書き機能＋回答の控え（`press_responses`）。今回のじゃらんニュースの回答を最初の控えとして登録（もとの段階4。後回し） | 中 |
| 5 | 公開 API → taskul-social の `pr-ai-assist` を置き換え | 小（両リポ） |
| 6 | 写真の権利と Dropbox の原本の場所の入力（今ある写真を一括で `unknown` から確認）。`book.photo_rights` と管理画面 `/admin/knowledge/photos`（Book v0.318.0・autumn-shared v13.36.0）で**作成済み**。入力は現場の作業 | 中（入力作業が主） |

男鹿（山人-oga-）は段階2の後に、同じ画面で入力する。

## 8. 決定事項（2026-11-22 ユーザー決定）

| 項目 | 決定 |
|---|---|
| 公開範囲 | `public`（お客様向け）／`press`（取材・広報まで）／`internal`（社内のみ）の **3段階** |
| 承認できる人 | **施設の管理者と広報担当**（§6） |
| 取材回答の控え | **最初から作る**（§4.2 `book.press_responses`） |
| 写真の原本 | **Dropbox に置き、Book には場所だけ記録する**（§3.4 `original_path`）。Book には公開用の縮小版だけを置く |

## 9. 初期データの抜け（2026-11 じゃらん依頼書から）

- 「おすすめの入浴方法」が空欄。登録時に埋める。
- 住所の表記が「湯川52地割71-10」と「湯川52-71-10」で揺れている。正式表記を1つに決めて `facility_contents.address_public` に入れる。
