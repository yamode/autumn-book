# autumn-book ブランドポータル サイトマップ

- **対象**: 単一ブランドポータル（`booking.yamado.co.jp`・2026-08-31 確定）
- **前提**: `autumn_book_architecture_decision.md`（ADR-0001）— 施設HPは外部に据え置き、予約・会員・掲示板・地図検索をポータル1サイトに統合。
- **最終更新**: 2026-06-21
- 本書のルートは実装（`apps/web/src/routes`）＋設計書 §4 に一致。詳細な deep-link URL契約・施設別テーマリングは規約どおり Fable 5 で展開。

---

## 0. 全体像

```
外部の施設HP（WordPress・据え置き）
  西和賀 www.yamado.co.jp ／ 男鹿 oga.yamado.co.jp
        │  「予約」「プランを見る」= 施設・日程をURLに載せて deep-link
        ▼
ブランドポータル（booking.yamado.co.jp・単一SvelteKit・SSR・全機能ファーストパーティ）
  ├─ 公開エリア（誰でも・SEO）
  ├─ 予約フロー（匿名で開始→決済前に会員/ゲスト分岐）
  ├─ 会員エリア（要ログイン）
  └─ 社内管理 /admin（staff/admin・別ゾーン）
```

| ゾーン | アクセス | 役割 |
|---|---|---|
| 公開 | 誰でも | SSR・検索流入面（施設予約トップ・プラン・掲示板閲覧） |
| 予約フロー | 匿名で開始可 | 仮押さえ → 決済 → 完了 |
| 会員 | 要ログイン | マイページ・ポイント・掲示板投稿 |
| 社内管理 | staff/admin | バックオフィス（同一アプリの別ゾーン） |

## 1. 外部エントリ（ポータル外・据え置き）

- 施設HP・西和賀「山人 -yamado-」: `www.yamado.co.jp`（WordPress）
- 施設HP・男鹿「山人 -oga-」: `oga.yamado.co.jp`（WordPress）
- 検索エンジン / SNS / OTA（一休・楽天・じゃらん）
- **接続**: 各HPの予約導線は、施設（理想は日程・プランまで）をURLに載せて §2 の施設予約トップ または §3 の予約フローへ deep-link 着地させる（汎用TOPに落とさない）。

## 2. 公開エリア（anon・SSR・SEO）

```
/                                  ポータルトップ（ブランド一覧・全国マップ空室検索）   ★SEO
/search                            地図＋リスト空室検索
/[brand]                           ※ページを持たない → / へ 301（§6-1）
/[brand]/[facility]                施設予約トップ（客室/プラン/空室/アクセス）  ⟵ HP予約の着地
  ├ /[brand]/[facility]/rooms             客室一覧
  │   └ /[brand]/[facility]/rooms/[room]  客室詳細
  ├ /[brand]/[facility]/plans             プラン一覧
  │   └ /[brand]/[facility]/plans/[plan]  プラン詳細・料金カレンダー        ★SEO入口
  ├ /[brand]/[facility]/news              お知らせ一覧
  │   └ /[brand]/[facility]/news/[id]     お知らせ詳細
  └ /[brand]/[facility]/[page]            アクセス等の下層ページ
/community                         掲示板トップ（板一覧）                      ★UGC SEO
  ├ /community/[board]                    スレ一覧
  └ /community/threads/[id]               スレ詳細
/legal/[page]                      特商法表記・プライバシー・宿泊約款
```

## 3. 予約フロー（匿名で開始可・決済前に会員/ゲスト分岐）

```
/booking/hold                      仮押さえ・ゲスト情報入力（既定20分保持）
/booking/payment                   決済（Stripe・事前決済プランのみ／現地払いはスキップ）
/booking/complete/[code]           予約完了（予約番号・マイページ誘導）
```

## 4. 会員エリア（要ログイン：メール／Google／LINE）

```
/auth/login                        ログイン
/auth/register                     会員登録（無料）
/auth/logout                       （action・ページなし）
/account                           マイページ（予約一覧をここに集約）
  ├ /account/reservations/[code]   予約詳細・変更・キャンセル
  ├ /account/points                ポイント
  ├ /account/favorites             お気に入り
  └ /account/profile               プロフィール
/community/[board]/new             スレ作成（member/staff/admin・banを除く）
/community/settings                掲示板ニックネーム設定
```

## 5. 社内管理 /admin（staff / admin・同一アプリの別ゾーン）

```
/admin                             ダッシュボード
/admin/login                       スタッフログイン
/admin/reservations  ・ /[code]    予約管理
/admin/plans         ・ /[id]      プラン管理
/admin/rooms                       客室管理
/admin/facility                    施設管理
/admin/members       ・ /[id]      会員管理
/admin/community                   掲示板モデレーション（pin/lock/削除・ban・板CRUD）
/admin/mail          ・ /mail/new  メルマガ配信
/admin/sequences                   ステップメール
/admin/faqs                        FAQ管理
/admin/news                        お知らせ編集
/admin/maintenance                 メンテナンス
```

## 6. ルーティングの決定事項

1. **`/[brand]` のブランドトップページは作らない** → `/` へ 301 リダイレクト（2026-06-21 決定）。ブランドは現在「yamado（山人）」1つで、`/`（ブランド一覧＋地図空室）が実質ブランドトップを兼ねるため。**URLの `[brand]` セグメントは将来の多ブランド（飲食/サウナ＝`book.brands.type`）のネームスペースとして維持**する。→ **実装済み（2026-07-10）**：`/[brand]/+page.server.ts` が実在ブランドのみ 301（不明 slug は 404）。
2. **`/[brand]/[facility]` はフルマーケHPではなくポータルの「施設予約トップ」**（ADR-0001）。施設のブランド世界観は外部HPが担う。
3. **予約ハンドオフ**は、施設（理想は日程・プラン）をURLに載せた安定 deep-link 契約にする。パラメータ仕様は Fable 5 で別途定義。
4. **SEO**：公開エリアは `yamado.co.jp` 配下に置く。掲示板UGCは横断1ハブとしてポータルに集約。canonical は「HP＝ブランド名／ポータル＝施設名＋予約・空室・プラン」で棲み分け。

## 7. 未確定 / 次の作業（Fable 5）

- [ ] ポータルのホスト名確定（stay / book / go …）※要ユーザー判断。
- [x] deep-link エントリURL契約 → **確定（2026-07-10）：`autumn_book_deeplink_contract.md` v1**。
- [ ] 施設別テーマリング仕様（`book.brands.theme` の適用範囲）。
- [x] `/[brand]` のリダイレクト実装 → **実装済み（2026-07-10）**。
- [ ] `autumn_book_design.md` §4 の URL 設計を本書に合わせて改訂。
