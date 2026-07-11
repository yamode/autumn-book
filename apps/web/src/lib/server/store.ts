// デモデータストア — 将来 Supabase（book スキーマ + RPC）へ差し替える境界。
// 関数シグネチャは設計書 §5.2 の RPC に対応させてある。
// 永続化なし（dev サーバープロセス内メモリ）。リロードで予約・hold は消える。

import {
	addDays,
	calcQuote,
	cancellationFee,
	earnedPoints,
	eachNight,
	type CancellationPolicy,
	type Quote
} from '@autumn-book/core';

export type * from '$lib/types';
import { PREPAY_DISCOUNT_MAX } from '$lib/types';
export { PREPAY_DISCOUNT_MAX };
import type {
	NewsPost, SitePage,
	Brand, Photo, AccessInfo, Facility, RoomType, RatePlan, GuestInfo, Hold, Booking,
	Member, PointEntry, MailCampaign, SequenceStep, EmailSequence, Faq, AuditLog,
	SearchParams, FacilityAvailability, CalendarDay, Locale, ContentTranslation,
	ForumProfile, ForumBoard, ForumThread, ForumPost, ForumPostView, ForumThreadListItem,
	OtayoriEntry, OtayoriPost, OtayoriAdminItem,
	HouseGuide, StayToken, StayInfo
} from '$lib/types';
import { extractReplyTo } from '$lib/forum-format';
import { dbg } from '$lib/debug';

// ---------------------------------------------------------------- マスタ（デモ）

const img = (seed: string) => `https://picsum.photos/seed/${seed}/960/640`;

export const memberRanks = [
	{ code: 'standard', label: 'スタンダード', rewardRate: 0.01, condition: '入会で付与' },
	{ code: 'silver', label: 'シルバー', rewardRate: 0.02, condition: '年2泊以上' },
	{ code: 'gold', label: 'ゴールド', rewardRate: 0.03, condition: '年5泊以上' }
] as const;

export const brands: Brand[] = [
	{
		slug: 'yamado',
		name: '山人',
		type: 'lodging',
		description: '東北の山と海に、土地の記憶を味わう小さな宿を。'
	}
];

const stdPolicy: CancellationPolicy = {
	rules: [
		{ days_before: 7, rate: 0.2 },
		{ days_before: 3, rate: 0.5 },
		{ days_before: 0, rate: 1.0 }
	],
	note: '7日前より20%、3日前より50%、当日・無連絡は100%のキャンセル料を申し受けます。'
};

export const facilities: Facility[] = [
	{
		id: 'f-nishiwaga',
		brandSlug: 'yamado',
		slug: 'nishiwaga',
		name: '山人 -yamado-',
		catchCopy: '極上のヒーリングリゾートで、巡る季節をひとり占め。',
		description:
			'山人（やまど）―、文字通り「山の人」。岩手・西和賀の山峡で自然と共生し、その季節でなければ決して味わえない味覚を探し出してお出しする、全10室の極上のヒーリングリゾートです。源泉かけ流しの湯とともに、静かな時間をお過ごしください。',
		lat: 39.3196,
		lng: 140.7822,
		prefecture: '岩手県',
		addressPublic: '岩手県和賀郡西和賀町湯川52-71-10',
		phone: '0197-82-2222',
		checkinTime: '15:00',
		checkoutTime: '11:00',
		amenities: ['源泉かけ流し温泉', '貸切風呂', '無料Wi-Fi', '送迎あり', '駐車場無料', '全室禁煙'],
		access: {
			car: [{ from: '秋田道 湯田IC', route: '国道107号 経由', minutes: 10 }],
			train: [{ from: 'JR ほっとゆだ駅', via: '送迎（要予約）', minutes: 10 }],
			air: [{ from: 'いわて花巻空港', minutes: 90 }],
			shuttle: { available: true, note: 'ほっとゆだ駅から無料送迎・前日まで要予約' },
			parking: { available: true, capacity: 20, fee: '無料' }
		},
		photos: [
			// 現行 WP サイトの実写真（暫定ホットリンク。WP 廃止前に Supabase Storage へ移設）
			{ url: '/site-assets/yamado/top_fig_01.jpg', caption: '山峡に佇む宿', category: 'exterior' },
			{ url: '/site-assets/yamado/room_yukitsubaki.jpg', caption: '雪椿（シモンズ社製ツイン和風ベッド）', category: 'room' },
			{ url: img('nishiwaga-bath'), caption: '源泉かけ流しの大浴場', category: 'bath' },
			{ url: '/site-assets/yamado/link_01.jpg', caption: '山人料理', category: 'meal' },
			{ url: '/site-assets/yamado/top_fig_02.jpg', caption: '西和賀の四季', category: 'view' }
		],
		template: 'yamado-v1',
		isPublished: true
	},
	{
		id: 'f-oga',
		brandSlug: 'yamado',
		slug: 'oga',
		name: '山人 -oga-',
		catchCopy: 'あるがままに、還る。',
		description:
			'七千万年にわたる歴史を刻む地層、潮の満ち引きで表情を変える海岸線。男鹿半島が織り成す荘厳な自然は、訪れる者を圧倒する力強さと静けさを持ち合わせています。何もしない、という贅沢を知る。心満ちる休息をあなたに。',
		lat: 39.8702,
		lng: 139.8205,
		prefecture: '秋田県',
		addressPublic: '秋田県男鹿市船川港台島字鵜ノ崎62-29',
		phone: '0185-47-7776',
		checkinTime: '15:00',
		checkoutTime: '10:00',
		amenities: ['展望温泉', '全室オーシャンビュー', '無料Wi-Fi', '駐車場無料', '全室禁煙'],
		access: {
			car: [{ from: '秋田道 昭和男鹿半島IC', route: '国道101号 経由', minutes: 40 }],
			train: [{ from: 'JR 男鹿駅', via: 'タクシー', minutes: 15 }],
			air: [{ from: '秋田空港', minutes: 80 }],
			shuttle: { available: false, note: '' },
			parking: { available: true, capacity: 15, fee: '無料' }
		},
		photos: [
			// 現行サイトの実写真（暫定ホットリンク。Supabase Storage へ移設予定）
			{ url: '/site-assets/oga/kv_left01.webp', caption: '鵜ノ崎海岸を望む宿', category: 'exterior' },
			{ url: '/site-assets/oga/room_b.webp', caption: '迦具土 — 日本海の絶景を間近に', category: 'room' },
			{ url: '/site-assets/oga/about_onsen.webp', caption: '夕陽を望む温泉', category: 'bath' },
			{ url: img('oga-meal'), caption: '大地の滋味が凝縮された男鹿の幸', category: 'meal' },
			{ url: '/site-assets/oga/g_main.webp', caption: '潮の満ち引きで表情を変える海岸線', category: 'view' }
		],
		template: 'oga-v1',
		isPublished: true
	}
];

export const roomTypes: RoomType[] = [
	// ---- 西和賀（現行サイトの実客室名） ----
	{
		id: 'r-nw-wayo',
		facilityId: 'f-nishiwaga',
		slug: 'yukitsubaki',
		name: '雪椿 Yukitsubaki',
		headline: 'シモンズ社製のツイン和風ベッドのラグジュアリーなお部屋',
		description: 'シモンズ社製のツイン和風ベッドを備えたラグジュアリーなお部屋。優雅なテラス付きで、川のせせらぎと四季の移ろいをお楽しみいただけます。',
		capacity: 4,
		sizeM2: 47.13,
		totalRooms: 2,
		amenities: ['ツイン和風ベッド', 'テラス付', 'ラグジュアリークラス'],
		photos: [{ url: '/site-assets/yamado/room_yukitsubaki.jpg', caption: '雪椿', category: 'room' }]
	},
	{
		id: 'r-nw-washitsu',
		facilityId: 'f-nishiwaga',
		slug: 'buna',
		name: '椈 Buna',
		headline: '川のせせらぎが心地良いテラスと広いお風呂',
		description: 'アッパークラスの広いお風呂付き。川のせせらぎが心地良いテラスを備えた、ゆったりとお過ごしいただけるお部屋です。',
		capacity: 3,
		sizeM2: 52.01,
		totalRooms: 2,
		amenities: ['広いお風呂付', 'テラス付', 'アッパークラス'],
		photos: [{ url: '/site-assets/yamado/room_buna.jpg', caption: '椈', category: 'room' }]
	},
	{
		id: 'r-nw-seizanro',
		facilityId: 'f-nishiwaga',
		slug: 'seizanro',
		name: '靖山樓 Seizanro',
		headline: '1Fがリビング、ロフトが寝室の開放的なメゾネット',
		description: 'メゾネットタイプのお部屋。1Fがリビング、ロフトが寝室の開放的な構造で、おこもりステイに最適です。',
		capacity: 2,
		sizeM2: 46.21,
		totalRooms: 2,
		amenities: ['メゾネット', 'ロフト寝室', '2名様専用'],
		photos: [{ url: '/site-assets/yamado/room_seizanro.jpg', caption: '靖山樓', category: 'room' }]
	},
	// ---- 男鹿（現行サイトの実客室名・3つの棟） ----
	{
		id: 'r-oga-twin',
		facilityId: 'f-oga',
		slug: 'yamazumi',
		name: '山祇 Yamazumi ジュニアスイート',
		headline: '秋田平野と海岸線を望む絶好の眺望',
		description: '秋田平野と海岸線を望む絶好の眺望。ロビー棟と同じ高さで階段の上り下りが不要、車いすにも対応しています。',
		capacity: 2,
		sizeM2: 40,
		totalRooms: 4,
		amenities: ['オーシャンビュー', '段差なし', '車いす対応'],
		photos: [{ url: '/site-assets/oga/room_a.webp', caption: '山祇', category: 'room' }]
	},
	{
		id: 'r-oga-suite',
		facilityId: 'f-oga',
		slug: 'kagutsuchi',
		name: '迦具土 Kagutsuchi オーシャンスイート',
		headline: '日本海の荒々しい絶景を間近に感じる、客室露天風呂付',
		description: '日本海の荒々しい絶景を間近に感じられる立地。広々としたオーシャンスイートに客室露天風呂を備えています。',
		capacity: 4,
		sizeM2: 55,
		totalRooms: 2,
		amenities: ['客室露天風呂', 'オーシャンビュー', '大浴場至近'],
		photos: [{ url: '/site-assets/oga/room_b.webp', caption: '迦具土', category: 'room' }]
	},
	{
		id: 'r-oga-watatsumi',
		facilityId: 'f-oga',
		slug: 'watatsumi',
		name: '綿津見 Watatsumi ラグジュアリースイート',
		headline: 'もっとも広い客室とバルコニー。最上級グレード',
		description: '当館でもっとも広い客室とバルコニーを備えた最上級グレード。海岸線を一望する4室のみの特別なお部屋です。',
		capacity: 4,
		sizeM2: 68,
		totalRooms: 2,
		amenities: ['最上級グレード', 'バルコニー', '海岸線一望'],
		photos: [{ url: '/site-assets/oga/room_c.webp', caption: '綿津見', category: 'room' }]
	}
];

export const ratePlans: RatePlan[] = [
	{
		id: 'p-nw-standard',
		facilityId: 'f-nishiwaga',
		slug: 'standard',
		name: '山人料理スタンダード（2食付）',
		headline: '迷ったらこちら。西和賀の山の幸を味わう基本プラン',
		description: `## お料理

地元の山菜・川魚・短角牛を中心に、その日の入荷で献立を組む**山人料理**のフルコースです。

- 夕食：個室食事処にて 17:30 / 19:30 から選択
- 朝食：炊きたての釜飯と山の汁物

## 温泉

源泉かけ流しの大浴場・露天風呂をチェックインから翌朝まで。貸切風呂（45分）は当日予約制です。

## こんな方に

| おすすめ | 内容 |
|---|---|
| はじめての山人 | 全部入りの基本形 |
| 食を楽しみたい | 献立は季節替わり |`,
		mealPlan: '夕朝食付',
		payment: { onsite: true, prepay: true, prepayMethods: ['card', 'paypay'], prepayDiscountRate: 0.1 },
		basePrice: 23100,
		highlightTags: ['源泉かけ流し', '個室食'],
		photos: [{ url: img('nw-plan-std'), caption: '山人料理', category: 'meal' }],
		cancellationPolicy: stdPolicy,
		roomTypeIds: ['r-nw-wayo', 'r-nw-washitsu', 'r-nw-seizanro'],
		isPublished: true,
		sortOrder: 1
	},
	{
		id: 'p-nw-anniv',
		facilityId: 'f-nishiwaga',
		slug: 'anniversary',
		name: '記念日プラン（乾杯スパークリング＆ケーキ付）',
		headline: '大切な日を山峡の湯宿で。特典付きアニバーサリー',
		description: `## 特典

- 乾杯用スパークリングワイン（ハーフボトル）
- アニバーサリーケーキ（メッセージ入り）
- レイトチェックアウト 12:00

## ご注意

ケーキのメッセージは予約時の連絡事項欄にご記入ください。`,
		mealPlan: '夕朝食付',
		payment: { onsite: false, prepay: true, prepayMethods: ['card', 'paypay'], prepayDiscountRate: 0.05 },
		basePrice: 27500,
		highlightTags: ['記念日', '特典付', '事前カード決済'],
		photos: [{ url: img('nw-plan-anniv'), caption: '記念日の演出', category: 'meal' }],
		cancellationPolicy: stdPolicy,
		roomTypeIds: ['r-nw-wayo'],
		isPublished: true,
		sortOrder: 2
	},
	{
		id: 'p-oga-standard',
		facilityId: 'f-oga',
		slug: 'standard',
		name: '男鹿の幸スタンダード（2食付）',
		headline: '日本海の旬と夕陽を味わう基本プラン',
		description: `## お料理

男鹿の港に揚がる旬魚と、名物**石焼料理**を中心とした海のコースです。

## 夕陽の時間

夕食の開始時刻は日没に合わせてご案内します。`,
		mealPlan: '夕朝食付',
		payment: { onsite: true, prepay: true, prepayMethods: ['card', 'paypay'], prepayDiscountRate: 0.15 },
		basePrice: 25300,
		highlightTags: ['オーシャンビュー', '石焼料理'],
		photos: [{ url: img('oga-plan-std'), caption: '石焼料理', category: 'meal' }],
		cancellationPolicy: stdPolicy,
		roomTypeIds: ['r-oga-twin', 'r-oga-suite', 'r-oga-watatsumi'],
		isPublished: true,
		sortOrder: 1
	},
	{
		id: 'p-oga-solo',
		facilityId: 'f-oga',
		slug: 'solo',
		name: 'ひとり旅プラン（1名利用・夕朝食付）',
		headline: '夕陽と海音を独り占めする、おひとりさま歓迎プラン',
		description: `## ひとり旅にこそ

カウンター席での夕食、湯上がりの読書スペースなど、おひとりの時間が心地よい設えです。`,
		mealPlan: '夕朝食付',
		payment: { onsite: true, prepay: false, prepayMethods: [], prepayDiscountRate: 0 },
		basePrice: 29700,
		highlightTags: ['一人旅', 'カウンター食'],
		photos: [{ url: img('oga-plan-solo'), caption: 'カウンター席', category: 'meal' }],
		cancellationPolicy: stdPolicy,
		roomTypeIds: ['r-oga-twin'],
		isPublished: true,
		sortOrder: 2
	}
];

