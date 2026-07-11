import { error } from '@sveltejs/kit';
import { getFacilityBySlug, facilities, brands } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbListFacilities } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');

		const all = await sbListFacilities();
		const siblings = all
			.filter((x) => x.brandSlug === facility.brandSlug && x.slug !== facility.slug)
			.map((x) => ({ slug: x.slug, name: x.name, brandSlug: x.brandSlug }));

		return {
			shellFacility: {
				template: facility.template,
				name: facility.name,
				slug: facility.slug,
				brandSlug: facility.brandSlug,
				phone: facility.phone,
				addressPublic: facility.addressPublic,
				brandName: '山人',
				siblings
			},
			// 外部施設HP（WP等）からの深い誘導で来た予約セクション。グローバルヘッダーに「HPへ戻る」動線を出す（ADR-0001）
			facilityBackLink: facility.websiteUrl ? { name: facility.name, href: facility.websiteUrl } : null,
			user: locals.user
		};
	}

	const facility = getFacilityBySlug(params.brand, params.facility, getLocale());
	if (!facility) error(404, '施設が見つかりません');

	// 同一ブランドの他施設（公開のみ・自施設を除く）＝施設間移動リンク用
	const siblings = facilities
		.filter((x) => x.brandSlug === facility.brandSlug && x.slug !== facility.slug && x.isPublished)
		.map((x) => ({ slug: x.slug, name: x.name, brandSlug: x.brandSlug }));
	const brandName = brands.find((b) => b.slug === facility.brandSlug)?.name ?? '山人';

	return {
		shellFacility: {
			template: facility.template,
			name: facility.name,
			slug: facility.slug,
			brandSlug: facility.brandSlug,
			phone: facility.phone,
			addressPublic: facility.addressPublic,
			brandName,
			siblings
		},
		facilityBackLink: facility.websiteUrl ? { name: facility.name, href: facility.websiteUrl } : null,
		user: locals.user
	};
};
