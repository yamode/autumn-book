# autumn-book おたよりポイント 設計書（v1）

最終更新: 2026-06-21
関連: 会員・ポイント基盤＝`autumn_book_design.md` §3.2 / 既存 migration `20260611100200_book_members.sql`・`20260611100500_book_rpc_booking.sql`。実装作法の前例＝`autumn_book_forum_design.md`（RPCファースト・deny-all RLS・demo/supabase 二層）。

---

## 0. 目的（事業要件）

- 通常の**会員ポイント（1pt=1円）とは別建て**で、**おたよりポイント（1pt=1,000円相当）**を管理する。
- **YouTube でおたよりを投稿してくれた視聴者に1ptを進呈**する。おたより投稿フォームは autumn-book 内に作り、**専用URL（`/otayori`）を YouTube 概要欄にだけ掲載**する。
- フォームへの投稿には**会員登録（無料）が必須**。未ログインには会員登録 CTA を出す。
- **既存のおたよりポイント保持者**（番組開始前から貯まっている人）には、**運営が会員ごとに手動で付与**できる。

## 1. アーキテクチャ判断（確定事項）

### 1.1 専用テーブルで別建て（＝既存 `point_ledger` に相乗りしない）

通常ポイントとおたよりポイントは**金額単位が1,000倍違う**（通常 1pt=1円 / おたより 1pt=1,000円）。既存 `book.point_ledger` は **残高 = `SUM(delta)`** を前提に、`book.point_balance()`・`confirm_booking` / `cancel_booking` RPC・会員管理UIの**すべてが「1pt=1円の単一プール」を暗黙の前提**にしている（`20260611100200` / `20260611100500` 実査済み）。

ここへ1pt=1,000円の行を混ぜると、`SUM(delta)` が「500円分＋3,000円分」を `503` と返すような**単位取り違え事故**が、種別フィルタを入れ忘れた箇所すべてで発生する。`kind` カラム相乗りは全消費箇所の改修と恒久的な事故リスクを抱える。**テーブルを分ければ単位の混在は構造的に不可能**になり、PROD 適用済みの予約 RPC にも一切触れずに済む。台帳の「逆仕訳＋`SUM` 残高」という実績あるパターンはそのまま流用する。

| 観点 | 専用テーブル（採用） | `point_ledger` に `kind` 相乗り（不採用） |
|---|---|---|
| 単位混在事故 | 構造的に不可能 | `kind` フィルタ漏れで恒久リスク |
| 既存 `point_balance()` / 予約RPC / 会員UI | 無改修 | 全消費箇所に `kind` 条件を追加 |
| 失効・還元率など別ルール | 自テーブルに閉じる | 既存ロジックに分岐が増える |
| コスト | テーブル/RPCを別に作る（パターンは流用） | 改修点が広く回帰リスク大 |

### 1.2 ユーザー確定事項（2026-06-21）

| 決定 | 内容 |
|---|---|
| 持ち方 | **専用テーブル新設**（`book.otayori_ledger` / `book.otayori_posts`） |
| 付与の確定 | **運営の承認時に付与**。フォーム投稿は `pending`、運営が承認した投稿だけ1pt（連打スパムによる金銭流出を防止） |
| 有効期限 | **無期限**（`expires_at` を持たない。残高＝付与累計−利用累計） |

### 1.3 用語・定数

- UI 表記＝**「おたよりポイント」**。単位は `pt`、補足「**1pt = 1,000円分**」を併記。
- 換算定数 `OTAYORI_POINT_YEN = 1000`（`apps/web/src/lib/types.ts` に置く）。
- 通常ポイントは従来どおり「ポイント」表記（1pt=1円）。両者を同じ画面に並べるときは見出しで明確に分ける。

## 2. ロールと権限

セッションは既存 `SessionUser`（`role: 'member' | 'staff' | 'admin'`）をそのまま使う。

| 操作 | 未ログイン | member | staff | admin |
|---|---|---|---|---|
| `/otayori` フォーム閲覧 | ✅（CTA表示） | ✅ | ✅(注) | ✅(注) |
| おたより投稿（申請） | — | ✅ | —(注) | —(注) |
| 自分のおたよりpt残高・履歴・投稿状況の閲覧 | — | ✅ | ✅ | ✅ |
| 投稿一覧の閲覧（管理） | — | — | ✅ | ✅ |
| 投稿の却下 | — | — | ✅ | ✅ |
| **投稿の承認（＝1pt付与）** | — | — | — | ✅ |
| **会員別の手動付与/調整** | — | — | — | ✅ |

