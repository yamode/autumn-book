# autumn-book コミュニティ掲示板 設計書（v1）

最終更新: 2026-06-12
元仕様: `forum-spec.md`（汎用 SvelteKit+Supabase 掲示板仕様・2026-06-12）を autumn-book の規約に適合させたもの。
設計: Fable 5 ／ 実装: Opus 4.8（2エージェント分担。§12 参照）

---

## 0. 目的（事業要件）

- 山人の**会員と運営スタッフが公開の場で自由にやりとり**するファンコミュニティを作る。
- **閲覧は誰でも**（未ログイン・非会員含む）。書き込みは**会員のみ**。
- 賑わいを外から見せることで **会員登録（無料）への誘導** と **公式サイト・直販予約への誘導** を行う。
  - 未ログイン閲覧者には投稿フォームの代わりに会員登録 CTA を表示。
  - 板・スレ画面の下部に施設サイト（西和賀・男鹿）と空室検索への導線を常設。

## 1. 元仕様からの適合判断（重要な差分）

元仕様をそのまま実装せず、以下を変更する。**実装者はこの差分を正とすること。**

| # | 元仕様 | 本設計 | 理由 |
|---|--------|--------|------|
| 1 | `public` スキーマに profiles/boards/threads/posts | **`book` スキーマに `forum_` プレフィックス**（forum_profiles / forum_boards / forum_threads / forum_posts） | プロジェクトルール（book スキーマ内で完結・既存スキーマへの ALTER 禁止） |
| 2 | `auth.users` への INSERT トリガーで profiles 自動生成 | **トリガー禁止。初回ニックネーム設定時に RPC で lazy 作成** | Supabase は全アプリ共有。auth.users へのトリガーは rms 等のスタッフサインアップにも発火してしまう |
| 3 | テーブル直 SELECT + 表示用ビュー（posts_view） | **RPC ファースト**。テーブルへの anon/authenticated GRANT なし・RLS は deny-all。読み書きすべて SECURITY DEFINER RPC | 既存 book RPC 規約（設計書 §5.2）と統一。`author_user_id`（= auth.users.id）の非露出を RPC 出力で構造的に保証。security_invoker ビュー＋列 GRANT 方式だと author_id の直接 SELECT を許してしまう |
| 4 | `reply_to uuid` アンカー | **スレッド内連番 `post_no`（>>n 形式）**。`reply_to_no int` を本文先頭の `>>n` から抽出して保持 | BBS 慣習どおり「>>2」で参照できる。UUID をアンカーに使うと実体 ID 露出と矛盾 |
| 5 | 本文の扱い未規定（アンカーのみ言及） | **plain text のみ**（HTML エスケープ → >>n リンク化 → URL 自動リンク → 改行 `<br>`）。Markdown 不採用 | UGC の XSS・モデレーション面積を最小化。Markdown は運営告知用に将来拡張 |
| 6 | Realtime / Claude モデレーション / 画像添付 | **本フェーズでは実装しない**（§11 後続フェーズ） | Realtime と Auth 連携は P5（Supabase Auth 本接続）後。現行は demo データ層が既定 |
| 7 | （言及なし） | **demo ストア（store.ts）に同一意味論の実装を先行**し、`DATA_SOURCE` で切替 | 既存アーキテクチャ（store.ts ⇔ supabase-data.ts の二層）に従う |
| 8 | 集計はトリガー（bump_thread_on_post） | **採番・集計とも `forum_create_post` RPC 内で実施**（thread 行を `for update` ロック） | post_no 採番にロックが必要なため、同一トランザクション内で reply_count / last_posted_at も更新する方が単純で競合安全 |
| 9 | profiles は全 auth.users に自動生成（独立した掲示板会員） | **掲示板専用の会員ID・アカウントは作らない**。書き込めるのは**既存会員（book.members）と社内スタッフのみ**。forum_profiles のプロフィール新規作成は `forum_set_nickname` 内で「`private.has_tenant_access`（→ role=staff/admin 自動判定）or `book.members` 行が存在（→ role=member）」にゲートし、どちらでもなければ `not_member` | 掲示板は既存会員制度の機能拡張であり、別の会員基盤を作らない（2026-06-12 ユーザー明確化）。demo 側は既存会員ログイン（SessionUser）経由なので元から既存会員のみ |

