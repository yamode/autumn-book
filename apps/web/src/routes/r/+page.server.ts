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
import { sbStayMealTimes, type StayMeal } from '$lib/server/stay-meals';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { intercomStatusFor } from '$lib/server/intercom';
import { getLocale } from '$lib/paraglide/runtime';
import {
	endedFacilityBySlug,
	loadThanksBanners,
	stayEndedFacility,
	type EndedFacility
} from '$lib/server/inroom-banners';
import { upcomingItems } from '$lib/inroom-day';
import type { Actions, PageServerLoad } from './$types';

// 滞在セッション Cookie（claim 済みトークンを httpOnly で保持）
const STAY_COOKIE = 'ab_stay';

export const load: PageServerLoad = async ({ cookies, url }) => {
	const locale = getLocale();
	const invalidQr = url.searchParams.get('e') === 'invalid';
	// チェックアウト後に QR を読んだ（/r/c/<token> が e=ended で戻す）
	const endedQr = url.searchParams.get('e') === 'ended';
	const token = cookies.get(STAY_COOKIE);

	// サンクス表示（ご滞在終了）。施設が分かれば、その施設の販促バナーを添える
	const thanks = async (facility: EndedFacility | null) => ({
		stay: null,
		guides: [],
		bathReservations: [],
		meals: [] as StayMeal[],
		expired: true,
		invalidQr: false,
		endedFacility: facility,
		banners: facility ? await loadThanksBanners(facility.id, locale) : [],
		// 黒ヘッダーの中央タイトル（layout が拾う）。施設が分かれば施設名
		...(facility?.name ? { headerTitle: facility.name } : {})
	});
	const noStay = { stay: null, guides: [], bathReservations: [], meals: [] as StayMeal[], expired: false, invalidQr, endedFacility: null, banners: [] };

	if (!token) {
		// 未 claim: コード入力フォームを出す（チェックアウト後の QR ならサンクス表示）。
		// 客室の入口QR（/r/start?f=<slug>）から来たときは、黒ヘッダーに施設名を出す
		if (endedQr) return thanks(endedFacilityBySlug(url.searchParams.get('f'), locale));
		const entryFacility = endedFacilityBySlug(url.searchParams.get('f'), locale);
		return entryFacility?.name ? { ...noStay, headerTitle: entryFacility.name } : noStay;
	}

	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, locale);
	if (!stay) {
		// Cookie はあるが無効（失効/期間外）＝ ご滞在終了。Cookie は消さず「終了」表示に使う
		if (invalidQr) return noStay;
		return thanks(
			(await stayEndedFacility(token, locale)) ?? endedFacilityBySlug(url.searchParams.get('f'), locale)
		);
	}

	const [guides, bathContext, intercom, meals] = await Promise.all([
		DATA_SOURCE === 'supabase'
			? sbListHouseGuides(stay.facility.id, locale)
			: Promise.resolve(listHouseGuidesFor(stay.facility.id, locale)),
		DATA_SOURCE === 'supabase' ? sbBathContext(token).catch(() => null) : Promise.resolve(null),
		intercomStatusFor(token),
		// PMS で決まった食事時間（夕食・朝食）。読めなければ出さない
		DATA_SOURCE === 'supabase' ? sbStayMealTimes(token) : Promise.resolve([] as StayMeal[])
	]);

	// 過ぎた予定だけ隠す（食事は始まりから60分・貸切風呂は枠の終わりまで出す。2026-10-09）。
	// 画面を開いたままでも時間が過ぎた分は消える（+page.svelte が1分ごとに同じ判定をし直す）
	const now = new Date();
	return {
		stay,
		guides,
		bathReservations: bathContext?.ok
			? upcomingItems(
					(bathContext.mine ?? []).map(({ id, date, from, to }) => ({ id, date, from, to })),
					(r) => ({ date: r.date, start: r.from, end: r.to }),
					now
				)
			: [],
		meals: upcomingItems(meals, (meal) => ({ date: meal.date, start: meal.time }), now),
		intercom,
		expired: false,
		invalidQr,
		endedFacility: null,
		banners: []
	};
};

export const actions: Actions = {
	// 手入力の6桁コード（2026-10-09 以前の発行分は8桁）→ トークン交換 → Cookie 発行。簡易レート制限（5回失敗で10分ロック）付き。
	claim: async (event) => {
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
		redirect(303, '/r');
	}
};