- 注: おたより投稿は**会員（`book.members` 行が存在する人）に限定**する（事業要件「会員登録が必須」）。staff/admin は運営アカウントのため投稿フォームは出さず、案内文を表示。
- **付与を伴う操作（承認・手動付与）は admin 限定**。これは既存 `adjust_points`（admin 限定）と揃える＝1pt=1,000円の発行は金銭価値があるため。却下・一覧閲覧は staff も可。
- ガードは既存 `private.has_tenant_access(tenant)`（staff相当）/ `private.is_tenant_admin(tenant) or private.is_superadmin()`（admin相当）を流用。テナントは現状シングル（`select id from core.tenants order by created_at limit 1`）。

## 3. データモデル（demo・`types.ts` 追加分）

```ts
/** おたよりポイント台帳（book.otayori_ledger 対称）。1pt = OTAYORI_POINT_YEN 円 */
export interface OtayoriEntry {
	id: string;
	memberId: string;
	delta: number;            // +N 付与 / -N 利用・巻き戻し
	reason: string;           // 'YouTubeおたより投稿' / '【手動付与】…' / 'ご予約での利用（code）' …
	sourcePostId?: string;    // 投稿起点の付与
	bookingCode?: string;     // 予約利用・巻き戻し（Phase 2）
	createdAt: string;
}

/** おたより投稿（book.otayori_posts 対称） */
export interface OtayoriPost {
	id: string;
	memberId: string;
	body: string;             // おたより本文（plain text）
	radioName?: string;       // 番組で読む用のラジオネーム（任意）
	status: 'pending' | 'approved' | 'rejected';
	reviewNote?: string;      // 却下理由など
	createdAt: string;
	reviewedAt?: string;
}

/** 管理画面の投稿一覧行（会員の内部識別を含む。公開画面には出さない） */
export interface OtayoriAdminItem {
	id: string;
	memberId: string;
	memberCode: string;       // YM-XXXXXX
	memberName: string;       // 内部表示用（core.guests.name 相当）
	radioName?: string;
	body: string;
	status: 'pending' | 'approved' | 'rejected';
	createdAt: string;
}

export const OTAYORI_POINT_YEN = 1000;
```

- `Booking` に `otayoriUsed?: number`（Phase 2・予約で使ったおたよりpt数）を追加。
- `Hold` に `otayoriDraft?: number`（Phase 2・②→③へ引き継ぐ利用ドラフト）を追加。

## 4. demo ストア（`store.ts` 追加関数）

`pointLedger` と同じ流儀で `otayoriLedger: OtayoriEntry[]` と `otayoriPosts: OtayoriPost[]` を保持。バリデーション: 本文 trim 後 1〜2000 字、ラジオネーム ≤40 字、未審査（pending）は会員あたり5件まで。

```ts
otayoriBalance(memberId: string): number            // SUM(delta)
listMyOtayori(memberId: string): { balance: number; ledger: OtayoriEntry[]; posts: OtayoriPost[] }

submitOtayori(memberId: string, body: string, radioName?: string):
	{ post: OtayoriPost } | { error: 'invalid' | 'too_many_pending' }
	// status='pending' で登録。ポイントはまだ付与しない

listOtayoriAdmin(status: 'pending' | 'approved' | 'rejected'): OtayoriAdminItem[]
	// memberCode / memberName を結合して返す。createdAt 降順

approveOtayori(postId: string, actor: string):                       // admin
	OtayoriPost | { error: 'not_found' }
	// pending/rejected → approved。otayoriLedger に +1（reason='YouTubeおたより投稿'・sourcePostId 紐付け）
	// 既に approved なら冪等（再付与しない＝sourcePostId で重複防止）。auditLogs 記帳

rejectOtayori(postId: string, note: string, actor: string):          // staff
	OtayoriPost | { error: 'not_found' }                            // auditLogs 記帳

grantOtayori(memberId: string, delta: number, reason: string, actor: string):  // admin
	void
	// otayoriLedger に delta（reason='【手動付与】'+reason）。delta は正負可（誤付与の訂正用）。auditLogs 記帳
```

