import { fail } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	PRECHECKIN_COOKIE,
	demoBathCancel,
	demoBathContext,
	demoBathReserve,
	ensureStayCookie,
	resolvePrecheckin
} from '$lib/server/precheckin';
import { sbBathCancel, sbBathContext, sbBathReserve, type BathContext } from '$lib/server/private-bath';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import { DEMO_PRECHECKIN_CODE } from '$lib/precheckin';
import { ciBathState, type CiBathState } from '$lib/precheckin-p3';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// ③ 貸切風呂（任意）。2026-11-14: この画面の中で予約・取消までできるようにした（以前は /r/bath へ案内するだけ）。
// 予約そのものは客室案内と同じ RPC（private_bath_context / reserve_private_bath / cancel_private_bath）を滞在トークンで呼ぶので、
// 料金・無料経路・上限・締切・取消期限・グループ共有は /r/bath と同じ結果になる（重複実装しない・docs/pre-checkin.md §6）。
// 滞在トークンは、回答済みなら book.precheckin_stay_token で受け取り Cookie（ab_stay）に入れる（以後 /r もそのまま開ける）。
// 滞在トークンの有効開始はチェックイン日 9:00 なので、それより前は「当日 9:00 から」を出す。
// 見本（DEMO-0001）は DB に触れず、プロセス内の見本の空き枠で予約・取消まで試せる。
type BathView = { state: CiBathState; ctx: BathContext | null };

const bathAccessForPrecheckin = (token: string) => 'precheckin-bath:' + token;

export const load: PageServerLoad = async (event) => {
	const { ctx } = await event.parent();
	if (!ctx) return { bath: { state: 'unavailable', ctx: null } as BathView };
	const answered = Boolean(ctx.answeredAt);

	if (ctx.bookingCode === DEMO_PRECHECKIN_CODE) {
		return { bath: { state: answered ? 'ready' : 'not_answered', ctx: answered ? demoBathContext(ctx.checkIn) : null } as BathView };
	}

	const pcToken = event.cookies.get(PRECHECKIN_COOKIE) ?? '';
	const token = ctx.editable && answered && pcToken ? await ensureStayCookie(event.cookies, pcToken) : null;
	const pre = ciBathState({ answered, editable: ctx.editable, token, bathOpen: true });
	if (pre !== 'ready' || !token?.ok || DATA_SOURCE !== 'supabase') return { bath: { state: pre, ctx: null } as BathView };

	const b = await sbBathContext(bathAccessForPrecheckin(pcToken)).catch(() => null);
	const open = Boolean(b?.ok && b.enabled && bathPmsEnabled());
	return { bath: { state: open ? 'ready' : 'unavailable', ctx: open ? b : null } as BathView };
};

/** 予約・取消の前に、事前チェックインのトークンを確かめる（見本は 'demo'） */
async function bathAccessFor(event: RequestEvent): Promise<string | null> {
	const r = await resolvePrecheckin(event);
	if (!('ctx' in r) || !r.ctx.answeredAt) return null;
	if (r.ctx.bookingCode === DEMO_PRECHECKIN_CODE) return 'demo';
	if (DATA_SOURCE !== 'supabase') return null;
	// RPC で事前チェックインの回答・有効期限と、当日9時を過ぎたかを検証する。
	return bathAccessForPrecheckin(r.token);
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

		if (token === 'demo') {
			for (const p of picked) {
				const r = demoBathReserve(p.date, p.from);
				if (r !== 'ok') return fail(409, { error: r });
			}
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
		const ok = token === 'demo' ? demoBathCancel(slotId) : bathPmsEnabled() && (await sbBathCancel(token, slotId));
		return ok ? { canceled: true } : fail(400, { error: 'cancel_failed' as const });
	}
};
