# GA4 とページ別 A/B テスト

## GA4 を有効にする

Google Analytics の GA4 ウェブデータストリームを作成し、`G-` で始まる測定 ID を取得する。`apps/web/wrangler.jsonc` の `PUBLIC_GA4_MEASUREMENT_ID` に設定してデプロイする。測定 ID は公開値。空欄なら Google タグと同意バナーは表示・送信されない。

公開ページで「同意する」を選んだ場合だけ Google タグを読み込み、`page_view` と既存の予約ファネルイベントを送る。管理画面、滞在者・取引先専用ページは対象外。ページ URL から検索パラメータと予約コードを除外する。

GA4 の管理画面では、A/B テストの比較に使うイベントスコープのカスタムディメンションとして `experiment_id`、`experiment_variant`、`experiment_revision` を登録する。`experiment_exposure` が表示数、予約完了の `purchase` が成果イベントになる。GA4 自体に振り分け機能はないため、このアプリが振り分けを担当する。

## ページのテストを追加する

1. `apps/web/src/lib/experiments.ts` の `experiments` に ID、改訂番号、ページパターン、配分を追加する。`:brand` のようなセグメントは任意の1階層に一致する。`/en` と `/zh-TW` は自動で同じページとして扱う。
2. 対象ページの Svelte コンポーネントで `experimentVariant(page.data.abExperiments, 'ID')` を読み、`a` と `b` の表示を実装する。A は既存表示にする。
3. 表示・リンク・予約動線を確認してから `enabled: true` にする。`trafficPercent` でテスト対象の割合、各 `weight` で対象内の配分を決める。
4. 内容や配分を変えて別のテストとして集計したいときは `revision` を上げる。同じ訪問者の割当は匿名のファーストパーティ Cookie で固定される。

施設の客室・プラン一覧には、見出し文言を切り替える無効状態のサンプルがある。ローカル開発または管理者ログイン中は `?ab_preview=facility-plans-heading:b` で B を確認できる。プレビューは GA4 の露出数に含めない。

GA4 に同意した利用者のページ表示に `experiment_assignments` を付け、初回露出時に `experiment_exposure` を送る。同意前、拒否後、GA4 測定 ID 未設定時は送らない。