export const faqs: Faq[] = [
	{
		id: 'q1',
		facilityId: 'f-nishiwaga',
		category: 'アクセス',
		question: '送迎はありますか？',
		answer: 'JRほっとゆだ駅から**無料送迎**を行っています（前日までに要予約）。お電話または予約時の連絡事項欄でお申し付けください。',
		isPublished: true,
		sortOrder: 1
	},
	{
		id: 'q2',
		facilityId: 'f-nishiwaga',
		category: '温泉',
		question: '日帰り入浴はできますか？',
		answer: '申し訳ございません。ご宿泊のお客様専用となっております。',
		isPublished: true,
		sortOrder: 2
	},
	{
		id: 'q3',
		facilityId: 'f-oga',
		category: 'お食事',
		question: '夕食の時間は選べますか？',
		answer: '日没に合わせてご案内しています。ご希望がある場合はチェックイン時にご相談ください。',
		isPublished: true,
		sortOrder: 1
	},
	{
		id: 'q4',
		facilityId: 'f-oga',
		category: 'お子様',
		question: '子供連れでも泊まれますか？',
		answer: '現在、直販サイトでは大人のみのご予約を承っています。お子様連れのご宿泊は**お電話（0185-47-7776）**でご相談ください。',
		isPublished: true,
		sortOrder: 2
	}
];

// ---------------------------------------------------------------- 下層コンテンツページ（現行サイトから移植）

const wpImg = (p: string) => `https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/${p}`;
const ogaImg = (p: string) => `https://oga.yamado.co.jp/img/${p}`;

export const sitePages: SitePage[] = [
	// ======== 西和賀（www.yamado.co.jp の下層ページを移植） ========
	{
		id: 'sp-nw-cuisine', facilityId: 'f-nishiwaga', slug: 'cuisine',
		title: 'お料理', titleEn: 'Cuisine',
		lead: '素材を知り尽くした料理人が奏でる美食のひととき。地場産の厳選食材と自社農園から収穫した安全で新鮮な食材を活用し、創造力あふれた調理法で仕上げたお料理をご堪能ください。',
		heroUrl: '/site-assets/yamado/cuisine_fig01.jpg',
		sections: [
			{ heading: '夕食', headingEn: 'Dinner', body: 'お客様ごとにパーテーションで仕切られた半個室感覚の空間で、ゆっくりと時間をかけて料理長渾身のレシピをご堪能ください。厳選した地酒やワインなど、アルコールの品揃えにもこだわりがございます。', imageUrl: '/site-assets/yamado/cuisine_dinner.jpg' },
			{ heading: '朝食', headingEn: 'Breakfast', body: '炊きたてご飯やほかほかのカンパーニュ、新鮮な野菜など、豊富な種類の料理をご用意しています。優雅な朝のひとときをお過ごしください。', imageUrl: '/site-assets/yamado/cuisine_breakfast.jpg' }
		],
		isPublished: true, sortOrder: 2
	},
	{
		id: 'sp-nw-facility', facilityId: 'f-nishiwaga', slug: 'facility',
		title: '施設', titleEn: 'Facility',
		lead: '大自然ともてなしの心を味わう至福の時間。都会の喧騒や日常から解き放たれる癒やしの空間として、館内を山に見立てて設えました。客室名は季節ごとの山の変化と、樹木・花の名前に由来しています。',
		heroUrl: '/site-assets/yamado/facility_01.jpg',
		sections: [
			{ heading: 'ロビー・読書室', headingEn: 'Lobby', body: '北欧と和が融合した開放的な空間。窓の外に広がる山の景色を眺めながら、ゆったりとした時間をお過ごしください。', imageUrl: '/site-assets/yamado/facility_01.jpg' },
			{ heading: '福膳坊', headingEn: 'Dining', body: '朝夕のお食事処。パーテーションで仕切られた半個室感覚の空間で、季節の山人料理をお楽しみいただけます。', imageUrl: '/site-assets/yamado/facility_07.jpg' },
			{ heading: '湯場一寸', headingEn: 'Onsen', body: '渓流沿いの野趣溢れる野天風呂。源泉かけ流しの湯を、川のせせらぎとともに。貸切利用も承ります（当日予約制）。', imageUrl: '/site-assets/yamado/facility_10.jpg' },
			{ heading: '客室棟', headingEn: 'Guest Rooms', body: 'メゾネットタイプの靖山樓、清流に面した麓花坊、広々とした麓樹坊。いずれも季節の山の変化と樹木・花の名に由来する全10室です。' }
		],
		isPublished: true, sortOrder: 3
	},
	{
		id: 'sp-nw-option', facilityId: 'f-nishiwaga', slug: 'option',
		title: 'オプション', titleEn: 'Option',
		lead: 'ご滞在をより豊かにするリラクゼーションとアクティビティをご用意しています。',
		heroUrl: '/site-assets/yamado/option_01.jpg',
		sections: [
			{ heading: 'リラクゼーション', headingEn: 'Relaxation', body: '女性整体師によるカイロプラクティック、筋肉療法、整体、フットケアなど。整体の技術を取り入れたエステです。', note: '15,000円（税込／60分）｜ 20:30〜22:00 または 9:30〜11:30', imageUrl: '/site-assets/yamado/option_01.jpg' },
			{ heading: 'リバートレッキング', headingEn: 'River Trekking', body: '夏の清流を歩く爽快な川のトレッキング。', note: '5,000円／人 ｜ 7月下旬〜9月下旬', imageUrl: '/site-assets/yamado/option_f1.jpg' },
			{ heading: 'ブナと桂の巨樹めぐり', headingEn: 'Giant Trees', body: '西和賀のブナと桂の巨樹を訪ねる森のガイドツアー。', note: '8,000円／人 ｜ 6月上旬〜11月上旬', imageUrl: '/site-assets/yamado/option_f2.jpg' },
			{ heading: '錦秋湖カンジキスノートレッキング', headingEn: 'Snow Trekking', body: '雪深い西和賀ならではの、カンジキで歩く冬の錦秋湖。', note: '5,000円／人 ｜ 12月下旬〜3月下旬', imageUrl: '/site-assets/yamado/option_f3.jpg' },
			{ heading: '水没林とカヌー', headingEn: 'Canoe', body: '春の錦秋湖にだけ現れる幻想的な水没林をカヌーでめぐります。', note: '10,000〜17,000円／人 ｜ 4月下旬〜5月下旬' }
		],
		isPublished: true, sortOrder: 4
	},
	{
		id: 'sp-nw-shiki', facilityId: 'f-nishiwaga', slug: 'shiki',
		title: '山人の四季', titleEn: 'Four Seasons',
		lead: 'ここにしかない四季の魅力。訪れるたび新鮮で懐かしい、西和賀の移ろい。',
		heroUrl: '/site-assets/yamado/top_fig_02.jpg',
		sections: [
			{ heading: '山人の春', headingEn: 'Spring', body: '雪解けの清流と山菜の芽吹き。錦秋湖には水没林が現れ、カヌーの季節が始まります。' },
			{ heading: '山人の夏', headingEn: 'Summer', body: 'ブナの森の深い緑と川のせせらぎ。リバートレッキングで涼を楽しむ季節です。' },
			{ heading: '山人の秋', headingEn: 'Autumn', body: '名の由来でもある錦秋湖の紅葉。山の幸が最も豊かになる実りの季節です。' },
			{ heading: '山人の冬', headingEn: 'Winter', body: '日本有数の豪雪地帯・西和賀の静寂な雪景色。雪見の温泉とカンジキトレッキングを。' }
		],
		isPublished: true, sortOrder: 5
	},
	// ======== 男鹿（oga.yamado.co.jp の下層ページを移植） ========
	{
		id: 'sp-oga-nature', facilityId: 'f-oga', slug: 'nature',
		title: '自然', titleEn: 'Nature',
		lead: '荒々しく打ち寄せる波の音が、木々を抜け、深く息づく森へ溶け込んでいく。大地が生んだ地層、潮の香りを孕む空気、そして太古の鼓動。',
		heroUrl: '/site-assets/oga/kv_nature.webp',
		sections: [
			{ heading: '悠久の時を越えて 原始の景色が残る、男鹿半島', headingEn: 'Oga Peninsula', body: '神聖な土地として人々に守られてきた男鹿。七千万年にわたる歴史を刻む地層が、訪れる者に太古の記憶を語りかけます。', imageUrl: '/site-assets/oga/n_oga.webp' },
			{ heading: '荒々しくも優しい海に 生命が宿る', headingEn: 'The Sea', body: '希少な生物が息づく豊かな海。荒々しい波の表情の奥に、静かな優しさを湛えています。', imageUrl: '/site-assets/oga/n_sea.webp' },
			{ heading: '何万年もの時を重ねてきた 大地の重み', headingEn: 'The Forest', body: '苔むす木々が原始の調和を保つ森。一歩足を踏み入れれば、生命の物語が聞こえてきます。', imageUrl: '/site-assets/oga/n_forest.webp' }
		],
		isPublished: true, sortOrder: 1
	},
	{
		id: 'sp-oga-cuisine', facilityId: 'f-oga', slug: 'cuisine',
		title: '料理', titleEn: 'Cuisine',
		lead: '男鹿の海と森が育む希少食材を、シェフの研ぎ澄まされた技で一皿に昇華。荒々しくも優しい自然の力を五感で受け止めるとき、そこには新たな発見と感動が待っています。',
		heroUrl: '/site-assets/oga/kv_cuisine.webp',
		sections: [
			{ heading: '自然の厳しさが育んだ濃密な旨味を宿した食材を贅沢に使用', headingEn: 'Ingredients', body: '男鹿半島の地形と厳しい環境条件が、海産物と山の恵みに濃密な旨味を与えます。', imageUrl: '/site-assets/oga/c_ingredient.webp' },
			{ heading: '男鹿の自然をひと皿に集約する研ぎ澄まされた匠の技術', headingEn: 'Chef', body: '食材の声に耳を澄まし、組み合わせと火入れで男鹿の自然をひと皿に集約します。', imageUrl: '/site-assets/oga/c_chef.webp' },
			{ heading: '大地と海の息吹が詰まった美食に心が静かに満ちてゆく', headingEn: 'Experience', body: 'ひと皿ごとに広がる大地と海の息吹。食を通じて、心と身体が静かに満ちてゆきます。', imageUrl: '/site-assets/oga/c_tableware.webp' },
			{ heading: 'コース', headingEn: 'Course', body: 'メヌエット（カジュアル）、セレナーデ（スタンダード）、シンフォニア（フルコース）の3つのコースをご用意しています。', note: 'コースはご予約のプランにより異なります', imageUrl: '/site-assets/oga/c_restaurant.webp' }
		],
		isPublished: true, sortOrder: 2
	},
	{
		id: 'sp-oga-restaurant', facilityId: 'f-oga', slug: 'restaurant',
		title: 'レストラン', titleEn: 'Restaurant',
		lead: '食事を待つ時間さえ贅沢に。美しい音と香りが漂う特別な空間。鵜ノ崎海岸の歴史に敬意を込めて、"isana" と名付けました。',
		heroUrl: '/site-assets/oga/kv_restaurant.webp',
		sections: [
			{ heading: 'レストラン isana', headingEn: 'isana', body: '全40席・個室1室（6席）。日本海を望む窓際の席で、男鹿の旬をご堪能ください。', note: 'ディナー 17:30〜22:00（L.O. 21:30）／ 朝食 7:30〜10:00（L.O. 9:30）', imageUrl: '/site-assets/oga/kv_restaurant.webp' },
			{ heading: 'コース', headingEn: 'Course', body: 'メヌエット（カジュアル）、セレナーデ（スタンダード）、シンフォニア（フルコース）。', imageUrl: '/site-assets/oga/c_restaurant.webp' }
		],
		isPublished: true, sortOrder: 3
	},
	{
		id: 'sp-oga-onsen', facilityId: 'f-oga', slug: 'onsen',
		title: '温泉', titleEn: 'Onsen',
		lead: '美しい日本海を眺めながら、エメラルド色に輝く湯に心も浸る。源泉掛け流しの鵜ノ崎温泉は、硫黄分を含むエメラルド色の湯です。',
		heroUrl: '/site-assets/oga/kv_onsen.webp',
		sections: [
			{ heading: '露天風呂', headingEn: 'Open-air Bath', body: '心を解放してくれる、エメラルド色に輝く湯船と紺碧に輝く日本海。湯船に身を沈めれば、視界には鮮やかな日本海が広がり、エメラルド色の湯が日常の疲れをやさしくほどいてくれます。', imageUrl: '/site-assets/oga/o_public.webp' },
			{ heading: '貸切露天風呂', headingEn: 'Private Bath', body: '誰にも邪魔されることなく、至福の時を独り占めする貸切の湯。静かな空間で、心をほどくひとときを。', imageUrl: '/site-assets/oga/o_private.webp' },
			{ heading: '泉質', headingEn: 'Spring Quality', body: '鵜ノ崎温泉 ｜ 含硫黄ナトリウム・カルシウム塩化物泉（源泉掛け流し）。美肌効果、殺菌・抗炎症作用、血管拡張作用などが期待できます。' }
		],
		isPublished: true, sortOrder: 4
	},
	{
		id: 'sp-oga-guide', facilityId: 'f-oga', slug: 'guide',
		title: '館内案内', titleEn: 'Facility',
		lead: '洗練された意匠に、やすらぎと感動が溶け合う。緩やかな色調と落ち着いた照明が心を静かにほどき、モダンなアクセントが感性を揺さぶる空間。',
		heroUrl: '/site-assets/oga/f_01.webp',
		sections: [
			{ heading: '自然と心が通う、癒しのエントランス', headingEn: 'Entrance & Reception', body: 'やわらかな光と木の温もり。人と自然が溶け合う穏やかな空気が迎えます。', imageUrl: '/site-assets/oga/f_01.webp' },
			{ heading: '朝露も夕闇も、男鹿の大地に身を委ねるひととき', headingEn: 'Terrace', body: '刻々と変わる空の表情に寄り添い、自然と自身の鼓動が重なる時間を。', imageUrl: '/site-assets/oga/f_02.webp' },
			{ heading: '大地と海の恵みを、至福の一皿で', headingEn: 'Restaurant', body: '男鹿の海と山の素材を、洗練された技で調理してお届けします。', imageUrl: '/site-assets/oga/f_03.webp' },
			{ heading: '海を望む、地酒と共に贅沢な夜を', headingEn: 'Bar & Lounge', body: '秋田の地酒とこだわりの一杯を、海を眺めながら楽しむ空間。', imageUrl: '/site-assets/oga/f_04.webp' }
		],
		isPublished: true, sortOrder: 5
	}
];

