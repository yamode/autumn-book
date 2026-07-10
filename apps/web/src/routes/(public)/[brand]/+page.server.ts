import { error, redirect } from '@sveltejs/kit';
import { brands } from '$lib/server/store';
import { localizeHref } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

// ブランドトップページは持たない（portal_sitemap §6-1・2026-06-21 決定）。
// `/`（ブランド一覧＋地図空室検索）が実質ブランドトップを兼ねるため / へ 301。
// URL の [brand] セグメントは将来の多ブランドのネームスペースとして維持する。
export const load: PageServerLoad = async ({ params }) => {
	const brand = brands.find((b) => b.slug === params.brand);
	if (!brand) error(404, 'ブランドが見つかりません');
	redirect(301, localizeHref('/'));
};
