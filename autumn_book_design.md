# autumn-book 設計書（v2 — プラットフォーム統合版）

> 本書は `autumn_book_spec.md` / `autumn_book_full_spec.md`（FastAPI + TL在庫正 前提の旧構想）を**置き換える**正式設計。
> 旧仕様の有効なアイデア（オプション・キャンセルポリシー・シークレットオファー等）は §12 の差分表で引き継ぎを明記する。
> 前提資料：`docs/architecture-memo.md`（星野リゾート動線の分析メモ）＋ autumn-rms / autumn-pms / autumn-order / autumn-shared の実装調査（**各リポ origin/main 最新化済み・2026-06-10 時点**）。
> 特に **autumn-pms/docs/02-architecture.md（クラウドPMS設計・同日付）** と整合を取ること。予約データの最終的な着地形（stay_groups → stays → stay_nights）は PMS 設計が定義する。

> ⚠ **2026-06-21 アーキテクチャ変更（要・最初に読むこと）**：施設HPの扱いを変更した。本書 §0・§4.0 が前提とする「**単一 SvelteKit アプリが全施設HPを `reroute` で配信し、施設HPを Svelte シェルで再現する**」方針は **`autumn_book_architecture_decision.md`（ADR-0001）で置き換え**。新方針＝**施設HPは既存サイト（WP）を外部に据え置き**、予約エンジン・会員・掲示板・地図検索は**単一のブランドポータル**（`stay.yamado.co.jp`）に統合し、施設HPの予約は**ポータルへリダイレクト**（ウィジェット不採用）。`book` スキーマ／RPC／会員／予約Tx／掲示板／客室情報／地図検索など本書の他章はそのまま有効。

---

## 0. 結論サマリ

| 論点 | 決定 |
|------|------|
| リポジトリ | `autumn-book` 新規モノレポ（pnpm workspace）。既存3リポと統合しない |
| フロント | SvelteKit 2 + Svelte 5 + TailwindCSS 4（rms/order と同一スタック） |
| デプロイ | Cloudflare Pages（`@sveltejs/adapter-cloudflare`）、`book.yamado.app` → 将来 `yamado.jp` 等の本番ドメイン |
| DB | **Supabase「Autumn Platform」を共有**（`opkocyapzmsjzhbwlguh`・東京）。migration の SoT は **autumn-shared/supabase/migrations**（56本適用済み・本番一致確認済）。適用フローはプラットフォーム標準（GitHub Integration による main マージ時自動適用・DEVブランチ検証は rms フロー準拠） |
| 在庫・料金の正 | **`booking.availability` + `booking.daily_rates`（プラットフォーム内）が正**。TL-リンカーンは OTA 配信用 SC であり、autumn-book は TL を直接見ない |
| 顧客アクセス | anon はテーブル直読みせず **SECURITY DEFINER RPC + 公開ビュー** 経由。新設 `book` スキーマに顧客向けデータを分離 |
| 会員 | Supabase Auth（メール + Google/LINE OAuth）。`book.members` ⇔ `core.guests` を guest_identities で名寄せ。全ブランド共通1ID |
| 決済 | Stripe（Payment Intent + 3DS）。現地払いプランは決済スキップ |
| 地図 | MapLibre GL JS + OpenFreeMap/国土地理院タイル（API キー・従量課金なし） |
| UX | 一休.com の予約導線を参考（§7 で要素分解） |

---

## 1. 位置づけと全体像

```
                        ┌─ 従業員向け ─────────────────────────┐
  OTA (一休/楽天/じゃらん…)   │  autumn-rms   料金・OTA配信管理       │
        ▲                 │  autumn-pms   施設運営（予定）         │
        │ SOAP            │  autumn-order 館内注文                │
  TL-リンカーン (SC) ◀──────┤                                     │
        ▲                 └──────────────┬──────────────────────┘
        │ 在庫減算通知                     │
  ┌─────┴────────────┐         Supabase「Autumn Platform」
  │  autumn-book     │◀───────  core / pms / booking / rms / book(新設)
  │  （本設計・顧客向け）│         migration は autumn-shared に集約
  └──────────────────┘
```

- 直販予約が確定したら `booking.availability` を減算し、**RMS の配信機構を通じて TL-リンカーンへ在庫を反映**（OTA とのダブルブッキング防止）。
- autumn-book は「直販の窓口 + 顧客接点（施設HP・地図検索・会員）」に専念する。

### 既存資産の再利用（つくらないものリスト）

| 既にあるもの | 場所 | autumn-book での扱い |
|---|---|---|
| 施設マスタ | `core.facilities` | 公開用コンテンツを `book.facility_contents` で重ねる |
| 部屋タイプ | `pms.room_types` | 公開ビュー経由で参照 |
| 料金（日次・人数帯別） | `booking.daily_rates`（大人1〜6名単価・子供5区分） | RPC で読む。**新規料金テーブルは作らない** |
| 在庫 | `booking.availability`（version 楽観ロック付き） | RPC で読み、予約確定時に減算 |
| プラン | `booking.rate_plans`（meal_plan / payment_method / cancellation_policy JSONB / public_on_direct） | 公開コンテンツ（写真・訴求文）だけ `book.plan_contents` で追加 |
| チャネル | `booking.channels`（code='autumn_booking' が直販） | 直販予約はこのチャネルで `booking.bookings` に書く |
| 顧客マスタ・名寄せ | `core.guests` + `core.guest_identities` | 会員登録・ゲスト予約の両方をここに集約。**core.guests は PMS 移行で大幅 ALTER 予定**（guest_code・kana分離・NG食材等）のため book 側で顧客属性を重複定義しない |
| 予約・滞在 | `booking.bookings` + `core.stays`（部屋単位）+ **`pms.stay_groups` / `pms.stay_nights`（PMS設計で新設予定）** | 直販予約も TL 取込予約と**同じ展開パイプライン**（bookings → stay_groups → stays → stay_nights）に乗せる。現場帳票（部屋割り・席割・御伺書）が stay_nights を読むため |
| 宿泊券 | `pms.voucher_masters` / `voucher_records`（PMS設計で新設予定） | ふるさと納税[F]/自社[A]宿泊券のコード利用を P6 で book に統合 |
| TL-リンカーン連携 | `autumn-shared/src/tl-lincoln/` + rms_* テーブル | 在庫減算通知に再利用 |

---

## 2. モノレポ構成

