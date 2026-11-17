import { DATA_SOURCE } from '$lib/server/supabase';
import { PRECHECKIN_COOKIE, demoBathContext, precheckinBathAccess } from '$lib/server/precheckin';
import { sbBathContext } from '$lib/server/private-bath';
import { DEMO_PRECHECKIN_CODE } from '$lib/precheckin';
import { ciBathRows, type CiBathRow } from '$lib/precheckin-p3';
import type { PageServerLoad } from './$types';

// ④ 完了。③ で取った貸切風呂の予約を一緒に出す（取ってあれば「予約する」の導線は出さない・2026-11-14）。
// 回答済みなら前日以前に取った予約も表示する。
export const load: PageServerLoad = async (event) => {
	const { ctx } = await event.parent();
	const none = { bathRows: [] as CiBathRow[] };
	if (!ctx || !ctx.answeredAt) return none;
	if (ctx.bookingCode === DEMO_PRECHECKIN_CODE) {
		const b = demoBathContext(ctx.checkIn);
		return { bathRows: ciBathRows(b.mine, b.baths) };
	}
	const pcToken = event.cookies.get(PRECHECKIN_COOKIE) ?? '';
	if (DATA_SOURCE !== 'supabase' || !pcToken) return none;
	const b = await sbBathContext(precheckinBathAccess(pcToken)).catch(() => null);
	return b?.ok ? { bathRows: ciBathRows(b.mine, b.baths) } : none;
};
