// アプリ運用管理画面（/admin/app・push・coupons・preferences）のデータ層。
//
// 設計書: docs/ADMIN_APP_OPS.md §5 / §6
//
// 書き込みはすべて book.admin_* の SECURITY DEFINER RPC を、cookie 束縛の
// authenticated クライアントから呼ぶ（service_role は使わない）。権限判定と監査ログは
// RPC 内で完結しており、DB が最終防衛線になる。
// RPC の戻りは snake_case のまま *Row 型で返し、camelCase 変換は各 route 側で行う
// （forum / otayori と同じ流儀）。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServerClient } from './auth';

/** book スキーマに束縛した authenticated クライアント（PostgrestClient） */
export type BookClient = ReturnType<SupabaseClient['schema']>;

export function bookAdmin(event: RequestEvent): BookClient {
	return createSupabaseServerClient(event).schema('book');
}

// ---------------------------------------------------------------------------
// エラーマッピング（設計書 §3 冒頭の表）
// ---------------------------------------------------------------------------

const RPC_MESSAGES: [string, string][] = [
	['not_authenticated', 'セッションが切れています。ログインし直してください。'],
	['coupon_invalid', 'このクーポンは無効か期限切れのため配布できません。'],
	[
		'coupon_issued',
		'配布済みのクーポンは割引条件を変更できません。無効化して新しいクーポンを作成してください。'
	],
	['already_sent', 'この配信は既に送信処理に入っているため取り消せません。'],
	['type_in_use', '回答が存在する項目の入力形式は変更できません。'],
	['key_taken', 'その key は既に使われています。'],
	['not_found', '対象が見つかりませんでした。'],
	['invalid_params', '入力内容に誤りがあります。'],
	[
		'forbidden',
		'この操作には管理者権限が必要です（Supabase の app_metadata.role と core.memberships の tenant_admin の両方が必要です）。'
	]
];

/** RPC 例外を管理者向けの日本語文言にする */
export function mapRpcError(e: unknown): string {
	const msg =
		e && typeof e === 'object' && 'message' in e
			? String((e as { message: unknown }).message ?? '')
			: typeof e === 'string'
				? e
				: '';

	// option_in_use:<value> は値を文言に含める
	const opt = /option_in_use:(\S+)/.exec(msg);
	if (opt) return `選択肢「${opt[1]}」は回答で使われているため削除できません。`;

	for (const [code, text] of RPC_MESSAGES) {
		if (msg.includes(code)) return text;
	}
	return `処理に失敗しました: ${msg || '不明なエラー'}`;
}

// ---------------------------------------------------------------------------
// 型（RPC の returns table / jsonb に対応）
// ---------------------------------------------------------------------------

export interface CouponRow {
	id: string;
	facility_id: string | null;
	name: string;
	description: string | null;
	discount_type: 'fixed' | 'percent';
	discount_value: number;
	min_total: number;
	valid_from: string;
	valid_until: string;
	stay_from: string | null;
	stay_until: string | null;
	is_active: boolean;
	created_at: string;
	issued: number;
	used: number;
	revoked: number;
	expired: number;
	last_used_at: string | null;
}

export interface MemberCouponRow {
	id: string;
	coupon_id: string;
	coupon_name: string;
	member_user_id: string;
	member_code: string | null;
	member_name: string | null;
	rank_code: string | null;
	status: string;
	issued_at: string;
	used_at: string | null;
	booking_code: string | null;
}

export interface MemberRow {
	user_id: string;
	member_code: string | null;
	name: string | null;
	email: string | null;
	rank_code: string | null;
	push_opt_in: boolean;
	device_count: number;
	joined_at: string;
	withdrawn_at: string | null;
	last_stay: string | null;
}

export interface DeviceRow {
	id: string;
	platform: string | null;
	device_name: string | null;
	is_active: boolean;
	last_seen_at: string | null;
	created_at: string;
}

export interface CampaignRow {
	id: string;
	type: 'news' | 'coupon' | 'custom';
	title: string;
	body: string | null;
	data: Record<string, unknown>;
	target: { mode?: string; ranks?: string[] };
	recipient_count: number;
	scheduled_at: string;
	cancelled_at: string | null;
	created_at: string;
	actor_name: string | null;
	pending: number;
	processing: number;
	sent: number;
	failed: number;
	read: number;
}

export interface QueueStatus {
	pending: number;
	processing: number;
	failed_1h: number;
	last_sent_at: string | null;
	last_claimed_at: string | null;
	stuck: boolean;
}