## 2. ロールと権限

セッションは既存 `SessionUser`（`session.ts`）の `role: 'member' | 'staff' | 'admin'` をそのまま使う。

| 操作 | 未ログイン | member | staff | admin |
|------|-----------|--------|-------|-------|
| 閲覧（板・スレ・投稿） | ✅ | ✅ | ✅ | ✅ |
| ニックネーム設定・変更 | — | ✅ | ✅ | ✅ |
| スレ作成・返信 | — | ✅（ban 除く） | ✅ | ✅ |
| 自分の投稿の削除 | — | ✅ | ✅ | ✅ |
| スレの pin / lock / 削除、他人の投稿の削除 | — | — | ✅ | ✅ |
| 会員の ban / 解除 | — | — | ✅ | ✅ |
| 板の作成・編集・アーカイブ | — | — | — | ✅ |

- **会員＝既存の会員制度（book.members / デモは store.members）そのもの**。掲示板専用の会員ID・登録フローは設けない。ニックネームは既存会員・スタッフに付与する表示名属性にすぎない（§1 #9）。
- **表示は全員ニックネームのみ**。実名・メール・user_id は demo / DB いずれの経路でも画面・API 出力に一切出さない。
- staff / admin の投稿には「運営」バッジを付ける（表示名はニックネームのまま。例:「やまびと事務局」）。
- ban された会員は閲覧のみ可。投稿時にエラー「現在書き込みが制限されています」。

## 3. データモデル（demo・`types.ts` 追加分）

```ts
export interface ForumProfile {
	userId: string; // SessionUser.id（demo）/ auth.users.id（本接続）
	nickname: string;
	role: 'member' | 'staff' | 'admin';
	isBanned: boolean;
	createdAt: string;
}

export interface ForumBoard {
	id: string;
	slug: string;
	title: string;
	description: string;
	sortOrder: number;
	isArchived: boolean;
	createdAt: string;
}

export interface ForumThread {
	id: string;
	boardId: string;
	authorUserId: string;
	title: string;
	isPinned: boolean;
	isLocked: boolean;
	isDeleted: boolean;
	replyCount: number; // 可視投稿数（#1 を含む）
	lastPostedAt: string;
	createdAt: string;
}

export interface ForumPost {
	id: string;
	threadId: string;
	authorUserId: string;
	postNo: number; // スレッド内連番。1 = スレ本文
	body: string;
	replyToNo: number | null; // 本文中の最初の >>n
	isDeleted: boolean;
	createdAt: string;
}

/** 表示用（authorUserId を含めない = 実体ID非露出を demo でも遵守） */
export interface ForumPostView {
	id: string;
	postNo: number;
	body: string; // 削除済みは ''
	replyToNo: number | null;
	createdAt: string;
	isDeleted: boolean; // true ならプレースホルダ表示「この投稿は削除されました」
	nickname: string | null; // 削除済みは null
	isStaff: boolean; // role が staff/admin なら true（運営バッジ）
	isOwn: boolean; // 閲覧者本人の投稿（削除ボタン表示用）
}

export interface ForumThreadListItem {
	id: string;
	title: string;
	isPinned: boolean;
	isLocked: boolean;
	replyCount: number;
	lastPostedAt: string;
	createdAt: string;
	authorNickname: string;
	authorIsStaff: boolean;
}
```

## 4. demo ストア（`store.ts` 追加関数）

シードデータは §9。バリデーション規則:

- nickname: trim 後 2〜20 文字（全角可）。ユニーク（大小文字無視・trim 済みで比較）。
- thread title: trim 後 1〜80 文字。body: trim 後 1〜4000 文字。

