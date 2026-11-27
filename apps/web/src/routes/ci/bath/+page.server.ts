import { fail, redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	PRECHECKIN_COOKIE,
	precheckinBathAccess,
	resolvePrecheckin
} from '$lib/server/precheckin';
import { demoBathCancel, demoBathContext, demoBathReserve } from '$lib/server/precheckin-demo-bath';
import { sbBathCancel, sbBathContext, sbBathReserve, type BathContext } from '$lib/server/private-bath';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import { DEMO_PRECHECKIN_CODE, type PcContext } from '$lib/precheckin';
import { canBookBathInPrecheckin, ciBathBeforeDay, ciBathState, type CiBathState } from '$lib/precheckin-p3';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// 回答済みの事前チェックインリンクで貸切風呂のRPCを呼ぶ。客室案内の開始時刻とは独立している。
type BathView = { state: CiBathState; ctx: BathContext | null };

export const load: PageServerLoad = async (event) => {
	const { ctx } = await event.parent();
	if (!ctx) return { bath: { state: 'unavailable', ctx: null } as BathView };
	const answered = Boolean(ctx.answeredAt);
	if (!canBookBathInPrecheckin(ctx)) redirect(303, localizeHref(answered ? '/ci/done' : '/ci/meals'));
	const pcToken = event.cookies.get(PRECHECKIN_COOKIE);
	let bath: BathContext | null = null;
	// 直販扱いの予約は、事前チェックインからチェックイン当日以降に貸切風呂を予約できる。
	// 前もっての予約は会員のマイページから（DB の _pb_bath_token も同じ条件で断る・2026-11-23）
	const beforeDay = ctx.bookingCode === DEMO_PRECHECKIN_CODE ? false : ciBathBeforeDay(ctx.checkIn);
	if (answered && ctx.editable && !beforeDay) {
		if (ctx.bookingCode === DEMO_PRECHECKIN_CODE) {
			bath = await demoBathContext(ctx, event.cookies);
		} else if (DATA_SOURCE === 'supabase' && pcToken && bathPmsEnabled()) {
			bath = await sbBathContext(precheckinBathAccess(pcToken)).catch(() => null);
		}
	}
	const state = ciBathState({ answered, editable: ctx.editable, bathOpen: Boolean(bath?.ok && bath.enabled), beforeDay });
	return { bath: { state, ctx: state === 'ready' ? bath : null } as BathView };
};

/** 予約・取消の前に、事前チェックインのトークンを確かめる（見本は仮の滞在情報を渡す） */
async function bathAccessFor(event: RequestEvent): Promise<string | PcContext | null> {
	const r = await resolvePrecheckin(event);
	if (!('ctx' in r) || !r.ctx.answeredAt || !r.ctx.editable) return null;
	if (!canBookBathInPrecheckin(r.ctx)) return null;
	if (r.ctx.bookingCode === DEMO_PRECHECKIN_CODE) return r.ctx;
	if (DATA_SOURCE !== 'supabase') return null;
	if (ciBathBeforeDay(r.ctx.checkIn)) return null;
	// RPC で事前チェックインの回答・有効期限を検証する。
	return precheckinBathAccess(r.token);
}

export const actions: Actions = {
	reserve: async (event) => {
		const token = await bathAccessFor(event);
		if (!token) return fail(400, { error: 'not_open' as const });
		const fd = await event.request.formData();
		const bathId = String(fd.get('bathId') ?? '').trim() || null;
		// 選んだ枠（'YYYY-MM-DD|HH:MM'）。時間帯（日付×午前/午後）ごとに 1 枠ずつ、まとめて送られてくる（2026-11-15）
		const slots = [...new Set(fd.getAll('slot').map((v) => String(v).trim()))]
			.map((v) => /^(\d{4}-\d{2}-\d{2})\|(\d{1,2}:\d{2})$/.exec(v))
			.map((m) => (m ? { date: m[1], from: m[2] } : null));
		if (slots.length === 0 || slots.length > 8 || slots.some((x) => x === null)) return fail(400, { error: 'choose' as const });
		const picked = slots as { date: string; from: string }[];

		if (typeof token !== 'string') {
			const r = await demoBathReserve(token, event.cookies, bathId, picked);
			if (r !== 'ok') return fail(409, { error: r });
			return { reserved: picked };
		}
		if (!bathPmsEnabled()) return fail(503, { error: 'not_open' as const });
		// まとめて 1 回で予約する（RPC は全部取れるか、全部取れないか）
		const r = await sbBathReserve(token, bathId, picked);
		if (!r.ok) return fail(r.code === 'other' ? 400 : 409, { error: r.code });
		return { reserved: picked };
	},

	cancel: async (event) => {
		const token = await bathAccessFor(event);
		if (!token) return fail(400, { error: 'not_open' as const });
		const slotId = String((await event.request.formData()).get('slotId') ?? '').trim();
		if (!slotId) return fail(400, { error: 'other' as const });
		const ok = typeof token !== 'string'
			? await demoBathCancel(token, event.cookies, slotId)
			: bathPmsEnabled() && (await sbBathCancel(token, slotId));
		return ok ? { canceled: true } : fail(400, { error: 'cancel_failed' as const });
	}
};
