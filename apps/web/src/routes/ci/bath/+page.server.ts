import { DATA_SOURCE } from '$lib/server/supabase';
import { PRECHECKIN_COOKIE, ensureStayCookie } from '$lib/server/precheckin';
import { sbBathContext } from '$lib/server/private-bath';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import { ciBathRows, ciBathState, type CiBathRow, type CiBathState } from '$lib/precheckin-p3';
import type { PageServerLoad } from './$types';

// ③ 貸切風呂（任意）。予約そのものは既存の /r/bath（private_bath_context / reserve / cancel・料金・無料経路・上限・締切）で行い、
// ここは「予約する」への導線と、予約済みの枠の表示だけ（重複実装しない・docs/pre-checkin.md §6）。
// 回答済み・チェックイン日 12:00 より前なら、ここで滞在トークンを Cookie（ab_stay）に入れておく
// （そのまま /r/bath を開ける。予約済みの枠を読むのにも同じトークンを使う）。
export const load: PageServerLoad = async (event) => {
	const { ctx } = await event.parent();
	const empty = { state: 'unavailable' as CiBathState, rows: [] as CiBathRow[], cancelMin: null as number | null };
	if (!ctx) return { bath: empty };

	const pcToken = event.cookies.get(PRECHECKIN_COOKIE) ?? '';
	const answered = Boolean(ctx.answeredAt);
	const token = ctx.editable && answered && pcToken ? await ensureStayCookie(event.cookies, pcToken) : null;

	// 予約状況は滞在トークンが今使えるときだけ読む（9:00 前は _pb_token が invalid_token にする）
	let bathOpen: boolean | null = null;
	let rows: CiBathRow[] = [];
	let cancelMin: number | null = null;
	const pre = ciBathState({ answered, editable: ctx.editable, token, bathOpen: true });
	if (pre === 'ready' && token?.ok && DATA_SOURCE === 'supabase') {
		const b = await sbBathContext(token.token).catch(() => null);
		bathOpen = Boolean(b?.ok && b.enabled && bathPmsEnabled());
		if (b?.ok) {
			rows = ciBathRows(b.mine, b.baths);
			cancelMin = b.cancel_min ?? null;
		}
	}
	const state = pre === 'ready' ? ciBathState({ answered, editable: ctx.editable, token, bathOpen }) : pre;
	return { bath: { state, rows, cancelMin } };
};