```ts
getForumProfile(userId: string): ForumProfile | undefined
setForumNickname(userId: string, nickname: string, role: ForumProfile['role']):
	ForumProfile | { error: 'taken' | 'invalid' }
	// 既存プロフィールがあれば nickname のみ更新。なければ lazy 作成（role は session.role を渡す）

listForumBoards(): (ForumBoard & { threadCount: number; lastPostedAt: string | null })[]
	// isArchived 含む（公開側はアーカイブ板も閲覧可・新規スレのみ不可）。sortOrder 順
getForumBoard(slug: string): ForumBoard | undefined

listForumThreads(boardId: string, page = 1, perPage = 20):
	{ threads: ForumThreadListItem[]; total: number }
	// is_deleted 除外。is_pinned desc → last_posted_at desc
getForumThread(id: string): (ForumThread & { boardSlug: string; boardTitle: string }) | undefined

listForumPosts(threadId: string, viewerUserId?: string): ForumPostView[]
	// post_no 昇順。削除済みもプレースホルダ行として返す（postNo 連番を保つ）

createForumThread(userId: string, boardId: string, title: string, body: string):
	{ thread: ForumThread } | { error: 'banned' | 'no_nickname' | 'invalid' | 'archived' }
	// thread と post_no=1 の投稿を同時作成。replyCount=1

createForumPost(userId: string, threadId: string, body: string):
	{ post: ForumPost } | { error: 'banned' | 'no_nickname' | 'locked' | 'invalid' | 'not_found' }
	// post_no = max+1。replyCount++・lastPostedAt 更新。replyToNo は body から抽出

deleteForumPost(postId: string, actorUserId: string, byStaff: boolean):
	true | { error: 'forbidden' | 'not_found' }
	// soft delete。可視だった場合 replyCount--。byStaff の場合 auditLogs に記帳

moderateForumThread(threadId: string, patch: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean }, actor: string): void
	// auditLogs に記帳

setForumBan(userId: string, banned: boolean, actor: string): void // auditLogs に記帳

upsertForumBoard(input: { id?: string; slug: string; title: string; description: string; sortOrder: number; isArchived: boolean }): ForumBoard | { error: 'slug_taken' }
```

`>>n` 抽出・本文整形は `apps/web/src/lib/forum-format.ts`（pure・サーバ/クライアント共用）に分離:

```ts
export function extractReplyTo(body: string): number | null; // 最初の >>n（1〜9999）
export function renderForumBody(body: string): string;
// 1) HTML エスケープ（& < > " '）
// 2) >>n → <a href="#post-n" class="...">&gt;&gt;n</a>
// 3) https?:// URL → <a href rel="nofollow noopener ugc" target="_blank">（表示は60字で省略）
// 4) 改行 → <br>
```

## 5. DB（book スキーマ・migration 1本）

`autumn-shared/supabase/migrations/20260612070000_book_forum.sql`（autumn-shared main へ直接 push = PROD 自動適用。プロジェクトルールどおり）

### 5.1 テーブル

```sql
create table book.forum_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null,
  role       text not null default 'member' check (role in ('member','staff','admin')),
  avatar_url text,
  is_banned  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index forum_profiles_nickname_lower_idx on book.forum_profiles (lower(trim(nickname)));

create table book.forum_boards (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text not null default '',
  sort_order  int not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now()
);

create table book.forum_threads (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references book.forum_boards(id) on delete cascade,
  author_user_id uuid not null references book.forum_profiles(user_id),
  title          text not null,
  is_pinned      boolean not null default false,
  is_locked      boolean not null default false,
  is_deleted     boolean not null default false,
  reply_count    int not null default 0,
  last_posted_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index forum_threads_board_idx on book.forum_threads (board_id, is_pinned desc, last_posted_at desc);

create table book.forum_posts (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references book.forum_threads(id) on delete cascade,
  author_user_id uuid not null references book.forum_profiles(user_id),
  post_no        int not null,
  body           text not null,
  reply_to_no    int,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (thread_id, post_no)
);
create index forum_posts_thread_idx on book.forum_posts (thread_id, post_no);
```