export interface PreferenceOption {
	value: string;
	label: string;
}

export interface PreferenceItem {
	key: string;
	label: string;
	group_name: 'meal' | 'room' | 'personal';
	value_type: 'single' | 'multi' | 'text' | 'boolean' | 'date';
	options: PreferenceOption[];
	sort_order: number;
	is_active: boolean;
}

export interface PreferenceUsageRow {
	key: string;
	answers: number;
	option_counts: Record<string, number>;
}

export interface FacilityHealth {
	facility_id: string;
	slug: string;
	name: string;
	plans_total: number;
	plans_published: number;
	plans_with_photos: number;
	rooms_total: number;
	rooms_published: number;
	rooms_with_photos: number;
	plans_no_policy: number;
	options_active: number;
	news_published: number;
}

export interface AppDashboard {
	generated_at: string;
	members: {
		total: number;
		active: number;
		joined_this_month: number;
		push_opt_in: number;
		push_capable: number;
		devices_active: number;
	};
	bookings: { last30_count: number; last30_amount: number; daily: { d: string; c: number }[] };
	notifications: {
		last7_sent: number;
		last7_failed: number;
		last7_read_rate: number;
		daily: { d: string; c: number }[];
		queue: QueueStatus;
		today_auto: { reminder: number; thanks: number };
	};
	coupons: { active: number; issued: number; used: number; expiring_7d_unused: number };
	facilities: FacilityHealth[];
	rank_policy_ok: boolean;
	audit: {
		created_at: string;
		action: string;
		detail: Record<string, unknown>;
		actor_name: string | null;
	}[];
}

// ---------------------------------------------------------------------------
// RPC ラッパ（薄く保つ。エラーは呼び出し側で mapRpcError する）
// ---------------------------------------------------------------------------

async function rpc<T>(client: BookClient, fn: string, args: Record<string, unknown> = {}) {
	const { data, error } = await client.rpc(fn, args);
	if (error) throw error;
	return data as T;
}

export const adminAppDashboard = (c: BookClient) => rpc<AppDashboard>(c, 'admin_app_dashboard');

export const adminListCoupons = (c: BookClient, includeInactive = true) =>
	rpc<CouponRow[]>(c, 'admin_list_coupons', { p_include_inactive: includeInactive });

export interface CouponInput {
	id?: string | null;
	name: string;
	description: string | null;
	discountType: 'fixed' | 'percent';
	discountValue: number;
	minTotal: number;
	validFrom: string;
	validUntil: string;
	stayFrom: string | null;
	stayUntil: string | null;
	facilityId: string | null;
	isActive: boolean;
}

export const adminUpsertCoupon = (c: BookClient, input: CouponInput) =>
	rpc<string>(c, 'admin_upsert_coupon', {
		p_id: input.id ?? null,
		p_name: input.name,
		p_description: input.description,
		p_discount_type: input.discountType,
		p_discount_value: input.discountValue,
		p_min_total: input.minTotal,
		p_valid_from: input.validFrom,
		p_valid_until: input.validUntil,
		p_stay_from: input.stayFrom,
		p_stay_until: input.stayUntil,
		p_facility_id: input.facilityId,
		p_is_active: input.isActive
	});

export const adminSetCouponActive = (c: BookClient, id: string, isActive: boolean) =>
	rpc<void>(c, 'admin_set_coupon_active', { p_id: id, p_is_active: isActive });

export const adminListMemberCoupons = (
	c: BookClient,
	opts: { couponId?: string; memberUserId?: string }
) =>
	rpc<MemberCouponRow[]>(c, 'admin_list_member_coupons', {
		p_coupon_id: opts.couponId ?? null,
		p_member_user_id: opts.memberUserId ?? null
	});

export const adminRevokeMemberCoupons = (
	c: BookClient,
	couponId: string,
	memberUserIds: string[] | null,
	reason: string | null
) =>
	rpc<number>(c, 'admin_revoke_member_coupons', {
		p_coupon_id: couponId,
		p_member_user_ids: memberUserIds,
		p_reason: reason
	});

/** 既存 RPC。p_member_user_ids が null なら全会員へ配布し、通知も送られる */
export const issueCoupon = (c: BookClient, couponId: string, memberUserIds: string[] | null) =>
	rpc<number>(c, 'issue_coupon', {
		p_coupon_id: couponId,
		p_member_user_ids: memberUserIds
	});

