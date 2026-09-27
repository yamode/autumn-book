import { fail, redirect } from '@sveltejs/kit';
import { resolveStay, listHouseGuidesFor, claimStayByCode } from '$lib/server/store';
// 試行レート制限は KV（AB_CONFIG）に数える。store.ts のプロセス内 Map は
// Workers では isolate ごとに分かれて揮発するため、本番で効かない（設計レビュー M1）。
import {
	claimRateCheck,
	claimRecordFailure,
	claimRecordSuccess
} from '$lib/server/claim-rate-limit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay, sbListHouseGuides, sbClaimStayByCode } from '$lib/server/supabase-data';
import { sbBathContext } from '$lib/server/private-bath';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { getLocale } from '$lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';

// 滞在セッション Cookie（claim 済みトークンを httpOnly で保持）
const STAY_COOKIE = 'ab_stay';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const locale = getLocale();
	const invalidQr = url.searchParams.get('e') === 'invalid';
	const token = cookies.get(STAY_COOKIE);

	if (!token) {
		// 未 claim: コード入力フォームを出す
		return { stay: null, guides: [], bathReservations: [], expired: false, invalidQr };
	}

	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, locale);
	if (!stay) {
		// Cookie はあるが無効（失効/期間外）＝ ご滞在終了。Cookie は消さず「終了」表示に使う
		return { stay: null, guides: [], bathReservations: [], expired: true, invalidQr };
	}

	const [guides, bathContext] = await Promise.all([
		DATA_SOURCE === 'supabase'
			? sbListHouseGuides(stay.facility.id, locale)
			: Promise.resolve(listHouseGuidesFor(stay.facility.id, locale)),
		DATA_SOURCE === 'supabase' ? sbBathContext(token).catch(() => null) : Promise.resolve(null)
	]);

	return {
		stay,
		guides,
		bathReservations: bathContext?.ok
			? (bathContext.mine ?? []).map(({ id, date, from, to }) => ({ id, date, from, to }))
			: [],
		expired: false,
		invalidQr
	};
};

export const actions: Actions = {
	// 手入力の8桁コード → トークン交換 → Cookie 発行。簡易レート制限（5回失敗で10分ロック）付き。
	claim: async (event) => {
		const key = event.getClientAddress();
		const rl = await claimRateCheck(event.platform, key);
		if (rl.locked) return fail(429, { claimError: 'locked' as const, retryInSec: rl.retryInSec });

		const form = await event.request.formData();
		const code = String(form.get('code') ?? '');

		const token = DATA_SOURCE === 'supabase' ? await sbClaimStayByCode(code) : claimStayByCode(code);
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
		redirect(303, '/r');
	}
};
