# Book 先行のプラン作成と rms への紐づけ（v0.217.0・2026-10-30）

これまでは **rms のプランテンプレート（`rms_plan_templates`）が先**で、3 時間ごとの同期（`book.sync_rms_rates_range`）が
`booking.rate_plans` と `book.plan_contents`（紹介の下書き）を作っていた。
**Book でプランを先に作り、料金（rms）をあとから紐づける**流れも使えるようにした。どちらの順でもよい。

## 流れ（Book 先行）

1. Book 管理画面 `/admin/plans` →「＋ 新規プランを作る」（プラン名・食事）。
   `book.admin_create_plan` が `booking.rate_plans`（`code = bk-xxxxxxxx`・`metadata.book_origin = true`・`managed_by = book`）と
   `book.plan_contents`（下書き）を作る。一覧と編集画面に **「料金待ち」** が出る。
   料金・日別料金が無いので、公開しても予約には出ない。紹介文・写真・支払方法・公開範囲は、この時点から Book で設定できる。
2. rms でプランテンプレートを作り（TL のプラングループ名・料金式・食事区分）、**Book の料金待ちプランに紐づける**
   （`book.rms_link_template`。rms の画面は autumn-rms 側の作業）。
3. 紐づけた瞬間に `book._apply_rms_links` が、料金式（`theory_pricing`）・食事区分・各種コードをそのプランの `metadata` へ反映し、
   `managed_by` を `rms_sync` に切り替える。以後は rms 先行のプランと同じ扱い（取引先料金・日別料金も同じ経路）。
   日別料金・在庫は次の同期（最大 3 時間）で入る。
4. Book 側でプラン名・紹介・支払方法・公開範囲を直しても、同期は上書きしない（rms 先行のプランと同じ）。

## rms 側が呼ぶ RPC（`book` スキーマ・ログイン中スタッフ権限）

| RPC | 役目 | 主なエラー |
|---|---|---|
| `book.rms_list_unlinked_plans(p_facility_id uuid)` | 料金待ちの Book プランの一覧（`rate_plan_id, code, name, meal_plan, created_at`） | `forbidden` |
| `book.rms_link_template(p_template_id uuid, p_rate_plan_id uuid)` | テンプレートを Book プランに紐づける。`p_rate_plan_id = null` で外す | `forbidden` / `not_found` / `not_book_plan`（Book で作ったプランではない）/ `already_linked`（そのプランは別のテンプレートに紐づき済み）/ `template_has_plan`（そのテンプレートはすでに自分の直販プランを持つ） |

- 紐づけ先は **Book で作ったプラン（`book_origin`）だけ**。rms 先行のプランには紐づけられない。
- テンプレートが**すでに rms 先行の直販プランを持っている場合は紐づけられない**（紐づけると同期がその既存プランを非活性にして、公開中のページが消えるため）。
- 紐づけを外す、またはテンプレートを非活性にすると、次の同期でそのプランは `managed_by = book` に戻り、**今日以降の日別料金は閉じる**（古い料金のまま売れ続けないように）。

## 列・ビュー

- `public.rms_plan_templates.book_rate_plan_id`（`booking.rate_plans.id`・1 プランに 1 テンプレート・削除時は空に戻る）
- `book.v_admin_rate_plans` に `managed_by` / `book_origin` / `has_pricing` を追加（Book 管理画面が「料金待ち」を出すのに使う）
- Book の画面の状態名: `rms`（rms 先行）／ `linked`（Book 先行・紐づけ済み）／ `awaiting`（Book 先行・料金待ち）。`content-admin.ts` の `planRmsStateOf`

## 客室との対応（今の制約）

日別料金は「プラン × 客室」の対応が要る。いまはこの対応を **TL のプラングループ名**（`book.rms_plan_room_map`）から作っているため、
紐づけ先のテンプレートには `tl_plan_group_name` が必要。紐づいたプランには、そのテンプレートのキーの行を **プランの `code` 名義で複写**する
（取引先料金など、map を `code` で引く他の関数を変えないため）。

**TL に載らない（Book 専用の）プランの客室対応**は、rms 設計書（`autumn-rms/docs/book-plan-master-design.md` §3.2）の
`rms_plan_room_links` で持つ想定で、まだ実装していない。それまでは、紐づけ先テンプレートに TL のグループ名を入れて客室を対応させる。

## 同期関数の変更点（autumn-shared `20261030213302`）

`20260723030000` の本体に次の 3 点だけを足した。紐づけが 1 件も無いときの挙動は変わらない（本番で実測確認）。

1. 直販プランの upsert と非活性化の対象から、`book_rate_plan_id` 付きテンプレートを外す
2. 紐づけの反映（`_apply_rms_links`）と、外れたものを book 管理へ戻す処理
3. 戻り値に `rate_plans_linked` を追加

## rms 側の残作業（別リポ・autumn-rms）

- プランテンプレートの編集画面に「Book のプランに紐づける」（`rms_list_unlinked_plans` で候補 → `rms_link_template`）と「紐づけを外す」
- 紐づけ済みのテンプレートでは、直販（`autumnBooking`）の設定との関係が分かる表示
