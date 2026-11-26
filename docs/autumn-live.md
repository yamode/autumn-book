# Autumn Live — 配布と権限の設計

Book へのアクセスと予約の様子を、空を背景に「流れの帯」と「光の粒」で見せる、閲覧専用のライブ画面。
見た目の試作は `docs/prototypes/autumn-live/index.html`（v13）、方向づけは `docs/prototypes/autumn-live/proposal.html`。

この文書は **どう配るか・誰がどう入るか・どうやって「読むだけ」を守るか** を決める。
データの取り方（Book の各画面からの計測・保存の表・段と画面の対応）は別の文書で決める（§7 に概略だけ）。

## 0. 決めたこと（2026-11-27）

| 項目 | 決定 |
|---|---|
| 配り方 | 既存の Autumn デスクトップアプリ（`autumn-pms/desktop`・Electron）に同梱する。新しいアプリは作らない |
| 画面の出し方 | タブではなく **独立したウィンドウ**。メイン画面とは別に動く |
| 使う端末 | 両方ある：①いつもの業務 PC で必要なときに開く ②テレビ用など **Live だけの端末** |
| 見られる人 | スタッフ全員（Book の `role` が `admin` または `staff` の人） |
| ブラウザから開く道 | **残さない**。デスクトップアプリからだけ入れる |
| 権限 | 読むだけ。Live の口からはデータを一切変えられない |
| 二段階認証 | 求めない（届くのは集計と匿名の動きだけのため） |
| 端末ごとのオンオフ | Autumn 設定の「Autumn Live を使う」。既定はオフ。オフの端末にはメニューも出さない |
| 使われていない端末 | 90 日入場券を取っていない端末は自動で止める |

## 1. なぜ既存アプリに同梱するか

- Win / Mac の配布（署名・Mac の公証・GitHub Releases からの自動更新）がもうある。Live 用に別アプリを作ると、この仕組みをもう一組持つことになる。
- シェルは Web 画面を表示する薄い作りで、画面の更新は Web のデプロイで済む。Live の画面も Book の Web に置けば、見た目の変更でアプリを出し直さなくてよい。
- 画面ごとに使えるネイティブ機能を分ける仕組み（`electron/apps.cjs` の許可表）と、メインプロセスから Book にセッションを作ってもらう仕組み（`electron/sso.cjs` → Book `POST /admin/sso`）が、すでにある。

## 2. 全体の形

```
┌─ Autumn デスクトップアプリ（Electron）────────────────────────┐
│  メイン画面（PMS / タブ型なら RMS・Order・Book）  partition: persist:autumn-pms │
│  Live ウィンドウ（新）                            partition: persist:autumn-live │
│     └ 表示するのは Book の /live だけ。ネイティブ機能は全画面・スリープ防止のみ │
│  メインプロセス：端末鍵（safeStorage）で Book に Live の入場券を取りに行く       │
└──────────────────────────────────────────────────────────────┘
            │ POST /live/session（メインプロセスから・端末署名つき）
            ▼
┌─ Book（SvelteKit / Cloudflare）─────────────────────────────┐
│  /live            … Live の画面（GET だけ）                   │
│  /live/api/*      … 集計と匿名の動きを読む（GET だけ）          │
│  Live 用セッション Cookie（範囲 = live:read・/live にだけ効く）  │
│  book.live_devices … 登録した端末の一覧（管理画面で見る・止める） │
└──────────────────────────────────────────────────────────────┘
```

## 3. デスクトップアプリ側（autumn-pms/desktop）

### 3.1 Live ウィンドウ

- 使うかどうか：端末ごとの Autumn 設定（デスクトップの表示設定）に「Autumn Live を使う」を置く。electron-store の `liveEnabled`、**既定はオフ**（2026-11-27 決定）。オフの端末には、メニュー・ショートカット・自動で開く設定のどれも出さない。お客様から画面が見えるフロントの共有 PC などは、オフのままにしておく。
- 開き方（オンの端末）：シェルメニュー「⋯」と従来表示のメニューに「Autumn Live を開く」。ショートカット `Ctrl+Shift+L`（macOS は `Cmd+Shift+L`）。タブ型・従来表示のどちらでも使える。
- 独立したウィンドウ（`BrowserWindow`）。タブには入れない。メイン画面を閉じても Live は残る。Live は 1 枚だけ（2 回目は既存のものを前に出す）。
- 置き場所を覚える：端末ごとに表示するモニター・位置・大きさ・全画面かを electron-store に保存し、次回も同じ場所に出す。
- スリープさせない：Live が見えている間だけ `powerSaveBlocker.start('prevent-display-sleep')`。最小化・非表示で止める。
- 起動時に自動で開く：端末設定 `liveAutoOpen`（既定オフ。`liveEnabled` がオンのときだけ選べる）。

