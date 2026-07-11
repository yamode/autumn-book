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

/** 事前決済の手段 */
export type PrepayMethod = 'card' | 'paypay';

/** 事前決済割引の上限（20%） */
export const PREPAY_DISCOUNT_MAX = 0.2;

/**
 * プランの決済設定。
 * 事前決済＝ご予約時の「即時決済」（宿泊後請求ではない）。
 * 事前決済を選んだゲストには prepayDiscountRate（0〜20%）の割引を適用できる。
 */
export interface PaymentConfig {
	/** 現地払いを受け付ける */
	onsite: boolean;
	/** 事前決済（即時決済）を受け付ける */
	prepay: boolean;
	/** 事前決済の手段（カード / PayPay） */
	prepayMethods: PrepayMethod[];
	/** 事前決済割引率 0〜0.2 */
	prepayDiscountRate: number;
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
	payment: PaymentConfig;
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
	paymentDraft?: PrepayMethod;
	/** ②→③へ引き継ぐおたよりポイント利用ドラフト（Phase 2） */
	otayoriDraft?: number;
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
	payment: 'onsite' | 'card' | 'paypay';
	paymentStatus: 'unpaid' | 'paid' | 'refunded' | 'partial_refund';
	/** 事前決済割引（適用時のみ）。total は割引適用後の最終額 */
	prepayDiscountRate?: number;
	discountAmount?: number;
	status: 'reserved' | 'cancelled' | 'stayed';
	channel: 'autumn_booking' | 'ota';
	cancellationPolicy: CancellationPolicy;
	cancelFee?: number;
	memberId?: string;
	/** 予約で使ったおたよりポイント数（Phase 2・1pt=1,000円） */
	otayoriUsed?: number;
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

// ---------------------------------------------------------------- コミュニティ掲示板（book.forum_* 対称）

export interface ForumProfile {
	userId: string; // SessionUser.id（demo）/ auth.users.id（本接続）
	nickname: string;
	role: 'member' | 'staff' | 'admin';
	isBanned: boolean;
	createdAt: string;
}

export interface ForumBoard {
	id: string;
	slug: string;
	title: string;
	description: string;
	sortOrder: number;
	isArchived: boolean;
	createdAt: string;
}

export interface ForumThread {
	id: string;
	boardId: string;
	authorUserId: string;
	title: string;
	isPinned: boolean;
	isLocked: boolean;
	isDeleted: boolean;
	replyCount: number; // 可視投稿数（#1 を含む）
	lastPostedAt: string;
	createdAt: string;
}

export interface ForumPost {
	id: string;
	threadId: string;
	authorUserId: string;
	postNo: number; // スレッド内連番。1 = スレ本文
	body: string;
	replyToNo: number | null; // 本文中の最初の >>n
	isDeleted: boolean;
	createdAt: string;
}

/** 表示用（authorUserId を含めない = 実体ID非露出を demo でも遵守） */
export interface ForumPostView {
	id: string;
	postNo: number;
	body: string; // 削除済みは ''
	replyToNo: number | null;
	createdAt: string;
	isDeleted: boolean; // true ならプレースホルダ表示「この投稿は削除されました」
	nickname: string | null; // 削除済みは null
	avatarUrl: string | null; // プロフィール画像（コミュニティのアイコン）。無ければ null でイニシャル表示
	isStaff: boolean; // role が staff/admin なら true（運営バッジ）
	isOwn: boolean; // 閲覧者本人の投稿（削除ボタン表示用）
}

export interface ForumThreadListItem {
	id: string;
	title: string;
	isPinned: boolean;
	isLocked: boolean;
	replyCount: number;
	lastPostedAt: string;
	createdAt: string;
	authorNickname: string;
	authorIsStaff: boolean;
}

// ---------------------------------------------------------------- おたよりポイント（book.otayori_* 対称）

/** おたよりポイント1ptの円換算（通常ポイント＝1pt=1円とは別建て）。設計書 §1.3 */
export const OTAYORI_POINT_YEN = 1000;

/** おたよりポイント台帳（book.otayori_ledger 対称）。1pt = OTAYORI_POINT_YEN 円 */
export interface OtayoriEntry {
	id: string;
	memberId: string;
	delta: number; // +N 付与 / -N 利用・巻き戻し
	reason: string; // 'YouTubeおたより投稿' / '【手動付与】…' / 'ご予約での利用（code）' …
	sourcePostId?: string; // 投稿起点の付与
	bookingCode?: string; // 予約利用・巻き戻し（Phase 2）
	createdAt: string;
}

/** おたより投稿（book.otayori_posts 対称） */
export interface OtayoriPost {
	id: string;
	memberId: string;
	body: string; // おたより本文（plain text）
	radioName?: string; // 番組で読む用のラジオネーム（任意）
	status: 'pending' | 'approved' | 'rejected';
	reviewNote?: string; // 却下理由など
	createdAt: string;
	reviewedAt?: string;
}

/** 管理画面の投稿一覧行（会員の内部識別を含む。公開画面には出さない） */
export interface OtayoriAdminItem {
	id: string;
	memberId: string;
	memberCode: string; // YM-XXXXXX
	memberName: string; // 内部表示用（core.guests.name 相当）
	radioName?: string;
	body: string;
	status: 'pending' | 'approved' | 'rejected';
	createdAt: string;
}

// ---------------------------------------------------------------- 客室電子インフォメーション（book.house_guides / stay_access_tokens 対称・P8a）

/** 館内案内（book.house_guides 対称・多言語・Markdown 原文保存） */
export interface HouseGuide {
	id: string;
	facilityId: string;
	/** 自由スラッグ（checkin / onsen / meal / wifi / notice …） */
	section: string;
	title: string;
	/** Markdown 原文（表示時に MarkdownView でサニタイズ） */
	body: string;
	lang: Locale;
	sortOrder: number;
	isPublished: boolean;
}

/** 滞在アクセストークン（book.stay_access_tokens 対称・印刷スリップ = QR + 手入力コード） */
export interface StayToken {
	id: string;
	facilityId: string;
	/** PMS 連携（P8b）で使う論理参照。P8a では未使用 */
	stayId?: string;
	/** 部屋表示名（pms.rooms と疎結合の文字列） */
	roomCode: string;
	guestName?: string;
	/** QR(/r/c/<token>) 用 bearer（64 hex） */
	token: string;
	/** 手入力用の8桁数字 */
	shortCode: string;
	validFrom: string; // ISO
	validTo: string; // ISO
	revokedAt?: string; // 失効時刻（チェックアウト即時失効）
	lastUsedAt?: string;
	createdAt: string;
}

/** 滞在情報（book.stay_info RPC の出力対称・ゲスト面の滞在カード用） */
export interface StayInfo {
	tokenId: string;
	roomCode: string;
	guestName?: string;
	validFrom: string; // ISO
	validTo: string; // ISO
	facility: { id: string; slug: string; name: string; phone?: string };
}