export interface MemberQuery {
	q?: string | null;
	ranks?: string[] | null;
	stayedFacility?: string | null;
	stayedFrom?: string | null;
	stayedUntil?: string | null;
	includeWithdrawn?: boolean;
	limit?: number;
	offset?: number;
}

export const adminListMembers = (c: BookClient, query: MemberQuery = {}) =>
	rpc<MemberRow[]>(c, 'admin_list_members', {
		p_q: query.q ?? null,
		p_ranks: query.ranks ?? null,
		p_stayed_facility: query.stayedFacility ?? null,
		p_stayed_from: query.stayedFrom ?? null,
		p_stayed_until: query.stayedUntil ?? null,
		p_include_withdrawn: query.includeWithdrawn ?? false,
		p_limit: query.limit ?? 200,
		p_offset: query.offset ?? 0
	});

export const adminMemberDevices = (c: BookClient, memberUserId: string) =>
	rpc<DeviceRow[]>(c, 'admin_member_devices', { p_member_user_id: memberUserId });

export interface SendNotificationInput {
	type: 'news' | 'coupon' | 'custom';
	title: string;
	body: string | null;
	url: string | null;
	memberUserIds: string[] | null;
	scheduledAt: string | null;
	target: Record<string, unknown>;
}

export const adminSendNotification = (c: BookClient, input: SendNotificationInput) =>
	rpc<{ campaign_id: string; count: number }>(c, 'admin_send_notification', {
		p_type: input.type,
		p_title: input.title,
		p_body: input.body,
		p_data: input.url ? { url: input.url } : {},
		p_member_user_ids: input.memberUserIds,
		p_scheduled_at: input.scheduledAt ?? new Date().toISOString(),
		p_target: input.target
	});

export const adminCancelCampaign = (c: BookClient, campaignId: string) =>
	rpc<number>(c, 'admin_cancel_campaign', { p_campaign_id: campaignId });

export const adminListCampaigns = (c: BookClient, limit = 50, offset = 0) =>
	rpc<CampaignRow[]>(c, 'admin_list_campaigns', { p_limit: limit, p_offset: offset });

export const adminCampaignDetail = (c: BookClient, campaignId: string) =>
	rpc<{
		failed_members: { member_code: string | null; name: string | null }[];
		devices_pushed: number;
		devices_ok: number;
		device_errors: {
			member_code: string | null;
			platform: string | null;
			device_name: string | null;
			error_code: string | null;
		}[];
	}>(c, 'admin_campaign_detail', { p_campaign_id: campaignId });

export const adminAutoNotificationStats = (c: BookClient, days = 30) =>
	rpc<{ day: string; type: string; queued: number; sent: number; failed: number; read: number }[]>(
		c,
		'admin_auto_notification_stats',
		{ p_days: days }
	);

export const adminNotificationQueueStatus = (c: BookClient) =>
	rpc<QueueStatus>(c, 'admin_notification_queue_status');

export interface PreferenceInput {
	key: string;
	label: string;
	groupName: 'meal' | 'room' | 'personal';
	valueType: PreferenceItem['value_type'];
	options: PreferenceOption[];
	sortOrder: number;
	isActive: boolean;
}

export const adminUpsertPreferenceItem = (c: BookClient, input: PreferenceInput) =>
	rpc<void>(c, 'admin_upsert_preference_item', {
		p_key: input.key,
		p_label: input.label,
		p_group_name: input.groupName,
		p_value_type: input.valueType,
		p_options: input.options,
		p_sort_order: input.sortOrder,
		p_is_active: input.isActive
	});

export const adminPreferenceUsage = (c: BookClient) =>
	rpc<PreferenceUsageRow[]>(c, 'admin_preference_usage');

/** 非表示項目も含むカタログ（staff select policy 経由の直接 select） */
export async function listPreferenceCatalog(c: BookClient): Promise<PreferenceItem[]> {
	const { data, error } = await c
		.from('preference_catalog')
		.select('key,label,group_name,value_type,options,sort_order,is_active')
		.order('group_name')
		.order('sort_order');
	if (error) throw error;
	return (data ?? []) as PreferenceItem[];
}

// ---------------------------------------------------------------------------
// ダッシュボードのアラート生成（設計書 §4.4。文言は DB に持たせない）
// ---------------------------------------------------------------------------

export type AlertLevel = 'error' | 'warn' | 'info';
export interface Alert {
	level: AlertLevel;
	message: string;
	link?: { label: string; href: string };
}

const LEVEL_ORDER: Record<AlertLevel, number> = { error: 0, warn: 1, info: 2 };

