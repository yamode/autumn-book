import { fail } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { sbUploadContentPhoto } from '$lib/server/content-admin';
import { photoFileProblem } from '$lib/content-blocks';
import {
	deleteBannerDemo,
	listBannersDemo,
	saveBannerDemo,
	sbDeleteBanner,
	sbListBanners,
	sbSaveBanner,
	type BannerInput,
	type BannerLang,
	type InroomBanner
} from '$lib/server/inroom-banners';
import type { Actions, PageServerLoad } from './$types';

// 客室案内のサンクスページ（チェックアウト後に QR を読んだときの表示）に出す販促バナー。admin のみ編集。
// 実データ（DATA_SOURCE と AUTH_MODE がともに supabase）のときだけ RPC。それ以外はプロセス内で完結（/admin/inroom と同じ）。
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

const LANGS = ['ja', 'en', 'zh-TW'] as const;

// action には parent() が無いので、admin layout と同じく ab_fac Cookie から今の施設を決める
function currentFacilityId(cookies: { get(name: string): string | undefined }): string {
	const facId = cookies.get('ab_fac') ?? facilities[0].id;
	return (facilities.find((f) => f.id === facId) ?? facilities[0]).id;
}
const ymd = (v: FormDataEntryValue | null) => {
	const s = String(v ?? '').trim();
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	let banners: InroomBanner[] = [];
	let loadError: string | null = null;
	if (useSupabaseAdmin) {
		try {
			banners = await sbListBanners(createSupabaseServerClient(event), currentFacility.id);
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	} else {
		banners = listBannersDemo(currentFacility.id);
	}
	return { banners, loadError, live: useSupabaseAdmin };
};

export const actions: Actions = {
	save: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const facilityId = currentFacilityId(event.cookies);
		const form = await event.request.formData();
		const id = String(form.get('bannerId') ?? '') || undefined;

		// 画像: ファイルを選んだらアップロード（実データのときだけ）。選ばなければ URL 欄の値（既存の画像を含む）
		let imageUrl = String(form.get('imageUrl') ?? '').trim();
		const file = form.get('photo');
		if (file instanceof File && file.size > 0) {
			if (!useSupabaseAdmin) {
				return fail(400, { message: 'この環境では画像をアップロードできません。画像のURLを入れてください。', bannerId: id ?? 'new' });
			}
			const problem = photoFileProblem(file);
			if (problem) return fail(400, { message: problem, bannerId: id ?? 'new' });
			try {
				imageUrl = await sbUploadContentPhoto(
					createSupabaseServerClient(event),
					'banners',
					FACILITY_UUID[facilityId] ?? facilityId,
					file
				);
			} catch (e) {
				return fail(500, { message: '画像をアップロードできませんでした（' + (e instanceof Error ? e.message : String(e)) + '）', bannerId: id ?? 'new' });
			}
		}

		const langRaw = String(form.get('lang') ?? '');
		const input: BannerInput = {
			id,
			facilityId,
			title: String(form.get('title') ?? '').trim(),
			imageUrl,
			linkUrl: String(form.get('linkUrl') ?? '').trim() || null,
			body: String(form.get('body') ?? '').trim() || null,
			lang: ((LANGS as readonly string[]).includes(langRaw) ? langRaw : null) as BannerLang,
			sortOrder: Number(form.get('sortOrder') ?? 0) || 0,
			isPublished: form.get('isPublished') === 'on',
			startDate: ymd(form.get('startDate')),
			endDate: ymd(form.get('endDate'))
		};

		// RPC と同じ確認をここでも行い、demo でも同じ文言で止める
		const fail400 = (message: string) => fail(400, { message, bannerId: id ?? 'new' });
		if (!input.title || input.title.length > 80) return fail400('名前を入れてください（80文字まで）');
		if (!/^https:\/\/[^\s<>"']+$/i.test(input.imageUrl)) return fail400('画像を選ぶか、https:// で始まる画像のURLを入れてください');
		if (input.linkUrl && !/^https:\/\/[^\s<>"']+$/i.test(input.linkUrl)) return fail400('リンク先は https:// で始まる形式で入力してください');
		if (input.body && input.body.length > 200) return fail400('一言は200文字までです');
		if (input.startDate && input.endDate && input.startDate > input.endDate) return fail400('掲載期間の開始日が終了日より後になっています');

		try {
			if (useSupabaseAdmin) await sbSaveBanner(createSupabaseServerClient(event), input);
			else saveBannerDemo(input);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました', bannerId: id ?? 'new' });
		}
		return { saved: true, bannerId: id ?? 'new' };
	},

	delete: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const id = String(form.get('bannerId') ?? '');
		try {
			if (useSupabaseAdmin) await sbDeleteBanner(createSupabaseServerClient(event), id);
			else deleteBannerDemo(id);
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '削除に失敗しました' });
		}
		return { deleted: true };
	}
};