```
autumn-book/
├─ apps/
│  └─ web/                     SvelteKit 本体
│     └─ src/routes/           （§4 の URL 設計に対応）
├─ packages/
│  ├─ core/                    料金計算・在庫判定・キャンセル料計算（純粋関数 + Vitest 相当の手動チェック）
│  └─ ui/                      ブランド共通コンポーネント（料金カレンダー、プランカード、地図…）
├─ docs/
│  ├─ architecture-memo.md     前提メモ
│  └─ （本書をリポ直下に置く）
├─ pnpm-workspace.yaml
└─ HANDOFF.md                  テストチェックリスト含む（全社テスト方針準拠）
```

- **`supabase/` ディレクトリはこのリポに作らない。** DDL はすべて `autumn-shared/supabase/migrations/` に追加（CLAUDE.md 絶対ルール）。
- 型定義・Supabase クライアントは rms/order と同様に autumn-shared を `preinstall` 同期で取り込む。
- Edge Functions（予約確定・決済 Webhook）も autumn-shared 側 `supabase/functions/` に置きデプロイする。

---

## 3. ドメイン拡張：新設 `book` スキーマ

既存スキーマ（core/pms/booking）は社内 RLS で守られており anon を入れない。顧客向けに **`book` スキーマ**を新設し、「公開コンテンツ」と「会員・カート」をここに集約する。

### 3.1 公開コンテンツ（ブランド・施設・プランの見せ方）

```
book.brands
  id uuid PK, tenant_id FK, slug UNIQUE('yamado'…), name, type('lodging'/'restaurant'/'sauna'),
  theme jsonb(配色・ロゴ), description, sort_order, is_active

book.facility_contents               -- core.facilities 1:1 の公開プロフィール
  facility_id PK/FK → core.facilities,
  brand_id FK → book.brands,
  slug UNIQUE, catch_copy, description,
  lat numeric, lng numeric, prefecture, address_public,
  checkin_time, checkout_time, amenities jsonb,
  access jsonb,                      -- §6.3 交通アクセス構造
  is_published, published_at

book.facility_photos
  id, facility_id FK, url, caption, category('exterior'/'room'/'bath'/'meal'/'view'), sort_order

book.room_type_contents              -- pms.room_types 1:1 の公開プロフィール
  room_type_id PK/FK, headline, description, photos jsonb, amenities jsonb, is_published

book.plan_contents                   -- booking.rate_plans 1:1 の公開プロフィール
  rate_plan_id PK/FK, headline, description, photos jsonb,
  highlight_tags text[]('露天風呂付'/'記念日'/'一人旅'…), sort_order, is_published
```

> 「ブランド追加＝データ追加」原則：飲食・サウナ業態は `brands.type` でテンプレートを出し分ける。MVP は `lodging` のみ実装し、type 別テンプレートの分岐点だけ用意しておく。

### 3.2 会員

```
book.members                         -- auth.users 1:1
  user_id PK/FK → auth.users,
  guest_id FK → core.guests,         -- 名寄せの着地点
  member_code UNIQUE, rank_code DEFAULT 'standard',
  is_mail_opt_in, joined_at

book.member_ranks                    -- standard/silver/gold… rank_order, 還元率
book.point_ledger                    -- 加算・利用・失効の台帳（残高は SUM、即時利用対応）
  id, member_id FK, booking_id FK NULL, delta int, reason, expires_at, created_at
book.favorites                       -- member_id × facility_id
```

- 会員登録・ログイン：**メール + パスワード／マジックリンク + Google・LINE OAuth**。顧客向けにパスキーは強制しない（rms の passkey は社内向け方針のまま）。
- 会員登録時に email で `core.guest_identities` を照合 → 既存ゲスト（OTA・電話予約履歴）と自動名寄せ。一致しなければ `core.guests` を新規作成。
- ポイント：一休方式を踏襲し「**即時利用**（予約時にその予約の付与予定ポイントも使える）」を採用。台帳方式なら予約キャンセル時の巻き戻しも `delta` 逆仕訳で表現できる。

### 3.3 カート・仮押さえ

```
book.holds                           -- 在庫仮押さえ（カートの実体）
  id uuid PK, session_id, member_id NULL,
  facility_id, room_type_id, rate_plan_id,
  checkin_date, checkout_date, adult_count, child_counts jsonb,
  price_snapshot jsonb,              -- 表示時点の宿泊料内訳
  status('active'/'converted'/'expired'/'released'),
  expires_at,                        -- 既定 20 分
  created_at
```

- hold 作成時に `booking.availability.available_rooms` を **version 楽観ロックで減算**。期限切れ解放（+1 戻す）は rms 実証済みの **pg_cron + pg_net → `/api/cron/*`（Bearer=CRON_SECRET・Vault名前参照）** パターンで実装。
- 未ログインでも hold 可能（session_id ベース）。決済直前にログイン or ゲスト続行を選択（一休と同じ「先に進める」導線）。
- 複数泊・複数施設のカートは将来拡張とし、MVP は hold 1件 = 1予約。

---

## 4. URL 設計（SvelteKit ルーティング）

### 4.0 ドメイン戦略（`yamado.co.jp` 一本継続・施設別サブドメイン）

**現状（2026-06-10 DNS 実査）**：zone は Xserver NS。www / oga / corporate すべて同一 Xserver（162.43.120.190）上のサブディレクトリ運用。メールは @yamado.co.jp（apex MX + Xserver SPF）と @oga.yamado.co.jp（oga に MX 同居）の2系統が Xserver アカウント内で稼働。

| ホスト | 現状 | 将来（autumn-book 後） |
|---|---|---|
| `www.yamado.co.jp` | 西和賀施設HP（WP） | **西和賀施設HP（autumn-book）に置換** — URL 維持で SEO 資産を引き継ぐ |
| `oga.yamado.co.jp` | 男鹿施設HP（WP）+ **MX 同居** | **男鹿施設HP（autumn-book）に置換** — MX 共存が DNS 上の争点（後述） |
| `corporate.yamado.co.jp` | コーポレート（WP） | **現状維持（触らない）** — 変更頻度が低く autumn-book の対象外 |
| apex `yamado.co.jp` | （www へ誘導）+ MX/SPF | 現状維持。メールの根なので Web 用途に使わない |
| `stay.yamado.co.jp`（新設・名称要決定） | ─ | **ポータル**（全国マップ空室検索・会員マイページ・OAuth コールバック集約） |
| メール（両系統） | Xserver | **一切触らない**（MX/SPF/DKIM 維持） |

