# autumn-book 内線通話 シグナリング契約書（intercom contract）

> 客室電子インフォメーションの内線通話を、**ゲスト面 `/r`（autumn-book・web）** と
> **受電ネイティブアプリ（yamode/autumn-call・別リポ・Capacitor iPhone）** の2アプリで実現するための
> **接続契約（プロトコル・データ形・認可・失敗時挙動）を固定する一次資料**。
> `autumn_book_deeplink_contract.md`（施設HP↔ポータル）と同じ役割を「`/r`↔受電アプリの通話」で果たす。
>
> - 両リポはこの契約に対して**互いの完成を待たずに並行開発**できる。
> - 本契約の変更は本ファイルの改訂として行い、`/r` 側・autumn-call 側の**双方の整合を確認してから**実装に反映する。
> - 実装フェーズは inroom 設計の P8c（P3予約/P4決済の後）。**本契約は設計のみ先行確定**。

- **ステータス**: Draft（2026-07-19・Fable 5 詳細設計）
- **置換**: `autumn_book_inroom_design.md` §3（Twilio 版内線アーキテクチャ）→ **Twilio 案は廃止**。本契約の自前 WebRTC 構成に置き換える
- **関連**: `autumn_book_inroom_design.md`（客室インフォ全体・P8a 実装済み）／autumn-call リポ `autumn_call_design.md`（受電アプリ設計）／taskul-one `docs/09〜12`（流用元の通話実装）

---

## 0. 決定サマリ

| 論点 | 決定 | 根拠 |
|---|---|---|
| Twilio | **廃止**（PSTN ブリッジしない） | 受電を iPhone ネイティブアプリにすれば従量課金・Regulatory Bundle・トール詐欺対策が全て不要 |
| 構成 | ゲスト `/r`（ブラウザ）⇄ **WebRTC P2P 音声** ⇄ 受電アプリ（iPhone） | taskul-one で 1:1 データ通話の実装実績あり（v0.6.0 で TURN 本番化済み） |
| シグナリングのバス | **autumn-platform**（`opkocyapzmsjzhbwlguh`）の Supabase Realtime ＋ `book.intercom_*` | ゲストは TASKUL に identity を持てない。`/r` の stay_session と同居する単一バス |
| シグナリング方式 | **store-and-forward（DB 永続化＋Realtime 通知）を最初から採用** | taskul-one v1（broadcast のみ）は wake-up race で「鳴るのに繋がらない」が発生 → v2（`one_call_signals`）で解消済み。その教訓を初日から反映 |
| TURN | Cloudflare Realtime 短命クレデンシャル（Edge Function 発行） | taskul-one `one-turn-credentials` と同型。館内同一 Wi-Fi なら STUN のみで接続可・TURN はフォールバック |
| 受電の運用 | **事務室据置き iPhone（常時充電・アプリ前面）を主**。複数端末の同時鳴動（simring 相当）対応 | 常時前面なら Realtime 購読だけで着信できる。push は背面/kill 時の補償 |
| 録音 | **機能自体を持たない**（inroom 設計の「既定OFF」からさらに縮小） | PII・同意の論点を丸ごと回避。必要になったら契約改訂 |
| 通話メディア | **音声のみ**（`media` 概念は設けない） | 内線にビデオは不要。taskul-one との差分を最小化する意図より要件优先 |
| コスト | **ほぼ ¥0/月**（CF TURN 無料枠 1TB・音声 Opus は ~0.5MB/分。TURN 経由時のみ課金対象） | Twilio 案の期待 ¥8,500/月 → 撤廃 |

---

## 1. 当事者と責務（3ピース）

```
[ゲスト面 /r]                       [autumn-platform]                 [受電アプリ autumn-call]
 autumn-book apps/web                Supabase (book スキーマ)          別リポ・Capacitor iPhone
 ・発信UI（「フロントを呼ぶ」）        ・intercom_calls（呼の SoT）       ・スタッフログイン（Supabase Auth）
 ・stay_session cookie（既存P8a）     ・intercom_signals（SDP/ICE 永続） ・待受（facility 購読）
 ・/r/api/intercom/* proxy           ・intercom_devices（受電端末）      ・着信UI・応答・通話
 ・WebRTC peer（ブラウザ）            ・facility_intercom（施設設定）     ・WebRTC peer（WebView）
                                     ・Edge Fn: intercom-turn / -invite
```

