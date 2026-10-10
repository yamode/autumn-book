import { redirect } from '@sveltejs/kit';
import { resolveStay, listHouseGuidesFor, getFacilityById } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay, sbListHouseGuides } from '$lib/server/supabase-data';
import { sbBathContext } from '$lib/server/private-bath';
import { sbStayMealTimes, type StayMeal } from '$lib/server/stay-meals';
import { intercomStatusFor } from '$lib/server/intercom';
import { getLocale } from '$lib/paraglide/runtime';
import {
	endedFacilityBySlug,
	loadThanksBanners,
	stayEndedFacility,
	type EndedFacility
} from '$lib/server/inroom-banners';
import { upcomingItems } from '$lib/inroom-day';
import { browseFacility, browseVisibleGuide } from '$lib/server/inroom-browse';
import { claimStayFromForm } from '$lib/server/stay-claim';
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
	const noStay = {
		stay: null,
		guides: [] as Awaited<ReturnType<typeof sbListHouseGuides>>,
		bathReservations: [],
		meals: [] as StayMeal[],
		expired: false,
		invalidQr,
		endedFacility: null,
		banners: [],
		// コードなしで見る館内案内（入口QRから・2026-10-10）。施設が分からなければ null（コード入力だけ出す）
		browse: null as { name: string; slug: string; phone: string } | null
	};

	if (!token) {
		// 未 claim: コード入力フォームを出す（チェックアウト後の QR ならサンクス表示）。
		// 客室の入口QR（/r/start?f=<slug>）から来たときは、黒ヘッダーに施設名を出す
		if (endedQr) return thanks(endedFacilityBySlug(url.searchParams.get('f'), locale));
		// 入口QRから来た（URL の f か、入口QRで覚えた Cookie）ときは、館内案内を先に見せ、トップでコードを入れてもらう
		const entryFacility = browseFacility(cookies, url.searchParams.get('f'), locale);
		if (!entryFacility) return noStay;
		const guides = await (DATA_SOURCE === 'supabase'
			? sbListHouseGuides(entryFacility.id, locale)
			: Promise.resolve(listHouseGuidesFor(entryFacility.id, locale))
		).catch(() => []);
		return {
			...noStay,
			// Wi-Fi はコードを入れてから（browseVisibleGuide）
			guides: guides.filter(browseVisibleGuide),
			browse: { name: entryFacility.name, slug: entryFacility.slug, phone: getFacilityById(entryFacility.id, locale)?.phone ?? '' },
			...(entryFacility.name ? { headerTitle: entryFacility.name } : {})
		};
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
		banners: [],
		browse: null
	};
};

export const actions: Actions = {
	// 手入力の6桁コード（2026-10-09 以前の発行分は8桁）→ トークン交換 → Cookie 発行（stay-claim.ts・貸切風呂のコード入力と共通）
	claim: async (event) => {
		const failed = await claimStayFromForm(event);
		if (failed) return failed;
		redirect(303, '/r');
	}
};
