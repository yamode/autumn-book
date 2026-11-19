import { legacyMigrationOpen } from '$lib/server/legacy-migration-flag';
import { legacyClaimable } from '$lib/server/legacy-members';
import { myReservations, facilityById, roomTypeById } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations, reverseFacilityUuid } from '$lib/server/supabase-data';
import { todayStr } from '$lib/format';
import { listMemberPagesFor } from '$lib/server/partners/member-bookings';
import { legacyMypageFromEnv } from '$lib/server/legacy-mypage-env';
import type { RequestEvent } from '@sveltejs/kit';

const loadReservations = async (event: RequestEvent) => {
	const { locals } = event;
	const today = todayStr();

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const memberPages = locals.user?.id ? listMemberPagesFor(locals.user.id).catch(() => []) : Promise.resolve([]);
		const reservations = await sbMyReservations(client);
		const list = reservations.map((r) => {
			// 施設マスタ（名称・写真・スラッグ）は store 側が正。実 UUID から逆引きする。
			const storeId = reverseFacilityUuid(r.facilityUuid);
			const f = storeId ? facilityById(storeId) : undefined;
			return {
				code: r.code,
				status: r.status,
				channel: r.channel,
				checkin: r.checkin,
				nights: r.nights,
				// 複数室（M1）は全室の大人の合計と室数（一覧の「3室」）
				adults: r.rooms && r.rooms.length > 1 ? r.rooms.reduce((s, x) => s + x.adults, 0) : r.adults,
				roomCount: r.roomCount ?? 1,
				total: r.total,
				pointsUsed: r.pointsUsed,
				payment: r.payment,
				facilityName: f?.name ?? '—',
				facilitySlug: f ? `${f.brandSlug}/${f.slug}` : '',
				// 客室マスタ（room_type_id UUID）は公開コンテンツ未投入のため未解決（空表示）。
				roomName: '',
				photo: f?.photos[0]?.url ?? '',
				// 特別会員の専用ページ経由の予約（一覧の「特別会員ページ」バッジ）
				memberPage: r.memberPage ? { pageName: r.memberPage.pageName } : null
			};
		});
		return {
			upcoming: list.filter((b) => b.status === 'reserved' && b.checkin >= today).sort((a, b) => a.checkin.localeCompare(b.checkin)),
			past: list.filter((b) => b.status !== 'reserved' || b.checkin < today),
			memberPages
		};
	}

	const list = myReservations(locals.user!.id).map((b) => ({
		...b,
		facilityName: facilityById(b.facilityId)!.name,
		facilitySlug: `${facilityById(b.facilityId)!.brandSlug}/${facilityById(b.facilityId)!.slug}`,
		roomName: roomTypeById(b.roomTypeId)!.name,
		photo: facilityById(b.facilityId)!.photos[0].url,
		roomCount: 1,
		memberPage: null as { pageName: string } | null
	}));
	return {
		upcoming: list.filter((b) => b.status === 'reserved' && b.checkin >= today).sort((a, b) => a.checkin.localeCompare(b.checkin)),
		past: list.filter((b) => b.status !== 'reserved' || b.checkin < today),
		memberPages: [] as Awaited<ReturnType<typeof listMemberPagesFor>>
	};
};

// 旧 tripla マイページへの案内（予約一覧の上に 1 行・期限まで）
export const loadAccountOverview = async (event: RequestEvent) => ({
	...(await loadReservations(event)),
	legacyActive: legacyMypageFromEnv().kind === 'active',
	// 以前の予約システムの会員の記録（同じメール）があれば「ご利用実績を引き継ぐ」を案内（移行の受付を開いているときだけ）
	legacyClaimable:
		legacyMigrationOpen(event.url) && event.locals.user
			? (await legacyClaimable(event.locals.user.id).catch(() => ({ claimable: false }))).claimable
			: false
});
