# 集客ループ運用ルール（GROWTH.md）

AI が人の指示なしで、autumn-book と連携サイト（hp-yamado・hp-oga）のアクセスデータを巡回し、
「流入の増減を見つける → 原因を分析する → 次の打ち手を考える → 打ち手の効果を測る」を回すときの決まりごと。
**集客ループのクラウドルーティンは、毎回最初にこのファイルを読む。** 規則を変えたいときはここだけ直す。

全体設計は `autumn-shared/docs/loop-engineering.md` の §10。

---

## 現在の段階

```
PHASE = 2
```

| PHASE | ループがやってよいこと |
|---|---|
| 0 | 何もしない（停止中） |
| 1 | データ取得 → 分析 → 週次レポートと「打ち手」の Issue 起票まで。コード・HP・GTM は触らない |
| 2 | `loop:go` の付いた打ち手のうち、book の画面・文言・計測イベントの追加と、HP の low（文言・メタ情報・内部リンク）を PR にする（merge は人。下記「実装役」） |
| 3 | 低リスクの打ち手（文言・メタ情報・内部リンク）は自分で merge。HP 側は PR まで |

段階を上げ下げするのは人（Hikaru）。ループは自分で PHASE を書き換えない。
緊急停止は autumn-book に `loop:pause` の open Issue があるとき（何もせず終わる）。

## 対象

| キー | サイト | GA4 測定ID（プロパティ） | Search Console | GTM |
|---|---|---|---|---|
| book | book.yamado.app（予約エンジン） | G-JFW5QS8QKH（556111214「Autumn Book」） | **未登録**（取得しない） | 直接 gtag |
| hp_yamado | www.yamado.co.jp（西和賀） | G-RN88NPRMNX（558375809） | sc-domain:yamado.co.jp を `https://www.yamado.co.jp/` のページで絞る | GTM-MKFGGV6J（266787355） |
| hp_oga | oga.yamado.co.jp（男鹿） | G-30DJVL8YLG（416414119） | sc-domain:oga.yamado.co.jp | GTM-PZL2T4L8（208438396） |

- GA4 の3プロパティはすべてアカウント「株式会社 山人」（78624539）にある。GTM はアカウント YAMADO（6272932827）。
- Search Console の持ち主：`sc-domain:yamado.co.jp` は yamode＠gmail.com、`sc-domain:oga.yamado.co.jp` は yamado2222＠gmail.com。
  `sc-domain:yamado.co.jp` は oga・corporate など他のサブドメインも含むので、西和賀の数字は必ずページで絞ったものを使う。
- book（yamado.app）は Search Console にまだ登録していない。book の検索流入は GA4 のチャネル（Organic Search）で見る。
- 読み取り用のサービスアカウント：`growth-loop@taskul-498901.iam.gserviceaccount.com`（Google Cloud プロジェクト TASKUL `taskul-498901`）。
  権限は GA4「閲覧者」・GTM「読み取り」（アカウントは「ユーザー」）・Search Console「制限付き」だけ。鍵は `96_Claude/secrets/google-growth-sa.json`。

HP → book は、HP に埋め込んだ検索バー・予約ボタンの `utm_source=hp_*`／`utm_content` で追える（book 側の `utm_source` 別レポート）。

## データの取り方

- `node scripts/growth/google-pull.mjs --days 56 --out /tmp/growth.json`（環境変数 `GOOGLE_SA_KEY_B64`）。
  GA4・Search Console・GTM を **読み取り専用** で取る。失敗したサイト・API は `error` に理由が入る（権限の付け忘れの検出にも使う）。
  2026-11-02 にローカルで全サイト・全 API が `error` なしで通ることを確認済み。
- 予約の実数は本番 Supabase（`opkocyapzmsjzhbwlguh`）の `book` スキーマを **SELECT のみ** で見る（GA4 の purchase と突き合わせて計測漏れを検出するため）。
  宿泊者の氏名・連絡先は取らない（件数・金額・チャネル・施設・日付だけ）。
- 変更履歴は autumn-book の `git log`・release notes、hp-yamado / hp-oga の `git log` を見る（流入の変化と、こちらの変更の時期を結びつけるため）。

## 毎日の健康診断（短く）