- **呼の SoT は `book.intercom_calls`**。両端はこの行の status を正として動く。
- 責務境界：`/r` は「発信・ゲストUX」、autumn-call は「受電・スタッフUX」、契約（本書）とDBが唯一の接点。
- `/admin/inroom`（通話ログ閲覧・内線設定・端末管理）は **autumn-book に残す**（admin 認証を複製しない）。

## 2. 前提（既存資産）

| 項目 | 値 |
|---|---|
| Supabase プロジェクト | autumn-platform `opkocyapzmsjzhbwlguh`（PROD・全 autumn アプリ共有） |
| スキーマ方針 | `book` は **RLS deny-all ＋ RPC-first**（PostgREST 公開済み）。本契約のテーブルも同方針 |
| ゲスト認証 | P8a 実装済みの **stay_session**（httpOnly cookie ⇄ `book.stay_access_tokens`）。会員ログイン不要 |
| スタッフ認証 | autumn-platform の Supabase Auth。**`app_metadata.role in ('admin','staff')`**（autumn-book `/admin` と同一アカウント） |
| migration | `autumn-shared/supabase/migrations/YYYYMMDDHHMMSS_book_intercom_*.sql`（実UTC秒・new-migration.sh） |
| Edge Functions | `autumn-shared/supabase/functions/`（send-push 等の前例に従い共有リポに集約） |

---

## 3. 呼のライフサイクル（状態機械）

`book.intercom_calls.status`：

```
ringing ──(スタッフ応答)──▶ active ──(どちらかが終話)──▶ ended
   │
   ├─(スタッフ拒否)──▶ declined
   ├─(ゲストが取消)──▶ canceled
   └─(RING_TIMEOUT 30s 無応答)──▶ missed
```

| 遷移 | 誰が | 手段 |
|---|---|---|
| 作成（ringing） | ゲスト | `/r/api/intercom/start` → RPC `book.intercom_start` |
| ringing→active | スタッフ | RPC `book.intercom_answer`（**先勝ち**：`update … where status='ringing'` が 0 行なら「他端末が応答済み」） |
| ringing→declined | スタッフ | RPC `book.intercom_decline` |
| ringing→canceled | ゲスト | `/r/api/intercom/hangup`（outgoing 中の切断） |
| ringing→missed | ゲスト側タイマー（30s）＋ `intercom_start` 実行時の同室 stale 掃除（>60s の ringing を missed 化） | `/r/api/intercom/timeout` |
| active→ended | どちらでも | 各自の hangup 経路（＋ `bye` シグナル） |

- **多端末同時鳴動**（事務室据置き＋任意でスタッフ携行 iPhone）：全端末に着信通知 → 最初に `intercom_answer` が成功した端末が通話。敗者は status 変化（active）を受けて着信 UI を閉じる。
- 応答時に `answered_device_id` を記録（通話ログ・監査用）。

## 4. シグナリング transport（store-and-forward・v2 方式）

> taskul-one の教訓：**broadcast のみ（fire-and-forget）だと、push で起こされた受端が購読する前に
> offer/ICE が消える**（wake-up race）→「鳴るのに無音」。対策として taskul-shared
> `20260716140000_one_call_signals.sql` が store-and-forward 化を導入済み。本契約は初日からこの v2 を採用する。

### 4.1 経路（永続＝正、broadcast＝高速化）

```
送信側 ── RPC intercom_signal_send ──▶ book.intercom_signals INSERT（永続・SoT）
                                        └─ 同一トランザクションで realtime.send()
                                           → topic call:{call_id} へ broadcast（低遅延の nudge 兼配送）
受信側 ── channel(call:{call_id}) 購読（高速路）
       └─ 購読確立時・再接続時・受信欠落疑い時に RPC intercom_signal_fetch(call_id, after_id) で
          backlog を replay（送信順 = id 昇順）
```

- **正は常に DB**。broadcast は取りこぼしてよい（fetch が補償する）。
- 受信側は `last_received_id` を保持し、fetch は `after_id` 以降のみ取得（重複適用は id で冪等に排除）。
- ゲスト（ブラウザ）の購読・fetch は匿名 Realtime／`/r/api` proxy 経由（§6）。

### 4.2 メッセージスキーマ（`intercom_signals.kind` / `payload`）

