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
import { timingSafeEqualText } from '$lib/partner-mfa';
import { signCookieValue, verifyCookieValue } from './signed-cookie';
import { base64url } from './partners/crypto';
import type { RequestEvent } from '@sveltejs/kit';

const PREVIEW_COOKIE = 'ab_preview';
const PREVIEW_TTL_SEC = 60 * 60 * 24; // 1日
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
// KV の値は全リクエストで読む（hooks と管理画面のレイアウトで1回ずつ）ので、同じ isolate の中で 10 秒覚える
// （2026-10-18 高速化）。切り替えた isolate では setMaintenance がすぐ書き換える。ほかの isolate のずれは最大 10 秒。
let toggleCache: { on: boolean; expires: number } | null = null;
const TOGGLE_TTL_MS = 10_000;

async function getToggle(platform: Platform): Promise<boolean> {
	const ns = kv(platform);
	if (!ns) return memoryOn;
	const now = Date.now();
	if (toggleCache && toggleCache.expires > now) return toggleCache.on;
	const on = (await ns.get(KV_KEY)) === 'on';
	toggleCache = { on, expires: now + TOGGLE_TTL_MS };
	return on;
}

/** 管理画面トグルを保存（KV があれば KV、無ければメモリ）。 */
export async function setMaintenance(platform: Platform, on: boolean): Promise<void> {
	const ns = kv(platform);
	if (ns) await ns.put(KV_KEY, on ? 'on' : 'off');
	else memoryOn = on;
	toggleCache = { on, expires: Date.now() + TOGGLE_TTL_MS };
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

/** 取引先専用ページ（メンテナンスの対象外・日本語のみ）のパスか。 */
export function isPartnerPath(pathname: string): boolean {
	return (
		pathname.startsWith('/p/') ||
		// 共通ログイン画面（docs/partner-common-login.md）
		pathname === '/partner' || pathname.startsWith('/partner/') ||
		pathname.startsWith('/api/partner/') ||
		pathname === '/api/cron/partner-charge' || pathname === '/api/cron/upgrade-payments' ||
		// 事前チェックイン P4: 当日 9:00 の自動送信（CRON_SECRET）と NTT CPaaS の Webhook（Basic 認証）。
		// 会員・運営のセッションは要らず、ポータル本体の公開状況（メンテナンス）と関係なく動かす
		pathname === '/api/cron/precheckin-send' || pathname.startsWith('/api/webhooks/ntt-cpaas/') ||
		// 受電端末の OS・アプリ更新の通知（pg_cron が 10 分ごとに呼ぶ・CRON_SECRET）。メンテナンス中でも止めない
		pathname === '/api/cron/intercom-device-notify'
	);
}

// ★2026-11-23 レビュー L-2: プレビュー cookie には合言葉そのものを入れず、署名つきの印（期限＋合言葉の指紋）を入れる。
//   ・cookie が漏れても合言葉は分からず、1 日で切れる。
//   ・MAINTENANCE_BYPASS_TOKEN を替えれば、指紋が合わなくなって発行済みの cookie もまとめて無効になる。
//   形式: signCookieValue('ab_preview', 'v1:<期限の epoch 秒>:<指紋>')

/** 合言葉の指紋（SHA-256 の先頭 16 文字・base64url）。合言葉の入れ替えで発行済みの印を無効にするため */
async function tokenFingerprint(token: string): Promise<string> {
	const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ab_preview/v1\n${token}`));
	return base64url(new Uint8Array(h)).slice(0, 16);
}

/** プレビュー cookie の値（署名つき・1 日）を作る */
export async function previewCookieValue(token: string, now = Date.now()): Promise<string> {
	const exp = Math.floor(now / 1000) + PREVIEW_TTL_SEC;
	return signCookieValue(PREVIEW_COOKIE, `v1:${exp}:${await tokenFingerprint(token)}`);
}

/** プレビュー cookie が今の合言葉で発行され、期限内か */
export async function isValidPreviewCookie(value: string | undefined | null, token: string, now = Date.now()): Promise<boolean> {
	if (!value || !token) return false;
	const inner = await verifyCookieValue(PREVIEW_COOKIE, value);
	const m = inner?.match(/^v1:(\d{1,12}):([A-Za-z0-9_-]{16})$/);
	if (!m) return false;
	if (Number(m[1]) * 1000 <= now) return false;
	return timingSafeEqualText(m[2], await tokenFingerprint(token));
}

async function issuePreviewCookie(event: RequestEvent, token: string): Promise<void> {
	event.cookies.set(PREVIEW_COOKIE, await previewCookieValue(token), {
		path: '/',
		httpOnly: true,
		secure: event.url.protocol === 'https:',
		sameSite: 'lax',
		maxAge: PREVIEW_TTL_SEC
	});
}

/** メンテナンスのバイパスの判定結果。redirect は ?preview= を外した同じ画面（合言葉を URL・履歴に残さない） */
export type MaintenanceBypass = { ok: boolean; redirect?: string };

/**
 * メンテナンス中でもこのリクエストを通す（バイパスする）か。
 * preview トークンが一致したら署名つきの cookie を発行し、以後の遷移でも通るようにする。
 * GET/HEAD でトークンを受け取ったときは、?preview= を外した URL への 303 を redirect で返す。
 */
export async function checkMaintenanceBypass(event: RequestEvent): Promise<MaintenanceBypass> {
	if (event.url.pathname === '/mail/unsubscribe') return { ok: true };
	const { url, locals, cookies } = event;
	const token = bypassToken();

	// 運営（admin / staff）でログイン中なら、プレビュー cookie も一緒に発行しておく。
	// 運営のまま会員ログインの試験をすると、セッションが会員に入れ替わって運営のバイパスを失い、
	// ログイン直後に 503 になるため（2026-10-29）。cookie があれば会員になっても公開サイトを通せる。
	const staffRole = locals.staff?.user.role ?? locals.user?.role;
	if ((staffRole === 'admin' || staffRole === 'staff') && token && !(await isValidPreviewCookie(cookies.get(PREVIEW_COOKIE), token))) {
		await issuePreviewCookie(event, token);
	}

	if (isAlwaysOpenPath(url.pathname)) return { ok: true };

	// 運営（admin / staff）はメンテ中も公開サイトをプレビューできる
	const role = locals.user?.role;
	if (role === 'admin' || role === 'staff') return { ok: true };

	// プレビュートークン（関係者への共有用）
	if (token) {
		const q = url.searchParams.get('preview');
		if (q && timingSafeEqualText(q, token)) {
			await issuePreviewCookie(event, token);
			const method = event.request?.method ?? 'GET';
			if (method === 'GET' || method === 'HEAD') {
				const clean = new URL(url);
				clean.searchParams.delete('preview');
				return { ok: true, redirect: clean.pathname + clean.search + clean.hash };
			}
			return { ok: true };
		}
		if (await isValidPreviewCookie(cookies.get(PREVIEW_COOKIE), token)) return { ok: true };
	}

	return { ok: false };
}

/** checkMaintenanceBypass の可否だけ */
export async function isMaintenanceBypassed(event: RequestEvent): Promise<boolean> {
	return (await checkMaintenanceBypass(event)).ok;
}

/** メンテナンス中でも誰でも開ける面か */
function isAlwaysOpenPath(pathname: string): boolean {
	// 管理エリアは常に到達可能（/admin/login でログイン → バイパス取得するため）
	if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;

	// 滞在中のお客様向けの面（客室電子インフォメーション・貸切風呂のご予約）は
	// ポータル本体より先に公開する。館内図に刷った QR の着地点なので、
	// メンテナンス中でも必ず開けなければならない（紙は刷り直せない）。
	// 言語プレフィックス付き（/en/r・/zh-TW/r）も同じ扱いにする。
	if (/^\/(?:en\/|zh-TW\/)?r(?:\/|$)/.test(pathname)) return true;
	// 事前チェックインのフォーム（/ci/<token>）も、SMS・メールで送ったリンクの着地点なので同じ扱い（P4）
	if (/^\/(?:en\/|zh-TW\/)?ci(?:\/|$)/.test(pathname)) return true;

	// 取引先専用ページ（限定URL /p/<token>・取引先 API・Stripe Webhook・請求 cron）は
	// ポータル本体の公開状況と関係なく稼働させる（2026-09-26 ユーザー指示。autumn-rms から移設）。
	if (isPartnerPath(pathname)) return true;

	// FAQ ボットの公開 API とウィジェットは、各施設HP（oga.yamado.co.jp・www.yamado.co.jp）に埋め込んで使う
	// 独立した機能なので、ポータル本体の公開状況と関係なく稼働させる（2026-10-03 ユーザー指示・設計書 autumn_book_faq_bot_design.md）。
	if (pathname.startsWith('/api/faq/') || pathname.startsWith('/faq/')) return true;
	// お知らせの公開 API も同様に、施設HP（Xserver の PHP）が一覧・詳細の描画に使う（2026-10-03 ユーザー指示: 両HPのお知らせを Book で管理）
	if (pathname.startsWith('/api/news/')) return true;
	// 施設ナレッジの API（docs/facility-knowledge.md 段階5）は、taskul-social などほかのアプリがサーバー側から読む。
	// ポータル本体の公開状況と関係なく稼働させる。ルートの中で鍵（KNOWLEDGE_API_KEY）を必ず確かめる
	if (pathname.startsWith('/api/knowledge/')) return true;
	// 西和賀HPの署名付き問い合わせ受付は、予約ポータルの公開状態から独立する。
	// この例外でも受付ルート内のHMAC・時刻・公開フラグ検証は必須。
	if (pathname === '/api/inquiries/nishiwaga') return true;
	// 会員サポートの受信（受信用 Worker → 署名つき POST・docs/member-support.md）も、メールを落とさないよう公開状態から独立させる。
	// ルートの中で署名と時刻を必ず確かめる
	if (pathname === '/api/support/inbound') return true;
	// 公開アプリ yamado-one の仮押さえ API も、ポータル本体の公開状況と関係なく稼働させる
	// （2026-10-17 ユーザー指示・auth-hardening.md S8）。アプリはストアに出る別プロダクトで、
	// ポータルの公開前・メンテナンス中でも予約できなければならない。ここを通さないと
	// アプリの「予約へ進む」が 503 のメンテナンス HTML を受け取って必ず失敗する。
	if (pathname === '/api/hold') return true;
	// 予約の確定も同じ理由でアプリ用の入口を通す（2026-10-21 監査で確定 RPC を service_role 専用にした）
	if (pathname === '/api/confirm') return true;
	// CSP の違反報告（Report-Only）はメンテナンス中のプレビューからも届く。HTML を返さず受ける
	if (pathname === '/api/csp-report') return true;
	// アクセス元の国の判定（同意バナーの出し分け）も、施設HP（Xserver・国が分からない）がブラウザから呼ぶ
	// 独立した機能なので、ポータル本体の公開状況と関係なく稼働させる（2026-10-21）。
	if (pathname === '/api/geo') return true;

	// 法定表記（特商法・プライバシーポリシー・宿泊約款）は、取引先ページからのリンク先であり、
	// 決済サービスの審査でも開ける必要があるため、ポータル本体の公開前から見られるようにする。
	if (/^\/(?:en\/|zh-TW\/)?legal\//.test(pathname)) return true;

	return false;
}

// メンテナンスページ文言（ja / en / zh-TW）
const COPY = {
	ja: {
		title: 'ただいまサイトを準備しています',
		body: 'メンテナンスのため、一時的にアクセスを制限しています。ご不便をおかけしますが、しばらくお待ちください。',
		tel: 'お急ぎの方・ご予約はお電話にて承ります',
		nishiwaga: '山人 -yamado-（西和賀）',
		oga: '山人 -oga-（男鹿）'
	},
	en: {
		title: 'We will be back soon',
		body: 'The site is temporarily unavailable for maintenance. We apologize for the inconvenience — please check back shortly.',
		tel: 'For reservations or urgent matters, please call us',
		nishiwaga: 'Yamado (Nishiwaga)',
		oga: 'Yamado Oga'
	},
	'zh-TW': {
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
    <div class="brand">YAMADO</div>
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
