// 管理画面の会員特典: 比較表の確認・印刷と、説明文の編集（book.site_texts・2026-11-23）。
// 表の特典を押すと開く窓で、その場で日本語・英語・繁体字を編集する。空にする（または元の文言と同じにする）と元の文言に戻る。
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

// 表の外にある文言（会員特典のページの見出しなど）は、表の下のボタンから同じ窓で編集する
const PAGE_GROUP = MEMBER_BENEFIT_TEXT_GROUPS.find((g) => g.title === '会員特典のページ');

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
	const items = Object.fromEntries(
		MEMBER_BENEFIT_TEXT_GROUPS.flatMap((g) => g.items).map((i) => [
			i.key,
			{
				label: i.label,
				multiline: i.multiline,
				defaults: defaultsOf(i.key),
				values: { ja: overrides.ja[i.key] ?? '', en: overrides.en[i.key] ?? '', 'zh-TW': overrides['zh-TW'][i.key] ?? '' }
			}
		])
	);
	return {
		// 比較表のプレビュー（日本語）
		texts: overrides.ja,
		edit: editable
			? {
					items,
					canEdit: event.locals.user?.role === 'admin',
					extra: PAGE_GROUP ? [{ id: 'page', title: 'ページの見出し・導入文', keys: PAGE_GROUP.items.map((i) => i.key) }] : []
				}
			: null,
		editable,
		loadError
	};
};

export const actions: Actions = {
	saveTexts: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { textError: '本番データ環境でだけ編集できます。' });
		const user = event.locals.user;
		if (user?.role !== 'admin') return fail(403, { textError: '編集権限がありません。' });
		const form = await event.request.formData();
		const keys = [...new Set(form.getAll('keys').map(String))].filter((k) => MEMBER_BENEFIT_TEXT_KEYS.includes(k));
		if (keys.length === 0) return fail(400, { textError: '項目が正しくありません。' });
		const client = createSupabaseServerClient(event);
		try {
			for (const key of keys) {
				const values = Object.fromEntries(SITE_TEXT_LOCALES.map((l) => [l, String(form.get(`value_${key}_${l}`) ?? '')])) as Record<SiteTextLocale, string>;
				if (Object.values(values).some((v) => v.length > 4000)) return fail(400, { textError: '4,000字以内で入力してください。' });
				await saveMemberBenefitText(client, key, values, defaultsOf(key), user.id);
			}
		} catch {
			return fail(500, { textError: '保存できませんでした。時間をおいてもう一度お試しください。' });
		}
		return { savedKeys: keys };
	}
};