Phase 2（予約利用）で `confirmBooking` / `cancelBooking` / `quoteFor` を拡張（§8）。

## 5. DB（book スキーマ・migration 1本）

`autumn-shared/supabase/migrations/20260621xxxxxx_book_otayori.sql`（タイムスタンプは作成時刻。autumn-shared main へ直接 push = PROD 自動適用。プロジェクトルールどおり）。**Phase 1 はテーブル2・RPC8。Phase 2 の予約利用拡張（§8）は P4 で別 migration**。

### 5.1 テーブル

```sql
-- おたより投稿
create table book.otayori_posts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenants(id),
  member_user_id uuid not null references book.members(user_id) on delete cascade,
  body           text not null,
  radio_name     text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  review_note    text,
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index otayori_posts_queue_idx  on book.otayori_posts (tenant_id, status, created_at desc);
create index otayori_posts_member_idx on book.otayori_posts (member_user_id, created_at desc);

-- おたよりポイント台帳（1pt=1,000円。残高=SUM(delta)・無期限）
create table book.otayori_ledger (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references core.tenants(id),
  member_user_id uuid not null references book.members(user_id) on delete cascade,
  delta          integer not null,
  reason         text not null,
  source_post_id uuid references book.otayori_posts(id),
  booking_id     uuid references booking.bookings(id),   -- Phase 2 の予約利用・巻き戻し
  created_at     timestamptz not null default now()
);
create index otayori_ledger_member_idx on book.otayori_ledger (member_user_id, created_at desc);
-- 1投稿につき付与は1回まで（承認の二重付与を構造的に防止）
create unique index otayori_ledger_post_award_idx
  on book.otayori_ledger (source_post_id) where source_post_id is not null;
```

### 5.2 RLS / GRANT 方針（forum と同一作法）

```sql
alter table book.otayori_posts  enable row level security;
alter table book.otayori_ledger enable row level security;
grant all on book.otayori_posts, book.otayori_ledger to service_role;
```

- 2テーブルとも RLS 有効・**ポリシーなし（deny-all）**。anon / authenticated へのテーブル GRANT は**一切しない**。アクセスは全て下記 `security definer set search_path = ''` RPC 経由。
- これにより `member_user_id`（= auth.users.id）や他会員の本文は RPC 出力でのみ制御され、直 SELECT で露出しない。

### 5.3 RPC 一覧（読み 2 / 書き 1 / 管理 4／※残高 1）

**会員向け（authenticated に grant。anon 不可）**

| RPC | 引数 | 返り | 動作 |
|---|---|---|---|
| `book.otayori_balance(p_user uuid default null)` | | `integer` | `point_balance` と同型ガード（自分 or `has_tenant_access`）。`SUM(delta)` |
| `book.otayori_my_summary()` | — | `jsonb` | `{balance, ledger:[{id,delta,reason,created_at}], posts:[{id,body,radio_name,status,review_note,created_at,reviewed_at}]}`（auth.uid() の分のみ） |
| `book.otayori_submit(p_body text, p_radio_name text default null)` | | `jsonb {post_id}` | **`book.members` 行が無ければ `not_member`**。本文 1〜2000字／ラジオネーム ≤40字（外れたら `invalid_input`）。pending が5件以上で `too_many_pending`。`status='pending'` で INSERT（**ポイントは付与しない**） |

**管理向け（authenticated + 内部ガード。すべて `book.admin_audit_logs` に記帳）**

| RPC | ガード | 引数 | 動作 |
|---|---|---|---|
| `book.otayori_list_admin(p_status text default 'pending', p_page int default 1, p_per int default 50)` | staff | | `members m join core.guests g on g.id=m.guest_id` で `member_code` / `name` を結合。`{total, items:[{post_id, member_user_id, member_code, member_name, radio_name, body, status, created_at}]}`。created_at 降順 |
| `book.otayori_approve(p_post_id uuid)` | **admin** | | 投稿を `for update`。`approved` 以外→`approved`（`reviewed_by/at` 記録）し、`otayori_ledger` に **+1 付与**（`reason='YouTubeおたより投稿'`・`source_post_id=p_post_id`、`on conflict (source_post_id) where source_post_id is not null do nothing` で冪等）。既に approved は no-op |
| `book.otayori_reject(p_post_id uuid, p_note text default null)` | staff | | `rejected` に更新（`review_note` 記録）。ポイント操作なし |
| `book.otayori_adjust(p_member_user_id uuid, p_delta int, p_reason text)` | **admin** | | **既存保持者への手動付与**。`adjust_points` と同型（`p_delta=0` or 空理由は `invalid_params`）。`otayori_ledger` に `delta`（`reason='【手動付与】'||p_reason`） |

