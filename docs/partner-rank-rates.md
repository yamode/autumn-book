# 取引先ランク暦・料金の幅の復活・料金表（CSV / PDF）設計

> 2026-10-09 決定。DB は autumn-shared `20261009131518_rms_partner_rank_calendar`（**PROD 適用済み**）。

## 1. ユーザーの指示と決定

- 取引先ページのトップ（料金カレンダー）にあった「最低〜最高料金」の表示が v0.77.0（一休型の部屋カード一覧に作り替えたとき）で消えた → **復活する**
- RMS で、取引先ごとのプラン料金を、ほか（TL リンカーン連動）から独立させて設定したい
  - 決め方: **リンカーンと同じく、ベースのプラン料金に日別にランクを当てる**
  - ベース料金とランク差額: **RMS の式をそのまま使う**（室料×人数＋ランク差額＋食事＋プラン調整）。取引先ごとに違うのは**日別のランクだけ**
  - ランク暦: **取引先ごとに 1 つ**（取引先 × 施設）。曜日の既定で埋める・別の取引先からコピーで入力を減らす
  - 既存の特別レート（％・円・固定単価・端数・最低/最高）は、**取引先ランク暦で出した料金に対して当てる**（Book の `pricing` の仕組みはそのまま）
  - 設定画面は **RMS（autumn-rms）に作る**
- 料金表を取引先ページから **CSV** と **見やすいカレンダー形式の PDF** で出力する
  - PDF の紙面: **月カレンダー（各日を料金区分の色で塗る）＋区分ごとの料金表**

## 2. 料金の決まり方

```
取引先ランク暦が有効（rms_partner_rank_settings.enabled = true）な取引先 × 施設:
  ランク = rms_partner_rank_days(partner, facility, date).rank_code
  行が無い日・'不可' → 売らない（その日の料金は出ない）
  1名あたり料金 = book._theory_pp(室料表, 人数, 定員, ランク差額, プラン式)   ← book.sync_rms_rates_range と同じ式
それ以外（既定）:
  従来どおり booking.daily_rates（TL のランク由来の理論値）

↓ どちらの場合も
Book の特別レート（rms_partner_facilities.pricing のルール → 端数 → 最高 → 最低）
```

- 2026-10-09 に PROD で照合: TL のランクを当てて取引先ランク暦の計算を再現すると、今後 60 日の `booking.daily_rates` 12,383 行と全件一致（同じ式であることの確認）。
- ランクは施設の有効なランクセット（`rms_rate_rank_sets.is_active` → `rms_rate_rank_prices.rank_code / rank_delta`・現状 A〜Z）。
- プラン × 客室の組合せは `book.rms_plan_room_map`（TL キャッシュ由来の構造情報）。料金そのものは TL に依存しない。

## 3. DB（適用済み）

| 対象 | 内容 |
|---|---|
| `public.rms_partner_rank_settings` | PK (partner_id, facility_id)・FK → `rms_partner_facilities` cascade。`enabled`（料金の元の切替）・`weekday_ranks` jsonb（入力補助 `{"0".."6", "7"=祝日, "8"=祝前日}`・料金計算には使わない）・`note`・`updated_by` |
| `public.rms_partner_rank_days` | PK (partner_id, facility_id, stay_date)・`rank_code`（ランクコード or `'不可'`）・`updated_by / updated_at` |
| `public.rms_partner_portal_source(p_facility, p_from, p_to, p_partner uuid default null)` | 旧 3 引数版を置換。`p_partner` の取引先ランク暦が有効なら §2 の計算。返り値に `priceSource: 'partner_rank' \| 'standard'` を追加。それ以外の形は従来どおり |

- どれも **service_role だけ**（authenticated からは見えない）。RMS は `guardCapability` ＋ `guardFacility` で確かめてから service_role で読み書きする（`rms_partners` 移設時と同じ流儀）。

## 4. RMS（autumn-rms）: 取引先料金の画面