- ドメインは **yamado.co.jp 一本を継続**（SEO 履歴・メール・印刷物の資産）。新ドメイン取得はしない。
- ポータルを www に同居させない理由：www は「西和賀の宿のサイト」というブランド面。全社横断機能（地図検索・マイページ）は中立ホストに置く。apex はメールの根のため避ける。
- 将来ブランド（飲食/サウナ）は `（slug）.yamado.co.jp` を既定とし、独自ブランド色が必要になった業態のみ個別ドメイン（`reroute` 方式は brands テーブルにドメイン列を足すだけで対応可能）。

**実装**：単一 SvelteKit アプリ + Cloudflare Pages のマルチカスタムドメイン。SvelteKit の `reroute` フックで `Host` → 施設 slug を解決し内部 `/[brand]/[facility]/...` ルートへマップ（施設追加＝DNS + DB 行追加）。
**会員1ID**：Supabase Auth cookie を `.yamado.co.jp` 親ドメインに設定 → 施設サブドメイン + ポータル横断でログイン共有。社内 SSO（`.yamado.app`）とは registrable domain ごと分離。
**SEO**：施設サブドメインを canonical とし、内部パスへの直接アクセスは 301。サイトマップ・OGP・構造化データ（`Hotel`）はホスト別出力。

**DNS の選択肢（メール無停止が絶対条件）**：

| 案 | 内容 | 評価 |
|---|---|---|
| **A. zone を Cloudflare DNS へ移管（推奨）** | 全レコード（MX/SPF/DKIM/A）を完全コピーして NS 切替。www/oga/stay → Pages、corporate/apex → Xserver A のまま | ◎ oga の MX 同居が CNAME flattening で解ける。メール・corporate 無影響。WAF/キャッシュも付く |
| B. Xserver DNS のまま | www・stay は MX なしなので CNAME → Pages 可。**oga だけ MX 同居で CNAME 不可** | △ oga の解決に (b1) @oga メールを @yamado.co.jp に統合（公開済みアドレス変更のコスト）か (b2) 男鹿だけ別ホスト名、の妥協が要る |

**カットオーバー**：P1〜P2 は `*.pages.dev` か `stay.yamado.co.jp` 配下で先行公開 → コンテンツ同等を確認後、www / oga の DNS を切替（旧 WP 主要 URL の 301 マップを用意）。切替は施設ごとに独立して実施できる（例：男鹿を先行）。

### 4.0.1 DNS 移管ランブック（案A確定版・2026-06-10 実査に基づく）

**前提事実（実 DNS 照会で確認済み）**：
- レジストラ＝ムームードメイン、NS＝Xserver。NS 切替操作は yamado.app（ムームー→Cloudflare）で実績あり、同一手順。
- apex MX = `yamado.co.jp`（自分自身・pref 0）→ apex A（162.43.120.190）は移管後も**グレークラウド（DNS only）必須**。
- **⚠ oga.yamado.co.jp には MX レコードが存在しない**。info@oga 宛メールは「MX なし→ A レコードへ配送」という SMTP の暗黙フォールバックで届いている。**oga の A を Pages に向けた瞬間、@oga 宛メールが Cloudflare の proxy IP へ吸われて静かに不達になる**。Web 切替前に明示 MX の追加が必須（任意ではない）。
- DKIM：`default._domainkey.oga` あり／apex はなし。DMARC：apex に `p=none` あり。oga に google-site-verification TXT あり。**oga には SPF がない**（送信ドメインとしては未保護。移行ついでに追加推奨）。

**手順**：
1. **棚卸し**：Xserver DNS パネルで全レコードを書き出し（公開クエリに出ない管理用 TXT 等も含む）。
2. **事前修正（Xserver DNS 上で・NS 切替前に）**：`oga.yamado.co.jp MX 0 yamado.co.jp` を明示追加（配送先は同一サーバーなので挙動不変）＋ oga 用 SPF TXT を追加。数日メール送受信を確認。
3. **Cloudflare にゾーン作成**：自動スキャン結果を信用せず、棚卸しリストと突合して全レコード再現。メール系（apex A・MX・SPF・DKIM・DMARC）はすべてグレークラウド。www/oga はまず現 Xserver IP のまま作る。
4. **ムームードメインで NS を Cloudflare へ切替**。伝播後、新旧の応答一致を確認し、両メールドメインで送受信テスト。
5. **安定後に Web だけ切替**：www / oga を Pages の CNAME（オレンジ可）へ差し替え。MX が明示済みなので CNAME flattening + 「MX はグレーの apex を指す」構成でメール無影響。
6. 将来 Resend 等の送信サービス追加時は SPF に include 追記＋専用 DKIM セレクタ追加（既存 Xserver SPF と共存可）。

**メールの長期方針**：corporate WP が Xserver に残る以上、Xserver 契約は継続＝**メールも Xserver のままで追加コストゼロ**。Xserver を完全撤収したくなった時点で初めてメール移転（Google Workspace 等）を独立プロジェクトとして検討すればよく、本件とは切り離せる。

### 4.0.1 DNS 移管ランブック（案A・メール無停止）

**前提（2026-06-10 実査）**：レジストラ＝ムームードメイン、NS＝Xserver。yamado.app で「ムームー＋NS→Cloudflare」構成は実績済みのため、同一オペレーション。
**最重要発見**：`oga.yamado.co.jp` に **MX レコードが存在しない**。@oga.yamado.co.jp 宛メールは暗黙MX（Aレコードフォールバック）で Xserver に届いている。**明示 MX を置かずに oga の Web を Pages へ向けるとメールが止まる**。逆に明示 MX（暗黙より優先される）を先に置けば Web は自由に動かせる。
その他実査結果：apex MX＝apex 自身（pref 0）／SPF＝Xserver 標準／DMARC p=none あり／DKIM は oga 用セレクタ（default._domainkey.oga）のみ確認、apex 用は要 Xserver パネル確認。