GRANT 例（forum と同様 `revoke ... from public, anon` 後に明示 grant）:

```sql
revoke execute on function book.otayori_submit(text, text) from public, anon;
grant  execute on function book.otayori_submit(text, text) to authenticated, service_role;
-- otayori_balance / my_summary / list_admin / approve / reject / adjust も authenticated, service_role（anon は付けない）
```

`book.otayori_approve` の核（抜粋）:

```sql
select * into v_post from book.otayori_posts where id = p_post_id for update;
if not found then raise exception 'not_found'; end if;
-- admin ガード（is_tenant_admin or is_superadmin）後…
if v_post.status <> 'approved' then
  update book.otayori_posts
     set status='approved', reviewed_by=auth.uid(), reviewed_at=now()
   where id = p_post_id;
end if;
insert into book.otayori_ledger (tenant_id, member_user_id, delta, reason, source_post_id)
values (v_post.tenant_id, v_post.member_user_id, 1, 'YouTubeおたより投稿', p_post_id)
on conflict (source_post_id) where source_post_id is not null do nothing;
insert into book.admin_audit_logs (tenant_id, actor, action, detail)
values (v_post.tenant_id, auth.uid(), 'otayori_approve',
        jsonb_build_object('post_id', p_post_id, 'member_user_id', v_post.member_user_id));
```

### 5.4 supabase-data.ts アダプタ

上記 RPC を呼ぶ薄い関数群を末尾に追記（既存スタイル踏襲・型は同ファイル内）。読み取りは anon キーで動くが、本機能は全 RPC が authenticated 限定のため**Supabase Auth 本接続（P5）後に有効**になる旨をコメント明記（既存 `cancelBooking` と同じ扱い）。**DATA_SOURCE=demo の現状は store.ts 実装が実働**。

## 6. ルーティング・画面

| ルート | 公開/管理 | 内容 |
|---|---|---|
| `/otayori` | 公開（`(public)`） | **おたより投稿フォーム**。未ログイン＝会員登録 CTA（`?next=/otayori`）。member＝本文＋ラジオネーム入力→送信（form action）。staff/admin＝「運営アカウントでは投稿できません」案内。冒頭に「**採用後、運営の承認をもって1pt（=1,000円分）を進呈します**」と説明 |
| `/otayori`（送信後） | 公開 | サンクス表示「おたよりを受け付けました。番組での採用・運営承認後にポイントを進呈します」。連続投稿への導線と残高/履歴（`/account/otayori`）リンク |
| `/account/otayori` | 会員 | マイページ：おたよりpt残高（「1pt=1,000円分」併記）＋台帳履歴＋**自分の投稿一覧（申請中／採用・承認済／見送り）** |
| `/admin/otayori` | 管理 | 投稿レビュー：タブ（申請中 / 承認済 / 却下）。各行に日時・会員（`YM-XXXXXX` + 氏名・内部表示）・ラジオネーム・本文・操作。**承認（admin・確認ダイアログ「1pt=1,000円相当を付与します」）／却下（staff・理由）**。さらに上部に「会員を検索して手動付与」フォーム（admin） |
| `/admin/members/[id]` | 管理 | 既存会員詳細に**「おたよりポイント」パネルを追加**：残高表示＋手動付与フォーム（pt数＋理由）。**これが「既存保持者へ会員別に手動付与」の主導線**（§9） |

- フォーム送信はすべて SvelteKit form actions。成功後 `redirect` / `invalidate`。
- 導線追加: 共通ヘッダーまたは `/account` メニューに「おたよりポイント」、admin 左ナビに「📨 おたより」。
- `/otayori` は通常の公開ルート＝**メンテナンスモード中は 503**（正式公開後に YouTube 概要欄へ掲載する前提なので問題なし）。i18n は既存どおり（ja 既定・`/en` `/zh-TW`）。
- 本文表示は掲示板と同じ無害化方針（HTML エスケープ→URL 自動リンク→改行）。管理画面の本文表示も同様にエスケープ。Markdown 不採用。