### 3.2 Live だけで起動する端末

- 端末設定 `startupMode`：`normal`（既定）／`live`。`live` を選ぶと `liveEnabled` も自動でオンになる。
- `live` では、メイン画面（PMS）を作らない。PMS へのログインも KIOSK ログインもしない。起動すると Live ウィンドウだけが全画面で出る。
- 救済：Shift を押しながら起動すると、従来どおりメイン画面で立ち上がる（既存の救済と同じ）。
- この端末の入り方は §4.3（表示専用端末）。人のアカウントを持たないので、この端末から PMS や Book の管理画面には入れない。

### 3.3 Live ウィンドウに許すこと・許さないこと

アプリの判定は **送信元の webContents** で行う。Live と Book のタブは同じ origin なので、URL ではなく「どのウィンドウか」で見分ける（Live ウィンドウの webContents をシェルが `live` として登録する）。

| | Live ウィンドウ |
|---|---|
| 表示してよい場所 | `https://<Book>/live` とその下だけ。ほかへの移動（`will-navigate`）・リダイレクトは止める |
| 新しいウィンドウ | 開かない（`setWindowOpenHandler` で常に deny）。外部リンクも開かない |
| ネイティブ機能（IPC） | 全画面の切り替え・スリープ防止・版の表示だけ。印刷・PDF・外部リンク・釣銭機・FAX・KIOSK・端末設定・更新の実行は不可 |
| セッション | 専用の partition `persist:autumn-live`。メイン画面の Cookie（共有ログイン・Book の管理セッション）は見えない |
| 開発者ツール | 製品版では開かない |

`apps.cjs` に `live` を足し、`ipc: 'live'`（上の 3 つだけ）を新設する。`npm test` の許可表テストに Live の行を足す。

### 3.4 端末鍵

- 初めて Live を開くとき、メインプロセスが端末ごとの鍵の組（Ed25519）を作り、秘密鍵を `safeStorage` で暗号化して electron-store に置く。公開鍵と端末 ID を Book に登録する（§4）。
- Book への入場券の要求は、メインプロセスがこの鍵で署名して送る。ページ（preload）からは呼べない IPC にしない。
- 鍵や入場券の値はログ・診断ログ・画面に出さない（`sso.cjs` と同じ扱い）。

## 4. Book 側

### 4.1 入場の口 `POST /live/session`

`/admin/sso` と同じ作りで、次を足す。

- 受け付けるのはメインプロセスからだけ：`Origin` / `Referer` が付いていたら 403（ブラウザのページからの fetch やフォームは必ず付く）。
- 端末の署名を確かめる：本文 `{ deviceId, ts, nonce }` を端末の秘密鍵で署名したもの。公開鍵は `book.live_devices` から引く。時刻のずれ 5 分以内、nonce は使い回し不可。
- 失敗は管理画面のログインと同じ回数制限（1 IP 10 回／10 分で 15 分止める）に数え、アクセスログに `login_failure`（`live_session_*`）で残す。
- 成功したら **Live 用のセッション Cookie** を返す（§4.4）。Supabase のログインセッションは作らない。

### 4.2 業務 PC（人がログインしている端末）

- メイン画面で人がログインしていること。メインプロセスが共有セッションの access_token を `Authorization: Bearer` で添える。Book は認証サーバで確かめ、`role` が `admin` / `staff` の人だけ通す（§0「全員」）。
- 端末の登録は初回に自動で行う：ログイン済みの人が初めて Live を開いたとき、公開鍵をその人の名前で `book.live_devices` に登録する（種類 `staff`）。
- 二段階認証は求めない（2026-11-27 決定）：Live に届くのは集計と匿名の動きだけで、書き込みもできないため。届く情報を増やすときは見直す。
- メイン画面でログアウトしたら、Live の入場券も次の更新で取れなくなる（共有セッションが無いため）。開いている Live は §4.4 の期限で閉じる。

