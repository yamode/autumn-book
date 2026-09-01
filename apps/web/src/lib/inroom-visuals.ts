// 客室インフォメーション（/r）の見た目まわりの対応表。**純データだけ**。
//
// 現行の客室インフォメーション（VERY travel）はトップに大きなヒーロー写真を置き、
// メニューを写真付きのカードで並べる。同じ体裁にするための「施設 × 案内セクション → 画像」の対応。
// 画像は static/site-assets 配下にローカル化済みのもの（外部CDNに依存しない）。
//
// 対応が無いセクションは写真なしのカードになる（文字だけでも成立する見た目にしてある）。

/** トップのヒーロー写真。施設スラッグごと。 */
export const INROOM_HERO: Record<string, string> = {
	yamado: '/site-assets/yamado/facility_01.jpg',
	nishiwaga: '/site-assets/yamado/facility_01.jpg',
	oga: '/site-assets/oga/kv_left01.webp'
};

/** カードの背景写真。施設スラッグ → 案内セクション → 画像。 */
const CARD_IMAGES: Record<string, Record<string, string>> = {
	yamado: {
		onsen: '/site-assets/yamado/facility_10.jpg',
		meal: '/site-assets/yamado/cuisine_dinner.jpg',
		roomservice: '/site-assets/yamado/cuisine_fig01.jpg',
		nature: '/site-assets/yamado/top_fig_02.jpg',
		water: '/site-assets/yamado/facility_07.jpg',
		front: '/site-assets/yamado/top_fig_01.jpg',
		roombath: '/site-assets/yamado/room_yukitsubaki.jpg',
		amenity: '/site-assets/yamado/option_f1.jpg',
		about: '/site-assets/yamado/link_02.jpg',
		welcome: '/site-assets/yamado/link_01.jpg'
	},
	oga: {
		onsen: '/site-assets/oga/o_public.webp',
		meal: '/site-assets/oga/c_restaurant.webp',
		lounge: '/site-assets/oga/p_facility.webp',
		lobby: '/site-assets/oga/f_01.webp',
		terrace: '/site-assets/oga/f_02.webp',
		room: '/site-assets/oga/room_b.webp',
		akane: '/site-assets/oga/room_a.webp',
		shuttle: '/site-assets/oga/p_access.webp',
		amenity: '/site-assets/oga/f_03.webp'
	}
};
CARD_IMAGES.nishiwaga = CARD_IMAGES.yamado;

export function inroomHero(slug: string): string | null {
	return INROOM_HERO[slug] ?? null;
}

export function inroomCardImage(slug: string, section: string): string | null {
	return CARD_IMAGES[slug]?.[section] ?? null;
}

/**
 * 案内セクションのアイコン（SVG の path）。
 * 現行アプリの一覧が左にアイコンを置いているのに合わせる。未対応は情報アイコン。
 */
const ICONS: Record<string, string> = {
	wifi: 'M12 18.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8M5.6 12.1a9 9 0 0 1 12.8 0M2.8 9.3a13 13 0 0 1 18.4 0M8.4 14.9a5 5 0 0 1 7.2 0',
	checkout: 'M12 7v5l3 2M12 3a9 9 0 1 0 9 9',
	front: 'M4 18v-1a4 4 0 0 1 4-4h3M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M14 15h6M17 12v6',
	meal: 'M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.5 1.5-2 3.5-2 6s.5 3.5 2 4v8',
	onsen: 'M4 14h16v1a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM8 10V6.5A2 2 0 0 1 11.7 5.4M13 10V7',
	water: 'M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z',
	roomservice: 'M3 17h18M5 17a7 7 0 0 1 14 0M12 7V5',
	request: 'M12 9v4M12 17h.01M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z',
	nature: 'M12 21V9M12 9 8 5M12 9l4-4M6 21h12M9 13l-3-2M15 13l3-2',
	cd: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z',
	links: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
	lounge: 'M4 11V7a2 2 0 0 1 4 0v4M16 11V7a2 2 0 0 1 4 0v4M4 11h16v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM7 19v2M17 19v2',
	lobby: 'M3 21V9l9-6 9 6v12M9 21v-6h6v6',
	terrace: 'M3 10h18L12 4 3 10zM5 10v11M19 10v11M9 21v-5h6v5',
	shuttle: 'M4 16V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9M4 12h16M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
	smoking: 'M3 16h14v3H3zM19 16h2v3h-2M17 12c2-1 2-3 0-4M14 12c2-1 2-3 0-4',
	room: 'M3 21V6l9-3 9 3v15M9 21v-7h6v7M8 10h.01M16 10h.01',
	amenity: 'M8 3h8l-1 4H9zM7 7h10l1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z',
	akane: 'M12 3c2.5 3 4 5.3 4 7.5a4 4 0 0 1-8 0C8 8.3 9.5 6 12 3zM7 21h10M12 15v6',
	door: 'M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M14 12h.01M3 21h18',
	cleaning: 'M8 3h3l1 8H7zM7 11h6l1 8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM16 6h4M18 4v4',
	delivery: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
	vending: 'M6 3h12v18H6zM9 6h3M9 9h3M9 12h3M9 17h6',
	laundry: 'M4 3h16v18H4zM8 6h.01M11 6h.01M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
	welcome: 'M4 21v-2a6 6 0 0 1 12 0v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8l2 2 3-3',
	about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
	roombath: 'M4 14h16v1a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM8 10V6.5A2 2 0 0 1 11.7 5.4'
};

const ICON_FALLBACK = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01';

export function inroomIcon(section: string): string {
	return ICONS[section] ?? ICON_FALLBACK;
}