### 5.2 RLS / GRANT 方針

- 4 テーブルとも `enable row level security`。**ポリシーは作らない（deny-all）**。
- anon / authenticated へのテーブル GRANT は**一切しない**。`grant all ... to service_role` のみ（既存規約）。
- アクセスはすべて下記 RPC（`security definer set search_path = ''`）経由。
- 運営ロール（forum_profiles.role の staff/admin への昇格）は service_role での UPDATE 運用とし、RPC は提供しない（自己昇格の余地を残さない）。

### 5.3 RPC 一覧

読み取り系（**anon, authenticated に grant execute**。`revoke from public` 後に明示 grant）:

| RPC | 引数 | 返り値（jsonb） | 備考 |
|---|---|---|---|
| `book.forum_list_boards()` | — | `[{id, slug, title, description, sort_order, is_archived, thread_count, last_posted_at}]` | is_deleted スレは集計除外 |
| `book.forum_list_threads(p_board_slug text, p_page int default 1, p_per int default 20)` | | `{total, threads:[{id, title, is_pinned, is_locked, reply_count, last_posted_at, created_at, author_nickname, author_is_staff}]}` | pinned desc → last_posted_at desc |
| `book.forum_get_thread(p_thread_id uuid)` | | `{id, board_slug, board_title, title, is_locked, is_pinned, ...}` | is_deleted なら not_found |
| `book.forum_list_posts(p_thread_id uuid)` | | `[{id, post_no, body, reply_to_no, created_at, is_deleted, nickname, is_staff, is_own}]` | 削除済みは body=''・nickname=null。`is_own` は `auth.uid()` 比較（anon は常に false）。**author_user_id は返さない** |

書き込み系（**authenticated のみ grant execute**）:

| RPC | 引数 | 動作 |
|---|---|---|
| `book.forum_set_nickname(p_nickname text)` | | trim・長さ 2〜20 検証。重複は `nickname_taken`、不正は `invalid_nickname` を raise。プロフィールがあれば nickname のみ更新。なければ**既存会員/スタッフ判定つきで lazy 作成**（§1 #9: スタッフ判定優先で role=staff/admin、book.members 行があれば role=member、どちらでもなければ `not_member`） |
| `book.forum_create_thread(p_board_slug text, p_title text, p_body text)` | | profile 必須（なければ `no_nickname`）・banned → `banned`・板 archived → `board_archived`。thread + post_no=1 を作成し `{thread_id}` 返却 |
| `book.forum_create_post(p_thread_id uuid, p_body text)` | | thread 行を `select ... for update` → locked なら `thread_locked`。post_no = reply_count ではなく `max(post_no)+1` で採番。reply_count+1・last_posted_at=now() を同一 Tx で更新。reply_to_no は本文先頭の >>n を正規表現抽出 |
| `book.forum_delete_own_post(p_post_id uuid)` | | 本人のみ。soft delete + 可視だった場合 reply_count-1 |

モデレーション系（**authenticated のみ。内部で `private.has_tenant_access` / `private.is_tenant_admin` ガード**。板 CRUD は admin = `private.is_tenant_admin or is_superadmin`、それ以外は staff 可）。すべて `book.admin_audit_logs` に記帳:

| RPC | ガード | 動作 |
|---|---|---|
| `book.forum_moderate_thread(p_thread_id uuid, p_pinned boolean, p_locked boolean, p_deleted boolean)` | staff | null 引数は変更なし |
| `book.forum_delete_post(p_post_id uuid)` | staff | soft delete + reply_count 減算 |
| `book.forum_set_ban(p_user_id uuid, p_banned boolean)` | staff | |
| `book.forum_upsert_board(p_id uuid, p_slug text, p_title text, p_description text, p_sort_order int, p_is_archived boolean)` | admin | p_id null なら INSERT |

