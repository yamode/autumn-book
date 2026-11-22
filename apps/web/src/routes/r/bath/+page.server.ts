// 貸切風呂のご予約（滞在中のお客様向け）。
//
// 入口は館内図に刷った QR（/r/c/<token>）。トークンは httpOnly Cookie（ab_stay）へ
// 交換済みなので、この画面は Cookie だけを見る。URL にトークンは出ない。
// 同じ QR をもう一度スキャンしても、ここに戻ってきて **予約済みの時間を確認できる**。
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbBathCancel, sbBathContent, sbBathContext, sbBathReserve } from '$lib/server/private-bath';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import { EMPTY_BATH_CONTENT } from '$lib/private-bath-content';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import type { Actions, PageServerLoad } from './$types';

const STAY_COOKIE = 'ab_stay';

const slotIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function returnToBath(booking: string | null, changed = false) {
	const query = new URLSearchParams();
	if (booking) query.set('booking', booking);
	if (changed) query.set('changed', '1');
	return query.size ? `/r/bath?${query}` : '/r/bath';
}

function bathAccess(event: RequestEvent) {
	const booking = event.url.searchParams.get('booking');
	if (booking === null) return { booking, token: event.cookies.get(STAY_COOKIE), client: undefined };
	// booking=<Book の予約番号> か、booking=stay:<PMS の予約番号>（電話・直接・tripla などマイページで見るだけの予約・2026-11-22）
	if (!MEMBER_SUPABASE || !/^(stay:)?[a-z0-9-]{1,80}$/i.test(booking)) error(404, m.error_booking_not_found());
	if (event.locals.user?.role !== 'member') {
		redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	const token = booking.startsWith('stay:') ? `member-stay:${booking.slice(5)}` : `member-booking:${booking}`;
	return { booking, token, client: createSupabaseServerClient(event) };
}

export const load: PageServerLoad = async (event) => {
	// マイページからの予約は、マイページの見た目の専用画面へ（2026-11-22）。古いリンクもそちらへ送る
	const memberBooking = event.url.searchParams.get('booking');
	if (memberBooking !== null && /^(stay:)?[a-z0-9-]{1,80}$/i.test(memberBooking)) {
		const change = event.url.searchParams.get('change');
		redirect(303, `/account/bath/${encodeURIComponent(memberBooking)}${change ? `?change=${encodeURIComponent(change)}` : ''}`);
	}
	const { booking, token, client } = bathAccess(event);
	// デモ運用は /r へ。トークンが無い（館内案内からコードなしで来た）ときは、先に6桁コードを入れてもらう（2026-10-10）。
	// 館内図の QR（/r/c/<token>?next=bath）はトークン入りなので、ここを通らずそのまま予約フォームへ来る
	if (DATA_SOURCE !== 'supabase') redirect(303, '/r');
	if (!token) redirect(303, '/r/bath/code');

	const requestedChange = event.url.searchParams.get('change');
	const changeCtx = requestedChange && slotIdPattern.test(requestedChange)
		? await sbBathContext(token, client, requestedChange)
		: null;
	const ctx = changeCtx ?? await sbBathContext(token, client);
	if (!ctx && booking) error(404, m.error_booking_not_found());
	// 失効・チェックアウト後は /r 側の「ご滞在は終了しました」に任せる（案内を1か所に寄せる）。
	if (!ctx) redirect(303, '/r');

	// 管理画面で編集した文章・写真。未設定なら空＝アプリの既定文言がそのまま出る。
	// 読めなくても画面は落とさない（予約できることのほうが大事）。
	const content = ctx.facility?.id
		? await sbBathContent(ctx.facility.id, getLocale()).catch(() => EMPTY_BATH_CONTENT)
		: EMPTY_BATH_CONTENT;

	// シェル（黒ヘッダー）に出す見出しと戻り先。文章を入れていれば、その見出しをそのまま使う。
	const headerTitle = content.fields.title || m.bath_title();

	return { ctx, content, pmsEnabled: bathPmsEnabled(), headerTitle, booking,
		changeId: changeCtx ? requestedChange : null,
		changeUnavailable: requestedChange !== null && !changeCtx,
		changeDone: event.url.searchParams.get('changed') === '1',
		bathHref: returnToBath(booking),
		headerBack: booking ? (booking.startsWith('stay:') ? '/account' : `/account/reservations/${encodeURIComponent(booking)}`) : '/r' };
};

export const actions: Actions = {
	reserve: async (event) => {
		const { booking, token, client } = bathAccess(event);
		if (!token) redirect(303, '/r');
		if (!bathPmsEnabled()) return fail(503, { error: 'not_open' as const });

		const fd = await event.request.formData();
		const bathId = String(fd.get('bathId') ?? '').trim() || null;
		const date = String(fd.get('date') ?? '').trim();
		const from = String(fd.get('from') ?? '').trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(from)) {
			return fail(400, { error: 'choose' as const });
		}

		const changeId = event.url.searchParams.get('change');
		if (changeId && !slotIdPattern.test(changeId)) return fail(400, { error: 'change_unavailable' as const });
		const result = await sbBathReserve(token, bathId, [{ date, from }], client, changeId);
		if (!result.ok) {
			// The transaction is authoritative. Refresh the slots after it rejects the request.
			if (result.code !== 'other') {
				const refreshedCtx = await sbBathContext(token, client, changeId);
				return fail(409, { error: result.code, refreshedCtx, availabilityRefreshFailed: !refreshedCtx?.ok,
					attempted: { date, from, bathId } });
			}
			return fail(400, { error: result.code });
		}
		if (changeId) redirect(303, returnToBath(booking, true));
		if (booking) return { done: 'reserved' as const };
		const query = new URLSearchParams({ date, from, bath: bathId ?? '' });
		redirect(303, `/r/bath/complete?${query}`);
	},

	cancel: async (event) => {
		const { token, client } = bathAccess(event);
		if (!token) redirect(303, '/r');
		if (!bathPmsEnabled()) return fail(503, { error: 'not_open' as const });

		const fd = await event.request.formData();
		const slotId = String(fd.get('slotId') ?? '').trim();
		// An old page may still send the previous cancel-first change action.
		if (fd.get('intent') === 'change') return fail(409, { error: 'change_unavailable' as const });
		if (!slotId) return fail(400, { error: 'other' as const });
		if (!(await sbBathCancel(token, slotId, client))) return fail(400, { error: 'other' as const });
		return { done: 'canceled' as const };
	}
};