### CTA 文言（ja 基準）

- 未ログイン: 「**おたよりの投稿には、山人会員（無料）の登録が必要です。**」→「会員登録（無料）」（`/auth/register?next=/otayori`）・「ログイン」（`/auth/login?next=/otayori`）
- 説明: 「YouTube で読ませていただいたおたよりには、運営の確認後に**おたよりポイント1pt（1,000円分）**を進呈します。次回以降のご宿泊でお使いいただけます。」

## 7. 付与フロー（申請 → 承認 → 付与）と不正対策

```
視聴者（会員）が /otayori で投稿
        │  otayori_submit  →  otayori_posts(status='pending')   ※ポイント未付与
        ▼
運営が /admin/otayori の「申請中」をレビュー
        │  却下: otayori_reject → status='rejected'（理由）
        │  承認: otayori_approve(admin) → status='approved'
        ▼                              ＋ otayori_ledger +1（source_post_id 紐付け）
会員のおたよりpt残高に +1（/account/otayori に反映）
```

- **承認制の理由**: 1pt=1,000円のため、投稿即時の自動付与はフォーム連打で金銭流出に直結する。番組で読むおたよりの選定と承認を一致させ、運営が確定させる。
- **二重付与防止**: `otayori_ledger(source_post_id)` の部分 UNIQUE インデックス＋承認RPCの `for update`＋`on conflict do nothing`。再承認しても加算は1回。
- **スパム抑制**: 未審査（pending）は会員あたり5件まで（`otayori_submit` で拒否）。本文長制限。投稿は会員限定なので bot 流入は低い（Turnstile は任意の後続強化）。
- **取り消し**: 誤承認は `otayori_adjust(member, -1, '誤付与の取消（post=…）')` で逆仕訳（admin）。

## 8. ポイント利用（Phase 2・予約決済への充当）

おたよりポイントは **1pt=1,000円で宿泊予約の支払いに充当**できる（通常ポイント＝1円刻みと**併用可**）。booking は現在 demo 駆動（Supabase 未接続・`rate_plans` 0件）かつ **`confirm_booking` の引数追加は drop+recreate を要する**ため、**予約利用は Phase 2（P4 決済・予約 Supabase 本接続と同時）**に回す。Phase 1 では残高表示と「1pt=1,000円分」の価値提示まで。設計は以下に確定済み。

### 8.1 充当ルール

- 充当順序: **おたよりpt（1,000円単位の粗い充当）を先に適用** → 残額を通常pt（1円単位）で埋める。これで端数の無駄が出ない。
- 計算（`v_total`=見積総額・税込）:
  - `otayori_use = least(p_otayori_used, otayori_balance(uid), floor(v_total / 1000))`
  - `point_use   = least(p_points_used, point_balance(uid), v_total - otayori_use*1000)`
  - `payable     = v_total - otayori_use*1000 - point_use`（≥0）
- **獲得ポイント（通常pt還元）は従来どおり `floor(v_total/1.10 * reward_rate)`＝総額ベースで不変**。おたよりpt利用は還元額に影響しない。おたよりptは予約で**貯まらない**（投稿・手動付与のみ）。

### 8.2 Supabase（P4 で別 migration）

`book.confirm_booking` は引数が増えるため **`drop function book.confirm_booking(uuid, text, jsonb, integer);` → 5引数版を再作成**（`p_otayori_used integer default 0` を追加）。既存本体（`20260611100500` §confirm_booking）に下記を加える:

```sql
-- 会員ブロック内（v_use 算出の直後）
v_ota_use := 0;
if v_member.user_id is not null then
  v_ota_use := least(greatest(coalesce(p_otayori_used,0),0),
                     book.otayori_balance(auth.uid()),
                     floor((v_total - v_use) / 1000.0)::integer);
end if;
-- metadata に 'otayori_used', v_ota_use を追加
-- booking 確定後:
if v_ota_use > 0 then
  insert into book.otayori_ledger (tenant_id, member_user_id, booking_id, delta, reason)
  values (v_hold.tenant_id, auth.uid(), v_booking_id, -v_ota_use, 'ご予約での利用（'||v_code||'）');
end if;
-- 返り値に 'otayori_used', v_ota_use
```

