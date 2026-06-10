// 共有型定義（クライアント・サーバー両方から import 可）
import type { CancellationPolicy, Quote } from '@autumn-book/core';

// ---------------------------------------------------------------- i18n 型

/** 対応ロケール（Paraglide runtime の Locale と対称） */
export type Locale = 'ja' | 'en' | 'zh-TW';

/** コンテンツ翻訳行（book.content_translations 対称） */
export interface ContentTranslation {
	entityType: 'brand' | 'facility' | 'room_type' | 'plan' | 'faq' | 'photo' | 'legal' | 'news' | 'site_page';
	entityId: string;
	locale: Locale;
	/** 翻訳対象フィールドのみ部分上書き（空文字は欠落扱い） */
	fields: Record<string, unknown>;
	isPublished: boolean;
}

export interface Brand {
	slug: string;
	name: string;
	type: 'lodging' | 'restaurant' | 'sauna';
	description: string;
}

export interface Photo {
	url: string;
	caption: string;
	category: 'exterior' | 'room' | 'bath' | 'meal' | 'view';
}

export interface AccessInfo {
	car: { from: string; route: string; minutes: number }[];
	train: { from: string; via: string; minutes: number }[];
	air: { from: string; minutes: number }[];
	shuttle: { available: boolean; note: string };
	parking: { available: boolean; capacity: number; fee: string };
}

export interface Facility {
	id: string;
	brandSlug: string;
	slug: string;
	name: string;
	catchCopy: string;
	description: string;
	lat: number;
	lng: number;
	prefecture: string;
	addressPublic: string;
	phone: string;
	checkinTime: string;
	checkoutTime: string;
	amenities: string[];
	access: AccessInfo;
	photos: Photo[];
	/** 施設HPのデザインテンプレート（画面設計：施設ごとに別デザイン運用） */
	template: 'standard' | 'yamado-v1' | 'oga-v1';
	isPublished: boolean;
}

/** 施設サイトの下層コンテンツページ（お料理・施設・温泉等。book.site_pages 対称） */
export interface SitePageSection {
	heading: string;
	headingEn?: string;
	/** Markdown 原文 */
	body: string;
	imageUrl?: string;
	/** 補足（料金・営業時間・泉質等の小さな表記） */
	note?: string;
}

export interface SitePage {
	id: string;
	facilityId: string;
	/** URL スラッグ（cuisine / facility / option / shiki / nature / onsen / restaurant / guide …） */
	slug: string;
	title: string;
	titleEn: string;
	lead: string;
	heroUrl: string;
	sections: SitePageSection[];
	isPublished: boolean;
	sortOrder: number;
}

/** お知らせ（book.news_posts 対称・WP のニュース機能を置換） */
export interface NewsPost {
	id: string;
	facilityId: string;
	title: string;
	/** Markdown 原文 */
	body: string;
	publishedAt: string; // YYYY-MM-DD
	isPublished: boolean;
	createdAt: string;
}

export interface RoomType {
	id: string;
	facilityId: string;
	slug: string;
	name: string;
	headline: string;
	description: string;
	capacity: number;
	sizeM2: number;
	totalRooms: number;
	amenities: string[];
	photos: Photo[];
}

export interface RatePlan {
	id: string;
	facilityId: string;
	slug: string;
	name: string;
	headline: string;
	/** Markdown 原文（A-05 プラン作成画面で編集） */
	description: string;
	mealPlan: string;
	paymentMethod: 'onsite' | 'card';
	basePrice: number;
	highlightTags: string[];
	photos: Photo[];
	cancellationPolicy: CancellationPolicy;
	roomTypeIds: string[];
	isPublished: boolean;
	sortOrder: number;
}

export interface GuestInfo {
	name: string;
	kana: string;
	phone: string;
	email: string;
	arrival?: string;
	shuttle?: boolean;
	notes?: string;
}

export interface Hold {
	id: string;
	facilityId: string;
	roomTypeId: string;
	planId: string;
	checkin: string;
	nights: number;
	adults: number;
	children: number;
	quote: Quote;
	memberId?: string;
	status: 'active' | 'converted' | 'expired' | 'released';
	expiresAt: number;
	/** ②お客様情報 → ③決済 へ引き継ぐ入力ドラフト */
	guestDraft?: GuestInfo;
	pointsDraft?: number;
}

export interface Booking {
	code: string;
	facilityId: string;
	roomTypeId: string;
	planId: string;
	checkin: string;
	nights: number;
	adults: number;
	children: number;
	guest: GuestInfo;
	total: number;
	pointsUsed: number;
	pointsEarned: number;
	payment: 'onsite' | 'card';
	paymentStatus: 'unpaid' | 'paid' | 'refunded' | 'partial_refund';
	status: 'reserved' | 'cancelled' | 'stayed';
	channel: 'autumn_booking' | 'ota';
	cancellationPolicy: CancellationPolicy;
	cancelFee?: number;
	memberId?: string;
	createdAt: string;
}

export interface Member {
	id: string;
	memberCode: string;
	email: string;
	password: string;
	name: string;
	kana: string;
	phone: string;
	rank: 'standard' | 'silver' | 'gold';
	mailOptIn: boolean;
	joinedAt: string;
}

export interface PointEntry {
	id: string;
	memberId: string;
	delta: number;
	reason: string;
	bookingCode?: string;
	expiresAt?: string;
	createdAt: string;
}

export interface MailCampaign {
	id: string;
	title: string;
	subject: string;
	body: string;
	segment: { ranks: string[]; facility?: string; minStays?: number };
	status: 'draft' | 'scheduled' | 'sending' | 'sent';
	scheduledAt?: string;
	stats?: { sent: number; opened: number; failed: number };
	createdAt: string;
}

export interface SequenceStep {
	id: string;
	offsetDays: number;
	sendHour: number;
	title: string;
	body: string;
}

export interface EmailSequence {
	id: string;
	facilityId: string;
	name: string;
	isActive: boolean;
	steps: SequenceStep[];
}

export interface Faq {
	id: string;
	facilityId: string;
	category: string;
	question: string;
	answer: string;
	isPublished: boolean;
	sortOrder: number;
}

export interface AuditLog {
	id: string;
	at: string;
	actor: string;
	action: string;
	detail: string;
}

export interface SearchParams {
	checkin?: string;
	nights: number;
	adults: number;
	children: number;
}

export interface FacilityAvailability {
	facility: Facility;
	minTotal: number | null;
	minPerPerson: number | null;
	remaining: number;
	reference: boolean;
}

export interface CalendarDay {
	date: string;
	price: number | null;
	remaining: number;
	mark: '◎' | '○' | '△' | '×';
}
