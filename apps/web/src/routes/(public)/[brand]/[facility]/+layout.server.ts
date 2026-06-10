import { error } from '@sveltejs/kit';
import { getFacilityBySlug } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const facility = getFacilityBySlug(params.brand, params.facility, getLocale());
	if (!facility) error(404, '施設が見つかりません');
	return {
		shellFacility: {
			template: facility.template,
			name: facility.name,
			slug: facility.slug,
			brandSlug: facility.brandSlug,
			phone: facility.phone,
			addressPublic: facility.addressPublic
		},
		user: locals.user
	};
};
