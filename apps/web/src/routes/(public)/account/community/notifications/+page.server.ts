import { redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(308, localizeHref('/account/community#reply-notifications'));
};
