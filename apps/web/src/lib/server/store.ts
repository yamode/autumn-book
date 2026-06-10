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
import type {
	NewsPost,
	Brand, Photo, AccessInfo, Facility, RoomType, RatePlan, GuestInfo, Hold, Booking,
	Member, PointEntry, MailCampaign, SequenceStep, EmailSequence, Faq, AuditLog,
	SearchParams, FacilityAvailability, CalendarDay, Locale, ContentTranslation
} from '$lib/types';

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
			{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/index/top_fig_01.jpg', caption: '山峡に佇む宿', category: 'exterior' },
			{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/guestroom/slider_01_02.jpg', caption: '雪椿（シモンズ社製ツイン和風ベッド）', category: 'room' },
			{ url: img('nishiwaga-bath'), caption: '源泉かけ流しの大浴場', category: 'bath' },
			{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/index/top_link_01.jpg', caption: '山人料理', category: 'meal' },
			{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/index/top_fig_02.jpg', caption: '西和賀の四季', category: 'view' }
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
			{ url: 'https://oga.yamado.co.jp/img/index/kv_pic_left01@2x.webp', caption: '鵜ノ崎海岸を望む宿', category: 'exterior' },
			{ url: 'https://oga.yamado.co.jp/img/room/ridge_b@2x.webp', caption: '迦具土 — 日本海の絶景を間近に', category: 'room' },
			{ url: 'https://oga.yamado.co.jp/img/index/about_onsen@2x.webp', caption: '夕陽を望む温泉', category: 'bath' },
			{ url: img('oga-meal'), caption: '大地の滋味が凝縮された男鹿の幸', category: 'meal' },
			{ url: 'https://oga.yamado.co.jp/img/index/gallery_pic_main@2x.webp', caption: '潮の満ち引きで表情を変える海岸線', category: 'view' }
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
		photos: [{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/guestroom/slider_01_02.jpg', caption: '雪椿', category: 'room' }]
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
		photos: [{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/guestroom/slider_02_01.jpg', caption: '椈', category: 'room' }]
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
		photos: [{ url: 'https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/guestroom/slider_04_01.jpg', caption: '靖山樓', category: 'room' }]
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
		photos: [{ url: 'https://oga.yamado.co.jp/img/room/ridge_a@2x.webp', caption: '山祇', category: 'room' }]
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
		photos: [{ url: 'https://oga.yamado.co.jp/img/room/ridge_b@2x.webp', caption: '迦具土', category: 'room' }]
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
		photos: [{ url: 'https://oga.yamado.co.jp/img/room/ridge_c@2x.webp', caption: '綿津見', category: 'room' }]
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
		paymentMethod: 'onsite',
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
		paymentMethod: 'card',
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
		paymentMethod: 'onsite',
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
		paymentMethod: 'onsite',
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

export const holds = new Map<string, Hold>();
export const bookings = new Map<string, Booking>();
export const auditLogs: AuditLog[] = [];

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
export function confirmBooking(holdId: string, guest: GuestInfo, pointsUsed: number, memberId?: string): Booking | { error: string } {
	const hold = getHold(holdId);
	if (!hold || hold.status !== 'active') return { error: 'hold_expired' };
	const plan = ratePlans.find((p) => p.id === hold.planId)!;
	const member = memberId ? members.find((m) => m.id === memberId) : undefined;
	const usable = member ? Math.min(pointsUsed, pointBalance(member.id)) : 0;
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
		total: hold.quote.total,
		pointsUsed: usable,
		pointsEarned: member ? earnedPoints(hold.quote.total, rank.rewardRate) : 0,
		payment: plan.paymentMethod,
		paymentStatus: plan.paymentMethod === 'card' ? 'paid' : 'unpaid',
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
	if (b.payment === 'card' && b.paymentStatus === 'paid') {
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