taskul-one `call.ts` の `Signal` 型を踏襲：

| kind | payload | 方向 |
|---|---|---|
| `offer` | `{ sdp: RTCSessionDescriptionInit }` | ゲスト→スタッフ |
| `answer` | `{ sdp: RTCSessionDescriptionInit }` | スタッフ→ゲスト |
| `ice` | `{ candidate: RTCIceCandidateInit }` | 双方向（trickle） |
| `bye` | `{}` | 双方向 |

- broadcast イベント名は `signal`、payload は `{ id, kind, payload, sender }`（`sender: 'guest' | 'staff'`）。
- **offer は必ずゲスト側（caller）が作る**。ただし taskul-one 同様、**スタッフが `intercom_answer` で active にした後に送る**（受端の購読確立前に offer を流さない）。store-and-forward により厳密には early-offer も救済されるが、順序規約として維持する。
- ICE candidate は remoteDescription 設定前に届いたら保留キューに積む（taskul-one `pendingCandidates` パターン）。

### 4.3 着信通知（ring）

シグナリングとは別に、**「呼が発生した」をスタッフ端末に届ける**経路：

| 状態 | 経路 |
|---|---|
| アプリ前面（主運用） | `intercom_start` 内の `realtime.send()` → topic **`intercom:facility:{facility_id}`** へ event `ring`（payload: `{ call_id, room_code, created_at }`）。受電アプリは常時この topic を購読 |
| 背面/復帰 | 復帰時に RPC `book.intercom_pending(facility_id)`（直近 45 秒の ringing を返す。taskul-one `checkPendingIncomingCall` と同じ補償）＋定期ポーリング（前面中 15s 間隔の保険） |
| kill / ロック中 | Edge Function **`intercom-invite`**（`intercom_start` 後に `/r` サーバが invoke）→ `book.intercom_devices` の該当施設端末へ push（第1段: FCM 高優先度 / 第2段: iOS VoIP push + CallKit。taskul-one docs/10 の段階導入と同じ） |

- 据置き運用（充電・前面固定・自動ロックOFF）が主のため、**MVP は前面 Realtime＋復帰補償のみで成立**する。push は段階導入（autumn-call 設計 P3/P4）。

### 4.4 Realtime topic 規約

| topic | 用途 | 購読者 |
|---|---|---|
| `call:{call_id}` | シグナル配送（nudge） | 当該呼のゲスト・スタッフ |
| `intercom:facility:{facility_id}` | 着信 ring・呼状態の施設内周知 | 当該施設の受電端末 |

- MVP は **public topic**（推測困難な UUID をトピック名に含める。taskul-one と同等の割り切り）。payload に電話番号等の秘匿情報は載らない（SDP/ICE と room_code のみ）。
- 強化パス（契約改訂で対応）：Realtime private channel ＋ `realtime.messages` RLS。

## 5. TURN / ICE

- Edge Function **`intercom-turn`**（autumn-shared）が Cloudflare Realtime の短命クレデンシャル（TTL 1h）を発行。taskul-one `one-turn-credentials` の移植。secrets: `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN`（autumn-platform 側に別途 set）。
- **認可が taskul-one と異なる**：ゲストは anon のため、`Authorization: user JWT` 検証の代わりに **`call_id + call_secret`（§6）を検証**する。スタッフは従来どおり JWT（role 確認）。
- 失敗時は STUN のみ（`stun:stun.cloudflare.com:3478`）にフォールバック。**ゲスト・受電 iPhone が同一館内 Wi-Fi なら STUN のみで P2P 接続できる**のが基本線で、TURN は AP 間分離・ゲストがモバイル回線時などの保険。
- クレデンシャルは 30 分クライアントキャッシュ（taskul-one と同じ）。

## 6. 認可モデル

### 6.1 ゲスト側（anon・stay_session）

- ブラウザには stay token を**一切露出しない**（httpOnly cookie は P8a で確立済み）。制御系は全て **`/r/api/intercom/*`（SvelteKit +server.ts）proxy** を通し、サーバが cookie から token を取り出して RPC を呼ぶ。
- ただし Realtime 購読（`call:{call_id}`）とシグナル送受の高頻度パスのため、`intercom_start` は **`call_secret`（呼ごとの短命ランダム値・呼終了で失効）** を返す。以降ゲストのブラウザは `call_id + call_secret` で signal send/fetch の RPC を**直接**呼べる（anon grant・secret 検証）。TURN 発行も同じ組で認可。
- レート制限：`intercom_start` は **同一 stay token あたり 5 回/10 分**（超過は `rate_limited` エラー）。`business_hours` 外は `out_of_hours` エラー（UI は「受付時間外」表示）。

