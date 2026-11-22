import { error } from '@sveltejs/kit';
import { getLegalPage } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const page = getLegalPage(params.page, locale);
	if (!page) error(404, m.error_page_not_found());
	return { page };
};