// ---------------------------------------------------------------- お知らせ（WP のニュース機能を置換）

export const newsPosts: NewsPost[] = [
	// 現行サイトの実ニュース（移植）
	{ id: 'n-nw-1', facilityId: 'f-nishiwaga', title: 'クマ対策について', body: '当館周辺では春から秋にかけてクマの目撃情報が寄せられることがあります。お散歩の際は遊歩道をご利用いただき、夕方以降の単独での外出はお控えください。クマ鈴の貸出をフロントにて行っております。', publishedAt: '2026-05-15', isPublished: true, createdAt: '2026-05-15' },
	{ id: 'n-nw-2', facilityId: 'f-nishiwaga', title: '【2026年5月〜7月】JR北上線計画運休のお知らせ', body: 'JR北上線は保守工事のため、2026年5月から7月にかけて一部期間で計画運休が予定されています。ほっとゆだ駅をご利用のお客様は、事前に運行状況をご確認ください。**送迎をご希望のお客様はお気軽にご相談ください**（前日まで要予約）。', publishedAt: '2026-04-11', isPublished: true, createdAt: '2026-04-11' },
	{ id: 'n-nw-3', facilityId: 'f-nishiwaga', title: 'サービス内容変更のお知らせ', body: 'サービス内容の一部を変更いたしました。詳しくはお電話（0197-82-2222）にてお問い合わせください。', publishedAt: '2026-02-16', isPublished: true, createdAt: '2026-02-16' },
	{ id: 'n-oga-1', facilityId: 'f-oga', title: 'JR男鹿線の一部列車の運休について（2026年5月・6月）', body: 'JR男鹿線は2026年5月・6月に一部列車の運休が予定されています。電車でお越しのお客様は、事前に運行状況をご確認ください。', publishedAt: '2026-04-14', isPublished: true, createdAt: '2026-04-14' },
	{ id: 'n-oga-2', facilityId: 'f-oga', title: 'イベントへご参加予定のお客様へ', body: 'イベント開催日は駐車場が混み合う場合がございます。お時間に余裕を持ってお越しください。', publishedAt: '2026-03-10', isPublished: true, createdAt: '2026-03-10' },
	{ id: 'n-oga-3', facilityId: 'f-oga', title: '秋田県プレミアムチケットについて', body: '秋田県プレミアム宿泊券をご利用いただけます。ご予約時の連絡事項欄にその旨をご記入ください。', publishedAt: '2026-03-02', isPublished: true, createdAt: '2026-03-02' }
];

// ---------------------------------------------------------------- 可変データ（メモリ）

const today = () => new Date().toISOString().slice(0, 10);
let seq = 1000;
const nextId = (p: string) => `${p}-${++seq}`;

export const members: Member[] = [
	{
		id: 'm-demo',
		memberCode: 'YM-000123',
		email: 'demo@yamado.co.jp',
		password: 'demo',
		name: '山田 太郎',
		kana: 'ヤマダ タロウ',
		phone: '090-0000-0000',
		rank: 'gold',
		mailOptIn: true,
		joinedAt: '2025-11-02'
	}
];

export const pointLedger: PointEntry[] = [
	{ id: 'pt1', memberId: 'm-demo', delta: 600, reason: '宿泊ポイント（YB-2026-000098）', bookingCode: 'YB-2026-000098', expiresAt: addDays(today(), 20), createdAt: '2026-02-12' },
	{ id: 'pt2', memberId: 'm-demo', delta: 840, reason: '宿泊ポイント（YB-2026-000104）', bookingCode: 'YB-2026-000104', expiresAt: addDays(today(), 300), createdAt: '2026-04-03' },
	{ id: 'pt3', memberId: 'm-demo', delta: -200, reason: 'ご予約での利用', createdAt: '2026-04-20' }
];

export const favoritesByMember = new Map<string, Set<string>>([['m-demo', new Set(['f-oga'])]]);

// デモの退会（論理削除）会員ID。退会後はログイン不可・マイページ不可にする（データは保持）。
export const withdrawnMembers = new Set<string>();

// 個別客室（客室タイプ内の1部屋ごと。実データは pms.rooms・metadata.display_name が部屋名）。
// お気に入り客室UI（demo）用。名称は実施設の部屋名に準拠。
export interface DemoRoom {
	id: string;
	facilityId: string;
	roomNumber: string;
	name: string; // 部屋名（例: 萌木）
	roomType: string; // 客室タイプの簡易表示
}
export const rooms: DemoRoom[] = [
	// 山人-yamado-（西和賀）
	{ id: 'nw-201', facilityId: 'f-nishiwaga', roomNumber: '201', name: '萌木', roomType: '靖山樓（メゾネット）' },
	{ id: 'nw-202', facilityId: 'f-nishiwaga', roomNumber: '202', name: '深緑', roomType: '靖山樓（メゾネット）' },
	{ id: 'nw-203', facilityId: 'f-nishiwaga', roomNumber: '203', name: '錦', roomType: '靖山樓（メゾネット）' },
	{ id: 'nw-204', facilityId: 'f-nishiwaga', roomNumber: '204', name: '雪華', roomType: '靖山樓（メゾネット）' },
	{ id: 'nw-301', facilityId: 'f-nishiwaga', roomNumber: '301', name: '蕗の薹', roomType: '麓花坊（ハリウッドツイン）' },
	{ id: 'nw-302', facilityId: 'f-nishiwaga', roomNumber: '302', name: '堅香子', roomType: '麓花坊（ハリウッドツイン）' },
	{ id: 'nw-303', facilityId: 'f-nishiwaga', roomNumber: '303', name: '羊草', roomType: '麓花坊（ハリウッドツイン）' },
	{ id: 'nw-304', facilityId: 'f-nishiwaga', roomNumber: '304', name: '雪椿', roomType: '麓花坊（離れ・ジャパニーズスイート）' },
	{ id: 'nw-401', facilityId: 'f-nishiwaga', roomNumber: '401', name: '椈', roomType: '麓樹坊（離れ・半露天付）' },
	{ id: 'nw-402', facilityId: 'f-nishiwaga', roomNumber: '402', name: '水木', roomType: '麓樹坊（ハリウッドツイン）' },
	{ id: 'nw-403', facilityId: 'f-nishiwaga', roomNumber: '403', name: '黒文字', roomType: '麓樹坊（ハリウッドツイン）' },
	{ id: 'nw-404', facilityId: 'f-nishiwaga', roomNumber: '404', name: '桂', roomType: '麓樹坊（離れ・半露天付）' },
	// 山人-oga-（男鹿）
	{ id: 'og-101', facilityId: 'f-oga', roomNumber: '101', name: '紅葉', roomType: '山祇 ジュニアスイート' },
	{ id: 'og-102', facilityId: 'f-oga', roomNumber: '102', name: '東雲', roomType: '山祇 ジュニアスイート' },
	{ id: 'og-103', facilityId: 'f-oga', roomNumber: '103', name: '茜', roomType: '山祇 ジュニアスイート' },
	{ id: 'og-104', facilityId: 'f-oga', roomNumber: '104', name: 'カーミン', roomType: '山祇 テラススイート' },
	{ id: 'og-201', facilityId: 'f-oga', roomNumber: '201', name: '琥珀', roomType: '山祇 ジュニアスイート【上階】' },
	{ id: 'og-202', facilityId: 'f-oga', roomNumber: '202', name: '鴇', roomType: '山祇 ジュニアスイート【上階】' },
	{ id: 'og-301', facilityId: 'f-oga', roomNumber: '301', name: '緋橙', roomType: '迦具土 オーシャン和スイート' },
	{ id: 'og-302', facilityId: 'f-oga', roomNumber: '302', name: '朱華', roomType: '迦具土 オーシャンスイート' },
	{ id: 'og-401', facilityId: 'f-oga', roomNumber: '401', name: '一重梅', roomType: '綿津見 グランドスイート' },
	{ id: 'og-402', facilityId: 'f-oga', roomNumber: '402', name: '蘇芳', roomType: '綿津見 ラグジュアリースイート' }
];

// デモのお気に入り客室（会員ID → 部屋ID の集合）
export const favoriteRoomsByMember = new Map<string, Set<string>>([['m-demo', new Set(['nw-201', 'og-401'])]]);

// デモのプロフィール画像（会員ID → data URL）。supabase では book.members.avatar_url + Storage。
export const avatarByMember = new Map<string, string>();

export const holds = new Map<string, Hold>();
export const bookings = new Map<string, Booking>();
export const auditLogs: AuditLog[] = [];

// 監査ログを1件追記する汎用ヘルパー（運営操作の記帳に使う）
export function addAuditLog(actor: string, action: string, detail: string): void {
	auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor, action, detail });
}

// デモ予約（会員に紐づく過去・未来）
function seedBookings() {
	const mk = (b: Partial<Booking> & Pick<Booking, 'code' | 'facilityId' | 'roomTypeId' | 'planId' | 'checkin' | 'status'>): Booking => ({
		nights: 2,
		adults: 2,
		children: 0,
		guest: { name: '山田 太郎', kana: 'ヤマダ タロウ', phone: '090-0000-0000', email: 'demo@yamado.co.jp' },
		total: 92400,
		pointsUsed: 0,
		pointsEarned: 840,
		payment: 'onsite',
		paymentStatus: 'unpaid',
		channel: 'autumn_booking',
		cancellationPolicy: stdPolicy,
		memberId: 'm-demo',
		createdAt: today(),
		...b
	});
	const list: Booking[] = [
		mk({ code: 'YB-2026-000104', facilityId: 'f-nishiwaga', roomTypeId: 'r-nw-wayo', planId: 'p-nw-standard', checkin: '2026-04-02', status: 'stayed' }),
		mk({ code: 'YB-2026-000131', facilityId: 'f-oga', roomTypeId: 'r-oga-twin', planId: 'p-oga-standard', checkin: addDays(today(), 18), status: 'reserved', total: 101200, pointsEarned: 920 }),
		mk({ code: 'OTA-1KYU-7741', facilityId: 'f-nishiwaga', roomTypeId: 'r-nw-washitsu', planId: 'p-nw-standard', checkin: addDays(today(), 5), status: 'reserved', channel: 'ota', memberId: undefined, guest: { name: '佐藤 花子', kana: 'サトウ ハナコ', phone: '080-1111-2222', email: 'hanako@example.com' } })
	];
	for (const b of list) bookings.set(b.code, b);
}
seedBookings();

export const mailCampaigns: MailCampaign[] = [
	{
		id: 'mc-1',
		title: '初夏の男鹿・夕陽の便り',
		subject: '【山人】初夏の男鹿、夕陽が最も美しい季節です',
		body: '## 夕陽の特等席、ご用意しています\n\n{氏名} 様\n\n男鹿は日本海に沈む夕陽が最も美しい季節を迎えました…',
		segment: { ranks: ['silver', 'gold'] },
		status: 'sent',
		scheduledAt: '2026-05-20 10:00',
		stats: { sent: 312, opened: 148, failed: 2 },
		createdAt: '2026-05-18'
	}
];

export const emailSequences: EmailSequence[] = facilities.map((f, i) => ({
	id: `seq-${f.slug}`,
	facilityId: f.id,
	name: `${f.name} 標準ステップメール`,
	isActive: i === 0,
	steps: [
		{ id: `st-${f.slug}-7`, offsetDays: -7, sendHour: 10, title: 'アクセス・送迎のご案内', body: '{氏名} 様\n\nご来館まであと1週間となりました。アクセスと送迎のご案内です…' },
		{ id: `st-${f.slug}-3`, offsetDays: -3, sendHour: 10, title: 'お食事と貸切風呂のご案内', body: '{氏名} 様\n\nご夕食の献立と、**貸切風呂**のご予約案内です…' },
		{ id: `st-${f.slug}-1`, offsetDays: -1, sendHour: 15, title: '明日のご来館をお待ちしています', body: 'チェックインは {チェックイン時刻} からです。到着予定の変更はこちらから…' },
		{ id: `st-${f.slug}+1`, offsetDays: 1, sendHour: 11, title: 'ご宿泊ありがとうございました', body: 'またのお越しをお待ちしております。次回ご利用いただける **500pt** を付与しました…' }
	]
}));

// ---------------------------------------------------------------- 在庫・料金（RPC 相当）

/** 決定的疑似乱数（日付×部屋で安定） */
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h);
}

const inventoryDelta = new Map<string, number>(); // hold/予約による減算オーバーレイ

function invKey(roomTypeId: string, date: string) {
	return `${roomTypeId}:${date}`;
}

/** 残室数（0〜totalRooms） */
export function remainingRooms(roomTypeId: string, date: string): number {
	const rt = roomTypes.find((r) => r.id === roomTypeId)!;
	const base = hash(invKey(roomTypeId, date)) % (rt.totalRooms + 1); // 0..total
	const delta = inventoryDelta.get(invKey(roomTypeId, date)) ?? 0;
	return Math.max(0, base + delta);
}

function adjustInventory(roomTypeId: string, checkin: string, nights: number, delta: number) {
	for (const d of eachNight(checkin, nights)) {
		const k = invKey(roomTypeId, d);
		inventoryDelta.set(k, (inventoryDelta.get(k) ?? 0) + delta);
	}
}

/** 日別単価（大人1名）：週末+25%・季節係数 */
export function nightlyRate(planId: string, date: string): number {
	const plan = ratePlans.find((p) => p.id === planId)!;
	const dow = new Date(date + 'T00:00:00Z').getUTCDay();
	const weekend = dow === 5 || dow === 6 ? 1.25 : 1;
	const seasonal = 1 + ((hash('season' + date.slice(0, 7)) % 11) - 5) / 100; // ±5%
	return Math.round((plan.basePrice * weekend * seasonal) / 100) * 100;
}

/** RPC: book.search_availability 相当 */
export function searchAvailability(params: SearchParams): FacilityAvailability[] {
	return facilities
		.filter((f) => f.isPublished)
		.map((facility) => {
			const plans = ratePlans.filter((p) => p.facilityId === facility.id && p.isPublished);
			if (!params.checkin) {
				const ref = Math.min(...plans.map((p) => p.basePrice));
				return { facility, minTotal: ref * params.adults * params.nights, minPerPerson: ref, remaining: 9, reference: true };
			}
			let best: number | null = null;
			let remaining = 0;
			for (const plan of plans) {
				for (const rtId of plan.roomTypeIds) {
					const rt = roomTypes.find((r) => r.id === rtId)!;
					if (rt.capacity < params.adults + params.children) continue;
					const rem = Math.min(...eachNight(params.checkin, params.nights).map((d) => remainingRooms(rtId, d)));
					if (rem <= 0) continue;
					remaining = Math.max(remaining, rem);
					const q = calcQuote({
						checkin: params.checkin,
						nights: params.nights,
						adults: params.adults,
						children: params.children,
						nightlyRate: (d) => nightlyRate(plan.id, d)
					});
					if (best === null || q.total < best) best = q.total;
				}
			}
			return {
				facility,
				minTotal: best,
				minPerPerson: best === null ? null : Math.round(best / params.adults),
				remaining,
				reference: false
			};
		});
}