### 4.1 ルート・権限・ナビ
- `/partner-rates`（一覧）・`/partner-rates/[partnerId]`（取引先の暦）。施設は他の画面と同じ `?facility=`
- 権限 `partner-rates`（`view` / `edit`）を `PAGE_CAPABILITIES` に追加。書き込みの action は `guardCapability(event, 'partner-rates:edit')` ＋ `guardFacility`
- ナビ（`RmsShell.svelte`）に「取引先料金」を「料金カレンダー」の後ろに追加。既存の「取引先（Book）」はそのまま

### 4.2 一覧 `/partner-rates`
- 選んでいる施設に `rms_partner_facilities` の行がある取引先（`rms_partners.name`・`is_active`・`valid_from/until`・`enabled`=施設オン/オフ）
- 列: 取引先名 / 施設の販売（オン・オフ）/ 取引先ランク暦（使う・使わない）/ 入力済みの最終日 / **公開範囲の未設定日数**（今日〜min(今日＋`max_days_ahead`, `valid_until`) のうち行が無い日。使う取引先で 1 日以上なら赤字の警告）
- 行を押すと詳細へ

### 4.3 詳細 `/partner-rates/[partnerId]`
- 見出し: 取引先名・施設・Book の取引先管理への外部リンク（RMS の既存の転送先オリジン `/admin/partners/<id>`）
- **料金の元の切替**: 「取引先ランク暦を使う」チェック（保存は `rms_partner_rank_settings` upsert）。オンにするとき公開範囲に未設定日があれば確認ダイアログ（「未設定の N 日は取引先ページで販売されません」）
- **曜日の既定**: 日〜土・祝日・祝前日の 9 つにランクを選ぶ（空欄可）。保存は `weekday_ranks`
- **ランク暦（月カレンダー）**: `/rate-calendar` と同じ見た目の月グリッド（前後の月へ移動・2か月並べて表示で可）
  - 各日: 取引先のランク（ランクの色 `rms_rate_rank_prices.color`）・参考として TL のランク（`rms_tl_lincoln_rate_cache.day_rank` を小さく灰色）・休館日の印
  - 塗り: パレットでランク（A〜Z・不可・消去）を選び、日を押す／ドラッグ／Shift＋クリックで範囲を塗る。保存前は変更した日を枠で強調し「未保存 N 日」を出す。離脱時に確認
  - 「期間を曜日の既定で埋める」: 期間（開始〜終了）・「空いている日だけ／上書き」。**翌日が祝日の日**を祝前日とする（土曜は曜日の「土」のまま扱わず、祝前日の既定があればそちらを優先）。優先順は 祝前日＞祝日＞曜日。祝日は RMS の `lib/holidays.ts`
  - 「別の取引先からコピー」: 同じ施設の取引先・期間を選び、その期間の暦を写す（上書き）
  - 「TL のランクを写す」: 期間を選び、TL のランク（`day_rank`）をそのまま入れる（はじめに合わせてから調整する用途）
- **料金の確認**（任意の補助）: プラン・部屋・人数を選ぶと、表示中の月の各日に「基準料金（1名1泊・税込・入湯税別・特別レート前）」を出す。計算は RMS の `lib/pricing.ts` の式で、DB の `book._theory_pp` と同じ結果になること（§2 の照合を参照）。特別レートは Book で当たる旨を注記
- 保存: form action `save`（JSON payload を formData に・`parsePricingPayload` と同じ流儀）。`days: [{date, rank|null}]`（null は削除）・`settings`。ランクコードは施設の有効なランクセットにあるもの or `'不可'` だけ受ける。日付は今日−31日〜今日＋730日。1 回 3,000 日まで。`updated_by` = ログインユーザー
- 取引先が施設オフ（`enabled=false`）でも暦は編集できる（オンにしたとき使われる）

### 4.4 バージョン
- RMS の MINOR を上げ、RMS の HANDOFF.md に節とテストチェックリストを追加（release-notes があれば追記）

