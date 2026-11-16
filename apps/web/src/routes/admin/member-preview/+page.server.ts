import { error } from '@sveltejs/kit';
import { launchPreviewToken, previewConfigured, previewOrigin, previewRanks } from '$lib/server/member-preview';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, setHeaders, parent }) => {
	await parent();
	if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') error(403);
	setHeaders({ 'cache-control': 'private, no-store' });
	return {
		destination: `${previewOrigin()}/member-preview/start`,
		options: previewConfigured()
			? await Promise.all(previewRanks.map(async (rank) => ({ rank, token: await launchPreviewToken(rank) })))
			: []
	};
};
