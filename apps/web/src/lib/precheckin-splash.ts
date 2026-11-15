// 事前チェックインのリンク（/ci/<token>）を開いた瞬間に出す、読み込み中の画面（2026-11-15）。
//
// 【なぜ】リンクを開くと、サーバーでトークンの確認 → Cookie → /ci の読み込み、と DB への往復が続き、
//   最初の画面が出るまで数秒かかることがある。そのあいだ真っ白だと「開けていない」ように見える。
// 【しくみ】/ci/<token> は、DB に触らずにこの軽い HTML をすぐ返す。この HTML が同じ URL に ?go=1 を付けて
//   開き直し、そこで今までどおりの確認と移動をする。ブラウザは次の画面の中身が届くまでこの画面を出し続ける。
// ・この HTML には予約の情報を一切入れない（トークンの確認より前に返すため）。施設名も出さない。
// ・JavaScript が無い環境は <noscript> の自動更新とリンクで進める。
// ・見た目は /ci の画面（黒いヘッダー 40px・淡いグレーの地）にそろえ、切り替わりが目立たないようにする。

/** 開き直す先（同じパスに ?go=1）。パスは呼び出し側が検証済みのものを渡す */
export function splashNextUrl(pathname: string): string {
	return `${pathname}?go=1`;
}

const esc = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** トークンの形（今の 16 文字・前の 43 文字）。これ以外は読み込み中の画面を挟まず、そのまま確認へ進める */
export function looksLikePrecheckinToken(token: string): boolean {
	return /^[0-9A-Za-z_-]{16,64}$/.test(token);
}

export type SplashLocale = 'ja' | 'en' | 'zh-TW';
const TEXT: Record<SplashLocale, { title: string; lead: string; link: string }> = {
	ja: { title: '事前チェックイン', lead: 'ご案内を準備しています', link: '画面が変わらないときは、こちらを押してください' },
	en: { title: 'Pre-check-in', lead: 'Preparing your page', link: 'Tap here if the page does not change' },
	'zh-TW': { title: '事前入住登記', lead: '正在為您準備頁面', link: '若畫面沒有切換，請點此處' }
};

/** 読み込み中の画面の HTML（1 枚で完結・外部の読み込みなし） */
export function precheckinSplashHtml(pathname: string, locale: SplashLocale = 'ja'): string {
	const next = esc(splashNextUrl(pathname));
	const t = TEXT[locale] ?? TEXT.ja;
	return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>${esc(t.title)}</title>
<noscript><meta http-equiv="refresh" content="0;url=${next}" /></noscript>
<style>
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:#f1f1f3;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;-webkit-font-smoothing:antialiased}
.bar{height:40px;background:#000}
.wrap{min-height:calc(100% - 40px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px 24px 96px}
.mark{position:relative;width:76px;height:76px}
.mark svg{position:absolute;inset:0;width:100%;height:100%}
.track{fill:none;stroke:#d6d3d1;stroke-width:1.5}
.arc{fill:none;stroke:#1c1917;stroke-width:1.5;stroke-linecap:round;stroke-dasharray:60 190;transform-origin:50% 50%;animation:spin 1.6s cubic-bezier(.5,.1,.3,.9) infinite}
.dot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#1c1917;animation:breathe 1.6s ease-in-out infinite}
.title{margin:0;font-size:13px;letter-spacing:.42em;text-indent:.42em;color:#44403c;text-align:center}
.lead{margin:-16px 0 0;font-size:13px;color:#78716c;letter-spacing:.08em;text-align:center}
.lead i{display:inline-block;width:1.2em;text-align:left;font-style:normal}
.lead i::after{content:"";animation:dots 1.6s steps(4,end) infinite}
.rule{width:120px;height:1px;background:#d6d3d1;overflow:hidden;position:relative}
.rule::after{content:"";position:absolute;inset:0;width:40%;background:#1c1917;animation:slide 1.6s cubic-bezier(.6,0,.3,1) infinite}
.late{margin:0;font-size:12px;opacity:0;animation:show .4s ease 6s forwards}
.late a{color:#57534e}
.fade{animation:rise .5s ease both}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes breathe{0%,100%{transform:scale(.6);opacity:.35}50%{transform:scale(1);opacity:1}}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes show{to{opacity:1}}
@media (prefers-reduced-motion:reduce){.arc,.dot,.rule::after,.fade{animation:none}.arc{stroke-dasharray:none;stroke:#a8a29e}}
</style>
</head>
<body>
<div class="bar"></div>
<main class="wrap" role="status" aria-live="polite">
<div class="mark fade" aria-hidden="true">
<svg viewBox="0 0 80 80"><circle class="track" cx="40" cy="40" r="38" /><circle class="arc" cx="40" cy="40" r="38" /></svg>
<span class="dot"></span>
</div>
<p class="title fade">${esc(t.title)}</p>
<div class="rule fade" aria-hidden="true"></div>
<p class="lead fade">${esc(t.lead)}<i aria-hidden="true"></i></p>
<p class="late"><a href="${next}" rel="nofollow">${esc(t.link)}</a></p>
</main>
<script>location.replace(${JSON.stringify(splashNextUrl(pathname)).replace(/</g, '\\u003c')});</script>
</body>
</html>`;
}