## 5. Book（autumn-book）

### 5.1 料金の取り出し（`lib/server/partners/rates.ts`）
- `rms_partner_portal_source` に `p_partner: partner.id` を渡す。元データのキャッシュキーに取引先 id を含める（取引先ランク暦の取引先は他と共有できないため。共有を残すなら `priceSource` が standard の取引先だけ施設キーにまとめてよいが、まずは取引先ごとで十分）。`BASE_MAX_ENTRIES` は取引先数に合わせて見直す
- `PartnerRatesResult` に `priceSource` を足す（管理画面の表示用）

### 5.2 料金の幅の復活（取引先ページのトップ）
- `/p/[token]/calendar/range`（GET・JSON）を戻す。中身は v0.77.0 で消した版（`git show ee3bd93^:apps/web/src/routes/p/[token]/calendar/range/+server.ts`）を、選んでいる施設（複数施設化後の `requirePortalApi` が返す施設の文脈）で動くように。キャッシュキーに施設 id を含める
- 表示: `/p/[token]/calendar/+page.svelte` の検索バーの上（`PartnerStaySearch` の前）に、旧版のカード（「公開期間の料金（1名1泊・税込・入湯税別）最低〜最高（期間）」＋根拠のツールチップ〔日付・部屋・プラン（取引先向けの名前）・人数・同額件数〕・あとから読み込み・取れなければ出さない）を戻す。旧版は `git show ee3bd93^:apps/web/src/routes/p/[token]/calendar/+page.svelte` の 121〜170 行・346〜400 行あたり。部品に切り出す（`PartnerPriceRange.svelte`）
- カードの右に「料金表をダウンロード」ボタン（§5.3 へ）
- オンの施設が無い取引先（`noFacilityMessage`）では出さない

### 5.3 料金表（CSV / PDF）
- 画面 `/p/[token]/rate-sheet`（ナビのメニューにも「料金表」）。確認モード（スタッフの「確認ページを開く」）でも使える
  - 入力: 開始月（既定は今月）・月数（1〜12・既定 3）・人数（複数選択・1〜施設の最大・既定 2）・形式（CSV / PDF）
  - 公開範囲（`clampPartnerRange` と同じ規則）の外は出さない（範囲外の月は「公開範囲外」）
- 共通の組み立て（純関数 `lib/partner-rate-sheet.ts` ＋ テスト）
  - 入力: 期間の `PartnerRateDay[]`（`loadPartnerRates` を 31 日ずつ）・部屋名・取引先向けのプラン名（`partnerPlanName`）
  - **料金区分**: 日ごとに「出ている全組合せ（部屋 × プラン × 人数 → 1名料金）」の署名を作り、同じ署名の日を 1 つの区分にまとめる（取引先ランク暦ならほぼランクと一致・特別レートの曜日/期間ルールで分かれた日は別の区分になる）。区分は平均料金の安い順に「区分A, B, C…」。休館・料金の無い日は区分なし
  - 区分の色は固定 12 色（淡い色・印刷で区別できる）。13 以上は色を繰り返し、文字で区別
- **CSV**（`/p/[token]/rate-sheet/csv?from=YYYY-MM&months=N`）
  - UTF-8 BOM・CRLF。列: `日付,曜日,料金区分,施設,部屋タイプ,プラン,食事,人数,1名料金（税込・入湯税別）,1室合計（税込・入湯税別）`。人数は全人数（選択に依らない）
  - ファイル名 `料金表_<施設名>_<YYYYMM>-<YYYYMM>.csv`（`Content-Disposition` は RFC 5987 の `filename*`）
