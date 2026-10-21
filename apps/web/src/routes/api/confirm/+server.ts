// POST /api/confirm — 公開アプリ（yamado-one）から現地払いの予約を確定する（2026-10-21 監査）。
//
// なぜこの入口が要るか:
//   以前はアプリが Supabase を直叩きして book.confirm_booking（anon 可）を呼んでいた。
//   RPC はプランの支払方法も必須の質問も見ていなかったため、直叩きで「予約時決済のみ」の
//   プランを現地払いで確定でき、必須の質問も飛ばせた（JPCERT-AT-2026-0030 を受けた監査で発覚）。
//   確定 RPC は service_role 専用（book.confirm_booking_server）にしたので、アプリはここを通す。
//
// 検査の段:
//   1. ここ: 入力の形・必須の質問（Web の予約確認画面と同じ applyGroupAnswers）
//   2. DB:   束の本人（セッション or 会員）・全室の支払方法（非会員は非会員の支払方法）・ゲスト情報の形
//
// 認証: 任意。Authorization: Bearer <Supabase のアクセストークン> があれば検証して会員として確定する
//   （ポイント・クーポンは会員だけ）。無ければ非会員。トークンが壊れていても 401 にはせず非会員として扱う
//   （/api/hold と同じ）。会員でないのにポイント・クーポンを送っても DB が使わない／弾く。
import { json } from '@sveltejs/kit';
import { confirmBookingGroup, sbGetHoldGroupMapped } from '$lib/server/supabase-data';
import { applyGroupAnswers } from '$lib/server/booking-questions';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import type { GuestInfo } from '$lib/types';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES = new Set(['ja', 'en', 'zh-TW']);

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

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const holdId = str(body.hold_id, 64);
	const sessionId = str(body.session_id, 200);
	const locale = String(body.locale ?? 'ja');
	const pointsUsed = Number(body.points_used ?? 0);
	const couponId = body.member_coupon_id == null ? null : str(body.member_coupon_id, 64);
	const g = (body.guest && typeof body.guest === 'object' ? body.guest : {}) as Record<string, unknown>;
	if (
		!UUID_RE.test(holdId) ||
		sessionId.length < 1 ||
		!LOCALES.has(locale) ||
		!Number.isInteger(pointsUsed) ||
		pointsUsed < 0 ||
		(couponId !== null && !UUID_RE.test(couponId))
	) {
		return json({ error: 'invalid' }, { status: 400 });
	}

	const guest: GuestInfo & { client: string } = {
		name: str(g.name, 120),
		kana: str(g.kana, 120),
		phone: str(g.phone, 40),
		email: str(g.email, 254),
		arrival: str(g.arrival, 40) || undefined,
		shuttle: g.shuttle === true,
		notes: str(g.notes, 2000) || undefined,
		// 管理画面で「アプリ経由」を見分ける印（book._sanitize_guest が通すキー）
		client: 'app'
	};
	if (!guest.name || !guest.email) return json({ error: 'invalid_guest' }, { status: 400 });

	try {
		const hold = await sbGetHoldGroupMapped(holdId, sessionId);
		if (!hold || hold.status !== 'active') return json({ error: 'hold_expired' }, { status: 410 });

		// 必須の質問（Web と同じ検証）。アプリは今のところ質問の画面を持たないので、answers は任意の
		// { "opt_<キー>": "回答" } を受け取る。必須の質問があるプランはここで止まる（questions_required）。
		const form = new FormData();
		const answers = body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {};
		for (const [k, v] of Object.entries(answers).slice(0, 100)) {
			if (/^(opt_|male_|female_)[\w-]{1,80}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) {
				form.set(k, String(v).slice(0, 2000));
			}
		}
		const answered = await applyGroupAnswers(
			form,
			hold.facilityId,
			hold.rooms.map((r) => ({ planId: r.planId, adults: r.adults })),
			guest
		);
		if (!answered.ok) return json({ error: 'questions_required', message: answered.message }, { status: 400 });

		const memberUserId = await memberFromBearer(request);
		const result = await confirmBookingGroup(holdId, sessionId, answered.guest, {
			memberUserId,
			pointsUsed: memberUserId ? pointsUsed : 0,
			memberCouponId: memberUserId ? couponId : null,
			locale,
			rooms: answered.rooms
		});
		if ('error' in result) {
			const status = result.error === 'hold_expired' ? 410 : result.error === 'forbidden' ? 403 : 400;
			return json({ error: result.error }, { status });
		}
		return json(result);
	} catch (e) {
		console.error('[api/confirm]', e instanceof Error ? e.message : String(e));
		return json({ error: 'unavailable' }, { status: 503 });
	}
};
