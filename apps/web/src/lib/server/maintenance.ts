// メンテナンスモード — 正式公開前 / メンテナンス作業中に一般ユーザーへ非公開にする。
//
// 制御は 2 系統:
//   1) 管理画面トグル … /admin/maintenance から即時に ON/OFF。保存先は Cloudflare KV
//      （AB_CONFIG バインド）。本番では edge 間で共有・永続するため、全 isolate に効く。
//      KV バインドが無い環境（vite dev 等）はプロセス内メモリにフォールバックする。
//   2) 環境変数 MAINTENANCE_MODE=on … 強制 ON のエスケープハッチ。on のときは
//      KV/トグルの値に関わらずメンテナンス中になり、管理画面トグルでは解除できない。
//
// メンテナンス中でも以下はサイトを閲覧できる（バイパス）:
//   - /admin 配下（運営作業・/admin/login でのログイン用）
//   - admin / staff でログイン中のユーザー（公開サイトのプレビュー用）
//   - プレビュートークン一致（MAINTENANCE_BYPASS_TOKEN・関係者への共有用）
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

const PREVIEW_COOKIE = 'ab_preview';
const KV_KEY = 'maintenance';

type Platform = App.Platform | undefined | null;

function truthy(v: string | undefined): boolean {
	return v === 'on' || v === 'true' || v === '1';
}

/** 環境変数 MAINTENANCE_MODE による強制 ON か。 */
export function isEnvForced(): boolean {
	return truthy(env.MAINTENANCE_MODE);
}

// KV バインドが無い環境（vite dev 等）用のプロセス内メモリ・フォールバック
let memoryOn = false;

function kv(platform: Platform): KVNamespace | null {
	return platform?.env?.AB_CONFIG ?? null;
}

/** KV にバインドがあるか（=本番で永続・edge 共有が効くか）。 */
export function isDurable(platform: Platform): boolean {
	return Boolean(kv(platform));
}

/** 管理画面トグルの保存値を取得（KV があれば KV、無ければメモリ）。 */
async function getToggle(platform: Platform): Promise<boolean> {
	const ns = kv(platform);
	if (ns) return (await ns.get(KV_KEY)) === 'on';
	return memoryOn;
}

/** 管理画面トグルを保存（KV があれば KV、無ければメモリ）。 */
export async function setMaintenance(platform: Platform, on: boolean): Promise<void> {
	const ns = kv(platform);
	if (ns) await ns.put(KV_KEY, on ? 'on' : 'off');
	else memoryOn = on;
}

/** 実際にメンテナンス中か（環境変数の強制 ON もしくはトグル ON）。 */
export async function isMaintenanceOn(platform: Platform): Promise<boolean> {
	if (isEnvForced()) return true;
	return getToggle(platform);
}

/** 管理画面表示用に状態の内訳をまとめて返す。 */
export async function maintenanceStatus(platform: Platform): Promise<{
	active: boolean;
	envForced: boolean;
	toggleOn: boolean;
	durable: boolean;
}> {
	const envForced = isEnvForced();
	const toggleOn = await getToggle(platform);
	return { active: envForced || toggleOn, envForced, toggleOn, durable: isDurable(platform) };
}

/** プレビュートークン（未設定なら空文字＝トークンによるバイパス無効）。 */
function bypassToken(): string {
	return env.MAINTENANCE_BYPASS_TOKEN ?? '';
}

/** プレビュー用バイパスリンク（?preview=<token>）。トークン未設定なら null。 */
export function previewLink(origin: string): string | null {
	const token = bypassToken();
	return token ? `${origin}/?preview=${encodeURIComponent(token)}` : null;
}

/**
 * メンテナンス中でもこのリクエストを通す（バイパスする）か。
 * preview トークンが一致したら cookie を発行し、以後の遷移でも通るようにする。
 */
