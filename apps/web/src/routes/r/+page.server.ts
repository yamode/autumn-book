import { fail, redirect } from '@sveltejs/kit';
import {
	resolveStay,
	listHouseGuidesFor,
	claimStayByCode,
	claimRateCheck,
	claimRecordFailure,
	claimRecordSuccess
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay, sbListHouseGuides, sbClaimStayByCode } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';

// 滞在セッション Cookie（claim 済みトークンを httpOnly で保持・チェックアウトまで≒3日）
const STAY_COOKIE = 'ab_stay';
const STAY_MAXAGE = 60 * 60 * 24 * 3;

export const load: PageServerLoad = async ({ cookies, url }) => {
	const locale = getLocale();
	const invalidQr = url.searchParams.get('e') === 'invalid';
	const token = cookies.get(STAY_COOKIE);

	if (!token) {
		// 未 claim: コード入力フォームを出す
		return { stay: null, guides: [], expired: false, invalidQr };
	}

	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, locale);
	if (!stay) {
		// Cookie はあるが無効（失効/期間外）＝ ご滞在終了。Cookie は消さず「終了」表示に使う
		return { stay: null, guides: [], expired: true, invalidQr };
	}

	const guides =
		DATA_SOURCE === 'supabase'
			? await sbListHouseGuides(stay.facility.id, locale)
			: listHouseGuidesFor(stay.facility.id, locale);

	return { stay, guides, expired: false, invalidQr };
};

export const actions: Actions = {
	// 手入力の8桁コード → トークン交換 → Cookie 発行。簡易レート制限（5回失敗で10分ロック）付き。
	claim: async (event) => {
		const key = event.getClientAddress();
		const rl = claimRateCheck(key);
		if (rl.locked) return fail(429, { claimError: 'locked' as const, retryInSec: rl.retryInSec });

		const form = await event.request.formData();
		const code = String(form.get('code') ?? '');

		const token = DATA_SOURCE === 'supabase' ? await sbClaimStayByCode(code) : claimStayByCode(code);
		if (!token) {
			claimRecordFailure(key);
			return fail(400, { claimError: 'fail' as const });
		}

		claimRecordSuccess(key);
		event.cookies.set(STAY_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: STAY_MAXAGE
		});
		redirect(303, '/r');
	}
};
