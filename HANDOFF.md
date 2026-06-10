# autumn-book HANDOFF

最終更新: 2026-06-10

## 現在の状態

- **フェーズ：設計完了・実装未着手（P0 前）**
- 正式設計書：`autumn_book_design.md`（v2・プラットフォーム統合版）
- 画面設計書：`autumn_book_ui_design.md`（v1・2026-06-10 追加）— 顧客向け16画面 + 管理画面9画面（予約管理・Markdownプラン作成・メルマガ作成等）。実装増分は同書 §7、新規未決5件は §8
- 旧仕様 `autumn_book_spec.md` / `autumn_book_full_spec.md` / `autumn_book_erd.md` は設計書 §12 で置き換え済み（参照用に残置）
- 前提：autumn-pms/docs/02-architecture.md（クラウドPMS設計・2026-06-10）と整合済み。予約の着地形（stay_groups → stays → stay_nights）は PMS 設計に従う
- コミット未実施（設計書・HANDOFF とも working tree のみ）

## 決定済み事項

- 技術スタック：SvelteKit 2 + Svelte 5 + Tailwind 4 + Cloudflare Pages（rms/order と同一）
- DB：Supabase「Autumn Platform」共有。migration SoT = autumn-shared（GitHub Integration 自動適用）
- ドメイン戦略：yamado.co.jp 一本継続。www=西和賀 / oga=男鹿 を autumn-book で置換、corporate は WP のまま（§4.0）
- DNS：案A（zone を Cloudflare へ移管・メールは Xserver のまま）で実施可能と確認済み。ランブック §4.0.1
  - ⚠ oga.yamado.co.jp は MX なし（A レコード暗黙配送）。**Web 切替前に明示 MX 追加が必須**
- Stripe 導入決定（2026-06-10）
- アナリティクス = Google Analytics 4（全ホスト単一プロパティ + クロスドメイン計測・予約ファネル計測）、エラートラッキング = Sentry（SvelteKit + Edge Functions、PII マスク）— 2026-06-10 決定（設計書 §9）
- 追加要件6件を §15 に設計済み：チャットボットQ&A / オプションサービス予約（貸切風呂等）/ 客室電子インフォメーション / Stripe / メルマガ / ステップメール

## 未決事項（要ユーザー判断・詳細は設計書 §14）

### ドメイン関連
- [ ] DNS 移管の実施タイミング（手順は確定済み。Xserver 全レコード棚卸しから）
- [ ] ポータルのホスト名（stay / book / go / member …）
- [ ] 旧 WP の切替順序（男鹿先行か同時か）・301 マップ・現予約導線の確認
- [ ] 送信メールドメイン（Resend の SPF/DKIM を Xserver SPF と共存設定）

### 事業・UX 関連
- [ ] LINE ログイン導入（LINE Developers チャネル開設要）
- [ ] Stripe アカウント構成（施設別 or 単一）※導入自体は決定済み
- [ ] buffer_rooms 運用値（0〜1 想定）
- [ ] 写真素材の調達・リサイズフロー
- [ ] 料金パリティ方針（直販ベストレート保証の打ち出し）
- [ ] ポイント原資・付与率（ランク別還元率）
- [ ] 子供料金の直販での受け方（child a〜e 区分は未使用）
- [ ] 多言語（EN/TW）の実装フェーズ

### 新規サブシステム関連（§15）
- [ ] メルマガ配信基盤（Resend 統一推奨 vs Benchmark 継続）
- [ ] チャットボットの応答範囲・エスカレーション先
- [ ] 電子インフォメーションの提供形態（スマホQR前提 vs 客室タブレット）
- [ ] オプション予約の販売条件（貸切風呂の枠数・開始タイミング・キャンセル規定・料金）
- [ ] ステップメールの文面・タイミングの現場確認（既定案：7日前/3日前/前日/翌日）

### 画面設計関連（autumn_book_ui_design.md §8）
- [ ] 管理画面の置き場所（autumn-book 内 `/admin` 提案 vs rms 同居）
- [ ] 写真ストレージ（Cloudflare Images vs Supabase Storage + 自前リサイズ）
- [ ] 管理面への Cloudflare Access 追加保護の要否
- [ ] OTA 予約を管理画面に閲覧表示するか（提案：閲覧のみ表示）
- [ ] rate_plans 新規作成を book 管理画面に取り込むか（提案：rms 残置）

## 次のアクション候補

1. 上記未決事項のうち「ポータルホスト名」「DNS 移管タイミング」を決める（P1 公開の前提）
2. P0 着手：リポ初期化（pnpm workspace + SvelteKit）+ `book` スキーマ migration を autumn-shared に PR
   - ⚠ 着手前に autumn-pms v0.1 の migration 進捗を確認（core.guests / rate_plans の ALTER 競合回避。設計書 §11）
3. DNS 事前修正（oga の明示 MX + SPF 追加）は移管前にいつでも実施可能・無リスク

## テストチェックリスト

（P0 実装開始時に追加する）