/** RPC: book.get_plan_calendar 相当 */
export function getPlanCalendar(planId: string, yearMonth: string): CalendarDay[] {
	const plan = ratePlans.find((p) => p.id === planId);
	if (!plan) return [];
	const [y, m] = yearMonth.split('-').map(Number);
	const daysInMonth = new Date(y, m, 0).getDate();
	const todayStr = today();
	return Array.from({ length: daysInMonth }, (_, i) => {
		const date = `${yearMonth}-${String(i + 1).padStart(2, '0')}`;
		if (date < todayStr) return { date, price: null, remaining: 0, mark: '×' as const };
		const rem = Math.max(...plan.roomTypeIds.map((r) => remainingRooms(r, date)));
		const price = rem > 0 ? nightlyRate(planId, date) : null;
		const mark = rem === 0 ? '×' : rem === 1 ? '△' : rem <= 3 ? '○' : '◎';
		return { date, price, remaining: rem, mark };
	});
}

/** RPC: book.quote 相当 */
export function quoteFor(planId: string, roomTypeId: string, checkin: string, nights: number, adults: number, children: number, pointsUsed = 0): Quote {
	return calcQuote({ checkin, nights, adults, children, pointsUsed, nightlyRate: (d) => nightlyRate(planId, d) });
}

/** RPC: book.create_hold 相当（version 楽観ロックの代わりにメモリ減算） */
export function createHold(planId: string, roomTypeId: string, checkin: string, nights: number, adults: number, children: number, memberId?: string): Hold | { error: 'sold_out' } {
	expireHolds();
	const rem = Math.min(...eachNight(checkin, nights).map((d) => remainingRooms(roomTypeId, d)));
	if (rem <= 0) return { error: 'sold_out' };
	adjustInventory(roomTypeId, checkin, nights, -1);
	const plan = ratePlans.find((p) => p.id === planId)!;
	const hold: Hold = {
		id: nextId('h'),
		facilityId: plan.facilityId,
		roomTypeId,
		planId,
		checkin,
		nights,
		adults,
		children,
		quote: quoteFor(planId, roomTypeId, checkin, nights, adults, children),
		memberId,
		status: 'active',
		expiresAt: Date.now() + 20 * 60 * 1000
	};
	holds.set(hold.id, hold);
	return hold;
}

export function expireHolds() {
	for (const h of holds.values()) {
		if (h.status === 'active' && h.expiresAt < Date.now()) {
			h.status = 'expired';
			adjustInventory(h.roomTypeId, h.checkin, h.nights, +1);
		}
	}
}

export function getHold(id: string): Hold | undefined {
	expireHolds();
	return holds.get(id);
}

/** RPC: book.confirm_booking 相当 */
export function confirmBooking(
	holdId: string,
	guest: GuestInfo,
	pointsUsed: number,
	memberId?: string,
	paymentChoice: 'onsite' | 'card' | 'paypay' = 'onsite'
): Booking | { error: string } {
	const hold = getHold(holdId);
	if (!hold || hold.status !== 'active') return { error: 'hold_expired' };
	const plan = ratePlans.find((p) => p.id === hold.planId)!;

	// 支払い方法のバリデーション（プランの決済設定に従う）
	const isPrepay = paymentChoice !== 'onsite';
	if (isPrepay && (!plan.payment.prepay || !plan.payment.prepayMethods.includes(paymentChoice))) {
		return { error: 'payment_not_allowed' };
	}
	if (!isPrepay && !plan.payment.onsite) return { error: 'payment_not_allowed' };

	// 事前決済（即時決済）割引: total は割引適用後の最終額
	const discountRate = isPrepay ? Math.min(plan.payment.prepayDiscountRate, PREPAY_DISCOUNT_MAX) : 0;
	const discountAmount = Math.round(hold.quote.total * discountRate);
	const finalTotal = hold.quote.total - discountAmount;

	const member = memberId ? members.find((m) => m.id === memberId) : undefined;
	const usable = member ? Math.min(pointsUsed, pointBalance(member.id), finalTotal) : 0;
	const rank = memberRanks.find((r) => r.code === (member?.rank ?? 'standard'))!;
	const code = `YB-2026-${String(++seq).padStart(6, '0')}`;
	const booking: Booking = {
		code,
		facilityId: hold.facilityId,
		roomTypeId: hold.roomTypeId,
		planId: hold.planId,
		checkin: hold.checkin,
		nights: hold.nights,
		adults: hold.adults,
		children: hold.children,
		guest,
		total: finalTotal,
		pointsUsed: usable,
		pointsEarned: member ? earnedPoints(finalTotal, rank.rewardRate) : 0,
		payment: paymentChoice,
		// 事前決済は予約時の即時決済（宿泊後請求ではない）
		paymentStatus: isPrepay ? 'paid' : 'unpaid',
		prepayDiscountRate: discountRate > 0 ? discountRate : undefined,
		discountAmount: discountAmount > 0 ? discountAmount : undefined,
		status: 'reserved',
		channel: 'autumn_booking',
		cancellationPolicy: plan.cancellationPolicy,
		memberId: member?.id,
		createdAt: today()
	};
	hold.status = 'converted';
	bookings.set(code, booking);
	if (member) {
		if (usable > 0) pointLedger.push({ id: nextId('pt'), memberId: member.id, delta: -usable, reason: `ご予約での利用（${code}）`, bookingCode: code, createdAt: today() });
		if (booking.pointsEarned > 0) pointLedger.push({ id: nextId('pt'), memberId: member.id, delta: booking.pointsEarned, reason: `宿泊ポイント（${code}）`, bookingCode: code, expiresAt: addDays(booking.checkin, 365), createdAt: today() });
	}
	return booking;
}

/** RPC: book.cancel_booking 相当 */
export function cancelBooking(code: string, opts: { waiveFee?: boolean; actor?: string; reason?: string } = {}): Booking | { error: string } {
	const b = bookings.get(code);
	if (!b || b.status !== 'reserved') return { error: 'not_cancellable' };
	const fee = opts.waiveFee ? 0 : cancellationFee(b.cancellationPolicy, b.checkin, today(), b.total);
	b.status = 'cancelled';
	b.cancelFee = fee;
	if (b.payment !== 'onsite' && b.paymentStatus === 'paid') {
		b.paymentStatus = fee === 0 ? 'refunded' : 'partial_refund';
	}
	adjustInventory(b.roomTypeId, b.checkin, b.nights, +1);
	if (b.memberId) {
		if (b.pointsUsed > 0) pointLedger.push({ id: nextId('pt'), memberId: b.memberId, delta: b.pointsUsed, reason: `キャンセルに伴う返還（${code}）`, bookingCode: code, createdAt: today() });
		if (b.pointsEarned > 0) pointLedger.push({ id: nextId('pt'), memberId: b.memberId, delta: -b.pointsEarned, reason: `キャンセルに伴う付与取消（${code}）`, bookingCode: code, createdAt: today() });
	}
	if (opts.actor) {
		auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor: opts.actor, action: 'cancel_booking', detail: `${code} fee=${fee} reason=${opts.reason ?? ''}` });
	}
	return b;
}

// ---------------------------------------------------------------- 会員・ポイント

export function pointBalance(memberId: string): number {
	return pointLedger.filter((p) => p.memberId === memberId).reduce((s, p) => s + p.delta, 0);
}

export function expiringPoints(memberId: string, withinDays = 30): number {
	const limit = addDays(today(), withinDays);
	return pointLedger
		.filter((p) => p.memberId === memberId && p.delta > 0 && p.expiresAt && p.expiresAt <= limit)
		.reduce((s, p) => s + p.delta, 0);
}

export function myReservations(memberId: string): Booking[] {
	return [...bookings.values()]
		.filter((b) => b.memberId === memberId)
		.sort((a, b) => b.checkin.localeCompare(a.checkin));
}

export function registerMember(input: { email: string; password: string; name: string; kana: string; phone: string; mailOptIn: boolean }): Member | { error: string } {
	if (members.some((m) => m.email === input.email)) return { error: 'email_exists' };
	const m: Member = {
		id: nextId('m'),
		memberCode: `YM-${String(++seq).padStart(6, '0')}`,
		rank: 'standard',
		joinedAt: today(),
		...input
	};
	members.push(m);
	pointLedger.push({ id: nextId('pt'), memberId: m.id, delta: 500, reason: '入会ボーナス', expiresAt: addDays(today(), 365), createdAt: today() });
	return m;
}

export function adjustPoints(memberId: string, delta: number, reason: string, actor: string) {
	pointLedger.push({ id: nextId('pt'), memberId, delta, reason: `【手動調整】${reason}`, createdAt: today() });
	auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor, action: 'adjust_points', detail: `${memberId} ${delta > 0 ? '+' : ''}${delta} ${reason}` });
}

export function countSegment(segment: MailCampaign['segment']): number {
	// デモ：会員1名 + 架空のベース数
	const base = 310;
	const rankFactor = segment.ranks.length === 0 ? 1 : segment.ranks.length / 3;
	return Math.round(base * rankFactor) + members.filter((m) => m.mailOptIn && (segment.ranks.length === 0 || segment.ranks.includes(m.rank))).length;
}

// ---------------------------------------------------------------- 参照ヘルパ（ロケール未指定＝ja 生データを返す内部用）

export const facilityBySlug = (brand: string, slug: string) => facilities.find((f) => f.brandSlug === brand && f.slug === slug && f.isPublished);
export const facilityById = (id: string) => facilities.find((f) => f.id === id);
export const roomTypeById = (id: string) => roomTypes.find((r) => r.id === id);
export const planById = (id: string) => ratePlans.find((p) => p.id === id);
export const memberById = (id: string) => members.find((m) => m.id === id);

// ---------------------------------------------------------------- コンテンツ翻訳（§2.2〜§2.4）

/** entity キーを組み立てるユーティリティ */
function translationKey(entityType: ContentTranslation['entityType'], entityId: string) {
	return `${entityType}:${entityId}`;
}

/**
 * 翻訳データストア（メモリ）。
 * 構造: entityType:entityId → locale → fields
 * en / zh-TW のみ保持（ja は常に base）
 */
export const translationStore = new Map<string, Map<Locale, ContentTranslation>>();

/** 翻訳を登録する内部ヘルパ */
function registerTranslation(
	entityType: ContentTranslation['entityType'],
	entityId: string,
	locale: 'en' | 'zh-TW',
	fields: Record<string, unknown>,
	isPublished = true
) {
	const key = translationKey(entityType, entityId);
	if (!translationStore.has(key)) translationStore.set(key, new Map());
	translationStore.get(key)!.set(locale, { entityType, entityId, locale, fields, isPublished });
}

/**
 * §2.2 フォールバック規約でマージして返す。
 * - ja ロケール／未公開翻訳は base をそのまま返す
 * - 欠落フィールド（undefined / 空文字）は ja 原文を維持
 * - amenities / access 等の配列・オブジェクトは丸ごと置換
 */
export function applyTranslation<T>(
	base: T,
	entityType: ContentTranslation['entityType'],
	entityId: string,
	locale: Locale
): T {
	if (locale === 'ja') return base;
	const key = translationKey(entityType, entityId);
	const translation = translationStore.get(key)?.get(locale);
	if (!translation || !translation.isPublished) return base;

	const merged = { ...(base as object) } as Record<string, unknown>;
	for (const [field, value] of Object.entries(translation.fields)) {
		// 空文字は欠落扱い → ja フォールバック
		if (value === '' || value === null || value === undefined) continue;
		merged[field] = value;
	}
	return merged as T;
}

// ---------------------------------------------------------------- 翻訳対応の公開取得関数

/** ロケール付き施設取得（§2.2 マージ済み） */
export function getFacilityBySlug(brand: string, slug: string, locale: Locale): Facility | undefined {
	const f = facilityBySlug(brand, slug);
	if (!f) return undefined;
	return applyTranslation(f, 'facility', f.id, locale);
}

/** ロケール付き施設取得 by id */
export function getFacilityById(id: string, locale: Locale): Facility | undefined {
	const f = facilityById(id);
	if (!f) return undefined;
	return applyTranslation(f, 'facility', f.id, locale);
}

/** ロケール付き部屋タイプ一覧 */
export function getRoomTypes(facilityId: string, locale: Locale): RoomType[] {
	return roomTypes
		.filter((r) => r.facilityId === facilityId)
		.map((r) => applyTranslation(r, 'room_type', r.id, locale));
}

/** ロケール付きプラン一覧 */
export function getRatePlans(facilityId: string, locale: Locale): RatePlan[] {
	return ratePlans
		.filter((p) => p.facilityId === facilityId && p.isPublished)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((p) => applyTranslation(p, 'plan', p.id, locale));
}

/** ロケール付き FAQ 一覧 */
export function getFaqs(facilityId: string, locale: Locale): Faq[] {
	return faqs
		.filter((q) => q.facilityId === facilityId && q.isPublished)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((q) => applyTranslation(q, 'faq', q.id, locale));
}

/** ロケール付き施設一覧（公開済み） */
/** 下層コンテンツページ取得（locale オーバーレイ適用） */
export function getSitePage(facilityId: string, slug: string, locale: Locale): SitePage | undefined {
	const p = sitePages.find((s) => s.facilityId === facilityId && s.slug === slug && s.isPublished);
	if (!p) return undefined;
	return applyTranslation(p, 'site_page', p.id, locale);
}

export function listSitePages(facilityId: string, locale: Locale): SitePage[] {
	return sitePages
		.filter((s) => s.facilityId === facilityId && s.isPublished)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((p) => applyTranslation(p, 'site_page', p.id, locale));
}

/** お知らせ一覧（公開のみ・新しい順・locale オーバーレイ適用） */
export function getNews(facilityId: string, locale: Locale, limit?: number): NewsPost[] {
	const list = newsPosts
		.filter((n) => n.facilityId === facilityId && n.isPublished)
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
		.map((n) => applyTranslation(n, 'news', n.id, locale));
	return limit ? list.slice(0, limit) : list;
}

export function getNewsPost(id: string, locale: Locale): NewsPost | undefined {
	const n = newsPosts.find((p) => p.id === id && p.isPublished);
	if (!n) return undefined;
	return applyTranslation(n, 'news', n.id, locale);
}

