// Autumn Live: 背景（シーン）の一覧（docs/autumn-live.md §10）。入場券は hooks.server.ts（handleLive）で確かめ済み。
// 画面が 1 分ごとに読み直し、変わっていたらその場で差し替える（版の更新なしで背景を変えられる）。30 秒覚える。
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { TtlCache } from '$lib/server/ttl-cache';

const cache = new TtlCache<unknown>(30_000, 1);

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.live) return json({ error: 'forbidden' }, { status: 403 });
	let scenes = cache.get('scenes');
	if (scenes === undefined) {
		const svc = partnerServiceClient();
		const r = svc ? await svc.schema('book').rpc('live_scenes_enabled') : null;
		if (!r || r.error) return json({ scenes: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
		scenes = r.data ?? [];
		cache.set('scenes', scenes);
	}
	return json({ scenes }, { headers: { 'cache-control': 'no-store' } });
};