/** 施設を切り替えてから該当画面へ飛ぶリンク（管理画面は施設を cookie で持つため） */
function switchTo(facilityId: string, back: string): string {
	return `/admin/switch?f=${facilityId}&back=${encodeURIComponent(back)}`;
}

export function buildAppAlerts(d: AppDashboard): Alert[] {
	const a: Alert[] = [];
	const fs = d.facilities;

	const totalPlans = fs.reduce((s, f) => s + f.plans_total, 0);
	const totalPlansPhotos = fs.reduce((s, f) => s + f.plans_with_photos, 0);
	const totalRooms = fs.reduce((s, f) => s + f.rooms_total, 0);
	const totalRoomsPhotos = fs.reduce((s, f) => s + f.rooms_with_photos, 0);
	const totalPublished = fs.reduce((s, f) => s + f.plans_published, 0);

	for (const f of fs) {
		// A1 / A2: 公開プラン
		if (f.plans_published === 0) {
			a.push({
				level: 'error',
				message: `公開中のプランがありません（${f.name}）。アプリの予約画面にプランが 1 件も出ません。`,
				link: { label: 'プラン', href: switchTo(f.facility_id, '/admin/plans') }
			});
		} else if (f.plans_total > 0 && (f.plans_published / f.plans_total < 0.3 || f.plans_published < 3)) {
			a.push({
				level: 'warn',
				message: `公開中のプランが ${f.plans_published}/${f.plans_total} 件です（${f.name}）。下書き ${f.plans_total - f.plans_published} 件はアプリに表示されません。`,
				link: { label: 'プラン', href: switchTo(f.facility_id, '/admin/plans') }
			});
		}
		// A5: 非公開の客室
		if (f.rooms_published < f.rooms_total) {
			a.push({
				level: 'warn',
				message: `非公開の客室が ${f.rooms_total - f.rooms_published} 件あります（${f.name}）。`,
				link: { label: '部屋編集', href: switchTo(f.facility_id, '/admin/rooms') }
			});
		}
		// A11: プラン個別のキャンセル規定
		if (d.rank_policy_ok && f.plans_total > 0 && f.plans_no_policy >= f.plans_total) {
			a.push({
				level: 'info',
				message: `プラン個別のキャンセル規定がありません（${f.plans_no_policy}/${f.plans_total} 件・${f.name}）。グレード別規定を適用中です。`,
				link: { label: 'キャンセル規定', href: '/admin/cancel-policies' }
			});
		}
		// A14: 公開お知らせ
		if (f.news_published === 0) {
			a.push({
				level: 'info',
				message: `公開中のお知らせがありません（${f.name}）。アプリのお知らせタブが空になります。`,
				link: { label: 'お知らせ', href: switchTo(f.facility_id, '/admin/news') }
			});
		}
	}

	// A3 / A4: 写真
	if (totalPlansPhotos === 0 && totalPlans > 0) {
		a.push({
			level: 'error',
			message: `写真のあるプランが 0/${totalPlans} 件・客室 ${totalRoomsPhotos}/${totalRooms} 件です。アプリはプレースホルダー画像を表示しています。`,
			link: { label: 'プラン', href: '/admin/plans' }
		});
	} else if (totalPublished > 0 && totalPlansPhotos / totalPublished < 0.5) {
		a.push({
			level: 'warn',
			message: `公開プランのうち写真があるのは ${totalPlansPhotos}/${totalPublished} 件です。`,
			link: { label: 'プラン', href: '/admin/plans' }
		});
	}

	// A6 / A7: push 端末
	if (d.members.active > 0 && d.members.devices_active === 0) {
		a.push({
			level: 'warn',
			message: `push を受け取れる端末が 0 台です（会員 ${d.members.active} 名）。通知は通知センターにのみ届きます。`,
			link: { label: 'アプリ通知', href: '/admin/push' }
		});
	} else if (d.members.active >= 10 && d.members.push_opt_in / d.members.active < 0.5) {
		a.push({
			level: 'info',
			message: `push 受信を許可している会員は ${Math.round((d.members.push_opt_in / d.members.active) * 100)}% です。`
		});
	}

	// A8 / A9: 配信
	if (d.notifications.queue.stuck) {
		a.push({
			level: 'error',
			message: `通知配信が滞留しています（待機 ${d.notifications.queue.pending} 件・処理中 ${d.notifications.queue.processing} 件）。pg_cron book_notifications_drain / Edge Function send-push を確認してください。`,
			link: { label: 'アプリ通知', href: '/admin/push' }
		});
	}
	if (d.notifications.last7_failed > 0) {
		a.push({
			level: 'warn',
			message: `直近 7 日で ${d.notifications.last7_failed} 件の通知が失敗しています。`,
			link: { label: 'アプリ通知', href: '/admin/push' }
		});
	}

	// A10: グレード別キャンセル規定
	if (!d.rank_policy_ok) {
		a.push({
			level: 'error',
			message: 'グレード別キャンセル規定（standard）が空です。全予約がキャンセル料無料になります。',
			link: { label: 'キャンセル規定', href: '/admin/cancel-policies' }
		});
	}

	// A12: オプション
	if (fs.length > 0 && fs.every((f) => f.options_active === 0)) {
		a.push({
			level: 'info',
			message: '公開中のオプションが 0 件です。使わないなら対応は不要です。',
			link: { label: 'オプション', href: '/admin/options' }
		});
	}

	// A13: 期限が近い未使用クーポン
	if (d.coupons.expiring_7d_unused > 0) {
		a.push({
			level: 'info',
			message: `期限まで 7 日以内で未使用の配布があるクーポンが ${d.coupons.expiring_7d_unused} 件あります。`,
			link: { label: 'クーポン', href: '/admin/coupons' }
		});
	}

	return a.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
}