`book.cancel_booking` に巻き戻しを追加:

```sql
v_ota := coalesce((v_booking.metadata->>'otayori_used')::integer, 0);
if (v_booking.metadata->>'member_user_id') is not null and v_ota > 0 then
  insert into book.otayori_ledger (tenant_id, member_user_id, booking_id, delta, reason)
  values (v_stay.tenant_id, (v_booking.metadata->>'member_user_id')::uuid, v_booking.id,
          v_ota, 'キャンセルに伴うおたよりポイント返還（'||p_booking_code||'）');
end if;
```

### 8.3 demo（store.ts）

`confirmBooking` に `otayoriUsed` 引数を追加し §8.1 の式で `otayoriUse` を算出、`booking.otayoriUsed` に記録、`otayoriLedger` に `-otayoriUse`。`cancelBooking` で `+otayoriUsed` を逆仕訳。予約フロー②（`/booking/hold`）に「おたよりポイントを使う」UI（残高表示・1pt=1,000円・`usePoints` 相当の再見積もり action）を追加。完了画面・予約詳細にも利用pt表示。

> Phase 1 と Phase 2 の境界は明確に独立: Phase 1（§5）は予約 RPC に**一切触れない**。Phase 2 を前倒しで demo だけ先行実装することも可能（migration 不要・低リスク）だが、Supabase 側は P4 booking 本接続とまとめるのが安全。

## 9. 既存保持者への手動付与

- 番組開始前から「おたよりポイント保持者」がいる場合、運営が会員ごとに付与する。
- **主導線**: `/admin/members/[id]` の「おたよりポイント」パネル → pt数＋理由を入力 → `otayori_adjust(member_user_id, delta, reason)`（admin）。`reason` は `【手動付与】` プレフィックスで台帳に残り、`admin_audit_logs` にも記帳。
- 補助導線: `/admin/otayori` 上部の「会員検索 → 付与」フォーム（同じ RPC）。
- 正負どちらも可（誤りの訂正に対応）。`delta=0`・空理由は拒否。

## 10. i18n（Paraglide・`apps/web/messages/{ja,en,zh-TW}.json`）

- UI 文言は `otayori_` プレフィックスでキー化。UGC（投稿本文・ラジオネーム）は翻訳対象外。
- 目安キー: `otayori_nav`「おたよりポイント」/ `otayori_form_title`「おたよりを送る」/ `otayori_form_intro`（承認後1pt進呈の説明）/ `otayori_body_label` / `otayori_radio_label` / `otayori_submit` / `otayori_thanks` / `otayori_balance_label` / `otayori_value_note`「1pt = 1,000円分」/ `otayori_history` / `otayori_status_pending`「確認中」`_approved`「進呈済み」`_rejected`「見送り」/ CTA `otayori_cta_register` `otayori_cta_login` / エラー `otayori_error_not_member` `_too_many_pending` `_invalid`。
- 管理画面が ja 直書き運用なら admin 系キーは既存流儀に合わせ不要。

## 11. デモシード（store.ts）

既存デモ会員（`m-demo` ＝ たろう / `demo@yamado.co.jp`）を使って動作を見せる:

- `otayoriPosts`: たろうの投稿3件 — ①`approved`（承認済・台帳に+1の起点）②`pending`（申請中：承認ボタンの確認用）③`rejected`（見送り：理由付き）。日付は `addDays(today(), -n)`。
- `otayoriLedger`: たろうに ①承認起点の `+1`（`sourcePostId` 紐付け）②手動付与 `+2`（reason=`【手動付与】番組開始前からのご愛顧`）→ **残高3pt（=3,000円分）**。
- 本文例は YouTube 視聴者のおたより想定（番組の感想・宿の思い出・質問など）で、承認/却下/手動付与のデモが一通り流せる構成にする。
- PROD migration にはシードを入れない（forum と同様、テーブル・RPC のみ）。

## 12. テストチェックリスト（HANDOFF.md に追記）