/** 管理画面用: 下書き含む全件 */
export function listNewsAdmin(facilityId: string): NewsPost[] {
	return newsPosts
		.filter((n) => n.facilityId === facilityId)
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function addNews(input: Omit<NewsPost, 'id' | 'createdAt'>): NewsPost {
	const post: NewsPost = { ...input, id: nextId('n'), createdAt: new Date().toISOString().slice(0, 10) };
	newsPosts.push(post);
	return post;
}

export function getPublishedFacilities(locale: Locale): Facility[] {
	return facilities
		.filter((f) => f.isPublished)
		.map((f) => applyTranslation(f, 'facility', f.id, locale));
}

// ---------------------------------------------------------------- 法務ページ（翻訳対応）

const legalPages: Record<string, { title: string; body: string }> = {
	tokushoho: {
		title: '特定商取引法に基づく表記',
		body: '## 販売事業者\n\n株式会社山人\n\n## 所在地\n\n岩手県和賀郡西和賀町湯川52-71-10\n\n## 連絡先\n\n0197-82-2222 ／ info@yamado.co.jp\n\n（正式な文面は公開前に確定します）'
	},
	privacy: {
		title: 'プライバシーポリシー',
		body: '## 個人情報の取り扱いについて\n\n当社は、ご予約・会員登録を通じてお預かりした個人情報を、宿泊サービスの提供およびご案内の目的にのみ利用します。\n\n（正式な文面は公開前に確定します）'
	},
	yakkan: {
		title: '宿泊約款',
		body: '## 宿泊約款\n\n旅館業法および国際観光ホテル整備法に基づくモデル宿泊約款に準拠します。\n\n（正式な文面は公開前に確定します）'
	}
};

export function getLegalPage(slug: string, locale: Locale): { title: string; body: string } | undefined {
	const page = legalPages[slug];
	if (!page) return undefined;
	return applyTranslation(page, 'legal', slug, locale);
}

// ---------------------------------------------------------------- 管理画面用 upsert

/** 管理画面から翻訳を保存する（Supabase 接続時は content_translations upsert に差し替え） */
export function upsertTranslation(
	entityType: ContentTranslation['entityType'],
	entityId: string,
	locale: 'en' | 'zh-TW',
	fields: Record<string, unknown>,
	isPublished: boolean
): void {
	registerTranslation(entityType, entityId, locale, fields, isPublished);
}

// ---------------------------------------------------------------- デモ翻訳データ投入

// === 施設: nishiwaga ===
registerTranslation('facility', 'f-nishiwaga', 'en', {
	catchCopy: 'Immerse yourself in the changing seasons at this mountain valley hot spring inn.',
	description:
		'Nestled in the snowy highlands of Nishiwaga, Iwate, this intimate 10-room inn is surrounded by the bounty of the mountains. Enjoy naturally flowing hot spring baths and mountain cuisine crafted entirely from local ingredients, as you settle into peaceful, unhurried time.',
	addressPublic: '52-71-10 Yugawa, Nishiwaga-cho, Waga-gun, Iwate',
	amenities: [
		'Naturally flowing hot springs',
		'Private bath',
		'Free Wi-Fi',
		'Complimentary shuttle',
		'Free parking',
		'Non-smoking throughout'
	],
	access: {
		car: [{ from: 'Akita Expwy Yuda IC', route: 'via National Route 107', minutes: 10 }],
		train: [{ from: 'JR Hottoyuda Station', via: 'Shuttle (reservation required)', minutes: 10 }],
		air: [{ from: 'Iwate Hanamaki Airport', minutes: 90 }],
		shuttle: { available: true, note: 'Free shuttle from Hottoyuda Station — reserve by the day before' },
		parking: { available: true, capacity: 20, fee: 'Free' }
	}
});

registerTranslation('facility', 'f-nishiwaga', 'zh-TW', {
	catchCopy: '在山間溫泉旅宿，獨享流轉的四季風情。',
	description:
		'位於岩手縣西和賀，豐沛的雪水與山珍環繞的小型溫泉旅宿，共10間客房。為您準備了源泉放流式溫泉，以及只使用在地食材精心料理的山人懷石，靜靜等待您的到來。',
	addressPublic: '岩手縣和賀郡西和賀町湯川52-71-10',
	amenities: [
		'源泉放流式溫泉',
		'包租浴池',
		'免費Wi-Fi',
		'免費接送',
		'免費停車場',
		'全館禁煙'
	],
	access: {
		car: [{ from: '秋田道 湯田IC', route: '經由國道107號', minutes: 10 }],
		train: [{ from: 'JR 熱湯站', via: '免費接送（需事先預約）', minutes: 10 }],
		air: [{ from: '岩手花卷機場', minutes: 90 }],
		shuttle: { available: true, note: '提供熱湯站免費接送服務，請於前一天前預約' },
		parking: { available: true, capacity: 20, fee: '免費' }
	}
});

// === 施設: oga ===
registerTranslation('facility', 'f-oga', 'en', {
	catchCopy: 'Sunsets over the Sea of Japan and the bounty of Oga, all in one panoramic view.',
	description:
		'Perched on a hilltop overlooking Unosaki Beach on the Oga Peninsula in Akita, this 8-room auberge invites you to savour the seafood of the Sea of Japan and the culinary traditions of Oga, bathed in a sweeping sunset panorama.',
	addressPublic: '62-29 Unozaki, Funakawa-ko Tajima, Oga-shi, Akita',
	amenities: [
		'Panoramic hot spring',
		'Ocean view from all rooms',
		'Free Wi-Fi',
		'Free parking',
		'Non-smoking throughout'
	],
	access: {
		car: [{ from: 'Akita Expwy Showa Oga-Hanto IC', route: 'via National Route 101', minutes: 40 }],
		train: [{ from: 'JR Oga Station', via: 'Taxi', minutes: 15 }],
		air: [{ from: 'Akita Airport', minutes: 80 }],
		shuttle: { available: false, note: '' },
		parking: { available: true, capacity: 15, fee: 'Free' }
	}
});

registerTranslation('facility', 'f-oga', 'zh-TW', {
	catchCopy: '在男鹿日本海的夕陽餘暉下，品味一桌海之饌宴。',
	description:
		'位於秋田男鹿半島鵜之崎海岸高台上的全8間客房奧貝奇酒店。在壯闊的夕陽全景中，盡情享受日本海的海鮮與男鹿的飲食文化。',
	addressPublic: '秋田縣男鹿市船川港台島字鵜之崎62-29',
	amenities: [
		'瞭望溫泉',
		'全室海景',
		'免費Wi-Fi',
		'免費停車場',
		'全館禁煙'
	],
	access: {
		car: [{ from: '秋田道 昭和男鹿半島IC', route: '經由國道101號', minutes: 40 }],
		train: [{ from: 'JR 男鹿站', via: '計程車', minutes: 15 }],
		air: [{ from: '秋田機場', minutes: 80 }],
		shuttle: { available: false, note: '' },
		parking: { available: true, capacity: 15, fee: '免費' }
	}
});

// === 部屋タイプ: 和洋室A（nishiwaga） ===
registerTranslation('room_type', 'r-nw-wayo', 'en', {
	headline: 'Japanese-Western room with a private semi-open-air hot spring bath',
	description: "The inn's most popular room, featuring a naturally flowing semi-open-air hot spring bath beyond the wide veranda.",
	amenities: ['Semi-open-air private bath', 'Twin bed + Ryukyu tatami', 'Kinshuko lake view']
});
registerTranslation('room_type', 'r-nw-wayo', 'zh-TW', {
	headline: '附設半露天溫泉的和洋室，獨享天然源泉',
	description: '設有源泉放流式半露天浴池，廣緣延伸而出，是本館最受歡迎的客房。',
	amenities: ['半露天浴池', '雙人床＋琉球榻榻米', '錦秋湖景']
});

// === 部屋タイプ: 和室（nishiwaga） ===
registerTranslation('room_type', 'r-nw-washitsu', 'en', {
	headline: 'Quiet Japanese-style room facing the beech forest',
	description: 'A traditional 10-tatami Japanese room with windows filled entirely by the primal beech forest.',
	amenities: ['10-tatami Japanese room', 'Mountain-facing', 'No private bath (large bath available)']
});
registerTranslation('room_type', 'r-nw-washitsu', 'zh-TW', {
	headline: '面向山毛櫸原生林的靜謐和室',
	description: '10疊純和室，窗外滿是山毛櫸原生林的翠綠景致。',
	amenities: ['10疊和室', '山側朝向', '無獨立衛浴（可使用大浴場）']
});

// === 部屋タイプ: オーシャンツイン（oga） ===
registerTranslation('room_type', 'r-oga-twin', 'en', {
	headline: 'Twin room with full-width windows overlooking the Sea of Japan',
	description: 'A sea-side room with floor-to-ceiling windows where you can gaze at the horizon while lying in bed.',
	amenities: ['Twin beds', 'Ocean view', 'Shower booth']
});
registerTranslation('room_type', 'r-oga-twin', 'zh-TW', {
	headline: '全面落地窗，將日本海盡收眼底的雙床客房',
	description: '躺在床上即可望見水平線的海景落地窗客房。',
	amenities: ['雙人床', '海景', '淋浴間']
});

// === 部屋タイプ: サンセットスイート（oga） ===
registerTranslation('room_type', 'r-oga-suite', 'en', {
	headline: 'Top-floor suite with an open-air bath — the best seat for the sunset',
	description: 'The top-floor suite featuring a panoramic open-air hot spring bath on the terrace.',
	amenities: ['Panoramic open-air bath', 'Terrace', 'Top floor']
});
registerTranslation('room_type', 'r-oga-suite', 'zh-TW', {
	headline: '為夕陽而生的頂層套房，附設露天溫泉',
	description: '頂層套房，露台上設有瞭望露天浴池。',
	amenities: ['瞭望露天浴池', '露台', '頂層']
});

// === プラン: 山人料理スタンダード（nishiwaga） ===
registerTranslation('plan', 'p-nw-standard', 'en', {
	headline: "Can't decide? This is it. A standard plan featuring Yamado's mountain cuisine.",
	description: `## Cuisine

A full-course **Yamado cuisine** composed daily from local mountain vegetables, river fish, and Tankaku beef.

- Dinner: Private dining room, choice of 17:30 or 19:30
- Breakfast: Freshly cooked clay-pot rice and mountain soup

## Hot Springs

The naturally flowing large bath and open-air bath are available from check-in through the next morning. A private bath (45 min) is available on the day by reservation.

## Recommended for

| Who | Why |
|---|---|
| First-time Yamado guests | The complete, all-in-one experience |
| Food lovers | Seasonal menus change throughout the year |`,
	highlightTags: ['Onsen', 'Private dining']
});
registerTranslation('plan', 'p-nw-standard', 'zh-TW', {
	headline: '初次入住的首選，盡享西和賀山珍的標準方案',
	description: `## 料理

以在地山菜、溪魚及短角牛為主角，每日依當日食材精心排盤的**山人懷石料理**全套餐。

- 晚餐：獨立包廂，可選擇17:30或19:30入座
- 早餐：現炊陶鍋飯與山野蔬菜湯品

## 溫泉

源泉放流式大浴場及露天浴場，自入住至隔日早晨均可使用。包租浴池（45分鐘）當日預約制。

## 適合的旅客

| 推薦對象 | 理由 |
|---|---|
| 初次入住山人 | 全包式基本體驗 |
| 注重美食的旅客 | 菜單隨季節更換 |`,
	highlightTags: ['溫泉', '獨立包廂']
});

// === プラン: 記念日プラン（nishiwaga） ===
registerTranslation('plan', 'p-nw-anniv', 'en', {
	headline: 'Celebrate your special day at this mountain valley hot spring inn.',
	description: `## Inclusions

- Celebratory sparkling wine (half bottle)
- Anniversary cake (personalised message)
- Late check-out until 12:00

## Please Note

Please include your cake message in the notes field at the time of booking.`,
	highlightTags: ['Anniversary', 'Special gifts', 'Pre-paid by card']
});
registerTranslation('plan', 'p-nw-anniv', 'zh-TW', {
	headline: '在山間溫泉旅宿，共度珍貴的紀念時刻',
	description: `## 方案特典

- 慶祝用氣泡酒（半瓶）
- 紀念蛋糕（可客製化留言）
- 延遲退房至12:00

## 注意事項

蛋糕留言請在預約時填寫於備註欄。`,
	highlightTags: ['紀念日', '附贈特典', '信用卡預付']
});

// === プラン: 男鹿の幸スタンダード（oga） ===
registerTranslation('plan', 'p-oga-standard', 'en', {
	headline: 'Taste the seasonal catch of the Sea of Japan and the sunset — our standard plan.',
	description: `## Cuisine

A seafood course centred on the seasonal catch from Oga's harbour and the signature **Ishiyaki (stone-grilling) dish**.

## Sunset Timing

Dinner start times are arranged to align with the sunset.`,
	highlightTags: ['Ocean view', 'Stone-grilled dish']
});
registerTranslation('plan', 'p-oga-standard', 'zh-TW', {
	headline: '品嚐日本海當季鮮味與夕陽美景的標準方案',
	description: `## 料理

以男鹿港當季鮮魚及名物**石燒料理**為主角的海鮮全套餐。

## 夕陽用餐時段

晚餐開始時間將配合日落時刻安排。`,
	highlightTags: ['海景', '石燒料理']
});

// === プラン: ひとり旅プラン（oga） ===
registerTranslation('plan', 'p-oga-solo', 'en', {
	headline: 'The sunset and the sound of the sea, all to yourself — solo travellers welcome.',
	description: `## Made for Solo Travel

Counter-seat dining, a reading lounge after your bath, and a setting that makes time alone feel truly comfortable.`,
	highlightTags: ['Solo travel', 'Counter dining']
});
registerTranslation('plan', 'p-oga-solo', 'zh-TW', {
	headline: '獨享夕陽與海潮聲，歡迎一個人的旅行',
	description: `## 專為一個人的旅行而設

吧檯式晚餐座位、浴後閱讀空間……讓獨旅時光更加惬意舒適。`,
	highlightTags: ['一人旅', '吧檯座位']
});

// === FAQ: nishiwaga ===
registerTranslation('faq', 'q1', 'en', {
	category: 'Access',
	question: 'Do you offer a shuttle service?',
	answer: 'Yes, we offer a **free shuttle** from JR Hottoyuda Station (advance reservation required — by the day before). Please call us or add a note when booking.'
});
registerTranslation('faq', 'q1', 'zh-TW', {
	category: '交通',
	question: '有提供接送服務嗎？',
	answer: '提供JR熱湯站的**免費接送**服務（須於前一天前預約）。請來電或在預約備註欄告知。'
});
registerTranslation('faq', 'q2', 'en', {
	category: 'Hot Springs',
	question: 'Do you offer day-trip bathing?',
	answer: 'We apologise — our baths are reserved exclusively for overnight guests.'
});
registerTranslation('faq', 'q2', 'zh-TW', {
	category: '溫泉',
	question: '可以純泡湯嗎？',
	answer: '非常抱歉，本館溫泉僅供住宿客人使用。'
});

// === FAQ: oga ===
registerTranslation('faq', 'q3', 'en', {
	category: 'Dining',
	question: 'Can I choose my dinner time?',
	answer: 'Dinner times are arranged to coincide with the sunset. If you have a preference, please let us know at check-in.'
});
registerTranslation('faq', 'q3', 'zh-TW', {
	category: '餐飲',
	question: '可以選擇晚餐時間嗎？',
	answer: '用餐時間將配合日落時刻安排。如有特別需求，請於入住時告知我們。'
});
registerTranslation('faq', 'q4', 'en', {
	category: 'Children',
	question: 'Can I stay with children?',
	answer: 'Our direct booking site currently accepts adult-only reservations. For families with children, please **call us at 0185-47-7776**.'
});
registerTranslation('faq', 'q4', 'zh-TW', {
	category: '兒童',
	question: '可以帶小孩入住嗎？',
	answer: '本官方網站目前僅接受純大人的預約。攜帶兒童入住請**來電0185-47-7776**洽詢。'
});

// === 法務ページ ===
registerTranslation('legal', 'tokushoho', 'en', {
	title: 'Specified Commercial Transaction Act Disclosure',
	body: '## Seller\n\nYamado Co., Ltd.\n\n## Address\n\n52-71-10 Yugawa, Nishiwaga-cho, Waga-gun, Iwate, Japan\n\n## Contact\n\n+81-197-82-2222 / info@yamado.co.jp\n\n*Note: This is a reference translation. The Japanese text is legally authoritative.*\n\n(Full text to be finalised before public launch)'
});
registerTranslation('legal', 'tokushoho', 'zh-TW', {
	title: '依特定商交易法之標示',
	body: '## 販售業者\n\n山人股份有限公司\n\n## 所在地\n\n〒029-5511 岩手縣和賀郡西和賀町湯川52-71-10\n\n## 聯絡方式\n\n0197-82-2222 ／ info@yamado.co.jp\n\n*注意：本頁為參考譯文，法律效力以日文原文為準。*\n\n（正式文面於正式上線前確定）'
});
registerTranslation('legal', 'privacy', 'en', {
	title: 'Privacy Policy',
	body: '## Handling of Personal Information\n\nWe use personal information collected through reservations and membership registration solely for the purpose of providing accommodation services and related communications.\n\n*Note: This is a reference translation. The Japanese text is legally authoritative.*\n\n(Full text to be finalised before public launch)'
});
registerTranslation('legal', 'privacy', 'zh-TW', {
	title: '個人資料保護政策',
	body: '## 關於個人資料之處理\n\n我們將透過預約及會員登錄取得的個人資料，僅用於提供住宿服務及相關通知之目的。\n\n*注意：本頁為參考譯文，法律效力以日文原文為準。*\n\n（正式文面於正式上線前確定）'
});
registerTranslation('legal', 'yakkan', 'en', {
	title: 'Terms and Conditions of Stay',
	body: '## Terms and Conditions of Stay\n\nBased on the model lodging terms and conditions established under the Hotel Business Act and the International Tourism Hotel Development Act.\n\n*Note: This is a reference translation. The Japanese text is legally authoritative.*\n\n(Full text to be finalised before public launch)'
});
registerTranslation('legal', 'yakkan', 'zh-TW', {
	title: '住宿契約條款',
	body: '## 住宿約款\n\n依據旅館業法及國際觀光旅館整備法之模範住宿約款規定辦理。\n\n*注意：本頁為參考譯文，法律效力以日文原文為準。*\n\n（正式文面於正式上線前確定）'
});

// ================================================================ コミュニティ掲示板（demo・設計書 §3-4 / §9）
// 将来 book.forum_* テーブル + RPC（設計書 §5）へ差し替える境界。関数シグネチャは §4 に対応。
// 表示は常にニックネームのみ。実名・メール・userId は ForumPostView / ForumThreadListItem に一切含めない。

export const forumProfiles: ForumProfile[] = [
	{ userId: 'm-demo', nickname: 'たろう', role: 'member', isBanned: false, createdAt: addDays(today(), -40) },
	{ userId: 'staff-demo', nickname: 'やまびと事務局', role: 'staff', isBanned: false, createdAt: addDays(today(), -60) },
	{ userId: 'admin-demo', nickname: '山人支配人', role: 'admin', isBanned: false, createdAt: addDays(today(), -60) },
	{ userId: 'm-yuki', nickname: 'ゆきぐに', role: 'member', isBanned: false, createdAt: addDays(today(), -30) },
	{ userId: 'm-umikaze', nickname: 'うみかぜ', role: 'member', isBanned: false, createdAt: addDays(today(), -25) }
];

export const forumBoards: ForumBoard[] = [
	{ id: 'fb-announce', slug: 'announce', title: '運営からのお知らせ', description: '山人からの告知・新着情報はこちら', sortOrder: 0, isArchived: false, createdAt: addDays(today(), -60) },
	{ id: 'fb-travel', slug: 'travel', title: '旅のはなし', description: '滞在の思い出、季節の見どころ、よもやま話', sortOrder: 1, isArchived: false, createdAt: addDays(today(), -60) },
	{ id: 'fb-qa', slug: 'qa', title: '質問・相談', description: 'ご宿泊前の疑問やわからないこと、何でもどうぞ', sortOrder: 2, isArchived: false, createdAt: addDays(today(), -60) }
];

export const forumThreads: ForumThread[] = [];
export const forumPosts: ForumPost[] = [];

// ---- バリデーション規則（設計書 §4） ----
const NICK_MIN = 2;
const NICK_MAX = 20;
const TITLE_MIN = 1;
const TITLE_MAX = 80;
const BODY_MIN = 1;
const BODY_MAX = 4000;

function validNickname(nickname: string): string | null {
	const t = nickname.trim();
	if ([...t].length < NICK_MIN || [...t].length > NICK_MAX) return null;
	return t;
}

function nicknameTaken(nickname: string, exceptUserId?: string): boolean {
	const norm = nickname.trim().toLowerCase();
	return forumProfiles.some((p) => p.userId !== exceptUserId && p.nickname.trim().toLowerCase() === norm);
}

function profileOf(userId: string): ForumProfile | undefined {
	return forumProfiles.find((p) => p.userId === userId);
}

// ---- シード投入（thread + post を相対日付で生成） ----
let forumSeq = 0;
const nextForumId = (p: string) => `${p}-${++forumSeq}`;

/** 1スレッド分のシードを投入するヘルパ。posts は [authorUserId, body, daysAgo] の配列 */
function seedThread(
	boardId: string,
	authorUserId: string,
	title: string,
	opts: { pinned?: boolean; locked?: boolean },
	posts: [string, string, number][]
) {
	const threadId = nextForumId('ft');
	const firstDaysAgo = posts[0][2];
	const lastDaysAgo = posts[posts.length - 1][2];
	let postNo = 0;
	for (const [author, body, daysAgo] of posts) {
		postNo += 1;
		forumPosts.push({
			id: nextForumId('fp'),
			threadId,
			authorUserId: author,
			postNo,
			body,
			replyToNo: extractReplyTo(body),
			isDeleted: false,
			createdAt: addDays(today(), -daysAgo)
		});
	}
	forumThreads.push({
		id: threadId,
		boardId,
		authorUserId,
		title,
		isPinned: !!opts.pinned,
		isLocked: !!opts.locked,
		isDeleted: false,
		replyCount: posts.length,
		lastPostedAt: addDays(today(), -lastDaysAgo),
		createdAt: addDays(today(), -firstDaysAgo)
	});
}

// 1. announce: 開設のお知らせ（pinned）
seedThread('fb-announce', 'staff-demo', 'コミュニティ掲示板を開設しました', { pinned: true }, [
	['staff-demo', 'みなさまこんにちは。山人のコミュニティ掲示板を開設しました。\nこちらはニックネームでご参加いただける場です。どなたでも閲覧でき、書き込みは会員（登録無料）のみとなります。\n宿のことでも旅のことでも、どうぞ気軽にお声がけください。', 14],
	['m-demo', 'こういう場所が欲しかったです。よろしくお願いします！', 13],
	['staff-demo', '>>2 ありがとうございます。のんびり育てていきます。', 13]
]);

// 2. travel: 雪見露天（ゆきぐに）
seedThread('fb-travel', 'm-yuki', '雪見露天、忘れられません', {}, [
	['m-yuki', '冬に西和賀の雪見露天に入りました。しんしんと降る雪の中、源泉かけ流しのお湯に浸かる時間は本当に格別でした。', 10],
	['m-umikaze', '写真はないんですか？いいなあ。', 9],
	['staff-demo', '>>1 嬉しいです。今年は雪が多く、12月から見頃でした。紅葉の露天もおすすめですよ。', 8],
	['m-yuki', '紅葉の時期にまた伺います。', 7]
]);

// 3. travel: 男鹿の夕陽スポット（たろう）
seedThread('fb-travel', 'm-demo', '男鹿の夕陽スポットを教えてください', {}, [
	['m-demo', '来月、男鹿に泊まる予定です。夕陽がきれいに見える場所があれば教えてください。', 5],
	['m-umikaze', '鵜ノ崎海岸の干潮時がおすすめです。「秋田のウユニ塩湖」とも呼ばれていますよ。', 4],
	['staff-demo', 'お部屋からも海に沈む夕陽をご覧いただけます。日没時刻はフロントでもご案内していますので、お気軽にお尋ねください。', 4]
]);

// 4. qa: 子ども連れ（うみかぜ）
seedThread('fb-qa', 'm-umikaze', '子ども連れでも大丈夫ですか？', {}, [
	['m-umikaze', '小さい子ども（3歳）を連れての宿泊を考えています。大丈夫でしょうか？', 3],
	['staff-demo', 'お子様連れのご宿泊も承っております。添い寝のご対応、お子様用の浴衣、お食事のご相談（取り分け・アレルギー対応等）も可能です。ご予約時にお気軽にご相談ください。', 2]
]);

// 5. announce: 受付終了の告知（locked）
seedThread('fb-announce', 'staff-demo', '【受付終了】春の感謝企画', { locked: true }, [
	['staff-demo', 'たくさんのお申し込みをありがとうございました。春の感謝企画は受付を終了しました。またの機会をお楽しみに。', 6]
]);

// ---------------------------------------------------------------- forum: 参照ヘルパ

function forumDisplay(profile: ForumProfile | undefined): { nickname: string | null; isStaff: boolean } {
	if (!profile) return { nickname: null, isStaff: false };
	return { nickname: profile.nickname, isStaff: profile.role === 'staff' || profile.role === 'admin' };
}

// ---------------------------------------------------------------- forum: 読み取り（RPC 相当）

/** RPC: book.forum_set_nickname の参照部 */
export function getForumProfile(userId: string): ForumProfile | undefined {
	return profileOf(userId);
}

/** RPC: book.forum_list_boards 相当。isArchived 含む・sortOrder 順 */
export function listForumBoards(): (ForumBoard & { threadCount: number; lastPostedAt: string | null })[] {
	return [...forumBoards]
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((board) => {
			const threads = forumThreads.filter((t) => t.boardId === board.id && !t.isDeleted);
			const lastPostedAt = threads.length ? threads.map((t) => t.lastPostedAt).sort().at(-1)! : null;
			return { ...board, threadCount: threads.length, lastPostedAt };
		});
}

export function getForumBoard(slug: string): ForumBoard | undefined {
	return forumBoards.find((b) => b.slug === slug);
}

/** RPC: book.forum_list_threads 相当。is_deleted 除外・pinned desc → last_posted_at desc */
export function listForumThreads(boardId: string, page = 1, perPage = 20): { threads: ForumThreadListItem[]; total: number } {
	const all = forumThreads
		.filter((t) => t.boardId === boardId && !t.isDeleted)
		.sort((a, b) => {
			if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
			return b.lastPostedAt.localeCompare(a.lastPostedAt);
		});
	const total = all.length;
	const start = (page - 1) * perPage;
	const threads = all.slice(start, start + perPage).map((t) => {
		const { nickname, isStaff } = forumDisplay(profileOf(t.authorUserId));
		return {
			id: t.id,
			title: t.title,
			isPinned: t.isPinned,
			isLocked: t.isLocked,
			replyCount: t.replyCount,
			lastPostedAt: t.lastPostedAt,
			createdAt: t.createdAt,
			authorNickname: nickname ?? '（退会した利用者）',
			authorIsStaff: isStaff
		};
	});
	return { threads, total };
}

/** RPC: book.forum_get_thread 相当。is_deleted なら undefined */
export function getForumThread(id: string): (ForumThread & { boardSlug: string; boardTitle: string }) | undefined {
	const t = forumThreads.find((th) => th.id === id && !th.isDeleted);
	if (!t) return undefined;
	const board = forumBoards.find((b) => b.id === t.boardId)!;
	return { ...t, boardSlug: board.slug, boardTitle: board.title };
}

/** RPC: book.forum_list_posts 相当。post_no 昇順・削除済みもプレースホルダ行で返す。author_user_id は返さない */
export function listForumPosts(threadId: string, viewerUserId?: string): ForumPostView[] {
	return forumPosts
		.filter((p) => p.threadId === threadId)
		.sort((a, b) => a.postNo - b.postNo)
		.map((p) => {
			if (p.isDeleted) {
				return { id: p.id, postNo: p.postNo, body: '', replyToNo: null, createdAt: p.createdAt, isDeleted: true, nickname: null, avatarUrl: null, isStaff: false, isOwn: false };
			}
			const { nickname, isStaff } = forumDisplay(profileOf(p.authorUserId));
			return {
				id: p.id,
				postNo: p.postNo,
				body: p.body,
				replyToNo: p.replyToNo,
				createdAt: p.createdAt,
				isDeleted: false,
				nickname,
				avatarUrl: avatarByMember.get(p.authorUserId) ?? null,
				isStaff,
				isOwn: !!viewerUserId && viewerUserId === p.authorUserId
			};
		});
}

// ---------------------------------------------------------------- forum: 書き込み（RPC 相当）

/** RPC: book.forum_set_nickname 相当。既存があれば nickname のみ更新・なければ lazy 作成 */
export function setForumNickname(userId: string, nickname: string, role: ForumProfile['role']): ForumProfile | { error: 'taken' | 'invalid' } {
	const valid = validNickname(nickname);
	if (!valid) return { error: 'invalid' };
	if (nicknameTaken(valid, userId)) return { error: 'taken' };
	const existing = profileOf(userId);
	if (existing) {
		existing.nickname = valid;
		dbg('forum_set_nickname update', userId, valid);
		return existing;
	}
	const profile: ForumProfile = { userId, nickname: valid, role, isBanned: false, createdAt: today() };
	forumProfiles.push(profile);
	dbg('forum_set_nickname create', userId, valid, role);
	return profile;
}

/** RPC: book.forum_create_thread 相当。thread + post_no=1 を同時作成 */
export function createForumThread(userId: string, boardId: string, title: string, body: string): { thread: ForumThread } | { error: 'banned' | 'no_nickname' | 'invalid' | 'archived' } {
	const profile = profileOf(userId);
	if (!profile) return { error: 'no_nickname' };
	if (profile.isBanned) return { error: 'banned' };
	const board = forumBoards.find((b) => b.id === boardId);
	if (!board) return { error: 'invalid' };
	if (board.isArchived) return { error: 'archived' };
	const t = title.trim();
	const b = body.trim();
	if ([...t].length < TITLE_MIN || [...t].length > TITLE_MAX) return { error: 'invalid' };
	if ([...b].length < BODY_MIN || [...b].length > BODY_MAX) return { error: 'invalid' };
	const now = new Date().toISOString();
	const thread: ForumThread = {
		id: nextForumId('ft'),
		boardId,
		authorUserId: userId,
		title: t,
		isPinned: false,
		isLocked: false,
		isDeleted: false,
		replyCount: 1,
		lastPostedAt: now,
		createdAt: now
	};
	forumThreads.push(thread);
	forumPosts.push({
		id: nextForumId('fp'),
		threadId: thread.id,
		authorUserId: userId,
		postNo: 1,
		body: b,
		replyToNo: extractReplyTo(b),
		isDeleted: false,
		createdAt: now
	});
	dbg('forum_create_thread', userId, board.slug, thread.id, JSON.stringify(t));
	return { thread };
}

/** RPC: book.forum_create_post 相当。post_no = max+1・replyCount++・lastPostedAt 更新 */
export function createForumPost(userId: string, threadId: string, body: string): { post: ForumPost } | { error: 'banned' | 'no_nickname' | 'locked' | 'invalid' | 'not_found' } {
	const profile = profileOf(userId);
	if (!profile) return { error: 'no_nickname' };
	if (profile.isBanned) return { error: 'banned' };
	const thread = forumThreads.find((t) => t.id === threadId && !t.isDeleted);
	if (!thread) return { error: 'not_found' };
	if (thread.isLocked) return { error: 'locked' };
	const b = body.trim();
	if ([...b].length < BODY_MIN || [...b].length > BODY_MAX) return { error: 'invalid' };
	const maxNo = forumPosts.filter((p) => p.threadId === threadId).reduce((mx, p) => Math.max(mx, p.postNo), 0);
	const now = new Date().toISOString();
	const post: ForumPost = {
		id: nextForumId('fp'),
		threadId,
		authorUserId: userId,
		postNo: maxNo + 1,
		body: b,
		replyToNo: extractReplyTo(b),
		isDeleted: false,
		createdAt: now
	};
	forumPosts.push(post);
	thread.replyCount += 1;
	thread.lastPostedAt = now;
	dbg('forum_create_post', userId, threadId, `#${post.postNo}`);
	return { post };
}

/** RPC: book.forum_delete_own_post / forum_delete_post 相当。soft delete。byStaff は監査ログ */
export function deleteForumPost(postId: string, actorUserId: string, byStaff: boolean): true | { error: 'forbidden' | 'not_found' } {
	const post = forumPosts.find((p) => p.id === postId);
	if (!post || post.isDeleted) return { error: 'not_found' };
	if (!byStaff && post.authorUserId !== actorUserId) return { error: 'forbidden' };
	const wasVisible = !post.isDeleted;
	post.isDeleted = true;
	if (wasVisible) {
		const thread = forumThreads.find((t) => t.id === post.threadId);
		if (thread && thread.replyCount > 0) thread.replyCount -= 1;
	}
	if (byStaff) {
		auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor: actorUserId, action: 'forum_delete_post', detail: `post=${postId} thread=${post.threadId} #${post.postNo}` });
	}
	dbg('forum_delete_post', actorUserId, postId, byStaff ? '(staff)' : '(own)');
	return true;
}

