import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { guideIdParam, rememberBrowseFacility } from '$lib/server/inroom-browse';
import { resolveRoomEntry, ROOM_COOKIE, ROOM_COOKIE_MAX_AGE_SEC, roomKeyParam } from '$lib/server/intercom';
import type { RequestHandler } from './$types';

// 客室に常設する「客室案内の入口QR」（/r/start?f=<slug>）の着地点（2026-10-09）。
// QR はお客様ごとに変わらない（いつ読んでも同じ URL）。
//   ・この端末に有効な滞在（Cookie の ab_stay）があれば、そのまま客室案内（/r）へ。一度コードを入れた端末は次から入力不要
//   ・無い／前のご滞在で期限切れなら、Cookie を消して館内案内（/r）へ。2026-10-10 からは最初にコード入力画面ではなく
//     館内案内（Wi-Fi・館内のご案内）を出し、そのトップで6桁コードを入れると滞在に紐づく（inroom-browse.ts）。前のご滞在の「終了」表示は出さない
// コードはチェックイン日の 9:00 〜 チェックアウト日の 11:00 だけ通る（book.claim_stay_by_code）。
// 案内ページ1件だけの QR（?g=<案内のid>・2026-10-15）は、トップではなくそのページ（/r/g/<id>）へ着地させる。
// Wi-Fi などコードが要るページは、/r/g 側がコード入力へ回し、入れたあとでそのページへ戻す。
const STAY_COOKIE = 'ab_stay';

// 客室ごとの入口QR（?k=<部屋の鍵>・2026-11-20）: 鍵を ab_room Cookie に覚える。滞在コードなしでも「フロントを呼ぶ」が使える
// （部屋番号だけが分かる）。予約情報・貸切風呂・Wi-Fi は従来どおり滞在コードが要る。使えない鍵なら Cookie を消して通常の入口QRと同じ動き。
export const GET: RequestHandler = async ({ cookies, url }) => {
	let slug = url.searchParams.get('f');
	const roomKey = roomKeyParam(url.searchParams.get('k'));
	if (roomKey) {
		const room = await resolveRoomEntry(roomKey);
		if (room) {
			cookies.set(ROOM_COOKIE, roomKey, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: ROOM_COOKIE_MAX_AGE_SEC });
			slug = room.facilitySlug;
		} else {
			cookies.delete(ROOM_COOKIE, { path: '/' });
		}
	}
	const guideId = guideIdParam(url.searchParams.get('g'));
	const guidePath = guideId ? `/r/g/${encodeURIComponent(guideId)}` : null;
	const token = cookies.get(STAY_COOKIE);
	if (token) {
		const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
		if (stay) redirect(302, localizeHref(guidePath ?? '/r'));
		cookies.delete(STAY_COOKIE, { path: '/' });
	}
	const known = slug && /^[a-z0-9-]+$/.test(slug) ? rememberBrowseFacility(cookies, slug, getLocale()) : false;
	if (known && guidePath) redirect(302, localizeHref(guidePath));
	redirect(302, localizeHref(known && slug ? `/r?f=${encodeURIComponent(slug)}` : '/r'));
};
