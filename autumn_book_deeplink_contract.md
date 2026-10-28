# autumn-book ディープリンク URL 契約 v1.1

- **ステータス**: 確定（v1: 2026-07-10・Fable 5 展開／v1.1: 2026-10-29 ホスト変更・検索バー・範囲の実装反映）
- **位置づけ**: `autumn_book_architecture_decision.md`（ADR-0001）「実装上の決めごと 1. ディープリンクのハンドオフ契約」の具体化。`autumn_book_portal_sitemap.md` §7 の宿題。
- **利用者**: 施設HP（hp-yamado / hp-oga 刷新版）・メルマガ・SNS・QR 等、ポータル外からの予約導線すべて。

---

## 0. 原則

1. **汎用トップに落とさない**。施設HPの「ご予約」は必ず施設を URL に載せて着地させる（最大のコンバージョンリスク対策・ADR-0001）。
2. **着地はエラーにしない**。不正・欠落パラメータは黙って既定値に丸める（ゲストを 4xx で止めない）。
3. **本契約のパス・パラメータ名は恒久**。変更する場合はポータル側が 301 を恒久的に維持する。HP 側の改修を要求しない。

## 1. ホスト

- **ポータルホストは `book.yamado.app` に確定**（v1.1・2026-10-29。v1 の `booking.yamado.co.jp` は実運用に至らなかった）。本契約はパス以下に加えてホストも固定する。
- 本番: `https://book.yamado.app` ／ 開発: `https://autumn-book.pages.dev`。HP 側のリンク先ホストはこれに一括置換する。
- ⚠ **紙に刷った QR（館内図の貸切風呂予約・`autumn_book_private_bath_design.md`）はホストを後から変えられない。** 本ホストは恒久。

## 2. エントリ URL（安定契約）

| # | 用途 | パス | 備考 |
|---|---|---|---|
| E1 | **施設予約トップ**（推奨・基本形） | `/yamado/nishiwaga`・`/yamado/oga` | HP「ご予約」の既定着地。客室・プラン・空室カレンダー・アクセスを表示 |
| E2 | プラン一覧 | `/yamado/{facility}/plans` | プラン訴求ページからの遷移用 |
| E3 | プラン詳細直行 | `/yamado/{facility}/plans/{planId}` | ⚠ `planId` は Supabase 本接続（P3）で確定するまで**恒久保証外**。当面は E1/E2 を推奨 |
| E4 | 客室詳細直行 | `/yamado/{facility}/rooms/{roomId}` | 同上（roomId は本接続まで保証外） |
| E5 | 施設未指定フォールバック | `/search` | 全施設の地図空室検索。ブランド横断導線のみに使用 |

- `{facility}` の安定 slug: **`nishiwaga`（西和賀）／ `oga`（男鹿）**。
  - ⚠ 出所は `book.facility_contents.slug`（`core.facilities.slug` ではない）。PROD は西和賀が `yamado` だったため、URL が `/yamado/yamado` になるのを避けて **2026-07-10 に `nishiwaga` へ変更**した（migration `20260710153430`・未公開のうちに実施）。以後この slug は恒久。
- `/yamado`（ブランドトップ）はページを持たず `/` へ 301（sitemap §6-1・実装済み）。着地先には使わない。

## 3. クエリパラメータ（全エントリ共通・すべて省略可）

| パラメータ | 形式 | 既定 | 正規化ルール |
|---|---|---|---|
| `checkin` | `YYYY-MM-DD` | なし（未選択） | 過去日・366日超・形式不正は無視（未指定扱い） |
| `nights` | `1`〜`7` | `1` | 範囲外・非数値は clamp / 既定へ（E2 の上限。E1・E5 の泊数セレクトは 1〜5） |
| `adults` | `1`〜`6` | `2` | 同上（1 室あたり。E2 の上限。E5 は 1〜4） |
| `rooms` | `1`〜`4` | `1` | **E2 のみ**。2 以上で残室の足りない部屋タイプを外し、部屋タイプ横断の組み合わせを出す。1 のときは付けなくてよい |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` | 文字列 | なし | 流入計測用。GA4 の `page_location` に残る（他のクエリは残さない）。命名は `docs/hp-book-integration.md` §3.1 |

例:
```
https://<PORTAL>/yamado/oga?checkin=2026-08-14&nights=1&adults=2
https://<PORTAL>/yamado/nishiwaga/plans?checkin=2026-09-01&nights=2&adults=3
```

## 4. 多言語

- 言語プレフィックスを許容: `/en/yamado/oga?...`・`/zh-TW/yamado/nishiwaga?...`（ja はプレフィックスなし）。
- HP の英語ページからは `/en/...` に着地させると UI 言語が連動する。

## 5. ポータル側の挙動保証（実装済み）

1. ヘッダー検索バー・施設シェル内の検索条件バーに `checkin / nights / adults` がプリフィルされる。
2. 施設予約トップ・プラン詳細の**料金カレンダーが `checkin` の月を初期表示**する。
3. プラン詳細では指定条件で客室ごとの見積り・残室が即時計算される。
4. 予約フロー（hold → 決済 → 完了）へ条件が引き継がれる。

## 6. HP 側実装ガイド

- 「ご予約」ボタン（日程未定）: → E1 をそのまま。
- HP に日程ピッカー（検索バー）を置く場合: 選択値を `checkin / nights / adults / rooms` に載せて **E2（`/plans`）へ**。E1 は `checkin` しか読まない（v1.1）。Book が配る `<yamado-search-bar>`（`https://book.yamado.app/embed/search-bar.js`・`docs/hp-book-integration.md` §3.8）を使う。
- 特定プランの訴求バナー: 当面 E2（プラン一覧）+ 日程。P3 本接続後に E3 直行へ格上げ可。
- `target=_blank` は不要（同タブ遷移を推奨。HP と Book は別の GA4 プロパティなので、ファネル計測は `utm_*` で接続する）。

## 7. 変更履歴

- 2026-07-10 v1 確定。施設トップのカレンダー初期月連動を実装（`[facility]/+page.server.ts`）。E1/E5・クエリ3種は既存実装で充足済みを確認。
- 2026-08-31 **ポータルホストを `booking.yamado.co.jp` に確定**（従来の `stay.yamado.co.jp` は仮称だった）。館内図の紙 QR がこのホストを焼き込むため恒久扱いとする。
- 2026-10-29 **v1.1**: ホストを `book.yamado.app` に変更。`rooms`（E2）と `utm_*` を追加し、`nights` 1〜7・`adults` 1〜6 に実装を反映。検索バーの遷移先を E2 に。HP 向けの検索バー部品 `embed/search-bar.js` を追加（`/api/stay-calendar` は HP の 3 オリジンに CORS 許可）。
