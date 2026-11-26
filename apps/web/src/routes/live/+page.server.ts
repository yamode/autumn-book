// Autumn Live の画面（docs/autumn-live.md）。入場券は hooks.server.ts（handleLive）で確かめ済み。
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.live) error(403, 'Autumn Live は Autumn デスクトップアプリから開いてください。');
	return { kind: locals.live.kind, expiresAt: locals.live.exp };
};