### 4.3 表示専用端末（Live だけの端末）

- 人のログインは使わない。管理者が Book の管理画面で「Live の表示端末を追加」を押すと、1 回だけ使える登録コード（8 桁・15 分有効）が出る。
- 端末側は初回起動時にそのコードを入力する。メインプロセスが公開鍵とコードを Book に送り、`book.live_devices` に種類 `display` で登録される。
- 以後は端末の署名だけで入場券を取れる。人のアカウントを持たないので、この端末からはほかの画面に入れない。
- 管理画面で端末を止めると、次の更新から入れなくなる（盗難・廃棄のとき）。

### 4.3.1 使われていない端末を自動で止める（2026-11-27 決定）

- 最後に入場券を取ってから **90 日** たった端末は、自動で止める（業務 PC・表示専用端末とも）。毎日 1 回の定期処理で判定する。
- 止まった端末は、管理画面の一覧に「停止中（自動）」と出る。
- 業務 PC は、次にスタッフがログインして Live を開いたとき、新しい鍵で自動で登録し直される（手間はかからない）。
- 表示専用端末は、管理者が出す登録コードがもう一度必要になる。

### 4.4 Live 用セッション

- Cookie `ab_live`（Book が署名・HttpOnly・Secure・`Path=/live`・SameSite=Strict）。中身は `{ deviceId, kind, userId?, scope: 'live:read', exp }`。
- 有効期限は 1 時間。シェルは 50 分ごとに §4.1 を呼び直して差し替える。止めた端末・役割を外れた人は、ここで入れなくなる。
- この Cookie で通るのは `/live` と `/live/api/*` の **GET だけ**。`hooks.server.ts` で次を止める：
  - `/live` 以外の画面（`/admin` を含む）では、この Cookie を見ない（ログインとして扱わない）。
  - `/live` の下への GET 以外のメソッドは 405。
- 管理画面のセッション（Supabase のログイン）では `/live` に入れない。ブラウザから開く道を残さないため（§0）。

### 4.5 読むための口

- `GET /live/api/snapshot`：いまの状態（今日の段ごとの人数・いまいる粒・各指標と比較の値）。
- `GET /live/api/events?after=<id>`：それ以降の動き（段の移動・離脱・予約・会員登録）。画面は 2 秒ごとに呼ぶ。見ている端末は多くて十数台なので、1 秒あたり数回で済む。
- 中で使う DB の口は、`book` スキーマの **読むだけの関数とビュー**（集計値と匿名の番号だけを返す）。書き込み用の関数は Live の側に作らない。
- 返すものに、名前・メール・電話・会員番号・予約番号は入れない。予約の知らせも「施設・宿泊月・人数・泊数・金額」まで。
- Realtime（Supabase）にするのは、この形で遅さが気になってから。

### 4.6 管理画面

- 「Live の端末」：登録済みの端末の一覧（種類・登録した人・最後に見えた時刻）と、止めるボタン。表示専用端末の登録コードを出すボタン。
- 置き場所は `/admin/security` の下を想定。

### 4.7 入場の要求の形（実装済み・2026-11-27）

実装: `apps/web/src/lib/live-pass.ts`（純関数・テストは `live-pass.test.ts`）、`lib/server/live-session.ts`、`routes/live/session/+server.ts`、`hooks.server.ts` の `handleLive`。
DB: autumn-shared `20261126232212_book_live_devices.sql`。秘密鍵: Cloudflare のシークレット `LIVE_SESSION_SECRET`（32 文字以上・未設定なら 503）。