```
Phase 0：Xserver DNS のまま事前整備（メールリスクをゼロ化してから移管する）
 0-1 Xserver パネルで全 DNS レコード棚卸し（公開クエリでは列挙不可。DKIMセレクタ・検証TXT・隠れサブドメインを台帳化）
 0-2 mail.yamado.co.jp A 162.43.120.190 を新設（メール専用ホスト。今後 Web と無関係に固定）
 0-3 明示 MX を整備：yamado.co.jp MX → mail.yamado.co.jp / oga.yamado.co.jp MX → mail.yamado.co.jp
 0-4 両ドメインで送受信テスト（外部Gmail⇔info@yamado.co.jp / info@oga.yamado.co.jp 往復）
 ※ この時点では何も移管しておらず、いつでも巻き戻せる

Phase 1：zone 移管
 1-1 Cloudflare に yamado.co.jp zone 作成、棚卸しレコードを全件再作成
     - メール系（mail A / MX / SPF / DKIM / DMARC）：全て DNS only（グレー雲）。MXターゲットを Proxy すると SMTP 不達
     - corporate / apex：A 162.43.120.190 のまま（corporate は Proxy 可・キャッシュ恩恵）
     - www / oga：当面 A 162.43.120.190 のまま（旧WP継続）
 1-2 ムームードメインで NS を Cloudflare 指定値へ変更（yamado.app と同手順）
 1-3 伝播後、dig で新旧全レコード一致を照合 → メール送受信を再テスト

Phase 2：Web 切替（autumn-book 完成後・施設ごと独立）
 2-1 oga → Pages カスタムドメイン化（CNAME）。メールは 0-3 の明示 MX で無影響
 2-2 www → 同上。stay.yamado.co.jp 新設
```

**メールの長期方針**：corporate WP が Xserver に残る限り Xserver 契約は継続するため、**メールは Xserver のままで追加コストなし・移行不要**。将来 Xserver を完全解約する局面で初めてメール移行（Google Workspace 等）を検討する。それは本件 DNS 移管とは独立した別プロジェクトであり、mail.yamado.co.jp に MX を集約しておけばその時の切替も MX 1行の変更で済む。

```
/                                    全体ポータル：ブランド一覧 + 全国マップ空室検索
/search                              マップ + リスト検索（?checkin&checkout&adults&children…）
/[brand]/                            ブランドトップ
/[brand]/[facility]/                 施設HP（写真・コンセプト・アクセス・空室カレンダー導線）
/[brand]/[facility]/rooms/[room]     部屋タイプ詳細
/[brand]/[facility]/plans/[plan]     プラン詳細（料金カレンダー付き）
/booking/hold                        仮押さえ → ゲスト情報入力
/booking/payment                     決済（Stripe Elements）
/booking/complete/[code]             完了（予約番号・マイページ誘導）
/account/                            マイページ（予約一覧・ポイント・お気に入り・プロフィール）
/account/reservations/[code]         予約詳細・変更・キャンセル
/auth/…                              ログイン・登録・OAuth コールバック
```

- `[brand]`/`[facility]` は `book.brands.slug` / `book.facility_contents.slug` を DB 解決（コード分岐なし）。
- 施設HPは SSR + Cloudflare エッジキャッシュ（コンテンツは ISR 的に revalidate）。検索・予約系は SSR + no-store。

---

## 5. API 層設計（anon セキュリティ境界）

**原則：anon キーから既存スキーマのテーブルを直接 SELECT させない。** 公開面はすべて以下のどちらかを通す。

### 5.1 公開ビュー（読み取り専用・公開可否フィルタ内蔵）

```sql
book.v_facilities      -- facility_contents × core.facilities（is_published のみ）
book.v_room_types      -- room_type_contents × pms.room_types
book.v_plans           -- plan_contents × booking.rate_plans（public_on_direct AND is_published）
```

anon に GRANT SELECT するのはこのビュー群と `book.facility_photos` のみ。

### 5.2 RPC（SECURITY DEFINER 関数）

| 関数 | 入力 | 出力 | 備考 |
|---|---|---|---|
| `book.search_availability` | 日付範囲・人数・地図 bounds（任意）| 施設ごとの「最低料金・残室数・lat/lng」 | マップ検索の心臓部。daily_rates×availability×stop_sell を集約。`STABLE`・1クエリで全施設分返す |
| `book.get_plan_calendar` | rate_plan_id・月 | 日別料金・残室・min_stay | 料金カレンダー用 |
| `book.quote` | room_type/plan/日程/人数構成 | 料金内訳（人数帯単価×泊数、子供区分、税） | hold 前の最終見積。`packages/core` と同一ロジックを SQL 側にも持たせ二重検証 |
| `book.create_hold` | quote 内容 | hold_id + expires_at | availability を version 付き UPDATE。競合時はリトライ→満室エラー |
| `book.confirm_booking` | hold_id・ゲスト情報・payment_intent_id | 予約番号 | §8 のトランザクション |
| `book.cancel_booking` | 予約番号 + 認証 | キャンセル料 | cancellation_policy スナップショットから算出、在庫戻し、Stripe 返金 |

- 検索系 RPC は Cloudflare 側で 60 秒程度の短期キャッシュ可（在庫の鮮度とトレードオフ。残り僅少時はキャッシュバイパス）。
- 決済 Webhook（Stripe）は Supabase Edge Function（service_role）で受け、`payment_status` を確定。

### 5.3 RLS 方針

> 実装規約（autumn-pms 設計書と統一）：ヘルパーは **`private.has_facility_access()` 等を直接呼ぶ**のが現行規約（20260605 estimates 以降）。RLS とは別に **`GRANT ... TO anon / authenticated` を忘れない**（grant がないと RLS 評価前に permission denied になる）。全テーブルに `tenant_id` + RLS（戦略Dの設計規律）。

| 対象 | anon | authenticated（会員） | 社内ロール |
|---|---|---|---|
| `book.v_*` ビュー・facility_photos | SELECT | SELECT | SELECT |
| `book.brands` / `*_contents` | ビュー経由のみ | 同左 | facility_admin 以上が編集 |
| `book.members` / `point_ledger` / `favorites` | ─ | **自分の行のみ**（user_id = auth.uid()） | superadmin のみ |
| `book.holds` | RPC 経由のみ | 同左 | facility staff 参照可 |
| `core.* / booking.* / pms.*` | **一切直接アクセス不可**（RPC 内部のみ） | 同左 | 既存 RLS のまま |
| マイページの予約参照 | ─ | RPC `book.my_reservations()`（member→guest_id→stays 連結） | 既存 RLS |

---

## 6. 地図検索（マップ空室・料金表示 + アクセス案内）

### 6.1 技術選定

- **MapLibre GL JS** + **OpenFreeMap タイル**（API キー不要・無償）。日本の地名表示を確認の上、不足なら国土地理院ベクトルタイルに差し替え。
- 施設数は当面 2（西和賀・男鹿）〜十数件想定。クラスタリング不要、**全施設を1回の RPC で取得**してクライアント側で描画する。

### 6.2 画面挙動（一休の「地図から探す」を参考）