### 6.2 スタッフ側（authenticated）

- autumn-platform Supabase Auth でログイン（autumn-book `/admin` と同一アカウント体系）。RPC 内で `app_metadata.role in ('admin','staff')` を検証。
- 端末登録（`intercom_devices`）・応答・拒否・終話・pending 取得・signal send/fetch が可能。施設は端末登録時に紐付け。

### 6.3 RPC × ロール マトリクス

| RPC | anon（ゲスト） | authenticated（スタッフ） | service_role |
|---|---|---|---|
| `intercom_start(p_token)` | ✅（stay token 検証・レート制限） | — | ✅ |
| `intercom_signal_send(call_id, secret_or_jwt, kind, payload)` | ✅（call_secret） | ✅（role 検証） | ✅ |
| `intercom_signal_fetch(call_id, secret_or_jwt, after_id)` | ✅（call_secret） | ✅ | ✅ |
| `intercom_answer / intercom_decline(call_id, device_id)` | — | ✅ | ✅ |
| `intercom_hangup(call_id, …)` | ✅（call_secret） | ✅ | ✅ |
| `intercom_timeout(call_id, secret)` | ✅ | — | ✅ |
| `intercom_pending(facility_id)` | — | ✅ | ✅ |
| `intercom_device_upsert / delete` | — | ✅（自端末のみ） | ✅ |
| `intercom_status_for(p_token)` | ✅（設定有効・時間内かを UI 表示用に返す） | — | ✅ |
| `facility_intercom_upsert` / `list_intercom_calls` | — | ✅（admin。`/admin/inroom` 用） | ✅ |

- テーブルは全て RLS deny-all。上記 RPC（`security definer`）のみが窓口（P8a と同じ流儀）。

## 7. データモデル（`book` スキーマ・migration は実装時に採番）

```
intercom_calls(
  id uuid PK, facility_id → core.facilities, stay_id（論理参照）, room_code text,
  status text check (ringing|active|declined|missed|canceled|ended),
  call_secret text,                -- ゲスト直接RPC用・終了時 null 化
  answered_device_id uuid, started_at, ended_at, created_at
)
intercom_signals(
  id bigint identity PK, call_id → intercom_calls (cascade),
  sender text check (guest|staff), kind text check (offer|answer|ice|bye),
  payload jsonb, created_at
)                                  -- one_call_signals と同型。index (call_id, id)
intercom_devices(
  id uuid PK, user_id → auth.users, facility_id → core.facilities,
  platform text check (ios|android), fcm_token text unique, voip_token text,
  device_label text, last_seen_at, disabled_at, created_at
)                                  -- one_devices と同型＋facility_id
facility_intercom(
  facility_id PK → core.facilities, is_enabled boolean,
  business_hours jsonb,            -- JST。例 {"mon":[["8:00","22:00"]], …}
  ring_timeout_sec int default 30, rate_limit int default 5, created_at, updated_at
)                                  -- Twilio 版の dial_* / caller_id / record_calls / voicemail_url は廃止
```

- inroom 設計 §6 の下書き（`20260615120000_book_inroom.sql`・未適用）にあった Twilio 前提の列は**採用しない**。
- 通話ログは `intercom_calls` がそのまま担う（`/admin/inroom` の「通話ログ」タブ＝`list_intercom_calls`）。
- `intercom_signals` は通話終了後に価値がないため、**7 日で削除**（pg_cron or 次回 `intercom_start` 時の掃除）。

## 8. 接続シーケンス（正常系フル）