- `POST /live/session`、`Content-Type: application/json`（フォームの形式で送ると hooks の別の関所で 403 になる）。ヘッダー `x-autumn-desktop: <端末名 / 版>` が必須、`Origin` / `Referer` は付けない。
- 本文はどれか 1 つ。`ts` は UNIX 秒（ずれ 5 分以内・端末ごとに前回より大きいこと）、`sig` は Ed25519 の署名（base64url・64 バイト）、`publicKey` は生の公開鍵 32 バイトの base64url。
  - 既存の端末 `{ deviceId, ts, sig }`（業務 PC は `Authorization: Bearer <共有セッションの access_token>` も付ける）
  - 業務 PC の登録 `{ publicKey, ts, sig }` ＋ Bearer
  - 表示端末の登録 `{ publicKey, code, ts, sig }`（`code` は 8 桁の数字）
- 署名する文字列は次の 5 行を `\n` でつないだもの: `autumn-live-session-v1`／deviceId（登録では空）／publicKey（既存の端末では空）／code（表示端末の登録以外は空）／ts。
- 成功: 200 `{ deviceId, kind, expiresAt }` と `Set-Cookie: ab_live=…; Path=/live; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`。
  デスクトップは Live ウィンドウの partition（`persist:autumn-live`）の `session.fetch` で呼ぶ（Cookie がそのウィンドウにだけ入る）。`deviceId` は electron-store に保存する。
- 失敗: 本文 `{ error }` で次の手を決める。
  - `login_required`（401）… 業務 PC でログインが無い・切れた
  - `revoked`（403）・`unknown_device`（401）… 業務 PC は新しい鍵で登録し直す／表示端末は登録コードを入力し直す
  - `bad_code`（403）… 登録コードが違う・切れた・使用済み
  - `rejected`（400・401・403・409・413・429・500）… それ以外。細かい理由はアクセスログ（`login_failure`・`live_session_*`）にだけ残す
  - `unavailable`（404・503）… 未配備・秘密鍵の未設定
- `/live` 配下は、入場券が無ければ 403、GET / HEAD 以外は 405（`/live/session` は POST 以外が 405）。

## 5. 「読むだけ」が守られる理由（まとめ）

1. **画面**：Live の画面には変更の操作が無い。
2. **アプリ**：Live ウィンドウは `/live` の外へ出られず、ネイティブ機能もほぼ呼べない。Cookie もメイン画面と分かれている。
3. **入場券**：`/live` と `/live/api/*` の GET だけに効く。管理画面のセッションとは別物。
4. **データの口**：Live 用の口は読む関数とビューだけ。返すのは集計と匿名の動きだけ。

画面やアプリに不具合があっても、3 と 4 が残るので、データを変えることも個人情報を持ち出すこともできない。

## 6. ブラウザから開けないことの限界

- ふつうのブラウザでは開けない：入場券は署名つきの要求でしか取れず、ブラウザのページからの要求は `Origin` で断る。
- 端末の秘密鍵を自分で取り出して、ブラウザの外から要求を作れば入れてしまう。その場合も見えるのは §4.5 の範囲（集計と匿名の動き）だけで、端末を止めればすぐ入れなくなる。これを許容する前提で設計する。

## 7. データの取り方（別の文書で決める・概略）

- Book の公開画面を開くたびに、ブラウザから Book に「匿名の番号・段・施設・流入元」だけを送る。予約の確定はサーバー側で記録する。
- 計測の同意は GA4 と同じ扱い（`$lib/analytics` の `consent()`）。同意がない人は粒にせず、件数にだけ入れる。管理画面・`/r`・`/p`・ボットは計測しない。
- 1 粒 = 1 つのブラウザ。数分間動きがなければ離れたとみなす。
- 段と画面の対応（`/search`・`/[brand]/[facility]`・`/[brand]/[facility]/plans/[plan]`・予約入力・`/booking/complete/[code]`）は、そちらの文書で確定する。

## 8. 作る順番

1. Book：`book.live_devices`（migration は autumn-shared へ）、`POST /live/session`、`ab_live` Cookie と hooks の関所、`/live` の空の画面。
2. デスクトップ：Live ウィンドウ、`apps.cjs` の `live`、端末鍵、50 分ごとの入場券の更新、`startupMode: live`、表示専用端末の登録コード入力。
3. Book：管理画面「Live の端末」。
4. データの取り方（§7）と、v13 の画面を `/live` に移す。
5. デスクトップの次の版として配布（Win / Mac）。

## 9. まだ決めていないこと

- なし（2026-11-27 時点）。