- **PDF**（`/p/[token]/rate-sheet/pdf?from=…&months=…&guests=2,3`）
  - 紙面は HTML（1 ファイル完結・CSS インライン・Noto Sans JP）を Cloudflare Browser Rendering で PDF 化（`invoice-pdf.ts` と同じ REST・同じ環境変数・429 の待ち直し）。失敗・未設定なら印刷用 HTML（`/p/[token]/rate-sheet/print?…`・開くと印刷ダイアログ）へ切り替え
  - A4 縦（2026-10-09 にユーザー指示で横から変更）。表紙は無し。各ページ上部に「<取引先名> 様 専用料金表 / <施設名> / 期間 / 発行日」と注記（1名1泊・税込・入湯税別／残室により予約できない日があります／発行日時点の料金です）
  - **月カレンダー**: 1 ページに 2 か月（上下）＋区分の凡例（区分ごとの1名料金の最安〜最高）。各日のマスに日付と区分の文字、区分の色で塗る。休館は「休館」、料金の無い日は灰色。日曜・祝日は赤、土曜は青
  - **区分ごとの料金表**: 選んだ人数ごとに 1 表。行 = 部屋タイプ × プラン（取引先向けの名前・食事）、列 = その期間に出る区分。マスに 1 名料金（下に小さく 1 室合計）。その区分で売っていない組合せは「—」。行が多いときは自然に改ページ（見出し行は繰り返す）。区分は1表8列まで（超えたら均等に分割）。部屋タイプごとにまとめ、部屋名は先頭行だけ
- アクセスログがあれば `rate_sheet_csv` / `rate_sheet_pdf` を記録
- 重さ: 12 か月 = 31 日 × 12 本。`loadPartnerRates` のキャッシュに乗るので、同時 4 本で読む（`loadPartnerPriceRange` と同じ）

### 5.4 管理画面（`/admin/partners/[id]`）
- 特別レートの節に「料金の元: RMS の取引先ランク暦 / TL のランク（既定）」を表示し、RMS の `/partner-rates/<id>?facility=<施設>` へのリンク（RMS のオリジンは既存の設定・定数を使う。無ければ `https://autumn-rms.yamado.app`）
- 取引先ランク暦を使っていて公開範囲に未設定日があれば警告（件数）
- 特別レートのプレビューは §5.1 で自動的に取引先ランク暦の料金になる

### 5.5 バージョン
- MINOR を上げる（ルートと `apps/web` の `package.json` 両方・`version.test.ts`）。HANDOFF.md に節とテストチェックリスト

## 6. テストチェックリスト（抜粋・HANDOFF に転記）

### RMS
- [ ] ナビ「取引先料金」→ 施設の取引先が一覧に出る。権限の無いユーザーには出ない・URL 直打ちも拒否
- [ ] 詳細で曜日の既定を保存 →「期間を曜日の既定で埋める」で祝日・祝前日も正しく塗られる
- [ ] パレットで日を塗る・範囲を塗る・消去 → 保存 → 再読み込みで残っている
- [ ] 「TL のランクを写す」「別の取引先からコピー」が期間どおりに写る
- [ ] 「取引先ランク暦を使う」をオン → 未設定日があれば確認が出る
- [ ] 料金の確認で、基準料金が Book の取引先ページ（特別レート無しのルール 0% のとき）と一致する

### Book
- [ ] 取引先ページのトップ（料金カレンダー）に最低〜最高が出る。ツールチップで根拠。施設を切り替えるとその施設の幅になる
- [ ] 取引先ランク暦をオンにした取引先は、暦のランクで料金が変わる（TL のランクを変えても変わらない）。未設定日・不可の日は売らない
- [ ] 特別レート（例: −10%）が取引先ランク暦の料金に当たる
- [ ] 料金表 CSV が Excel で文字化けせずに開け、件数・料金が画面と一致する
- [ ] 料金表 PDF: 月カレンダーの色・区分と区分の料金表が一致。人数を 2 つ選ぶと表が 2 つ。Browser Rendering が無い環境では印刷用 HTML に切り替わる
- [ ] 公開範囲外の月は出ない。確認モードでも出力できる
- [ ] 管理画面の取引先詳細に「料金の元」と RMS へのリンク・未設定日の警告
