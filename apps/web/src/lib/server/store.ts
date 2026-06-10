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
	Brand, Photo, AccessInfo, Facility, RoomType, RatePlan, GuestInfo, Hold, Booking,
	Member, PointEntry, MailCampaign, SequenceStep, EmailSequence, Faq, AuditLog,
	SearchParams, FacilityAvailability, CalendarDay
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
		catchCopy: '山峡の湯宿で、巡る季節をひとり占め。',
		description:
			'岩手・西和賀。豪雪がもたらす豊かな水と山の幸に抱かれた、全10室の小さな湯宿です。源泉かけ流しの湯と、地のものだけで仕立てる山人料理をご用意して、静かな時間をお待ちしています。',
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
			{ url: img('nishiwaga-ext'), caption: '雪深い山峡に佇む宿', category: 'exterior' },
			{ url: img('nishiwaga-room'), caption: '半露天風呂付き客室', category: 'room' },
			{ url: img('nishiwaga-bath'), caption: '源泉かけ流しの大浴場', category: 'bath' },
			{ url: img('nishiwaga-meal'), caption: '山人料理・先付', category: 'meal' },
			{ url: img('nishiwaga-view'), caption: '錦秋湖の朝霧', category: 'view' }
		],
		isPublished: true
	},
	{
		id: 'f-oga',
		brandSlug: 'yamado',
		slug: 'oga',
		name: '山人 -oga-',
		catchCopy: '日本海に沈む夕陽と、男鹿の幸を一望の宿。',
		description:
			'秋田・男鹿半島、鵜ノ崎海岸を見下ろす高台に建つ全8室のオーベルジュ。日本海の海の幸と男鹿の食文化を、夕陽のパノラマとともにお楽しみください。',
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
			{ url: img('oga-ext'), caption: '鵜ノ崎海岸を望む高台の宿', category: 'exterior' },
			{ url: img('oga-room'), caption: 'オーシャンビューツイン', category: 'room' },
			{ url: img('oga-bath'), caption: '夕陽を望む展望温泉', category: 'bath' },
			{ url: img('oga-meal'), caption: '男鹿の海の幸', category: 'meal' },
			{ url: img('oga-view'), caption: '日本海に沈む夕陽', category: 'view' }
		],
		isPublished: true
	}
];

export const roomTypes: RoomType[] = [
	{
		id: 'r-nw-wayo',
		facilityId: 'f-nishiwaga',
		slug: 'wayo-a',
		name: '和洋室A（半露天風呂付）',
		headline: '源泉を独り占めする半露天風呂付きの和洋室',
		description: '広縁の先に源泉かけ流しの半露天風呂を備えた、当館で最も人気の客室です。',
		capacity: 4,
		sizeM2: 52,
		totalRooms: 4,
		amenities: ['半露天風呂', 'ツインベッド+琉球畳', '錦秋湖側'],
		photos: [{ url: img('nw-wayo'), caption: '和洋室A', category: 'room' }]
	},
	{
		id: 'r-nw-washitsu',
		facilityId: 'f-nishiwaga',
		slug: 'washitsu',
		name: '和室（山側）',
		headline: 'ブナの森に向き合う静かな和室',
		description: '10畳の純和室。窓いっぱいにブナの原生林が広がります。',
		capacity: 3,
		sizeM2: 38,
		totalRooms: 6,
		amenities: ['10畳和室', '山側', 'バス無し（大浴場利用）'],
		photos: [{ url: img('nw-washitsu'), caption: '和室（山側）', category: 'room' }]
	},
	{
		id: 'r-oga-twin',
		facilityId: 'f-oga',
		slug: 'ocean-twin',
		name: 'オーシャンツイン',
		headline: '全面窓に日本海が広がるツインルーム',
		description: 'ベッドに横になったまま水平線を眺められる、海side全面窓の客室です。',
		capacity: 2,
		sizeM2: 40,
		totalRooms: 6,
		amenities: ['ツインベッド', 'オーシャンビュー', 'シャワーブース'],
		photos: [{ url: img('oga-twin'), caption: 'オーシャンツイン', category: 'room' }]
	},
	{
		id: 'r-oga-suite',
		facilityId: 'f-oga',
		slug: 'sunset-suite',
		name: 'サンセットスイート',
		headline: '夕陽のための特等席、露天風呂付スイート',
		description: 'テラスに展望露天風呂を備えた最上階スイート。',
		capacity: 4,
		sizeM2: 68,
		totalRooms: 2,
		amenities: ['展望露天風呂', 'テラス', '最上階'],
		photos: [{ url: img('oga-suite'), caption: 'サンセットスイート', category: 'room' }]
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
		roomTypeIds: ['r-nw-wayo', 'r-nw-washitsu'],
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
		roomTypeIds: ['r-oga-twin', 'r-oga-suite'],
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

export interface SearchParams {
	checkin?: string;
	nights: number;
	adults: number;
	children: number;
}

export interface FacilityAvailability {
	facility: Facility;
	minTotal: number | null; // 1室・滞在総額の最安。null=満室
	minPerPerson: number | null;
	remaining: number;
	reference: boolean; // 日付未指定の参考料金か
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

export interface CalendarDay {
	date: string;
	price: number | null;
	remaining: number;
	mark: '◎' | '○' | '△' | '×';
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

// ---------------------------------------------------------------- 参照ヘルパ

export const facilityBySlug = (brand: string, slug: string) => facilities.find((f) => f.brandSlug === brand && f.slug === slug && f.isPublished);
export const facilityById = (id: string) => facilities.find((f) => f.id === id);
export const roomTypeById = (id: string) => roomTypes.find((r) => r.id === id);
export const planById = (id: string) => ratePlans.find((p) => p.id === id);
export const memberById = (id: string) => members.find((m) => m.id === id);