シード（migration 内で INSERT）: 板 3 件のみ（§9 の announce / travel / qa。スレ・投稿・プロフィールは PROD には入れない）。

### 5.4 supabase-data.ts アダプタ

上記 RPC を呼ぶ薄い関数群を `supabase-data.ts` 末尾に追記（既存スタイル踏襲・型は同ファイル内に定義）。
読み取り系は anon キーで即動作。書き込み系は Supabase Auth 本接続（P5・@supabase/ssr）後に有効になる旨をコメントで明記（既存 `cancelBooking` と同じ扱い）。

## 6. ルーティング・画面（`(public)` グループ＝共通ヘッダー配下）

| ルート | 内容 |
|---|---|
| `/community` | 板一覧（タイトル・説明・スレ数・最終投稿日時）＋未ログイン CTA バナー。下部に施設サイト・空室検索への誘導セクション |
| `/community/[board]` | スレ一覧。pinned は 📌 で先頭固定・locked は 🔒。各行: タイトル / 作成者ニックネーム（運営バッジ）/ 件数 / 最終投稿。ページネーション（20件・`?page=`）。「新しいスレッドを作る」ボタン（未ログイン時は登録 CTA、アーカイブ板では非表示） |
| `/community/[board]/new` | スレ作成フォーム（タイトル＋本文）。**member/staff/admin ログイン必須**（未ログインは `/auth/login?next=` へ）。ニックネーム未設定なら設定フォームを先に表示（同ページ内 or `/community/settings?next=` へ誘導） |
| `/community/threads/[id]` | スレ詳細。投稿一覧（`#n` アンカー `id="post-n"`・ニックネーム・運営バッジ・日時・本文・>>n リンク・削除済みプレースホルダ・本人投稿に削除ボタン）＋返信フォーム。locked は「このスレッドはロックされています」。未ログインは閲覧のみ＋CTA |
| `/community/settings` | ニックネーム設定・変更（要ログイン）。現在のニックネーム表示・重複/長さエラー表示。`?next=` リダイレクト対応 |
| `/admin/community` | 管理画面: ①板管理（admin のみ・追加/編集/アーカイブ）②スレ操作（板選択→スレ一覧→pin/lock/削除トグル）③投稿削除（スレ選択→投稿一覧→削除）④ban 管理（プロフィール一覧→ban トグル）。staff は①以外。操作は監査ログへ |

- フォーム送信はすべて SvelteKit form actions（既存パターン）。成功後 `redirect` または `invalidate`。
- 共通ヘッダー（`routes/(public)/+layout.svelte`）のナビに「コミュニティ」を追加。admin レイアウトのナビにも「コミュニティ」を追加。
- `/account`（マイページ）のメニューに「コミュニティ設定（ニックネーム）」リンクを追加。
- スレ詳細・スレ一覧の `<title>` はスレ名/板名（SEO・公式サイト誘導の入口）。

### CTA 文言（ja 基準）

- バナー: 「**山人会員（無料）になると、この掲示板に参加できます。** 宿の人とゆるりと話せるコミュニティです」→ ボタン「会員登録（無料）」(`/auth/register`)・「ログイン」(`/auth/login`)
- 下部誘導: 「山人の宿はこちら」→ 西和賀（`/yamado/nishiwaga`）・男鹿（`/yamado/oga`）・「空室を探す」(`/search`)
  - 施設 URL は store の brandSlug/slug から動的生成（ハードコードしない）。

## 7. 表示・整形ルール

