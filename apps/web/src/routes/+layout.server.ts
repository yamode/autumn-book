import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url }) => {
	// Re-run this layout load when a client-side navigation changes page or preview variant.
	void url.pathname;
	void url.searchParams.get('ab_preview');
	return { abExperiments: locals.abExperiments };
};
