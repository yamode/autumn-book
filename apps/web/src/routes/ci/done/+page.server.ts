import { DATA_SOURCE } from '$lib/server/supabase';
import { PRECHECKIN_COOKIE, pcDoneMessage, precheckinBathAccess } from '$lib/server/precheckin';
import { doneMessageFor, doneTitleFor } from '$lib/precheckin-done-message';
import { getLocale } from '$lib/paraglide/runtime';
import { demoBathContext } from '$lib/server/precheckin-demo-bath';
import { sbBathContext } from '$lib/server/private-bath';
import { DEMO_PRECHECKIN_CODE } from '$lib/precheckin';
import { canBookBathInPrecheckin, ciBathRows, type CiBathRow } from '$lib/precheckin-p3';
import type { PageServerLoad } from './$types';

// ④ 完了。③ で取った貸切風呂の予約を一緒に出す（取ってあれば「予約する」の導線は出さない・2026-11-14）。
// 回答済みなら前日以前に取った予約も表示する。
export const load: PageServerLoad = async (event) => {
	const { ctx } = await event.parent();
	// 施設からのご案内（管理画面で編集・お客様の言語で。空なら枠を出さない）。貸切風呂の有無に関係なく出す
	// 見出しは空なら出さない（本文だけ）。本文が空なら枠ごと出さない
	const notice = ctx
		? await pcDoneMessage(ctx.facility.id)
				.then((m) => ({ title: doneTitleFor(m, getLocale()), body: doneMessageFor(m, getLocale()) }))
				.catch(() => ({ title: '', body: '' }))
		: { title: '', body: '' };
	const none = { bathRows: [] as CiBathRow[], notice };
	if (!ctx || !ctx.answeredAt || !canBookBathInPrecheckin(ctx)) return none;
	if (ctx.bookingCode === DEMO_PRECHECKIN_CODE) {
		const b = await demoBathContext(ctx, event.cookies, true);
		return b ? { bathRows: ciBathRows(b.mine, b.baths), notice } : none;
	}
	const pcToken = event.cookies.get(PRECHECKIN_COOKIE) ?? '';
	if (DATA_SOURCE !== 'supabase' || !pcToken) return none;
	const b = await sbBathContext(precheckinBathAccess(pcToken)).catch(() => null);
	return b?.ok ? { bathRows: ciBathRows(b.mine, b.baths), notice } : none;
};