- 本文表示は `renderForumBody()`（§4）の出力を `{@html}` で描画。**エスケープ漏れ・生 HTML 不許可を最優先**（`<script>alert(1)</script>` がそのまま文字列表示されること）。
- 日時表示は既存 `format.ts` の流儀に合わせ `YYYY/MM/DD HH:mm`。
- 運営バッジ: 深緑（既存アクセントカラー）の小ラベル「運営」。i18n キー化。
- アバターは MVP では表示しない（イニシャル円 = ニックネーム先頭1文字のプレースホルダ）。
- ページ下部の DBG パネル（既存 `debug.ts`）に主要操作を `dbg()` 出力。

## 8. i18n（Paraglide・`apps/web/messages/{ja,en,zh-TW}.json`）

- UI 文言はすべてメッセージキー化（`forum_` プレフィックス・既存キーの命名に倣う）。**UGC（投稿本文・ニックネーム・板タイトル）は翻訳対象外**（板タイトル/説明はシードが日本語のまま全ロケール共通で可）。
- 必要キーの目安（ja 文言は §6 の表記を正とする・en/zh-TW は実装エージェントが自然な訳を当てる）:
  - ナビ/見出し: `forum_nav`「コミュニティ」、`forum_title`、`forum_boards_heading`、`forum_threads_count`、`forum_last_posted`、`forum_new_thread`、`forum_reply`、`forum_locked_notice`、`forum_archived_notice`、`forum_deleted_post`、`forum_staff_badge`「運営」
  - フォーム: `forum_thread_title_label`、`forum_body_label`、`forum_submit_thread`、`forum_submit_reply`、`forum_nickname_label`、`forum_nickname_save`、`forum_nickname_current`、`forum_nickname_required_notice`
  - エラー: `forum_error_nickname_taken`、`forum_error_nickname_invalid`、`forum_error_banned`、`forum_error_locked`、`forum_error_invalid_input`
  - CTA: `forum_cta_banner`、`forum_cta_register`、`forum_cta_login`、`forum_cta_facilities_heading`、`forum_cta_search`
  - 管理: `forum_admin_*` は admin 画面が ja 直書きなら不要（既存 admin 画面の流儀に合わせる。既存が ja 直書きならそれに倣う）

## 9. デモシード（store.ts）

プロフィール（members テーブルに行がない userId でも forum_profiles だけで表示できる設計とする）:

| userId | nickname | role | 備考 |
|---|---|---|---|
| `m-demo` | たろう | member | デモ会員ログインで本人になる |
| `staff-demo` | やまびと事務局 | staff | 管理画面のスタッフデモログイン |
| `admin-demo` | 山人支配人 | admin | 管理者デモログイン |
| `m-yuki` | ゆきぐに | member | 架空の賑やかし会員 |
| `m-umikaze` | うみかぜ | member | 同上 |

板（DB シードと同一内容）:

| slug | title | description | sort |
|---|---|---|---|
| `announce` | 運営からのお知らせ | 山人からの告知・新着情報はこちら | 0 |
| `travel` | 旅のはなし | 滞在の思い出、季節の見どころ、よもやま話 | 1 |
| `qa` | 質問・相談 | ご宿泊前の疑問やわからないこと、何でもどうぞ | 2 |

スレッド・投稿（賑わいと「運営と会員の距離の近さ」が伝わる内容にする。日付は `addDays(today(), -n)` で相対生成）:

1. **announce**「コミュニティ掲示板を開設しました」（やまびと事務局・**pinned**）
   - #1 事務局: 開設挨拶。ニックネーム制であること・どなたでも閲覧でき書き込みは会員（無料）であること・宿のことでも旅のことでも気軽に、という案内
   - #2 たろう: 「こういう場所が欲しかったです。よろしくお願いします！」
   - #3 事務局: 「>>2 ありがとうございます。のんびり育てていきます」
2. **travel**「雪見露天、忘れられません」（ゆきぐに）
   - #1 ゆきぐに: 冬に西和賀で入った雪見露天の感想
   - #2 うみかぜ: 「写真はないんですか？いいなあ」
   - #3 事務局: 「>>1 嬉しいです。今年は雪が多く、12月から見頃でした。紅葉の露天もおすすめです」
   - #4 ゆきぐに: 「紅葉の時期にまた伺います」