/** RPC: book.forum_moderate_thread 相当。pin / lock / 削除。監査ログ */
export function moderateForumThread(threadId: string, patch: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean }, actor: string): void {
	const thread = forumThreads.find((t) => t.id === threadId);
	if (!thread) return;
	if (patch.isPinned !== undefined) thread.isPinned = patch.isPinned;
	if (patch.isLocked !== undefined) thread.isLocked = patch.isLocked;
	if (patch.isDeleted !== undefined) thread.isDeleted = patch.isDeleted;
	auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor, action: 'forum_moderate_thread', detail: `thread=${threadId} ${JSON.stringify(patch)}` });
	dbg('forum_moderate_thread', actor, threadId, JSON.stringify(patch));
}

/** RPC: book.forum_set_ban 相当。監査ログ */
export function setForumBan(userId: string, banned: boolean, actor: string): void {
	const profile = profileOf(userId);
	if (!profile) return;
	profile.isBanned = banned;
	auditLogs.unshift({ id: nextId('al'), at: new Date().toISOString(), actor, action: 'forum_set_ban', detail: `user=${userId} banned=${banned}` });
	dbg('forum_set_ban', actor, userId, String(banned));
}

/** RPC: book.forum_upsert_board 相当（admin のみ）。slug 重複は error */
export function upsertForumBoard(input: { id?: string; slug: string; title: string; description: string; sortOrder: number; isArchived: boolean }): ForumBoard | { error: 'slug_taken' } {
	const slug = input.slug.trim();
	const clash = forumBoards.find((b) => b.slug === slug && b.id !== input.id);
	if (clash) return { error: 'slug_taken' };
	if (input.id) {
		const board = forumBoards.find((b) => b.id === input.id);
		if (board) {
			board.slug = slug;
			board.title = input.title.trim();
			board.description = input.description.trim();
			board.sortOrder = input.sortOrder;
			board.isArchived = input.isArchived;
			dbg('forum_upsert_board update', board.id, slug);
			return board;
		}
	}
	const board: ForumBoard = {
		id: nextForumId('fb'),
		slug,
		title: input.title.trim(),
		description: input.description.trim(),
		sortOrder: input.sortOrder,
		isArchived: input.isArchived,
		createdAt: today()
	};
	forumBoards.push(board);
	dbg('forum_upsert_board create', board.id, slug);
	return board;
}