export function isMaintenanceBypassed(event: RequestEvent): boolean {
	const { url, locals, cookies } = event;

	// 管理エリアは常に到達可能（/admin/login でログイン → バイパス取得するため）
	if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return true;

	// 滞在中のお客様向けの面（客室電子インフォメーション・貸切風呂のご予約）は
	// ポータル本体より先に公開する。館内図に刷った QR の着地点なので、
	// メンテナンス中でも必ず開けなければならない（紙は刷り直せない）。
	// 言語プレフィックス付き（/en/r・/zh-TW/r）も同じ扱いにする。
	if (/^\/(?:en\/|zh-TW\/)?r(?:\/|$)/.test(url.pathname)) return true;

	// 運営（admin / staff）はメンテ中も公開サイトをプレビューできる
	const role = locals.user?.role;
	if (role === 'admin' || role === 'staff') return true;

	// プレビュートークン（関係者への共有用）
	const token = bypassToken();
	if (token) {
		const q = url.searchParams.get('preview');
		if (q && q === token) {
			cookies.set(PREVIEW_COOKIE, token, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 // 1日
			});
			return true;
		}
		if (cookies.get(PREVIEW_COOKIE) === token) return true;
	}

	return false;
}

// メンテナンスページ文言（ja / en / zh-TW）
const COPY = {
	ja: {
		brandSub: '- yamado -',
		title: 'ただいまサイトを準備しています',
		body: 'メンテナンスのため、一時的にアクセスを制限しています。ご不便をおかけしますが、しばらくお待ちください。',
		tel: 'お急ぎの方・ご予約はお電話にて承ります',
		nishiwaga: '山人 -yamado-（西和賀）',
		oga: '山人 -oga-（男鹿）'
	},
	en: {
		brandSub: '- yamado -',
		title: 'We will be back soon',
		body: 'The site is temporarily unavailable for maintenance. We apologize for the inconvenience — please check back shortly.',
		tel: 'For reservations or urgent matters, please call us',
		nishiwaga: 'Yamado (Nishiwaga)',
		oga: 'Yamado Oga'
	},
	'zh-TW': {
		brandSub: '- yamado -',
		title: '網站維護中',
		body: '網站正在進行維護，暫時無法瀏覽。造成不便敬請見諒，請稍後再試。',
		tel: '如需訂房或有急事，歡迎來電洽詢',
		nishiwaga: '山人 -yamado-（西和賀）',
		oga: '山人 -oga-（男鹿）'
	}
} as const;

type MaintLocale = keyof typeof COPY;

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** メンテナンス時に返す 503 ページの HTML（自己完結・外部アセット非依存）。 */
export function maintenancePageHtml(locale: string = 'ja'): string {
	const key: MaintLocale = locale === 'en' ? 'en' : locale === 'zh-TW' ? 'zh-TW' : 'ja';
	const t = COPY[key];
	const custom = (env.MAINTENANCE_MESSAGE ?? '').trim();
	const body = custom ? escapeHtml(custom) : t.body;
	const lang = key === 'zh-TW' ? 'zh-Hant' : key;

	return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(t.title)} — 山人</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 1.5rem;
    background: #14302a;
    color: #e7e5e4;
    font-family: "Yu Mincho", "游明朝", "YuMincho", serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { width: 100%; max-width: 34rem; text-align: center; }
  .brand { font-size: 1.9rem; letter-spacing: .35em; color: #fff; }
  .brand small { display:block; margin-top:.4rem; font-size:.7rem; letter-spacing:.3em; color:#a8a29e; }
  .divider { width: 3rem; height: 1px; margin: 1.6rem auto; background: rgba(255,255,255,.25); }
  h1 { font-size: 1.25rem; font-weight: 500; color: #fff; margin: 0 0 1rem; line-height: 1.7; }
  p.body { font-size: .95rem; line-height: 1.9; color: #d6d3d1; margin: 0 auto; max-width: 28rem; }
  .tel { margin-top: 2.4rem; padding-top: 1.6rem; border-top: 1px solid rgba(255,255,255,.12); font-size: .85rem; color: #a8a29e; }
  .tel .lead { margin-bottom: .9rem; }
  .tel a { display:block; margin:.35rem 0; color:#fff; text-decoration:none; font-size:1.05rem; letter-spacing:.05em; }
  .tel a span { display:block; font-size:.72rem; color:#a8a29e; letter-spacing:.1em; margin-bottom:.1rem; }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">山人<small>${t.brandSub}</small></div>
    <div class="divider"></div>
    <h1>${escapeHtml(t.title)}</h1>
    <p class="body">${body}</p>
    <div class="tel">
      <p class="lead">${escapeHtml(t.tel)}</p>
      <a href="tel:0197822222"><span>${escapeHtml(t.nishiwaga)}</span>0197-82-2222</a>
      <a href="tel:0185477776"><span>${escapeHtml(t.oga)}</span>0185-47-7776</a>
    </div>
  </main>
</body>
</html>`;
}