// ---------------------------------------------------------------------------
// 会員一覧・会員詳細（/admin/members の実データ経路）
// ---------------------------------------------------------------------------

export interface PointLedgerRow {
	id: string;
	delta: number;
	reason: string | null;
	created_at: string;
	expires_at: string | null;
}

export interface MemberNotificationRow {
	id: string;
	type: string;
	title: string;
	status: string;
	created_at: string;
	read_at: string | null;
}

export interface MemberPreferenceRow {
	pref_key: string;
	value: unknown;
	updated_at: string;
}

/** ポイント残高（既存 RPC・引数省略時は自分） */
export const pointBalanceOf = (c: BookClient, userId: string) =>
	rpc<number>(c, 'point_balance', { p_user: userId });

/** おたよりポイント残高（既存 RPC） */
export const otayoriBalanceOf = (c: BookClient, userId: string) =>
	rpc<number>(c, 'otayori_balance', { p_user: userId });

/** ポイント手動調整（既存 RPC・内部で監査ログを記帳する） */
export const adjustPointsOf = (c: BookClient, userId: string, delta: number, reason: string) =>
	rpc<void>(c, 'adjust_points', {
		p_member_user_id: userId,
		p_delta: delta,
		p_reason: reason
	});

/** おたよりポイント手動付与（既存 RPC） */
export const grantOtayoriOf = (c: BookClient, userId: string, delta: number, reason: string) =>
	rpc<void>(c, 'otayori_adjust', {
		p_member_user_id: userId,
		p_delta: delta,
		p_reason: reason
	});

/** ポイント履歴（point_ledger_staff_select 経由の直接 select） */
export async function listPointLedger(c: BookClient, userId: string): Promise<PointLedgerRow[]> {
	const { data, error } = await c
		.from('point_ledger')
		.select('id,delta,reason,created_at,expires_at')
		.eq('member_user_id', userId)
		.order('created_at', { ascending: false })
		.limit(100);
	if (error) throw error;
	return (data ?? []) as PointLedgerRow[];
}

/** 会員宛の通知履歴（notifications_staff_select 経由） */
export async function listMemberNotifications(
	c: BookClient,
	userId: string
): Promise<MemberNotificationRow[]> {
	const { data, error } = await c
		.from('notifications')
		.select('id,type,title,status,created_at,read_at')
		.eq('member_user_id', userId)
		.order('created_at', { ascending: false })
		.limit(50);
	if (error) throw error;
	return (data ?? []) as MemberNotificationRow[];
}

/** 会員の好み回答（member_preferences_staff_select 経由） */
export async function listMemberPreferences(
	c: BookClient,
	userId: string
): Promise<MemberPreferenceRow[]> {
	const { data, error } = await c
		.from('member_preferences')
		.select('pref_key,value,updated_at')
		.eq('member_user_id', userId);
	if (error) throw error;
	return (data ?? []) as MemberPreferenceRow[];
}

/** RankBadge が受ける union に寄せる（DB は text のため） */
export type MemberRank = 'standard' | 'silver' | 'gold' | 'platinum';
export function normalizeRank(code: string | null | undefined): MemberRank {
	return code === 'silver' || code === 'gold' || code === 'platinum' ? code : 'standard';
}
