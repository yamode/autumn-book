// POST /api/hold — 公開アプリ（yamado-one）から 1 室の仮押さえを作る（auth-hardening.md S8）。
//
// なぜこの入口が要るか:
//   アプリが Supabase を直叩きして book.create_hold（7 引数版・anon 可）を呼ぶと、
//   Cloudflare の前段（KV の IP 別制限）を通らないため、DB に届いてから止まることになる。
//   この入口を挟むと Web の予約フォームと同じ防御（hold-rate-limit.ts の 10 分 20 回）を
//   アプリにも効かせられる。仮押さえは 1 件ごとに booking.availability を 20 分押さえるので、
//   DB へ届く前に止める意味が大きい。
//
// 防御の段:
//   1. ここ: Cloudflare KV `AB_RATE` の `hold:<ip>` 10 分 20 回（Web と同じ関数・同じ窓）
//   2. DB: book.create_hold_group の client_key 別 10 分 20 件・全体 10 分 500 件
//   Turnstile は Web だけ（React Native にネイティブの部品が無く、予約は非会員でもできるため
//   「要ログイン」で代替もできない。2026-10-17 のユーザー判断で今回は入れない）。
//
// ⚠ p_client_key に相当する clientKey は**必ずここで決めた接続元 IP** を渡す。
//   本文から受け取った値を流してはいけない（DB 側の接続元別の上限を回し放題になる）。
//
// 認証: 任意。Authorization: Bearer <Supabase のアクセストークン> があれば検証して
//   会員として紐付ける（p_member_user_id）。無ければ非会員の予約として通す（Web と同じ）。
//   トークンが壊れていても 401 にはせず「非会員」として扱う（予約を落とさない側に倒す）。
import { json } from '@sveltejs/kit';
import { createHoldSingle } from '$lib/server/supabase-data';
import { holdRateCheck } from '$lib/server/hold-rate-limit';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { isSecretPlan } from '$lib/server/secret-plans';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCALES = new Set(['ja', 'en', 'zh-TW']);

/** 接続元 IP（Cloudflare では cf-connecting-ip。取れなければ 'unknown'） */
function clientIp(event: { request: Request; getClientAddress: () => string }): string {
	const h = event.request.headers.get('cf-connecting-ip');
	if (h) return h;
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

/** Authorization: Bearer のトークンを Supabase で検証して会員 id を返す。無効・未設定なら null */
async function memberFromBearer(request: Request): Promise<string | null> {
	const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (!token) return null;
	try {
		const sb = partnerServiceClient();
		if (!sb) return null;
		const {
			data: { user },
			error
		} = await sb.auth.getUser(token);
		return error || !user ? null : user.id;
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async (event) => {
	const { request, platform } = event;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const sessionId = String(body.session_id ?? '').trim();
	const planId = String(body.rate_plan_id ?? '').trim();
	const roomTypeId = String(body.room_type_id ?? '').trim();
	const checkin = String(body.checkin ?? '').trim();
	const nights = Number(body.nights);
	const adults = Number(body.adults);
	const locale = String(body.locale ?? 'ja');

	// 入力検証（DB 側でも見るが、無駄な往復をここで落とす）
	if (
		sessionId.length < 1 ||
		sessionId.length > 200 ||
		!UUID_RE.test(planId) ||
		!UUID_RE.test(roomTypeId) ||
		!DATE_RE.test(checkin) ||
		!Number.isInteger(nights) ||
		nights < 1 ||
		nights > 14 ||
		!Number.isInteger(adults) ||
		adults < 1 ||
		adults > 6 ||
		!LOCALES.has(locale)
	) {
		return json({ error: 'invalid' }, { status: 400 });
	}

	const ip = clientIp(event);

	// 1 段目: Cloudflare KV の接続元別の上限（DB に届く前に止める）
	if (!(await holdRateCheck(platform, ip))) {
		return json({ error: 'rate_limited' }, { status: 429 });
	}

	const memberUserId = await memberFromBearer(request);

	// シークレットプラン（会員限定・URL 限定）はアプリからは予約させない（専用 URL を開いたかを判定できないため。公式サイトから予約する）
	if (await isSecretPlan(planId)) {
		return json({ error: 'invalid' }, { status: 400 });
	}

	try {
		const result = await createHoldSingle(sessionId, planId, roomTypeId, checkin, nights, adults, {
			clientKey: ip, // ★本文の値ではなく、ここで決めた IP を渡す
			memberUserId,
			locale
		});
		if ('error' in result) {
			const status =
				result.error === 'sold_out' ? 409 : result.error === 'rate_limited' || result.error === 'too_many_holds' ? 429 : 400;
			return json({ error: result.error }, { status });
		}
		return json({ hold_id: result.holdId, expires_at: result.expiresAt, quote: result.quote });
	} catch (e) {
		console.error('[api/hold]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503 });
	}
};
