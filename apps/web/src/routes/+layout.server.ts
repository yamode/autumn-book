import { consentRequiredFor } from '$lib/consent-region';
import { requestCountry } from '$lib/server/geo';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	const { locals, url } = event;
	// Re-run this layout load when a client-side navigation changes page or preview variant.
	void url.pathname;
	void url.searchParams.get('ab_preview');
	// アクセス解析の同意を先に聞く地域か（EEA・英国・スイス・不明）。それ以外は確認を出さずに計測する（2026-10-21）
	return { abExperiments: locals.abExperiments, consentRequired: consentRequiredFor(requestCountry(event)) };
};