```
ゲスト /r                        book (DB/RPC)                    受電アプリ
  │ 「フロントを呼ぶ」tap
  │─ POST /r/api/intercom/start ─▶ intercom_start:
  │                                 ├ token検証・時間内・レート制限
  │                                 ├ intercom_calls INSERT (ringing, call_secret)
  │                                 └ realtime.send(intercom:facility:{f}, ring)──▶ 着信UI（全端末鳴動）
  │◀─ {call_id, call_secret} ──────┘
  │ （/r サーバが intercom-invite invoke → 背面端末へ push）
  │ getUserMedia(audio) + Wake Lock
  │ intercom-turn で ICE servers 取得（call_id+secret）
  │ RTCPeerConnection 生成・track 追加
  │ channel(call:{call_id}) 購読 ＋ signal_fetch で backlog 確認
  │                                                        「応答」tap
  │                                          intercom_answer ◀─（先勝ち・active化）
  │                                 realtime.send(call状態) ──▶ 敗者端末は着信UIを閉じる
  │◀─ active を検知（broadcast/fetch）        getUserMedia + TURN + peer + 購読 + fetch
  │─ signal_send(offer) ──────────▶ INSERT + broadcast ────▶ setRemote → answer 作成
  │◀─ signal_send(answer) ─────────  INSERT + broadcast ◀───┘
  │⇄ signal_send(ice) × n（trickle・保留キュー処理）⇄
  │◀━━━━━━━━━━━ WebRTC P2P 音声（同一Wi-FiならSTUN直結／だめならTURN中継）━━━━━━━━▶
  │ 終話 → hangup ────────────────▶ status=ended + bye ────▶ 終話
```

## 9. 異常系（両アプリが従う共通規約）

| 事象 | 挙動 |
|---|---|
| 30s 無応答 | ゲスト側タイマーで `intercom_timeout` → missed。ゲスト UI はフォールバック提示（再発信／「電波があれば `tel:` 発信」リンク）。受電側は ring payload の `created_at`+35s で自動的に着信 UI を閉じる |
| 受付時間外 | `intercom_start` が `out_of_hours` → UI「受付時間外」（`intercom_status_for` で発信ボタン自体も事前に無効化表示） |
| ゲストが画面を閉じた/ロック | `visibilitychange` 検知→復帰時に再接続試行。`connectionState failed/disconnected` → 終話処理（taskul-one と同じ）。Wake Lock（iOS 16.4+）で自動ロック抑止 |
| broadcast 欠落 | 受信側の定期 `signal_fetch`（通話確立まで 2s 間隔・確立後停止）が補償 |
| Realtime 全断 | シグナリングは fetch ポーリングに縮退（確立済みの P2P 音声は Realtime に依存しないため通話は継続） |
| 多重発信 | 同一 stay の ringing/active 存在中は `intercom_start` が `busy` を返す |
| 緊急通報 | **本内線は 110/119 不可**。客室掲示（Web 外・inroom 設計 §3.4 のまま有効） |

## 10. 実装の割り当て

| 成果物 | リポ | 備考 |
|---|---|---|
| migration `book_intercom_*` | autumn-shared | §7。実装フェーズ開始時に new-migration.sh で採番 |
| Edge Fn `intercom-turn` / `intercom-invite` | autumn-shared | taskul-one の該当 Function を移植・認可改修（§5・§4.3） |
| `/r` 発信 UI・`/r/api/intercom/*`・通話シート | autumn-book | Twilio 版設計（inroom §7 の `/api/intercom/token|voice|status`）は**作らない** |
| `/admin/inroom` 内線設定・通話ログ・端末管理タブ | autumn-book | `facility_intercom_upsert` / `list_intercom_calls` |
| 受電アプリ全体 | autumn-call | `autumn_call_design.md` 参照。taskul-one `call.ts` を本契約に合わせて移植 |
| 本契約書 | autumn-book | SoT。改訂は両リポ確認の上で |

## 11. 未決事項

1. CF TURN キーを taskul と共用にするか autumn 用に新規発行するか（コスト同じ・分離推奨）。
2. push 第2段（iOS VoIP push + CallKit）まで行くか、据置き運用＋FCM 第1段で止めるか（運用実績を見て判断）。
3. `business_hours` の初期値（両施設の受電可能時間帯）と時間外の代替導線文言。
4. スタッフ携行端末（simring 相当）を初期から配るか、据置き 1 台で開始するか。

---

## 12. 実装状況と実装で決めた細部（2026-09-29）

