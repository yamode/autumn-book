// 管理画面の会員特典: 比較表の確認・印刷と、説明文の編集（book.site_texts・2026-11-23）。
// 文言ごとに日本語・英語・繁体字を編集する。空にする（または元の文言と同じにする）と元の文言に戻る。
import { fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { listMemberBenefitTextsAdmin, saveMemberBenefitText, SITE_TEXT_LOCALES, type SiteTextLocale } from '$lib/server/site-texts';
import { MEMBER_BENEFIT_TEXT_GROUPS, MEMBER_BENEFIT_TEXT_KEYS } from '$lib/member-benefit-texts';
import type { Actions, PageServerLoad } from './$types';

type MessageFn = (params?: Record<string, never>, options?: { locale?: SiteTextLocale }) => string;
const messages = m as unknown as Record<string, MessageFn>;

/** アプリに書いてある元の文言（3言語） */
function defaultsOf(key: string): Record<SiteTextLocale, string> {
	const fn = messages[key];
	const out = { ja: '', en: '', 'zh-TW': '' } as Record<SiteTextLocale, string>;
	for (const locale of SITE_TEXT_LOCALES) out[locale] = fn ? fn({}, { locale }) : '';
	return out;
}

export const load: PageServerLoad = async (event) => {
	const editable = ADMIN_SUPABASE;
	let overrides: Record<SiteTextLocale, Record<string, string>> = { ja: {}, en: {}, 'zh-TW': {} };
	let loadError: string | null = null;
	if (editable) {
		try {
			overrides = await listMemberBenefitTextsAdmin(createSupabaseServerClient(event));
		} catch {
			loadError = '上書きした文言を読み込めませんでした。表は元の文言で表示しています。';
		}
	}
	const groups = MEMBER_BENEFIT_TEXT_GROUPS.map((g) => ({
		title: g.title,
		items: g.items.map((i) => ({
			...i,
			defaults: defaultsOf(i.key),
			values: { ja: overrides.ja[i.key] ?? '', en: overrides.en[i.key] ?? '', 'zh-TW': overrides['zh-TW'][i.key] ?? '' }
		}))
	}));
	return {
		// 比較表のプレビュー（日本語）
		texts: overrides.ja,
		groups,
		editable,
		canEdit: event.locals.user?.role === 'admin',
		loadError
	};
};

export const actions: Actions = {
	saveText: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: '本番データ環境でだけ編集できます。' });
		const user = event.locals.user;
		if (user?.role !== 'admin') return fail(403, { message: '編集権限がありません。' });
		const form = await event.request.formData();
		const key = String(form.get('key') ?? '');
		if (!MEMBER_BENEFIT_TEXT_KEYS.includes(key)) return fail(400, { message: '項目が正しくありません。' });
		const values = Object.fromEntries(SITE_TEXT_LOCALES.map((l) => [l, String(form.get(`value_${l}`) ?? '')])) as Record<SiteTextLocale, string>;
		if (Object.values(values).some((v) => v.length > 4000)) return fail(400, { message: '4,000字以内で入力してください。', key });
		try {
			await saveMemberBenefitText(createSupabaseServerClient(event), key, values, defaultsOf(key), user.id);
		} catch {
			return fail(500, { message: '保存できませんでした。時間をおいてもう一度お試しください。', key });
		}
		return { savedKey: key };
	}
};
