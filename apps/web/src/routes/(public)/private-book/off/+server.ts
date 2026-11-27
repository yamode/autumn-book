// POST /private-book/off — プライベートブックの出口（帯の「ふつうのご予約に戻る」・docs/private-book.md）。
// クッキーを消して同じ画面（back）へ戻る。予約入力（/booking/hold）の中からなら holdId の仮押さえを解放してから戻る
// （ただのリンクだと期限まで在庫が減ったまま）。解放は本人のセッション（ab_book_sid）の束だけ（DB が確かめる）。
import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { bookingSessionId, releaseHoldGroup } from '$lib/server/supabase-data';
import { clearPrivateBookCookie } from '$lib/server/private-book';
import { pbSafeBack } from '$lib/private-book';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, setHeaders }) => {
	const form = await request.formData().catch(() => null);
	const back = pbSafeBack(String(form?.get('back') ?? ''), '/');
	const holdId = String(form?.get('holdId') ?? '');
	clearPrivateBookCookie(cookies);
	if (holdId && DATA_SOURCE === 'supabase') {
		try {
			await releaseHoldGroup(holdId, bookingSessionId(cookies));
		} catch (e) {
			// 解放に失敗しても戻る（期限で自動解放される）
			console.error('[private-book/off] release', e);
		}
	}
	setHeaders({ 'cache-control': 'private, no-store' });
	if (request.headers.get('accept') === 'application/json') return new Response(null, { status: 204 });
	redirect(303, back);
};