```
┌──────────────────────────────┬───────────────┐
│  地図（東北→全国）              │ 施設カードリスト │
│   ⛰ ピン=施設                  │  写真・名称      │
│   ピンバッジ: 「¥23,100〜」     │  最低料金・残室   │
│   満室は灰色「満室」            │  「プランを見る」 │
└──────────────────────────────┴───────────────┘
  上部バー: [日付 2泊] [大人2・子供0] [検索]
```

- 日付・人数を変えると `search_availability` を再実行しピンのバッジが更新される。
- 日付未指定でも地図は出す（料金は「参考最低料金」表示）→ 施設HPへの SEO 入口を兼ねる。
- ピン/カードのホバー・タップで相互ハイライト（モバイルはボトムシートにカード）。

### 6.3 交通アクセス案内

`book.facility_contents.access` (jsonb) に構造化して持ち、施設HPと地図パネル両方で描画：

```jsonc
{
  "car":    [{ "from": "盛岡IC", "route": "秋田道 湯田IC 経由", "minutes": 70 }],
  "train":  [{ "from": "JR ほっとゆだ駅", "via": "送迎（要予約）", "minutes": 10 }],
  "air":    [{ "from": "いわて花巻空港", "minutes": 90 }],
  "shuttle": { "available": true, "note": "ほっとゆだ駅から無料送迎・前日まで要予約" },
  "parking": { "available": true, "capacity": 20, "fee": "無料" }
}
```

- Google Maps へのディープリンク（`https://www.google.com/maps/dir/?api=1&destination=lat,lng`）で経路検索はGoogleに委譲（自前で経路APIは持たない＝費用ゼロ）。
- 送迎要予約の施設は予約フローの「ゲスト情報」ステップに送迎希望チェックを出す（hold の jsonb に格納 → bookings.notes へ）。

---

## 7. UX/UI 設計（一休.com 参考の要素分解）

一休の使いやすさを構成する要素を分解し、採用可否を決める：

| 一休の要素 | 採用 | autumn-book での実装 |
|---|---|---|
| 検索条件（日付・人数）が全ページで常時編集可能なスティッキーバー | ◎ | 全ルート共通レイアウトに検索バー。変更すると料金が画面遷移なしで再計算 |
| 部屋×プランのマトリクスではなく「プランカード」一覧 + 絞り込み（食事・部屋タイプ・特典） | ◎ | `/[facility]/` 配下のプラン一覧。highlight_tags で絞り込みチップ |
| 料金は**総額・税込・1室あたり**を主表示、1人あたりを併記 | ◎ | quote RPC が両方返す。「2名1室 ¥46,200（1名 ¥23,100）」 |
| 料金カレンダー（月表示で日別最安値・残室・◎○△×） | ◎ | `get_plan_calendar`。プラン詳細と施設トップの両方に設置 |
| キャンセルポリシーと「何日前まで無料」を予約ボタンの直近に明示 | ◎ | rate_plans.cancellation_policy スナップショットから「6/20まで無料」と動的文言化 |
| ポイント即時利用（今回の予約にすぐ使える） | ◎ | §3.2 台帳方式 |
| 未ログインで最後まで進め、決済直前に会員/ゲスト分岐 | ◎ | hold は session ベース。会員登録すると入力済み情報を引き継ぎ |
| 残り室数の希少性表示（「残り1室」） | ◎ | available_rooms ≤2 のとき表示。虚偽表示はしない（実数のみ） |
| 写真の大判ギャラリー・カテゴリタブ（客室/温泉/食事） | ◎ | facility_photos.category |
| タイムセール・会員ランク別料金 | △ 後続 | promo_codes は既存。シークレットオファー（旧仕様）は Phase 3 |
| 口コミ・評価 | ✕ 当面 | 自社2施設では母数が薄い。Google レビューへの外部リンクで代替 |

### 予約フロー（4ステップ・離脱最小化）

```
① プラン詳細 ─ 日付・人数確定・料金内訳表示
② [予約する] → create_hold（20分タイマー表示）→ ゲスト情報（会員はプリフィル）
③ 決済（事前カード払いプランのみ Stripe Elements・3DS / 現地払いはスキップ）
④ confirm_booking → 完了画面（予約番号・カレンダー追加・マイページ誘導）
```

- 各ステップは1画面1目的。入力項目は氏名・カナ・電話・メール + 送迎/到着時刻のみ（一休同様、住所は取らない）。
- デバッグ方針（全社共通）：`const DEBUG = true` + `dbg()` + デバッグパネルを開発初期から実装。

---

## 8. 予約確定トランザクション（整合性の核心）

```
confirm_booking(hold_id, guest_info, payment_intent_id?) -- SECURITY DEFINER, 1トランザクション
 1. hold を行ロック・status='active' かつ未失効を検証
 2. 事前決済プランなら Stripe PaymentIntent を Edge Function 経由で検証（succeeded/requires_capture）
 3. core.guests upsert（guest_identities で email/phone 照合）
 4. **PMS と同一の展開形で書く**：pms.stay_groups INSERT（代表者・言語・予約対応者='web'）
    → core.stays INSERT（部屋単位, status='reserved', 人数内訳, stay_group_id）
    → pms.stay_nights INSERT（部屋×泊, 単価・プラン・人数）
    ※ pms スキーマ拡張（autumn-pms v0.1）適用前は core.stays + bookings のみで動かし、
      適用後に展開を追加する移行可能設計とする（confirm_booking 内部の差し替えで済む）
 5. booking.bookings INSERT（channel='autumn_booking', 金額内訳, cancellation_policy snapshot,
    payment_status, member ポイント利用額）
    ※ TL 取込予約と直販予約が同じ「bookings → stay 展開」パイプラインを通ることで、
      PMS の Wブッキング検知・顧客マルチキー照合ロジックを共用できる
 6. hold.status='converted'（在庫は hold 時点で減算済みのため追加減算なし）
 7. book.point_ledger に利用(-)・付与予定(+)を記帳
 8. 予約確定メール送信ジョブ enqueue（Resend / Edge Function）
 9. TL-リンカーン在庫減算通知を enqueue（autumn-shared の SC 配信機構を呼ぶ非同期ジョブ。
    失敗時は booking.sync_logs に記録しリトライ + RMS 画面でアラート）
```

- **ダブルブッキング防止の二段構え**：hold 時の version 楽観ロック減算 + SC への非同期反映。SC 反映が遅延する窓は buffer_rooms（既存カラム）で吸収する運用。
- キャンセルは逆順（在庫戻し → Stripe 返金 → ポイント巻き戻し → SC 通知 → メール）。
- 予約変更（日程・人数）は「新 hold 作成 → 旧予約をアトミックに付け替え」で実現。`bookings.status='modified'` と履歴を残す（星野リゾートの教訓：問い合わせの4割が変更要望）。

