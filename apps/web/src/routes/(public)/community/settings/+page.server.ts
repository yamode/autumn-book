import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// 旧URL。ニックネーム設定は /account/community（マイページのタブ配下）へ移設した。
// 既存の深リンク・ブックマーク救済のため next を保持して恒久リダイレクトする。
export const load: PageServerLoad = async ({ url }) => {
	const next = url.searchParams.get('next');
	redirect(308, '/account/community' + (next ? `?next=${encodeURIComponent(next)}` : ''));
};
