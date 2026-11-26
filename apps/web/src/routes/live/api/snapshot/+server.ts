// Autumn Live: いまの状態（docs/autumn-live.md §4.5）。入場券は hooks.server.ts（handleLive）で確かめ済み。
// データの取り方（§7）が決まるまでは、準備中であることだけを返す。
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.live) return json({ error: 'forbidden' }, { status: 403 });
	return json({ status: 'not_ready', generatedAt: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
};