---

## 9. 非機能要件

| 項目 | 方針 |
|---|---|
| SEO | 施設HP・プラン詳細は SSR + 構造化データ（schema.org `Hotel` / `Offer`）。OGP 画像は施設写真 |
| 性能 | LCP < 2.5s。画像は Cloudflare Images or `_image` リサイズ。検索 RPC は単一クエリ集約 |
| 可用性 | Cloudflare Pages エッジ配信。Supabase 障害時は施設HP（静的キャッシュ）は閲覧可・予約のみ停止のフェイルソフト |
| セキュリティ | anon は RPC/ビューのみ。レート制限（Cloudflare WAF + RPC 内で hold 連打制限）。カード情報非保持（Stripe 直収） |
| 監視 | sync_logs + RESERVATION 系イベントを rms の管理画面から閲覧。決済不一致は日次照合（balance-match スキルと将来連携） |
| アナリティクス | **Google Analytics 4（決定・2026-06-10）**。全ホスト（www / oga / ポータル）を単一 GA4 プロパティ + クロスドメイン計測で統合。予約ファネル（検索→プラン閲覧→hold→確定）をイベント送信し、`purchase` イベントに予約金額を載せて施設別 CV を計測。同意バナー（Consent Mode v2）を共通レイアウトに実装 |
| エラートラッキング | **Sentry（決定・2026-06-10）**。`@sentry/sveltekit` でクライアント＋サーバ（Cloudflare Pages）両方を計測。Supabase Edge Functions（決済 Webhook・SC 通知）も Sentry Deno SDK で送信。決済・予約確定フローのエラーはアラート通知（メール/LINE WORKS）。PII（氏名・連絡先）は beforeSend でマスク |
| i18n | MVP は日本語のみ。`paraglide` 等を入れられるよう文言はメッセージ化しておく |
| 法令 | 特商法表記・旅館業約款・プライバシーポリシーの静的ページ。宿泊税（導入自治体のみ）対応は金額内訳の拡張点として確保 |

---

## 10. 実装ロードマップ

| Phase | 内容 | 完了条件 |
|---|---|---|
| **P0 基盤** | リポ初期化（pnpm workspace + SvelteKit + Tailwind）、autumn-shared 同期、`book` スキーマ migration（autumn-shared に PR）、HANDOFF.md | dev で空ページが Cloudflare Pages に出る |
| **P1 施設HP** | brands/facility_contents/photos + 公開ビュー、`/[brand]/[facility]/` SSR、アクセス案内 | 西和賀・男鹿の施設ページ公開可能 |
| **P2 検索** | search_availability RPC、地図検索画面、料金カレンダー | 日付・人数で2施設の空室・料金が地図に出る |
| **P3 予約** | quote/create_hold/confirm_booking、ゲスト予約（決済なし=現地払いプランのみ）、確定メール、SC 在庫通知 | テスト予約が bookings/stays に入り TL に反映 |
| **P4 決済** | **Stripe 統合（導入決定済み）**：事前決済プラン、キャンセル・返金 | 3DS 込みの事前決済が通る |
| **P5 会員** | Auth + members/名寄せ、マイページ、ポイント、お気に入り | 会員予約 → マイページで予約・ポイント確認 |
| **P6 オプション予約** | 貸切風呂（時間枠）・エステ・ケーキ等の予約（§15.2）。PMS 側テーブル（v0.4〜0.7）に依存 | 予約済みゲストが貸切風呂をWeb予約できる |
| **P7 CRM 配信** | ステップメール（§15.6）→ メルマガ（§15.5） | 予約者に日数連動メールが自動配信される |
| **P8 電子インフォメーション** | 客室QR → 滞在者向けページ（§15.3） | 客室QRから自分の食事時間・館内案内が見える |
| **P9 チャットボット LLM 版** | §15.1（静的FAQ検索は P1 の施設HPに同梱） | ─ |
| **P10 拡張** | 予約変更、シークレットオファー、プロモコード、宿泊券（ふるさと納税/自社）コード利用、ブランド type 追加（飲食/サウナ） | ─ |

各 Phase 完了時に HANDOFF.md のテストチェックリストを更新・実走（全社テスト方針：`- [ ]` のまま残す）。

---

## 11. 必要な migration 一覧（autumn-shared へ追加するもの）

```
YYYYMMDDHHMMSS_book_schema.sql            -- book スキーマ + brands/facility_contents/photos/
                                          --   room_type_contents/plan_contents + 公開ビュー + RLS
YYYYMMDDHHMMSS_book_members.sql           -- members/member_ranks/point_ledger/favorites + RLS
YYYYMMDDHHMMSS_book_holds.sql             -- holds + 失効解放の pg_cron
YYYYMMDDHHMMSS_book_rpc_search.sql        -- search_availability/get_plan_calendar/quote
YYYYMMDDHHMMSS_book_rpc_booking.sql       -- create_hold/confirm_booking/cancel_booking/my_reservations
--- 以下は P6 以降（§15 サブシステム） ---
YYYYMMDDHHMMSS_book_email_sequences.sql   -- email_sequences/sequence_steps/email_sends（ステップメール）
YYYYMMDDHHMMSS_book_mail_campaigns.sql    -- mail_campaigns/mail_sends（メルマガ）
YYYYMMDDHHMMSS_book_option_products.sql   -- option_products + オプション予約 RPC（PMS テーブル前提）
YYYYMMDDHHMMSS_book_stay_tokens.sql       -- stay_access_tokens + house_guides（電子インフォメーション）
YYYYMMDDHHMMSS_book_faq_chat.sql          -- faqs/chat_logs（チャットボット）
```

適用フローはプラットフォーム標準に従う：autumn-shared に PR → **GitHub Integration により main マージ時に自動適用**（autumn-pms 設計書の確定事項。検証が必要な変更は rms フローどおり Supabase DEV ブランチで先行確認）。グローバル CLAUDE.md の「main 1本 + 手動 push」既定とは異なり、**autumn プラットフォームでは自動適用が稼働中**のためこちらが正。

また `core.guests` / `booking.rate_plans` への列追加は autumn-pms v0.1 の migration と競合しうるため、**book 用 migration の作成前に autumn-pms の進捗（pms スキーマ拡張の適用状況）を必ず確認**する。

---

## 12. 旧仕様（autumn_book_spec / full_spec / erd）との差分

