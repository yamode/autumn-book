// 管理画面「Autumn Live の背景」（docs/autumn-live.md §10）。管理者だけ。中身は lib/server/live-scenes-admin.ts
// 保存した内容は、Live の画面が 1 分以内に読み直して差し替える（版の更新は要らない）。
import { error, fail } from '@sveltejs/kit';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import {
	LiveSceneError,
	checkSceneInput,
	deleteLiveScene,
	listLiveScenes,
	saveLiveScene,
	sceneImageProblem,
	uploadSceneImage,
	type LiveSceneRow
} from '$lib/server/live-scenes-admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	if (event.locals.user?.role !== 'admin') error(403, 'この画面は管理者だけが開けます。');
	if (AUTH_MODE !== 'supabase') return { available: false as const, scenes: [] as LiveSceneRow[], loadError: null as string | null };
	try {
		return { available: true as const, scenes: await listLiveScenes(), loadError: null as string | null };
	} catch (e) {
		return { available: true as const, scenes: [] as LiveSceneRow[], loadError: e instanceof LiveSceneError ? e.message : '背景の一覧を読めませんでした。' };
	}
};

const guard = (locals: App.Locals) => {
	if (AUTH_MODE !== 'supabase') return fail(400, { message: 'この環境（AUTH_MODE=demo）では使えません。' });
	if (locals.user?.role !== 'admin') return fail(403, { message: '背景を変えるのは管理者だけができます。' });
	return null;
};
const failOf = (e: unknown, fallback: string) => fail(e instanceof LiveSceneError ? e.status : 500, { message: e instanceof LiveSceneError ? e.message : fallback });

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const g = guard(locals);
		if (g) return g;
		const f = await request.formData();
		const r = checkSceneInput(f);
		if (!r.ok) return fail(400, { message: r.message, editing: String(f.get('id') ?? '') || 'new', draft: Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])) });
		try {
			const id = await saveLiveScene(locals.user!.id, r.input, r.config);
			return { done: `「${r.input.name}」を保存しました。Live の画面には 1 分以内に出ます。`, editing: id };
		} catch (e) {
			return failOf(e, '保存できませんでした。');
		}
	},
	remove: async ({ request, locals }) => {
		const g = guard(locals);
		if (g) return g;
		const f = await request.formData();
		try {
			await deleteLiveScene(locals.user!.id, String(f.get('id') ?? ''));
			return { done: 'シーンを削除しました。' };
		} catch (e) {
			return failOf(e, '削除できませんでした。');
		}
	},
	upload: async (event) => {
		const g = guard(event.locals);
		if (g) return g;
		const f = await event.request.formData();
		const file = f.get('image');
		const problem = sceneImageProblem(file instanceof File ? file : null);
		if (problem) return fail(400, { message: problem });
		try {
			const url = await uploadSceneImage(createSupabaseServerClient(event), event.locals.user!.id, file as File);
			return { uploaded: url };
		} catch (e) {
			return failOf(e, '画像を上げられませんでした。');
		}
	}
};
