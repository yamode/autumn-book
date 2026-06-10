import { fail } from '@sveltejs/kit';
import { listNewsAdmin, addNews, newsPosts } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	return { posts: listNewsAdmin(currentFacility.id) };
};

export const actions: Actions = {
	add: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'タイトルを入力してください' });
		addNews({
			facilityId: String(form.get('facilityId')),
			title,
			body: String(form.get('body') ?? ''),
			publishedAt: String(form.get('publishedAt')) || new Date().toISOString().slice(0, 10),
			isPublished: false
		});
		return { added: true };
	},
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const post = newsPosts.find((n) => n.id === String(form.get('postId')));
		if (!post) return fail(404, {});
		const title = String(form.get('title') ?? '').trim();
		if (!title) return fail(400, { message: 'タイトルを入力してください' });
		post.title = title;
		post.body = String(form.get('body') ?? '');
		post.publishedAt = String(form.get('publishedAt')) || post.publishedAt;
		post.isPublished = form.get('isPublished') === 'on';
		return { saved: post.id };
	}
};