| 旧仕様 | 本設計 | 理由 |
|---|---|---|
| FastAPI + 独自DB | SvelteKit + 共有 Supabase | rms/order と同一スタック・同一DB。二重マスタ排除 |
| 在庫の正 = TL-リンカーン | 正 = `booking.availability`、TL は OTA 配信先 | プラットフォーム側に在庫・楽観ロックが既に実装済み。直販が TL を経由すると遅延と手数料の不利 |
| bigint ID・独自 facilities/room_types/rate_plans | 既存 uuid テーブルを参照 | スキーマ二重化の回避 |
| OPTIONS / RESERVATION_OPTIONS（オプション販売） | **P6 へ引き継ぎ**（`book.options` 系として将来追加） | 良いアイデアだが MVP の予約成立を優先 |
| SECRET_OFFERS / MAIL_CAMPAIGNS | P6 へ引き継ぎ | 同上。promo_codes（既存）で一部代替可 |
| CANCELLATION_POLICIES 正規化テーブル | `rate_plans.cancellation_policy`（JSONB・既存）+ 予約時スナップショット | 既存実装に合わせる。表現力は同等 |
| MEMBER_RANKS / RANK_HISTORIES | `book.member_ranks` として継承（履歴は point_ledger と統合検討） | 概念維持・実装簡素化 |
| Benchmark Email 会員同期 | 継続方針（is_mail_opt_in を同期キーに） | 旧仕様どおり |

---

## 13. 開発運用ルール

- **設計は Fable 5、実装は Opus 4.8**（autumn-pms 設計書 §8 と同一ルール）。
- バージョン管理・コミット規約・チェックリスト型手動テスト（HANDOFF.md）・DEBUG フラグ方針はグローバル CLAUDE.md に従う。
- PMS の予約展開パイプライン（stay_groups / stay_nights / Wブッキング検知）は autumn-pms 側の実装を共用する。autumn-book で二重実装しない。

## 14. 未決事項（要ユーザー判断）

### ドメイン関連（§4.0 の決定に伴う派生論点）

1. ~~DNS zone の Cloudflare 移管可否~~ → **案Aで実施可能と確認済み（§4.0.1 ランブック）**。残作業は Xserver パネルでの全レコード棚卸しと実施タイミングの決定のみ。
2. **ポータルのホスト名**：`stay` / `book` / `go` / `member` 等の命名決定。
3. **旧 WP サイトの扱い**：切替時期・301 マップ・WP 上の既存予約導線（現在どの予約エンジンに飛んでいるか）の確認。切替順序（男鹿先行か同時か）。
4. **送信メールドメイン**：予約確定メールを `@yamado.co.jp`（または施設別 `@oga.yamado.co.jp`）から Resend 等で送る場合、既存 Xserver SPF（`include:spf.sender.xserver.jp`）に送信サービスを追記する形で共存させる。DKIM はサービス側セレクタで独立追加可。

### 事業・UX 関連

5. **LINE ログイン**：顧客層的に効果が大きい見込みだが、LINE Developers のチャネル開設が必要。
6. ~~Stripe 導入可否~~ → **導入決定（2026-06-10）**。残る判断は**アカウント構成**：施設別（西和賀/男鹿で口座が分かれるか）か単一か。`payments.facility_id` の扱いに影響。
7. **buffer_rooms の運用値**：SC 反映遅延の吸収幅（各施設の室数規模では 0〜1 が現実的）。
8. **写真素材**：facility_photos に入れる公式写真の調達・リサイズフロー。
9. **料金パリティ方針**：直販は OTA 手数料がない分、ベストレート保証（直販最安 or ポイント分お得）を打ち出すか。一休等 OTA との価格関係の社内ルール化。
10. **ポイント原資・付与率**：member_ranks の還元率設計（一休は 1〜2%＋即時利用が訴求軸）。
11. **子供料金の見せ方**：daily_rates の child a〜e 区分は現在未使用。直販で子供料金を受けるか、当面「大人のみ予約可・子供は電話」とするか。
12. **多言語**：FileMaker 帳票に EN/TW があり インバウンド実需あり。施設HPの英語版を P どこに置くか。

### 新規サブシステム関連（2026-06-10 追加要件・§15）

13. **メルマガ配信基盤**：Resend に統一（推奨・トランザクションメールと同一スタック）か、Benchmark Email 継続（旧仕様の会員同期資産）か。
14. **チャットボットの応答範囲**：FAQ 回答に限定か、空室照会まで踏み込むか。回答不能時のエスカレーション先（電話/メール/有人チャット）。
15. ~~**電子インフォメーションの提供形態**：ゲスト自身のスマホ（客室QR）前提か、客室タブレット設置か。~~ → **決定（2026-06-15）：ゲスト自身のスマホ＋チェックイン時の印刷QRスリップ。TV配信は保留。詳細＝`autumn_book_inroom_design.md`**
16. **オプション予約の販売条件**：貸切風呂の枠数・予約開始タイミング（予約確定後すぐ/N日前から）・キャンセル規定・料金（無料/有料/プラン込み）。
17. **ステップメールの文面・タイミング**：§15.6 の既定案（7日前/3日前/前日/翌日）の現場確認。

---

## 15. 追加サブシステム設計（2026-06-10 追加要件）

### 15.1 チャットボット Q&A

- **配置**：施設HP・ポータル全ページの右下ウィジェット + 電子インフォメーション（§15.3）内。
- **構成**：SvelteKit server route → Claude API（コスト重視で claude-haiku-4-5、品質不足なら sonnet へ）。システムプロンプトに**その施設の構造化データを注入する RAG-lite**（book.v_facilities のアクセス・設備・チェックイン時刻 + `book.faqs`）。ベクタDB は施設2軒の FAQ 規模では不要。
- **データ**：`book.faqs`（facility_id, category, question, answer, is_published, sort_order）— FAQ は静的表示（P1 の施設HPに同梱）と LLM の知識源を兼ねる。`book.chat_logs`（匿名 session_id, 質問, 回答, 解決フラグ）を改善用に保存。
- **ガードレール**：予約操作・料金確約はさせない（検索/予約ページへのリンク誘導のみ）。回答不能時は電話・メールへ誘導。IP/セッション単位のレート制限。DEBUG フラグでプロンプト・応答をログ出力。
- **段階導入**：C1=静的 FAQ 検索（LLM なし・P1）→ C2=LLM 応答（P9）。

### 15.2 オプションサービス予約（貸切風呂・エステ・ケーキ等）

旧仕様の OPTIONS 構想を、**PMS 実テーブルを在庫の正とする形**で実装する（二重管理しない）。