```markdown
### おたよりポイント
- [ ] /otayori に未ログインで入ると会員登録CTAが出る（投稿フォームは出ない）
- [ ] 会員ログイン中は本文＋ラジオネームを入力して投稿でき、サンクス文が出る
- [ ] 投稿直後はポイントが増えない（pending・/account/otayori で「確認中」表示）
- [ ] 本文空・2000字超・ラジオネーム40字超はエラーになる
- [ ] 未審査5件を超えると投稿が拒否される
- [ ] /admin/otayori 申請中タブに投稿が並び、会員番号・氏名・本文が見える
- [ ] admin が承認するとおたよりpt残高が+1され、台帳に「YouTubeおたより投稿」が載る
- [ ] 同じ投稿を再承認しても二重付与されない
- [ ] staff は却下はできるが承認（付与）ボタンが出ない／実行で権限エラー
- [ ] /admin/members/[id] のおたよりポイントパネルから手動付与でき、残高と監査ログに反映
- [ ] /account/otayori に残高・「1pt=1,000円分」・台帳・投稿状況が表示される
- [ ] 通常ポイント残高はおたよりポイントの増減に影響されない（単位が混ざらない）
- [ ] /en /zh-TW で UI 文言が翻訳される（本文・ラジオネームは原文のまま）
- [ ] スマホ幅で投稿フォーム・管理レビュー・マイページが崩れない
# Phase 2（予約利用・P4と同時）
- [ ] 予約②でおたよりポイントを使うと1ptにつき1,000円支払額が減る（通常ptと併用可）
- [ ] 予約キャンセルで使ったおたよりポイントが返還される（台帳で確認）
```

## 13. フェーズ分け / 後続

- **Phase 1（本設計の主対象・予約RPC非依存）**: `otayori_posts` / `otayori_ledger` ＋ RPC8 ／ demo store ／ `/otayori`・`/account/otayori`・`/admin/otayori`・会員詳細パネル ／ i18n ／ supabase-data アダプタ。承認制付与・手動付与・残高/履歴表示まで。
- **Phase 2（P4 予約・決済 Supabase 本接続と同時）**: §8 の予約決済充当（`confirm_booking`/`cancel_booking` drop+recreate ＋ demo `confirmBooking` 拡張 ＋ 予約UI）。
- 後続候補: 投稿への運営返信（番組で読んだ旨の通知）／採用おたよりの公開ギャラリー（掲示板連携）／Turnstile 等の bot 対策強化／失効方針を変えるなら `expires_at` 追加。

## 14. 実装分担（Opus 4.8・並行）

- **Agent A（autumn-book アプリ）**: `types.ts`（§3）／`store.ts`（§4・§11 シード）／`(public)/otayori`・`account/otayori`・`admin/otayori` 各画面＋会員詳細パネル追記／本文整形（掲示板の `forum-format.ts` を流用 or 共通化）／i18n キー（ja/en/zh-TW）／DBG 出力／`pnpm build` 成功確認。**supabase-data.ts は触らない**。
- **Agent B（autumn-shared migration + supabase-data.ts）**: §5 の migration 1本（**コミットのみ・push はレビュー後に親が実施**）／`supabase-data.ts` のおたより関数追記。**routes / store / i18n は触らない**。
- Phase 2 は P4 着手時に別タスク（§8）。

## 15. 未決事項・既知の結合点

- [ ] **承認の主体**: 「承認＝付与」を admin 限定にしたが、運用上 staff にも承認を許すか（現設計は staff=却下のみ／admin=承認・付与）。
- [ ] **ラジオネームの扱い**: 任意入力にしているが、番組で読む前提なら必須化するか。未入力時に何を表示名にするか（既定は内部の会員名のみで公開しない）。
- [ ] **1投稿1pt以外の付与**: 採用回数や内容で2pt以上を出したいケースがあるか（あれば `otayori_approve` に pt 数引数を追加）。
- [ ] **既存保持者リスト**: 手動付与の対象者と初期pt数の名簿（運用データ）。
- [ ] **結合点（Phase 2）**: `confirm_booking` / `cancel_booking` は **drop+recreate**（引数追加のため `create or replace` 不可）。呼び出し側（hold/payment の form action・supabase-data・demo）も同時に新引数へ更新が必要。P4 booking 本接続の migration とまとめること。
- [ ] **失効**: 現状無期限。将来期限を設けるなら `otayori_ledger.expires_at` 追加＋失効ジョブ＋表示対応（通常ポイントの `expiringPoints` 相当）。
