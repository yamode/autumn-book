import { fail } from '@sveltejs/kit';
import { listNewsAdmin as listNewsAdminDemo, addNews, newsPosts } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { createSupabaseServerClient } from '$lib/server/auth';
import { listNewsAdmin, addNewsAdmin, updateNewsAdmin, FACILITY_UUID } from '$lib/server/supabase-data';
import type { Actions, PageServerLoad } from './$types';

// DATA_SOURCE=supabase では実データ（book.news_posts）を、それ以外はデモストアを使う。
// 実データ操作にはSupabase Authセッション（管理者ログイン）に紐づいたクライアントが必要
// （RLS: news_posts_staff_all は authenticated + has_facility_access 前提。詳細は supabase-data.ts）。
function realFacilityId(demoFacilityId: string): string {
	const id = FACILITY_UUID[demoFacilityId];
	if (!id) throw new Error(`FACILITY_UUID に対応がありません: ${demoFacilityId}`);
	return id;
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (DATA_SOURCE === 'supabase') {
		const client = createSupabaseServerClient(event);
		const posts = await listNewsAdmin(client, realFacilityId(currentFacility.id));
		return { posts };
	}
	return { posts: listNewsAdminDemo(currentFacility.id) };
};

export const actions: Actions = {
	add: async (event) => {
		const { request, locals } = event;
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'タイトルを入力してください' });
		const body = String(form.get('body') ?? '');
		const publishedAt = String(form.get('publishedAt')) || new Date().toISOString().slice(0, 10);

		if (DATA_SOURCE === 'supabase') {
			const client = createSupabaseServerClient(event);
			const facilityId = realFacilityId(String(form.get('facilityId')));
			try {
				await addNewsAdmin(client, facilityId, { title, body, publishedAt });
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '追加に失敗しました' });
			}
			return { added: true };
		}

		addNews({ facilityId: String(form.get('facilityId')), title, body, publishedAt, isPublished: false });
		return { added: true };
	},
	save: async (event) => {
		const { request, locals } = event;
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const postId = String(form.get('postId'));
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'タイトルを入力してください' });
		const body = String(form.get('body') ?? '');
		const publishedAt = String(form.get('publishedAt'));
		const isPublished = form.get('isPublished') === 'on';

		if (DATA_SOURCE === 'supabase') {
			const client = createSupabaseServerClient(event);
			try {
				const saved = await updateNewsAdmin(client, postId, { title, body, publishedAt, isPublished });
				return { saved: saved.id };
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		}

		const post = newsPosts.find((n) => n.id === postId);
		if (!post) return fail(404, {});
		post.title = title;
		post.body = body;
		post.publishedAt = publishedAt || post.publishedAt;
		post.isPublished = isPublished;
		return { saved: post.id };
	}
};