3. **travel**「男鹿の夕陽スポットを教えてください」（たろう）
   - #1 たろう: 来月男鹿に泊まる。夕陽がきれいな場所は？
   - #2 うみかぜ: 鵜ノ崎海岸の干潮時がおすすめ
   - #3 事務局: 「お部屋からも海に沈む夕陽がご覧いただけます。日没時刻はフロントでもご案内しています」
4. **qa**「子ども連れでも大丈夫ですか？」（うみかぜ）
   - #1 うみかぜ: 小さい子連れでの宿泊について
   - #2 事務局: 添い寝・お子様用浴衣・食事の対応を丁寧に回答（最後に「ご予約時にお気軽にご相談ください」）
5. **announce**「【受付終了】春の感謝企画」（やまびと事務局・**locked**）
   - #1 事務局: 受付終了の告知（locked スレの動作確認用）

## 10. テストチェックリスト（HANDOFF.md に追記する項目）

```markdown
### コミュニティ掲示板
- [ ] 未ログインで /community〜スレ詳細まで閲覧でき、投稿フォームの代わりに会員登録CTAが出る
- [ ] 会員ログイン後、ニックネーム未設定だと投稿前に設定を求められ、設定後に投稿できる
- [ ] ニックネームの重複・2文字未満・21文字以上はエラーになる
- [ ] スレ作成→板一覧の先頭（pinned の下）に出る。返信で件数・最終投稿が更新される
- [ ] >>2 と書くと該当投稿へのページ内リンクになる
- [ ] 本文に <script> を書いてもそのまま文字として表示される（XSS不可）
- [ ] 自分の投稿を削除でき、「この投稿は削除されました」のプレースホルダになる
- [ ] ロックされたスレ（春の感謝企画）には返信フォームが出ない
- [ ] 運営（staff/admin）の投稿に「運営」バッジが付き、実名・メールはどこにも出ない
- [ ] /admin/community でスレの pin/lock/削除・投稿削除・ban ができ、監査ログに残る
- [ ] ban した会員（たろう）でログインすると投稿がエラーになる
- [ ] 板をアーカイブすると新規スレ作成ボタンが消える（閲覧は可能）
- [ ] /en /zh-TW で UI 文言が翻訳される（投稿本文・板名は日本語のまま）
- [ ] スマホ幅でスレ一覧・投稿一覧・フォームが崩れない
```

## 11. 後続フェーズ（本実装に含めない）

1. **Realtime**: P5（Supabase Auth 本接続）後。`forum_posts` INSERT を購読し、ペイロードは使わず `forum_list_posts` を再取得（実体 ID 非露出を維持）。
2. **Claude モデレーション**: Workers + Claude API（既存 IVR パターン流用）。閾値超え自動非表示＋運営通知、グレーはキュー。
3. **画像添付**: Supabase Storage（book-photos と別バケット `forum-images`）。
4. **検索・通知・引用 UI・アバター画像**。
5. **運営ロール付与のオペレーション**: forum_profiles.role を service_role で更新する手順書（P5 で社内 Auth と接続するまでの暫定）。

## 12. 実装分担（Opus 4.8・2エージェント並行）

- **Agent A（autumn-book アプリ）**: types.ts / store.ts（§3-4・§9）/ forum-format.ts / `(public)` ルート5画面 / admin 1画面 / 共通ヘッダー・admin ナビ・account メニュー導線 / i18n キー（ja/en/zh-TW）/ DBG 出力 / `pnpm build` 成功確認
- **Agent B（autumn-shared migration + supabase-data.ts）**: §5 の migration SQL 1本（**コミットのみ・push はレビュー後に親が実施**）/ supabase-data.ts のフォーラム関数追記
- 競合回避: Agent A は supabase-data.ts を触らない。Agent B はアプリの routes / store / i18n を触らない。
