import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay, sbStaySharedRooms } from '$lib/server/supabase-data';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { guideIdParam, rememberBrowseFacility } from '$lib/server/inroom-browse';
import { resolveRoomEntry, ROOM_COOKIE, ROOM_COOKIE_MAX_AGE_SEC, roomKeyParam } from '$lib/server/intercom';
import { stayUpcoming } from '$lib/server/inroom-banners';
import { decideStayForScannedRoom, type StayRoomDecision } from '$lib/inroom-room-match';
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
	const room = roomKey ? await resolveRoomEntry(roomKey) : null;
	if (roomKey) {
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
		// お部屋のポップの QR（部屋番号だけ・トークンなし）を読んだとき、端末が持っている滞在と食事時間・
		// 貸切風呂を共有していない部屋なら、滞在を外して読んだ部屋のトークンなし表示にする（2026-11-24 指示）。
		// 食事・風呂は既定では部屋ごとなので、別の部屋の滞在を持ったまま見せると誤った時間・枠が出る。
		// PMS でグループの風呂（private_bath_shared）も食事（meal_split=まとめる）も共有にしていれば、
		// book.stay_shared_rooms がグループの部屋を返すので外さない。
		//   2026-11-21 は逆に「部屋番号が違っても外さない」にしていた。本人の滞在が消えていた原因は、
		//   比べていた値が stay_info の room_code（非正規化・部屋の割り当て変更に追従しない）だったこと。
		//   stay_shared_rooms は「いまの割り当て」なので、移動した本人が新しい部屋の QR を読んでも保たれる。
		//   判断が付かないとき（割り当て前・鍵に部屋名が無い・RPC が失敗）は外さない（$lib/inroom-room-match）。
		let decision: StayRoomDecision = 'keep';
		if (stay && room) {
			const scope = DATA_SOURCE === 'supabase' ? await sbStaySharedRooms(token) : null;
			decision = decideStayForScannedRoom({
				stayFacilitySlug: stay.facility.slug,
				// RPC が失敗したら部屋では外さない（施設の比較だけ効く）。古い room_code では比べない
				sharedRooms: scope?.sharedRooms ?? [],
				scannedFacilitySlug: room.facilitySlug,
				scannedRoomCode: room.roomCode
			});
		}
		if (stay && decision === 'keep') redirect(302, localizeHref(guidePath ?? '/r'));
		// 'other-room' で外したあとは、下の redirect が読んだ部屋の施設（slug = room.facilitySlug）の
		// トークンなし表示へ送る。ab_room は上で新しい部屋の鍵に入れ替えてあるので、部屋名は新しい部屋が出る
		// 客室案内の開始前（チェックイン日 9:00 より前）の滞在も外さない（/r が「○日 9:00 から」を出し、時刻が来ればそのまま使える）
		if (!stay) {
			const upcoming = await stayUpcoming(token, getLocale());
			if (upcoming && (!room || upcoming.facility.slug === room.facilitySlug)) redirect(302, localizeHref('/r'));
		}
		cookies.delete(STAY_COOKIE, { path: '/' });
	}
	const known = slug && /^[a-z0-9-]+$/.test(slug) ? rememberBrowseFacility(cookies, slug, getLocale()) : false;
	if (known && guidePath) redirect(302, localizeHref(guidePath));
	redirect(302, localizeHref(known && slug ? `/r?f=${encodeURIComponent(slug)}` : '/r'));
};
