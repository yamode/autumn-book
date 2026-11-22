// マイページの貸切風呂の事前予約（2026-11-22）。
// 以前は館内の QR と同じ /r/bath（黒いヘッダーの館内向けの画面）へ飛ばしていたが、
// マイページから来た会員にはマイページの見た目のまま予約・変更・取消できるようにした。
// [booking] は Book の予約番号か、stay:<PMS の予約番号>（電話・直接・tripla などの見るだけの予約）。
// 予約の可否・上限・締切は DB（book._pb_token の member-booking: / member-stay:）が判断する。
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbBathCancel, sbBathContent, sbBathContext, sbBathReserve } from '$lib/server/private-bath';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import { EMPTY_BATH_CONTENT } from '$lib/private-bath-content';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const slotIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function access(event: RequestEvent) {
	const booking = event.params.booking ?? '';
	if (!MEMBER_SUPABASE || !/^(stay:)?[a-z0-9-]{1,80}$/i.test(booking)) error(404, m.error_booking_not_found());
	if (event.locals.user?.role !== 'member') {
		redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	const isStay = booking.startsWith('stay:');
	const token = isStay ? `member-stay:${booking.slice(5)}` : `member-booking:${booking}`;
	return { booking, isStay, token, client: createSupabaseServerClient(event) };
}

export const load: PageServerLoad = async (event) => {
	const { booking, isStay, token, client } = access(event);
	const requestedChange = event.url.searchParams.get('change');
	const changeCtx = requestedChange && slotIdPattern.test(requestedChange) ? await sbBathContext(token, client, requestedChange) : null;
	const ctx = changeCtx ?? (await sbBathContext(token, client));
	if (!ctx) error(404, m.error_booking_not_found());
	const content = ctx.facility?.id
		? await sbBathContent(ctx.facility.id, getLocale()).catch(() => EMPTY_BATH_CONTENT)
		: EMPTY_BATH_CONTENT;
	return {
		ctx,
		content,
		booking,
		pmsEnabled: bathPmsEnabled(),
		changeId: changeCtx ? requestedChange : null,
		changeUnavailable: requestedChange !== null && !changeCtx,
		backHref: isStay ? '/account/reservations' : `/account/reservations/${encodeURIComponent(booking)}`,
		backIsList: isStay
	};
};

export const actions: Actions = {
	reserve: async (event) => {
		const { token, client } = access(event);
		if (!bathPmsEnabled()) return fail(503, { error: 'not_open' as const });
		const fd = await event.request.formData();
		const bathId = String(fd.get('bathId') ?? '').trim() || null;
		const date = String(fd.get('date') ?? '').trim();
		const from = String(fd.get('from') ?? '').trim();
		const changeId = String(fd.get('changeId') ?? '').trim() || null;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(from)) return fail(400, { error: 'choose' as const });
		if (changeId && !slotIdPattern.test(changeId)) return fail(400, { error: 'change_unavailable' as const });
		const result = await sbBathReserve(token, bathId, [{ date, from }], client, changeId);
		if (!result.ok) {
			// 確定の可否は DB が正。断られたら空き枠を読み直して返す
			const refreshedCtx = result.code !== 'other' ? await sbBathContext(token, client) : null;
			return fail(409, { error: result.code, refreshedCtx });
		}
		redirect(303, `${event.url.pathname}?done=${changeId ? 'changed' : 'reserved'}`);
	},

	cancel: async (event) => {
		const { token, client } = access(event);
		if (!bathPmsEnabled()) return fail(503, { error: 'not_open' as const });
		const fd = await event.request.formData();
		const slotId = String(fd.get('slotId') ?? '').trim();
		if (!slotIdPattern.test(slotId)) return fail(400, { error: 'other' as const });
		if (!(await sbBathCancel(token, slotId, client))) return fail(400, { error: 'other' as const });
		redirect(303, `${event.url.pathname}?done=canceled`);
	}
};
