// Autumn Live: いまの状態（docs/autumn-live.md §4.5・§7）。入場券は hooks.server.ts（handleLive）で確かめ済み。
// 今日の流れ（book.live_snapshot_fast・3 秒覚える）と、オンハンド・会員・いつもの幅（book.live_snapshot_slow・5 分覚える）を合わせて返す。
// 返すのは集計と匿名の値だけ（名前・メール・電話・会員番号・予約番号は DB の関数の時点で入っていない）。
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { TtlCache } from '$lib/server/ttl-cache';

const fast = new TtlCache<unknown>(3_000, 2);
const slow = new TtlCache<unknown>(5 * 60_000, 2);

async function read(name: 'live_snapshot_fast' | 'live_snapshot_slow', cache: TtlCache<unknown>): Promise<unknown> {
	const hit = cache.get(name);
	if (hit !== undefined) return hit;
	const svc = partnerServiceClient();
	if (!svc) return null;
	const { data, error } = await svc.schema('book').rpc(name);
	if (error) {
		console.error(`[live] ${name} を読めませんでした:`, error.message);
		return null;
	}
	cache.set(name, data);
	return data;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.live) return json({ error: 'forbidden' }, { status: 403 });
	const [today, totals] = await Promise.all([read('live_snapshot_fast', fast), read('live_snapshot_slow', slow)]);
	if (!today) return json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
	return json({ status: 'ok', today, totals }, { headers: { 'cache-control': 'no-store' } });
};