次のどれかに当たったら、その日のうちに `kind:bug` で Issue を起票（重複は追記）：

- どれかのサイトの前日セッションが **0**、または直近7日平均の **30% 未満**（タグ切れ・サイト停止の疑い）
- book の `purchase` イベント数が、Supabase の前日の直販予約件数と **2件以上** ずれる（計測漏れ／二重計測）
- GTM の公開バージョンが前回から変わった（誰が何を出したかを日誌に残す。意図しない変更なら Issue）
- HP → book（`utm_source=hp_*`）の流入が前日 **0**（検索バー・ボタンの壊れの疑い）

## 週次分析（月曜朝）

1. **何が増えた／減ったか**：サイトごとに、直近7日 vs 前週・前年同週（364日前）、直近28日 vs その前28日。
   見る軸：チャネル・参照元・ランディングページ・端末・国・検索クエリ（表示回数・CTR・順位）・book のファネル各段の通過率。
   **件数が小さいもの（週50セッション未満）の増減率は話題にしない**（ノイズ）。
2. **なぜか**：季節（紅葉・雪・GW・年末年始）、こちらの変更（デプロイ・HP 更新・GTM 公開）、検索順位の変化、OTA 側の動きのどれで説明できるか。
   説明がつかないものは「不明」と書く。こじつけない。
3. **次の打ち手**：最大3つ。各打ち手に
   - 仮説（何をすると、どの数字が、どれくらい動くと考えるか）
   - 根拠の数字
   - やること（触るリポ・ページ）
   - 測り方（どの指標を何週間見て、成功／失敗を判定するか）
   - リスク区分
4. 前回までの打ち手で、測定期間が終わったものの **判定**（効いた／効かなかった／判断できない）。

出力：
- autumn-book に週次レポート Issue（タイトル「集客レポート YYYY-MM-DD 週」・ラベル `loop` `growth`）
- 打ち手ごとに Issue（ラベル `loop` `growth` `risk:*`。HP の打ち手は hp-yamado / hp-oga 側に起票し、レポートからリンク）
- 各打ち手の判定は、その打ち手の Issue にコメントし、効いた／効かなかったで閉じる

## リスク区分（集客ループ用）

| リスク | 例 | 扱い |
|---|---|---|
| high | `docs/loop/**`（この規則と指示の正本）・GTM の公開・タグ追加削除、GA4 の設定変更、広告出稿・予算、料金・プラン内容、同意バナー（Consent Mode）、HP の FTPS 本番反映 | **提案まで。実行しない** |
| mid | book の画面構成・導線の変更、HP のページ追加・構成変更、新しい計測イベントの追加 | PR まで。merge は人 |
| low | 文言・見出し・meta description・title・alt・内部リンクの追加、構造化データの修正 | PHASE 3 なら book は自分で merge 可（HP は PR まで） |

## 実装役（growth-build・PHASE 2 以上）

毎日 JST 4:30 のルーティン「[集客] autumn-book 実装役 growth-build」が、承認済みの打ち手を PR にする（2026-11-03 Hikaru の指示で追加）。
PHASE が 2 未満、または `loop:pause` の open Issue があれば何もしない。

- **対象**：`growth` ＋ `loop:go` が付いた open Issue で、`loop:needs-human` が付いておらず、まだ PR が無いもの。
  - autumn-book：`risk:low` / `risk:mid`
  - hp-yamado・hp-oga：`risk:low` だけ（文言・見出し・title・meta description・alt・内部リンク・構造化データ）。2026-11-10 Hikaru の指示で追加。
    HP には PR ゲートが無いので、実装役が手元チェック（hp-yamado は `npm run check`・`npm run build:xserver`、hp-oga は `npm run check`）と別エージェントのレビューで代える。
    **PR まで。** merge と本番反映（FTPS・`npm run deploy:xserver`）は PHASE に関係なく人（本番反映は high のまま）。HP の `risk:mid` 以上は従来どおり人が進める。