- **DB**: autumn-shared `20260929120100_book_intercom.sql`（PROD 適用済み）。§6.3 の RPC は全て実装。`facility_intercom.is_enabled` は全施設 **false** で開始（`/admin/inroom` で施設ごとに ON）。
  - スタッフ側の認可は role ではなく **`private.has_facility_access`**（book の他の管理 RPC と同じ線引き）。設定の変更（`facility_intercom_upsert`）はテナント管理者のみ。
  - `intercom_signal_fetch` は `{ status, signals }` を返す（呼の状態を同梱）。`intercom_answer` は先勝ちに負けると `{ ok: false, status }`。
  - `intercom_hangup` は呼出中にゲストが切ると `canceled`、スタッフが切ると `declined`、通話中はどちらでも `ended`。`bye` シグナルは RPC が自動で入れる。
  - Realtime: `intercom:facility:{id}` に `ring`、`call:{id}` に `status` / `signal`（`realtime.send(..., private=false)`）。
- **ゲスト（autumn-book `/r`）**: ブラウザには Supabase クライアントを持たせず、`/r/api/intercom` 経由の **fetch ポーリングだけ**で動く（接続まで 1 秒・通話中 2 秒）。正は DB なので broadcast を使わなくても契約上問題ない。
  - TURN は §5 の Edge Function ではなく **`/r/api/intercom` action `ice`** が発行（autumn-book の env `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN`。未設定なら STUN のみ）。受電アプリ側の `intercom-turn` は未実装。
- **taskul-one の轍（HANDOFF v0.15.0）から、受電アプリも守ること**:
  1. **ICE restart の re-offer に応答する**。ゲスト（発信側）が `disconnected` 6 秒グレース後に `createOffer({ iceRestart: true })` を送る（最大 3 回）。受電側は通話中に届いた 2 回目以降の `offer` にも `answer` を返す。受電側から restart はしない（glare 回避）。
  2. offer / answer の payload は `{ sdp: { type, sdp } }`。answer を作るときも Opus の `useinbandfec=1;usedtx=1;minptime=10` を付ける（ゲストの `tuneOpus` と同じ）。
  3. 相手音声は非 muted の `<video playsinline autoplay>` に結線（taskul-one build 7 の無音対策）。
  4. `RTCPeerConnection({ iceCandidatePoolSize: 1 })`・ICE の保留キュー・シグナルは id 順に 1 件ずつ処理。
  5. 着信 UI は ring の `created_at` + 45 秒で自動クローズ（ghost ring 抑制）。

### 12.1 追補（2026-09-29・受電アプリ設計の Fable レビュー反映）

- DB 手直し：autumn-shared `20260929120200_book_intercom_hardening.sql`（PROD 適用済み）。
  - `intercom_pending` の窓・`intercom_start` の取り残し掃除は **施設の `ring_timeout_sec` 基準**（＋15 秒／＋30 秒）。
  - 端末は **`install_id`（アプリが生成・保存する UUID）で 1 端末 1 行**。`intercom_device_upsert(p_facility_id, p_install_id, p_platform, p_fcm_token, p_voip_token, p_device_label)`。受電アプリは起動時と 5 分ごとに呼ぶ（ハートビート）。
  - **稼働端末（`last_seen_at` 10 分以内）が 0 台なら `intercom_start` は `offline` で断る**。`intercom_status_for` は `online` を返し、`/r` はボタンを押せなくして電話を案内する。
  - 受電アプリの施設選択は `intercom_my_facilities()`。
  - `admin_facility_intercom` は `online_devices` / `last_seen_at`、`list_intercom_calls` は `device_label` を返す。
- **受信側は broadcast の payload を信用しない**（topic は public なので誰でも送れる）。`ring` → `intercom_pending` で実在確認、`signal` → `intercom_signal_fetch` で取り込み、`status` → pending / fetch で裏取り。broadcast は「DB を見に行け」という合図としてだけ使う。
- ゲスト側の TURN 発行（`/r/api/intercom` action `ice`）は呼が ringing / active のときだけ。

### 12.2 追補（2026-09-29・TURN と push）

- 受電側 TURN：Edge Function **`intercom-turn`**（autumn-shared・PROD デプロイ済み・verify_jwt=true）。内線を受けられるスタッフ（`intercom_my_facilities` が空でない）にだけ Cloudflare TURN の短命クレデンシャルを返す。`CF_TURN_*` 未設定なら STUN のみ。
- 着信 push：Edge Function **`intercom-invite`**（PROD デプロイ済み・verify_jwt=false）。`/r/api/intercom` の start 直後に autumn-book サーバが `{ call_id, call_secret }` で呼ぶ（`waitUntil`・ゲストは待たせない）。call_secret を照合し、ringing かつ 60 秒以内の呼に **1 回だけ**（`intercom_calls.invited_at` の claim）、施設の受電端末へ FCM を送る。`FCM_SERVICE_ACCOUNT_JSON` 未設定なら送らない。
- 受電アプリは push を「DB を見に行け」という合図として扱い、`intercom_pending` で裏取りしてから鳴らす（§12.1 と同じ）。

