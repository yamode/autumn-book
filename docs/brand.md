# AutumnBookロゴ

2026-10-17確定。Autumn共通のA形状を維持し、Bookは白背景・黒いA・ゴールドの斜線を正式配色とする。

| 要素 | 色 |
|---|---|
| A・ワードマーク | `#000000` |
| 斜線アクセント | `#B08D3E` |
| アイコンの背景 | `#FFFFFF` |

## 正式資産

- `apps/web/static/brand/autumn-book-logo.svg`：横組みロゴ。Segoe UI BoldのAutumn・Segoe UI RegularのBookをアウトライン化。フォントの読み込み不要。
- `apps/web/static/brand/autumn-book-symbol.svg`：背景なしのシンボル。共通マスターの多角形をそのまま使用し、外接矩形のviewBoxで切り出す。
- `apps/web/static/brand/autumn-book-icon.svg`：白い角丸背景つき。共通マスターと同じ配置・余白。
- `apps/web/static/brand/autumn-book-icon-512.png`：512pxのアイコン。
- `apps/web/static/favicon.svg`：アイコンと同一内容。`favicon.ico`は16・32・48px、同サイズのPNGも保管。
- `apps/web/static/apple-touch-icon.png`：180px・白い正方形背景。角丸は端末側に任せる。

## 使用ルール

- Aの形・内側の余白・斜線の角度・縦横比は変えない。
- 管理画面は共通コンポーネント`AutumnBookLogo.svelte`を使う。ログイン・二段階認証・パスワード再設定・サイドバー・モバイルメニューに表示する。
- 暗いサイドバーでは白い面の上に正式ロゴを置く。小さい表示では文字なしのシンボルを使う。
- 顧客向けの施設ロゴは施設固有の資産を使う。faviconはBook共通の正式アイコンを使う。
- 旧共有資料のシアンのBookロゴは採用しない。Bookの正本はこのディレクトリのSVGとする。