- **1サイクル1件。** 3リポ合わせてループの open PR（`loop/` ブランチ）が3本以上なら新規に着手しない。
  ただし **`risk:low` は束ねてよい**（2026-11-10 Hikaru の指示）：候補の low は1サイクルで全部やり、同じリポの分は1本の PR にまとめる（リポごとに1本。差分300行は束ね全体で数える）。open PR の上限は mid の新規着手にだけ効かせる。main と衝突しているだけの PR は、版を振り直して全部まとめて直す（本数に数えない）。
- 触らないもの：上の表の high（GTM・GA4 の設定・料金・プラン・同意バナー）、決済・認証・予約確定の処理（`apps/web/src/lib/server/**` の決済・認証まわり）、migration、`.github/workflows/**`、`.env*`。当たると分かったら実装せず `loop:needs-human`。
  計測イベントを足すときはコードの送信部分だけを直し、GA4 側の設定（コンバージョン・カスタム定義）は変えない。
- 差分は300行まで（package.json・テストを除く）。ブランチは `loop/<番号>-<短い英語slug>`。main へ直接 push しない。
- 版上げ：ルートの `package.json` と `apps/web/package.json` の version を同じ値に上げる（文言・修正は PATCH、画面の機能追加は MINOR）。コミットは日本語で末尾に `(vX.Y.Z)`。
- 多言語：画面の文言を足したら `apps/web/messages/` の各言語にも足す（欠けたら PR にそう書く）。
- PR ゲート：`.github/workflows/pr-check.yml`（型検査・テスト・ビルド）が全部緑でなければ merge しない。
- レビューは実装したのと**別のエージェント**が diff と Issue だけを見て行う。観点：打ち手の目的と「測り方」が満たせるか／予約・決済の導線を壊していないか／個人情報／多言語の欠け。直しの往復は2回まで。
- PR 本文には、元の打ち手の Issue（`Refs #<番号>`）と「測り方（どの指標を何週間見るか）」を書く。**`Closes` は使わない**（打ち手の Issue は、週次分析が効いた／効かなかったを判定して閉じる）。
- merge：PHASE 2 は人（承認ボードの「マージ」か GitHub）。HP の PR はいつも人。PHASE 3 では autumn-book の PR のうち、`risk:low` で差分がすべて low、人が付けた `loop:go`、pr-check 緑、レビューで重大な指摘なし、このファイルに `AUTO_MERGE_LOW = off` と書かれていない、をすべて満たすものだけ実装役が squash merge してよい（1回1本まで）。
  merge 後は main の `Deploy to Cloudflare Pages`（ヘルスチェック込み）が success になるのを確かめ、失敗なら revert の PR を出して `loop:needs-human` を付ける。
- merge されたら、打ち手の Issue に「vX.Y.Z で反映しました（測定の起点：反映日）」とコメントする。週次分析はその日を起点に効果を測る。
- 記録：日誌（#1）にコメントで1件残す。

## 指示の正本（ルーティンのプロンプト）

- 各ルーティンの指示は `docs/loop/prompts/` の `growth-daily.md`（健康診断）・`growth-weekly.md`（週次分析）・`growth-build.md`（実装役）が正本。ルーティン本文は「このファイルを読んで `---` より後ろに従う」だけにしてあり、実行のたびに main を読む。
- 指示を変えるのは人。クラウドルーティン台帳の「相談」から開いたセッションで正本を直す PR を作り、人が merge する（merge した次の実行から効く）。
- ループ（発見役・実装役）は `docs/loop/**` を変えない・変える PR を作らない・merge しない。変えたほうがよいと思ったら、日誌に提案として書くだけにする。

## 守ること

- Google 側（GA4・GTM・Search Console）は **読むだけ**。サービスアカウントにも閲覧権限しか付けない。
- 数字を書くときは期間と比較対象を必ず併記する（「+20%」だけで書かない）。
- 個人を特定できる情報（予約者名・メール・予約番号と人の組み合わせ）をレポート・Issue に書かない。
- 打ち手は山人の2施設の集客に直結するものに絞る。「他社でも使える」汎用化の提案はしない（autumn 設計規律）。
- 料金・在庫の判断（値付け・販売停止）は RMS と人の領分。提案は「RMS で検討を」と書くに留める。
- 実装の PR を作るときは各リポの CLAUDE.md（版上げ・release notes・日本語コミット）に従い、main へ直接 push しない。