### 12.3 追補（2026-09-30・受電専用アカウント＝内線オペレーター）

- **受電専用アカウントには `core.memberships` を付けない。** `private.has_facility_access` / `has_tenant_access` はロールを見ずに membership の有無だけで PMS・RMS・ordering・book の行（宿泊者・請求・予約など）を読み書きさせるうえ、PMS の `staff` / `shared_login` は cross-facility のため全施設に届く。常時ログインの据置き iPhone にそれを持たせない。
- 代わりに **`book.intercom_operators (user_id, facility_id)`**（autumn-shared `20260930100000_book_intercom_operators.sql`）。RLS deny-all・RPC からだけ参照。
- 受電側の認可は **`book._intercom_can_receive(tenant, facility)`** ＝ `has_facility_access` **または** `is_superadmin` **または** オペレーター行がある。`_intercom_require_staff`・`_intercom_call_auth`（スタッフ分岐）・`intercom_my_facilities` がこれを使う。
  - オペレーターが使える RPC：`intercom_my_facilities` / `intercom_device_upsert` / `intercom_device_delete` / `intercom_pending` / `intercom_answer` / `intercom_decline` / `intercom_signal_send` / `intercom_signal_fetch` / `intercom_hangup`（p_secret=null）/ `list_intercom_calls` / `admin_facility_intercom`（自施設のみ）、Edge Function `intercom-turn`。
  - 使えないもの：`facility_intercom_upsert`（テナント管理者のみ）・book の他の管理 RPC・PMS/RMS/ordering の全テーブル（membership が無いので RLS で弾かれる）。autumn-book `/admin` も `app_metadata.role` が無いので入れない。
- オペレーターの追加・削除は当面 SQL（service_role）で行う。運用：施設ごとに 1 アカウント（2026-09-30：山人-yamado- = `reservation@yamado.co.jp`、山人-oga- = `reservation@oga.yamado.co.jp`）。
- 既存スタッフ（membership あり）は従来どおり受電できる（`has_facility_access` の分岐は残す）。

### 12.4 追補（2026-09-30・ロック中も鳴り続ける着信＝CallKit + VoIP push・受電アプリ C4）

- 受電端末が `intercom_device_upsert(p_voip_token)` に PushKit の VoIP トークンを載せる（列 `intercom_devices.voip_token` は既存）。
- `intercom-invite` は、施設の有効な受電端末のうち **`voip_token` がある端末へ APNs VoIP push（.p8・`apns-push-type: voip`・topic `<bundle>.voip`・TTL 30 秒）**、無い端末へは従来どおり FCM alert。**施設の全端末へ同時に送る**（同じアカウントで複数端末にログインしていても端末ごとに 1 行なので全部鳴る）。
  - VoIP payload：`{ "kind": "intercom_ring", "callId", "roomCode", "facilityId", "ringTimeoutSec" }`（`aps` は空）。
  - 送信条件は従来どおり（ringing・60 秒以内・1 呼 1 回の claim）。VoIP が BadDeviceToken（両環境）/ Unregistered なら `voip_token` を消す。
  - secrets：`APNS_AUTH_KEY_P8` / `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID`（未設定なら全端末 FCM にフォールバック）。本番→開発ホストの自動フォールバック（taskul-one `_shared/apns.ts` と同じ）。
- 受電アプリは VoIP push を受けたら**毎回同期的に CallKit へ報告**し（iOS 要件）、CallKit が呼出時間の間ロック画面でも鳴らし続ける。**push は合図に過ぎず、応答は従来どおり `intercom_answer`（先勝ち）→ signal の store-and-forward**。他端末が先に応答した・取消・時間切れになったら、アプリが `intercom_pending` / status で裏取りして CallKit の着信を閉じる（呼出時間＋15 秒の安全弁もネイティブに持つ）。
- ゲスト側（`/r`）とシグナリング・RPC は変更なし。
