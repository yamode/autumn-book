// 写真の権利・原本の場所（docs/facility-knowledge.md 段階6）。プラン・部屋タイプ・お知らせで使っている写真ごとに、
// 撮影者・権利・使える範囲・人の写り込み・Dropbox の原本の場所を入れる。取材の回答に出す写真はここで「取材に出せる」になったものだけ。
// 権限は DB が決める（施設権限のあるスタッフ）。本番データ（Supabase）でだけ動く。
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { KnowledgeError } from '$lib/server/facility-knowledge';
import { listPhotos, parseRightsForm, saveRights, type PhotoItem } from '$lib/server/facility-knowledge/photos';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { currentFacility } = await event.parent();
	const empty = { photos: [] as PhotoItem[], unavailable: null as string | null, loadError: null as string | null };
	if (!ADMIN_SUPABASE) return { ...empty, unavailable: '写真の権利は本番データ環境で利用できます。' };
	const facilityId = FACILITY_UUID[currentFacility.id];
	if (!facilityId || !event.locals.user) return { ...empty, unavailable: 'この施設では利用できません。' };
	try {
		return { ...empty, photos: await listPhotos(createSupabaseServerClient(event), facilityId) };
	} catch (e) {
		return { ...empty, loadError: e instanceof KnowledgeError ? e.message : '写真を読み込めませんでした。時間をおいて再読み込みしてください。' };
	}
};

export const actions: Actions = {
	save: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: '本番データ環境でだけ使えます。' });
		const user = event.locals.user;
		if (user?.role !== 'admin' && user?.role !== 'staff') return fail(403, { message: '編集権限がありません。' });
		const form = await event.request.formData();
		const facilityId = FACILITY_UUID[String(form.get('facilityId') ?? '')];
		if (!facilityId) return fail(400, { message: '施設が正しくありません。' });
		try {
			const urls = form.getAll('url').map(String);
			const n = await saveRights(createSupabaseServerClient(event), facilityId, urls, parseRightsForm(form));
			return { done: n === 1 ? '保存しました。' : `${n}枚に保存しました。` };
		} catch (e) {
			if (e instanceof KnowledgeError) return fail(e.status, { message: e.message });
			return fail(500, { message: '保存できませんでした。時間をおいてもう一度お試しください。' });
		}
	}
};