- **2類型**：
  - **時間枠型**：貸切風呂（一寸）= `pms.private_bath_slots`、マッサージ = `pms.relaxations`。枠の在庫は PMS テーブルそのもの。
  - **数量型**：ケーキ・花・お心付け = `pms.stay_amenities`。
- **顧客向けコンテンツ層**：`book.option_products`（PMS マスタ 1:1 の見せ方：写真・説明・価格表示・販売条件・予約可能期間）。plan_contents と同じパターン。
- **導線（クロスセル設計）**：①予約完了画面の直後 ②マイページ予約詳細から追加 ③ステップメール3日前便（§15.6）のリンク ④電子インフォメーション（§15.3）から滞在中追加。
- **RPC**：`book.list_option_slots(stay)` / `book.reserve_option(stay, product, slot/qty)`。**予約済みゲスト（stay 紐付け）のみ予約可**。SECURITY DEFINER で PMS テーブルへ書き込み、現場の帳票（一寸予約表）に自動反映される。
- **決済**：基本は現地精算（`pms.bill_items` に連携）。有料オプションの事前決済は Stripe 追加決済として将来拡張。
- **依存**：pms.private_bath_slots 等は autumn-pms v0.4〜0.7 で実装予定。それまでは P7 に着手しない（先に作るなら autumn-pms 側と migration を共同設計）。

### 15.3 客室用電子インフォメーション

> **2026-06-15 更新**：本節を実装方式まで具体化し、新要件「客室からの内線電話」「客室Braviaへの配信」を加えた詳細設計を **`autumn_book_inroom_design.md`** に分離（26エージェントの敵対的レビュー反映済み）。決定要点＝提供形態はゲスト自身のスマホ／配布はチェックイン時の印刷QRスリップ→httpOnlyセッション交換・チェックアウト即時失効／内線は弱電波対策でWi-Fi WebRTC→Twilio→固定電話・ネイティブアプリ不要／TV配信は保留。migration 下書き＝`autumn-shared/.../20260615120000_book_inroom.sql`。以下は原案（概念）。

- **アクセス方式**：客室設置の QR → `https://（ポータル）/r/[token]`。`book.stay_access_tokens`（stay_id, token, valid_from/to=滞在期間, last_used_at）。チェックイン処理時に PMS が発行（部屋常設QRの場合は部屋番号+姓で本人確認後にトークン発行）。ゲスト自身のスマホ前提・アプリ不要。
- **表示内容**：
  - 館内案内：`book.house_guides`（facility_id, section, title, body, lang, sort_order）— 営業時間・館内図・Wi-Fi・注意事項
  - **自分の滞在情報**：夕食・朝食時間（`pms.night_services`）、部屋名、チェックアウト時刻
  - 貸切風呂の空き枠表示 + その場で追加予約（§15.2 連携）
  - チャットボット（§15.1）
  - autumn-order への注文リンク（館内飲食・売店）
  - チェックアウト案内（PMS のスマートチェックアウト＝請求書事前送付と連動）
- **RPC**：`book.stay_info(token)`（SECURITY DEFINER・トークン有効期間内のみ・該当 stay の情報だけ返す）。
- **多言語**：house_guides.lang で JP/EN/TW（FileMaker 館内図の言語展開を踏襲）。

### 15.4 Stripe 決済（導入決定 → P4）

§8 の設計どおり。決定事項として確定：
- PaymentIntent + 3DS（SCA）必須。カード情報は Stripe 直収（自社非保持・PCI DSS SAQ-A 相当）。
- Webhook は Supabase Edge Function（service_role）で受信し `payment_status` を確定。署名検証必須。
- 返金は `cancel_booking` RPC から Stripe Refund API。キャンセル料差引返金に対応。
- 未決はアカウント構成のみ（§14-6：施設別か単一か）。

### 15.5 メルマガ配信（会員向け）

- **データ**：`book.mail_campaigns`（title, body_html/text, segment jsonb, status: draft/scheduled/sending/sent, scheduled_at, stats jsonb）+ `book.mail_sends`（campaign_id, member_id, status, sent_at, opened_at — UNIQUE(campaign_id, member_id) で二重送信防止）。旧仕様 MAIL_CAMPAIGNS の継承。
- **セグメント**：rank / is_mail_opt_in / 宿泊履歴（施設・最終宿泊日・回数 = guest_stats 参照）/ お気に入り施設。segment jsonb に条件を保存し配信時に評価。
- **配信基盤**：推奨は **Resend**（トランザクションメールと同一スタック・Audiences/Broadcasts）。Benchmark 継続案との比較は §14-13。
- **法令**：特定電子メール法準拠 — オプトイン記録（joined_at + is_mail_opt_in）、全メールに配信停止リンク（ワンクリックでマイページ経由せず停止）、送信者表示。
- **管理UI**：rms/pms と同様の社内画面（autumn-book リポ内 `/admin` か rms への同居かは実装時判断）。

### 15.6 ステップメール（予約者向け）

予約確定を起点に checkin_date 相対で自動配信するシーケンス。

| タイミング | 内容 | 狙い |
|---|---|---|
| 確定直後 | 予約確定（P3 で実装済みの確定メール） | ─ |
| 7日前 | アクセス・送迎案内（要予約送迎のリマインド）・服装/気候 | 不安解消・電話問い合わせ削減 |
| 3日前 | 食事内容・**貸切風呂等オプションのクロスセル**（§15.2） | 客単価向上 |
| 前日 | リマインド・チェックイン時刻確認・到着予定の回答リンク | 無断キャンセル防止・現場準備 |
| 翌日 | サンクス・クチコミ依頼・再訪クーポン/ポイント案内 | リピート促進 |

- **データ**：`book.email_sequences`（facility_id, name, is_active）+ `book.sequence_steps`（sequence_id, offset_days（負=前、正=後）, template_code, send_hour）+ `book.email_sends`（booking_id, step_id, status, sent_at — **UNIQUE(booking_id, step_id) で重複送信を構造的に防止**）。
- **実装**：pg_cron 日次（朝） + pg_net → `/api/cron/step-mails`（Bearer=CRON_SECRET・rms 実証パターン）→ 対象予約を抽出し Resend 送信。キャンセル済み予約の未送分は自動スキップ。直前予約（3日前以降の予約）は該当ステップを飛ばして次から。
- **文面**：施設別テンプレート（差込変数：氏名・日程・部屋・プラン・送迎有無）。タイミング・文言の既定案は §14-17 で現場確認。

