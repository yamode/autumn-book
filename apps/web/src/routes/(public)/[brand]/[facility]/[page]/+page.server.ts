import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getSitePage, getFaqs } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

// 下層コンテンツページ（cuisine / facility / option / shiki / nature / onsen / restaurant / guide …）
// 特殊スラッグ: faq（FAQ一覧ページ）・access（アクセスページ）
export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	if (params.page === 'faq') {
		return { kind: 'faq' as const, facility, faqs: getFaqs(facility.id, locale), page: null };
	}
	if (params.page === 'access') {
		return { kind: 'access' as const, facility, faqs: [], page: null };
	}

	const page = getSitePage(facility.id, params.page, locale);
	if (!page) error(404, 'ページが見つかりません');
	return { kind: 'page' as const, facility, page, faqs: [] };
};
