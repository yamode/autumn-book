// GET /private-book[?page=<専用ページの partnerId>][&back=<戻る画面>] — プライベートブックの入口（docs/private-book.md）。
// メインメニューの「PRIVATE BOOK」と帯のページの切り替えから来る。
//   - 会員でログインしていなければログイン画面へ（戻ったらここへ）
//   - ?page= が無ければ、使えるページから本人 → ご家族の順で選ぶ。?page= は使えるページの中にあるときだけ
//   - そのページを今使えるか（rms_member_page_access・kind=member・公開期間）を確かめてからクッキーを書き、元の画面（無ければ /search）へ
// クッキーには partnerId しか書かない。料金を出す・束を作るたびに確かめ直す（hooks の resolvePrivateBook・hold の privateBookHold）。
import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { memberPagesFor } from '$lib/server/partners/store';
import { clearPrivateBookCookie, setPrivateBookCookie, verifyPrivateBook } from '$lib/server/private-book';
import { choosePrivateBookPage, pbSafeBack } from '$lib/private-book';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store' });
	const back = pbSafeBack(url.searchParams.get('back'));
	const user = locals.user;
	if (user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const sb = DATA_SOURCE === 'supabase' ? partnerServiceClient() : null;
	if (!sb) redirect(303, back);
	let partnerId: string | null = null;
	try {
		const page = choosePrivateBookPage(await memberPagesFor(sb, user.id), url.searchParams.get('page'));
		const state = page ? await verifyPrivateBook(user.id, page.partnerId) : null;
		partnerId = state?.partnerId ?? null;
	} catch (e) {
		console.error('[private-book] 入口でページを確かめられませんでした', e instanceof Error ? e.message : e);
	}
	if (partnerId) setPrivateBookCookie(cookies, partnerId);
	else clearPrivateBookCookie(cookies);
	redirect(303, back);
};
