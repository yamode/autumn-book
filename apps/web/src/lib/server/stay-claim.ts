// 6桁コード（2026-10-09 以前の発行分は8桁）→ 滞在トークンに交換して Cookie（ab_stay）を発行する。
// 客室案内のトップ（/r）と、貸切風呂のコード入力（/r/bath/code）で共通（2026-10-10）。
// 簡易レート制限（5回失敗で10分ロック・KV に数える）付き。成功なら null、失敗なら fail() を返す（呼び出し側が行き先へ redirect）。
import { fail, type RequestEvent } from '@sveltejs/kit';
import { resolveStay, claimStayByCode } from '$lib/server/store';
import { claimRateCheck, claimRecordFailure, claimRecordSuccess } from '$lib/server/claim-rate-limit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay, sbClaimStayByCode } from '$lib/server/supabase-data';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { getLocale } from '$lib/paraglide/runtime';

const STAY_COOKIE = 'ab_stay';

export async function claimStayFromForm(event: RequestEvent) {
	const key = event.getClientAddress();
	const rl = await claimRateCheck(event.platform, key);
	if (rl.locked) return fail(429, { claimError: 'locked' as const, retryInSec: rl.retryInSec });

	const form = await event.request.formData();
	const code = String(form.get('code') ?? '');

	const token = DATA_SOURCE === 'supabase' ? await sbClaimStayByCode(code, key) : claimStayByCode(code);
	if (token === 'rate_limited') return fail(429, { claimError: 'locked' as const, retryInSec: 600 });
	if (!token) {
		await claimRecordFailure(event.platform, key);
		return fail(400, { claimError: 'fail' as const });
	}
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
	if (!stay) return fail(400, { claimError: 'fail' as const });

	await claimRecordSuccess(event.platform, key);
	event.cookies.set(STAY_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: stayCookieMaxAge(stay.validTo)
	});
	return null;
}