/** 管理画面用: 全プロフィール一覧（ban 管理）。実名・メールは返さない（nickname のみ） */
export function listForumProfiles(): ForumProfile[] {
	return [...forumProfiles].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 管理画面用: 板内の全スレ（is_deleted 含む・モデレーション用） */
export function listForumThreadsAdmin(boardId: string): ForumThread[] {
	return forumThreads
		.filter((t) => t.boardId === boardId)
		.sort((a, b) => {
			if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
			return b.lastPostedAt.localeCompare(a.lastPostedAt);
		});
}

// ================================================================ おたよりポイント（demo・設計書 §3-4 / §11）
// 将来 book.otayori_*（otayori_posts / otayori_ledger）テーブル + RPC（設計書 §5）へ差し替える境界。
// 関数シグネチャは §4 に対応。通常ポイント（pointLedger・1pt=1円）とは別建て（1pt = OTAYORI_POINT_YEN 円）。
// 残高は SUM(delta) で算出（無期限・expires_at を持たない）。

export const otayoriLedger: OtayoriEntry[] = [];
export const otayoriPosts: OtayoriPost[] = [];

// ---- バリデーション規則（設計書 §4） ----
const OTAYORI_BODY_MIN = 1;
const OTAYORI_BODY_MAX = 2000;
const OTAYORI_RADIO_MAX = 40;
const OTAYORI_PENDING_MAX = 5; // 未審査（pending）は会員あたり5件まで

let otayoriSeq = 0;
const nextOtayoriId = (p: string) => `${p}-${++otayoriSeq}`;

// ---- デモシード（設計書 §11）：m-demo（たろう）の投稿3件 + 台帳で残高3pt ----
function seedOtayori() {
	// ① 承認済（台帳 +1 の起点）
	const approved: OtayoriPost = {
		id: nextOtayoriId('op'),
		memberId: 'm-demo',
		body: '番組をいつも楽しく拝見しています。先日、雪見の露天風呂に入りながら聞いた川のせせらぎが忘れられません。次は紅葉の季節にお邪魔したいです。',
		radioName: 'ゆきみ',
		status: 'approved',
		createdAt: addDays(today(), -12),
		reviewedAt: addDays(today(), -10)
	};
	// ② 申請中（承認ボタンの確認用）
	const pending: OtayoriPost = {
		id: nextOtayoriId('op'),
		memberId: 'm-demo',
		body: '男鹿のお宿で見た日本海に沈む夕陽が本当にきれいでした。スタッフの方に教えていただいた鵜ノ崎海岸にも行ってみたいです。質問なのですが、冬の男鹿はどんな景色になりますか？',
		radioName: 'うみねこ',
		status: 'pending',
		createdAt: addDays(today(), -2)
	};
	// ③ 見送り（却下：理由付き）
	const rejected: OtayoriPost = {
		id: nextOtayoriId('op'),
		memberId: 'm-demo',
		body: 'いつも応援しています！これからも頑張ってください。',
		status: 'rejected',
		reviewNote: '番組での採用は見送らせていただきました（内容が短いため）。',
		createdAt: addDays(today(), -5),
		reviewedAt: addDays(today(), -4)
	};
	otayoriPosts.push(approved, pending, rejected);

	// 台帳：①承認起点の +1 ＋ ②手動付与 +2 → 残高 3pt（=3,000円分）
	otayoriLedger.push({
		id: nextOtayoriId('ol'),
		memberId: 'm-demo',
		delta: 1,
		reason: 'YouTubeおたより投稿',
		sourcePostId: approved.id,
		createdAt: approved.reviewedAt!
	});
	otayoriLedger.push({
		id: nextOtayoriId('ol'),
		memberId: 'm-demo',
		delta: 2,
		reason: '【手動付与】番組開始前からのご愛顧',
		createdAt: addDays(today(), -20)
	});
}
seedOtayori();

// ---------------------------------------------------------------- おたより: 読み取り（RPC 相当）

/** RPC: book.otayori_balance 相当。残高 = SUM(delta)（無期限） */
export function otayoriBalance(memberId: string): number {
	return otayoriLedger.filter((e) => e.memberId === memberId).reduce((s, e) => s + e.delta, 0);
}

/** RPC: book.otayori_my_summary 相当。残高 + 台帳履歴 + 自分の投稿一覧（いずれも新しい順） */
export function listMyOtayori(memberId: string): { balance: number; ledger: OtayoriEntry[]; posts: OtayoriPost[] } {
	return {
		balance: otayoriBalance(memberId),
		ledger: otayoriLedger.filter((e) => e.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		posts: otayoriPosts.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
	};
}

/** RPC: book.otayori_list_admin 相当。member_code / member_name を結合して返す。createdAt 降順 */
export function listOtayoriAdmin(status: 'pending' | 'approved' | 'rejected'): OtayoriAdminItem[] {
	return otayoriPosts
		.filter((p) => p.status === status)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map((p) => {
			const member = members.find((mb) => mb.id === p.memberId);
			return {
				id: p.id,
				memberId: p.memberId,
				memberCode: member?.memberCode ?? '（退会した会員）',
				memberName: member?.name ?? '—',
				radioName: p.radioName,
				body: p.body,
				status: p.status,
				createdAt: p.createdAt
			};
		});
}

// ---------------------------------------------------------------- おたより: 書き込み（RPC 相当）

/** RPC: book.otayori_submit 相当。status='pending' で登録（ポイントはまだ付与しない） */
export function otayoriSubmit(
	memberId: string,
	body: string,
	radioName?: string
): { post: OtayoriPost } | { error: 'invalid' | 'too_many_pending' } {
	const b = body.trim();
	const r = (radioName ?? '').trim();
	if ([...b].length < OTAYORI_BODY_MIN || [...b].length > OTAYORI_BODY_MAX) return { error: 'invalid' };
	if ([...r].length > OTAYORI_RADIO_MAX) return { error: 'invalid' };
	const pendingCount = otayoriPosts.filter((p) => p.memberId === memberId && p.status === 'pending').length;
	if (pendingCount >= OTAYORI_PENDING_MAX) return { error: 'too_many_pending' };
	const post: OtayoriPost = {
		id: nextOtayoriId('op'),
		memberId,
		body: b,
		radioName: r || undefined,
		status: 'pending',
		createdAt: today()
	};
	otayoriPosts.push(post);
	dbg('otayori_submit', memberId, post.id, `${[...b].length}字`);
	return { post };
}

/**
 * RPC: book.otayori_approve 相当（admin）。pending/rejected → approved。
 * otayoriLedger に +1 付与（reason='YouTubeおたより投稿'・sourcePostId 紐付け）。
 * 既に approved・または同 sourcePostId の付与済みなら冪等（再付与しない）。auditLogs 記帳。
 */
export function approveOtayori(postId: string, actor: string): OtayoriPost | { error: 'not_found' } {
	const post = otayoriPosts.find((p) => p.id === postId);
	if (!post) return { error: 'not_found' };
	const wasApproved = post.status === 'approved';
	post.status = 'approved';
	post.reviewedAt = post.reviewedAt ?? today();
	post.reviewNote = undefined;
	// sourcePostId による二重付与防止（部分 UNIQUE インデックス相当）
	const alreadyAwarded = otayoriLedger.some((e) => e.sourcePostId === postId);
	if (!alreadyAwarded) {
		otayoriLedger.push({
			id: nextOtayoriId('ol'),
			memberId: post.memberId,
			delta: 1,
			reason: 'YouTubeおたより投稿',
			sourcePostId: postId,
			createdAt: today()
		});
	}
	addAuditLog(actor, 'otayori_approve', `post=${postId} member=${post.memberId}${wasApproved || alreadyAwarded ? ' (no-op)' : ' +1pt'}`);
	dbg('otayori_approve', actor, postId, alreadyAwarded ? '(already awarded)' : '+1pt');
	return post;
}

/** RPC: book.otayori_reject 相当（staff 可）。rejected に更新（review_note 記録）。ポイント操作なし。auditLogs 記帳 */
export function rejectOtayori(postId: string, note: string, actor: string): OtayoriPost | { error: 'not_found' } {
	const post = otayoriPosts.find((p) => p.id === postId);
	if (!post) return { error: 'not_found' };
	post.status = 'rejected';
	post.reviewNote = note.trim() || undefined;
	post.reviewedAt = today();
	addAuditLog(actor, 'otayori_reject', `post=${postId} member=${post.memberId} note=${note.trim()}`);
	dbg('otayori_reject', actor, postId);
	return post;
}

/**
 * RPC: book.otayori_adjust 相当（admin）。既存保持者への手動付与。
 * otayoriLedger に delta（reason='【手動付与】'+reason）。delta は正負可（誤付与の訂正用）。auditLogs 記帳。
 */
export function grantOtayori(memberId: string, delta: number, reason: string, actor: string): void {
	otayoriLedger.push({
		id: nextOtayoriId('ol'),
		memberId,
		delta,
		reason: `【手動付与】${reason}`,
		createdAt: today()
	});
	addAuditLog(actor, 'otayori_adjust', `${memberId} ${delta > 0 ? '+' : ''}${delta}pt ${reason}`);
	dbg('otayori_adjust', actor, memberId, `${delta > 0 ? '+' : ''}${delta}pt`);
}

// ================================================================ 客室電子インフォメーション（demo・設計書 §4-§7 / §9-1・P8a）
// 将来 book.house_guides / stay_access_tokens テーブル + RPC（migration 20260710103006_book_inroom_phase1）
// へ差し替える境界。supabase-data.ts に対称の sb* アダプタがある（DATA_SOURCE=supabase で実働）。
// 内線電話（intercom）・TV・PMS 連携は P8a の対象外（本節に含めない）。

// ---- 館内案内シード（Markdown 原文・実在施設の雰囲気） ----
// language-unit フォールバック（migration の list_house_guides と同一）: 指定言語が0件なら ja 全件へ。
export const houseGuides: HouseGuide[] = [
	// === 西和賀（f-nishiwaga）: ja 5件 ===
	{
		id: 'hg-nw-checkin', facilityId: 'f-nishiwaga', section: 'checkin', lang: 'ja', sortOrder: 1, isPublished: true,
		title: 'ご到着・ご出発',
		body: `## チェックイン / チェックアウト

- チェックイン：**15:00** から
- チェックアウト：**11:00** まで

## 送迎について

JR ほっとゆだ駅より無料送迎を承っております（前日まで要予約）。ご到着時刻がお決まりになりましたら、フロント（**0197-82-2222**）までお知らせください。`
	},
	{
		id: 'hg-nw-onsen', facilityId: 'f-nishiwaga', section: 'onsen', lang: 'ja', sortOrder: 2, isPublished: true,
		title: '温泉のご案内',
		body: `## 大浴場・野天風呂

源泉かけ流しの湯を、チェックインから翌朝までお楽しみいただけます。

| | 時間 |
|---|---|
| ご利用時間 | 15:00 〜 翌 10:00 |
| 清掃のため休止 | 10:00 〜 11:00 |

## 貸切風呂

渓流沿いの貸切風呂を **45分・当日予約制**でご用意しております。ご希望の際はフロントへお声がけください。`
	},
	{
		id: 'hg-nw-meal', facilityId: 'f-nishiwaga', section: 'meal', lang: 'ja', sortOrder: 3, isPublished: true,
		title: 'お食事',
		body: `## 夕食

個室のお食事処「福膳坊」にて、季節の山人料理をお召し上がりください。

- 開始時刻：**17:30** または **19:30**（チェックイン時にお伺いします）

## 朝食

- 時間：**7:30 〜 9:00**
- 場所：福膳坊

炊きたての釜飯と山の汁物をご用意しております。`
	},
	{
		id: 'hg-nw-wifi', facilityId: 'f-nishiwaga', section: 'wifi', lang: 'ja', sortOrder: 4, isPublished: true,
		title: 'Wi-Fi のご利用',
		body: `## 無料 Wi-Fi

全客室・館内で無料 Wi-Fi をご利用いただけます。

| | |
|---|---|
| ネットワーク名（SSID） | \`yamado-guest\` |
| パスワード | \`yamado2026\` |

接続がうまくいかない場合は、フロントまでお申し付けください。`
	},
	{
		id: 'hg-nw-notice', facilityId: 'f-nishiwaga', section: 'notice', lang: 'ja', sortOrder: 5, isPublished: true,
		title: '滞在中のご注意',
		body: `## お願い

- 館内は**全館禁煙**です。喫煙は屋外の指定場所をご利用ください。
- 大浴場・お食事処へは館内着とスリッパでお越しいただけます。

## クマにご注意ください

春から秋にかけて、周辺でクマの目撃情報が寄せられることがあります。夕方以降の単独での外出はお控えください。クマ鈴の貸し出しをフロントで行っております。`
	},
	// === 西和賀（f-nishiwaga）: en 2件（onsen / wifi 相当） ===
	{
		id: 'hg-nw-onsen-en', facilityId: 'f-nishiwaga', section: 'onsen', lang: 'en', sortOrder: 2, isPublished: true,
		title: 'Hot Spring Guide',
		body: `## Large Bath & Open-air Bath

Enjoy our naturally flowing hot spring from check-in through the next morning.

| | Hours |
|---|---|
| Open | 15:00 – 10:00 (next day) |
| Closed for cleaning | 10:00 – 11:00 |

## Private Bath

A riverside private bath is available for **45 minutes, same-day reservation**. Please ask the front desk.`
	},
	{
		id: 'hg-nw-wifi-en', facilityId: 'f-nishiwaga', section: 'wifi', lang: 'en', sortOrder: 4, isPublished: true,
		title: 'Wi-Fi',
		body: `## Free Wi-Fi

Free Wi-Fi is available in all guest rooms and throughout the inn.

| | |
|---|---|
| Network (SSID) | \`yamado-guest\` |
| Password | \`yamado2026\` |

If you have trouble connecting, please contact the front desk.`
	},
	// === 男鹿（f-oga）: ja 4件 ===
	{
		id: 'hg-oga-checkin', facilityId: 'f-oga', section: 'checkin', lang: 'ja', sortOrder: 1, isPublished: true,
		title: 'ご到着・ご出発',
		body: `## チェックイン / チェックアウト

- チェックイン：**15:00** から
- チェックアウト：**10:00** まで

ご不明な点はフロント（**0185-47-7776**）までお問い合わせください。`
	},
	{
		id: 'hg-oga-onsen', facilityId: 'f-oga', section: 'onsen', lang: 'ja', sortOrder: 2, isPublished: true,
		title: '温泉のご案内',
		body: `## 展望温泉「鵜ノ崎の湯」

エメラルド色に輝く源泉かけ流しの湯から、紺碧の日本海を一望いただけます。

- ご利用時間：**15:00 〜 翌 9:30**
- 泉質：含硫黄ナトリウム・カルシウム塩化物泉

## 貸切露天風呂

夕陽の時間帯は特におすすめです。ご予約はフロントにて承ります。`
	},
	{
		id: 'hg-oga-meal', facilityId: 'f-oga', section: 'meal', lang: 'ja', sortOrder: 3, isPublished: true,
		title: 'お食事',
		body: `## レストラン「isana」

日本海を望むレストランにて、男鹿の旬をご堪能ください。

| | 時間 |
|---|---|
| 夕食 | 17:30 〜 22:00（L.O. 21:30） |
| 朝食 | 7:30 〜 10:00（L.O. 9:30） |

夕食の開始時刻は、日没に合わせてご案内する場合がございます。`
	},
	{
		id: 'hg-oga-wifi', facilityId: 'f-oga', section: 'wifi', lang: 'ja', sortOrder: 4, isPublished: true,
		title: 'Wi-Fi のご利用',
		body: `## 無料 Wi-Fi

全客室・館内で無料 Wi-Fi をご利用いただけます。

| | |
|---|---|
| ネットワーク名（SSID） | \`oga-guest\` |
| パスワード | \`oga2026\` |

接続でお困りの際はフロントまでお申し付けください。`
	}
];

// ---- 滞在トークンシード（デモ・claim / 印刷スリップ動作確認用） ----
const stayNow = Date.now();
export const stayTokens: StayToken[] = [
	{
		id: 'stk-demo-nw', facilityId: 'f-nishiwaga', roomCode: '雪椿', guestName: '山田 太郎',
		token: 'demo-stay-nishiwaga', shortCode: '11112222',
		validFrom: new Date(stayNow - 60 * 60 * 1000).toISOString(),
		validTo: new Date(stayNow + 2 * 24 * 60 * 60 * 1000).toISOString(),
		createdAt: new Date(stayNow - 60 * 60 * 1000).toISOString()
	},
	{
		id: 'stk-demo-oga', facilityId: 'f-oga', roomCode: '山祇', guestName: '佐藤 花子',
		token: 'demo-stay-oga', shortCode: '33334444',
		validFrom: new Date(stayNow - 60 * 60 * 1000).toISOString(),
		validTo: new Date(stayNow + 2 * 24 * 60 * 60 * 1000).toISOString(),
		createdAt: new Date(stayNow - 60 * 60 * 1000).toISOString()
	}
];

let inroomSeq = 0;
const nextInroomId = (p: string) => `${p}-${++inroomSeq}`;

/** トークンが現在有効か（未失効かつ期間内） */
function isStayActive(t: StayToken, at = Date.now()): boolean {
	if (t.revokedAt) return false;
	return at >= new Date(t.validFrom).getTime() && at < new Date(t.validTo).getTime();
}

// ---------------------------------------------------------------- 客室: ゲスト面（RPC 相当・anon）

/** RPC: book.stay_info 相当。有効なら StayInfo・無効（失効/期間外/不明）なら null。last_used_at を更新 */
export function resolveStay(token: string, locale: Locale): StayInfo | null {
	const t = stayTokens.find((x) => x.token === token.trim());
	if (!t || !isStayActive(t)) return null;
	t.lastUsedAt = new Date().toISOString();
	// 施設名はロケール反映（電話・slug は非翻訳）
	const fac = getFacilityById(t.facilityId, locale) ?? facilityById(t.facilityId);
	return {
		tokenId: t.id,
		roomCode: t.roomCode,
		guestName: t.guestName,
		validFrom: t.validFrom,
		validTo: t.validTo,
		facility: { id: t.facilityId, slug: fac?.slug ?? '', name: fac?.name ?? '', phone: fac?.phone }
	};
}

/** RPC: book.claim_stay_by_code 相当。8桁数字 → 有効トークン文字列 or null */
export function claimStayByCode(code: string): string | null {
	const digits = (code ?? '').replace(/\D/g, '');
	if (digits.length !== 8) return null;
	const t = stayTokens.find((x) => x.shortCode === digits);
	if (!t || !isStayActive(t)) return null;
	return t.token;
}

/** RPC: book.list_house_guides 相当。is_published のみ・language-unit フォールバック（指定言語0件→ja）・sort順 */
export function listHouseGuidesFor(facilityId: string, locale: Locale): HouseGuide[] {
	const published = houseGuides.filter((g) => g.facilityId === facilityId && g.isPublished);
	const bySort = (a: HouseGuide, b: HouseGuide) => a.sortOrder - b.sortOrder;
	let items = published.filter((g) => g.lang === locale).sort(bySort);
	if (items.length === 0 && locale !== 'ja') items = published.filter((g) => g.lang === 'ja').sort(bySort);
	return items;
}

// ---------------------------------------------------------------- 客室: 管理面（RPC 相当・authenticated）

/** 管理画面用: 施設の館内案内を全件（未公開含む）。並びは sort_order → lang */
export function listHouseGuidesAdmin(facilityId: string): HouseGuide[] {
	return houseGuides
		.filter((g) => g.facilityId === facilityId)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.lang.localeCompare(b.lang));
}

/** RPC: book.house_guide_upsert 相当（p_id なしで新規・ありで更新） */
export function upsertHouseGuide(input: {
	id?: string;
	facilityId: string;
	section: string;
	title: string;
	body: string;
	lang: Locale;
	sortOrder: number;
	isPublished: boolean;
}): HouseGuide {
	if (input.id) {
		const g = houseGuides.find((x) => x.id === input.id && x.facilityId === input.facilityId);
		if (g) {
			g.section = input.section.trim();
			g.title = input.title.trim();
			g.body = input.body;
			g.lang = input.lang;
			g.sortOrder = input.sortOrder;
			g.isPublished = input.isPublished;
			dbg('house_guide_upsert update', g.id);
			return g;
		}
	}
	const g: HouseGuide = {
		id: nextInroomId('hg'),
		facilityId: input.facilityId,
		section: input.section.trim(),
		title: input.title.trim(),
		body: input.body,
		lang: input.lang,
		sortOrder: input.sortOrder,
		isPublished: input.isPublished
	};
	houseGuides.push(g);
	dbg('house_guide_upsert create', g.id, g.section, g.lang);
	return g;
}

/** RPC: book.house_guide_delete 相当 */
export function deleteHouseGuide(id: string): void {
	const i = houseGuides.findIndex((g) => g.id === id);
	if (i >= 0) {
		houseGuides.splice(i, 1);
		dbg('house_guide_delete', id);
	}
}

/** RPC: book.issue_stay_token 相当。token=64hex・short_code=8桁数字（重複回避）をサーバ生成 */
export function issueStayToken(input: {
	facilityId: string;
	roomCode: string;
	guestName?: string;
	validTo: string; // ISO
	validFrom?: string; // ISO（省略時 now）
	stayId?: string;
}): StayToken {
	// 64 hex（gen_random_uuid ×2 相当）
	const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
	let shortCode = '';
	for (let i = 0; i < 20; i++) {
		shortCode = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
		if (!stayTokens.some((t) => t.shortCode === shortCode)) break;
	}
	const nowIso = new Date().toISOString();
	const tok: StayToken = {
		id: nextInroomId('stk'),
		facilityId: input.facilityId,
		stayId: input.stayId,
		roomCode: input.roomCode.trim(),
		guestName: input.guestName?.trim() || undefined,
		token,
		shortCode,
		validFrom: input.validFrom ?? nowIso,
		validTo: input.validTo,
		createdAt: nowIso
	};
	stayTokens.push(tok);
	dbg('issue_stay_token', input.facilityId, tok.roomCode, shortCode);
	return tok;
}

/** RPC: book.revoke_stay_token 相当。冪等（既失効はそのまま） */
export function revokeStayToken(id: string): void {
	const t = stayTokens.find((x) => x.id === id);
	if (t && !t.revokedAt) {
		t.revokedAt = new Date().toISOString();
		dbg('revoke_stay_token', id);
	}
}

/** RPC: book.list_stay_tokens 相当。既定は有効のみ・include_inactive で全件。新しい順 */
export function listStayTokens(facilityId: string, includeInactive = false): StayToken[] {
	return stayTokens
		.filter((t) => t.facilityId === facilityId && (includeInactive || isStayActive(t)))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 印刷スリップ用: id で1件取得（施設横断） */
export function getStayTokenById(id: string): StayToken | undefined {
	return stayTokens.find((t) => t.id === id);
}

// ---------------------------------------------------------------- 客室: 手入力コードの簡易レート制限（デモ）
// キー（クライアントIP等）単位で失敗回数を数え、5回で10分ロック。migration の
// claim_stay_by_code は試行制限を持たない（アプリ層で実施）方針に対応する簡易実装。

const CLAIM_MAX_FAIL = 5;
const CLAIM_LOCK_MS = 10 * 60 * 1000;
const claimAttempts = new Map<string, { fails: number; lockedUntil: number }>();

/** ロック状態を確認。locked=true なら残り秒 retryInSec を返す */
export function claimRateCheck(key: string): { locked: boolean; retryInSec: number } {
	const rec = claimAttempts.get(key);
	if (rec && rec.lockedUntil > Date.now()) {
		return { locked: true, retryInSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
	}
	return { locked: false, retryInSec: 0 };
}

/** 失敗を記録。CLAIM_MAX_FAIL 到達でロック */
export function claimRecordFailure(key: string): void {
	const rec = claimAttempts.get(key) ?? { fails: 0, lockedUntil: 0 };
	rec.fails += 1;
	if (rec.fails >= CLAIM_MAX_FAIL) {
		rec.lockedUntil = Date.now() + CLAIM_LOCK_MS;
		rec.fails = 0;
	}
	claimAttempts.set(key, rec);
	dbg('claim_rate fail', key, JSON.stringify(rec));
}

/** 成功時はカウンタをクリア */
export function claimRecordSuccess(key: string): void {
	claimAttempts.delete(key);
}
