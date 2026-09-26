// 管理画面の部屋・プラン紹介ページ（/admin/rooms・/admin/plans）で共通の下回り。
// 流儀は /admin/bath と同じ:
//   - 保存は DATA_SOURCE=supabase かつ AUTH_MODE=supabase（ADMIN_SUPABASE）のときだけ通す。
//     それ以外は**黙って成功させず** NOT_LIVE を返す（デモのメモリに書くと isolate ごとに消えるため）。
//   - 編集できるのは admin と staff。
//   - 施設は管理画面共通の ab_fac クッキーから解決し、FACILITY_UUID で実 UUID にする。
import { fail, type RequestEvent } from '@sveltejs/kit';
import { facilities, ratePlans, roomTypes } from '$lib/server/store';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { sbUploadContentPhoto, type AdminPlanContent, type AdminRoomContent } from '$lib/server/content-admin';
import { normalizeContentDraft, photoFileProblem, type ContentDraft } from '$lib/content-blocks';

export const NOT_LIVE =
	'この環境では保存できません（管理画面が実データに繋がっていません）。本番でお試しください。';

export const LIVE = ADMIN_SUPABASE;

export function facilityUuidOf(id: string): string {
	return FACILITY_UUID[id] ?? id;
}

/** action からは event.parent() を呼べないので、共通レイアウトと同じ ab_fac クッキーから施設を決める。 */
export function currentFacilityOf(event: RequestEvent): { id: string; name: string; uuid: string } {
	const facId = event.cookies.get('ab_fac') ?? facilities[0].id;
	const f = facilities.find((x) => x.id === facId) ?? facilities[0];
	return { id: f.id, name: f.name, uuid: facilityUuidOf(f.id) };
}

/** 編集できるのは管理者・スタッフだけ（/admin/bath と同じ線引き）。 */
export function denyIfNotStaff(event: RequestEvent) {
	const role = event.locals.user?.role;
	if (role !== 'admin' && role !== 'staff') return fail(403, { error: '権限がありません。' });
	return null;
}

export function messageOf(e: unknown): string {
	const m =
		e instanceof Error
			? e.message
			: e && typeof e === 'object' && 'message' in e
				? String((e as { message: unknown }).message)
				: String(e);
	if (m.includes('row-level security') || m.includes('forbidden')) return 'この施設を編集する権限がありません。';
	if (m.includes('not_authenticated') || m.includes('JWT')) return 'ログインし直してください。';
	return m;
}

/** 保存フォームの hidden `payload`（JSON）を読んで正規化する。 */
export async function draftFromRequest(event: RequestEvent, photoFallback: 'room' | 'meal'): Promise<ContentDraft> {
	const fd = await event.request.formData();
	let raw: unknown = {};
	try {
		raw = JSON.parse(String(fd.get('payload') ?? '{}'));
	} catch {
		raw = {};
	}
	return normalizeContentDraft(raw, photoFallback);
}

/**
 * 写真アップロードの action 本体。アップロードして URL を返すだけで、行には書かない
 * （画面側で写真一覧・ブロックへ差し込み、「保存」で他の編集と一緒に書く）。
 */
export async function uploadPhotoAction(event: RequestEvent, kind: 'rooms' | 'plans') {
	const denied = denyIfNotStaff(event);
	if (denied) return denied;
	if (!LIVE) return fail(503, { error: NOT_LIVE });
	const fd = await event.request.formData();
	const file = fd.get('photo');
	const problem = photoFileProblem(file instanceof File ? file : null);
	if (problem) return fail(400, { error: problem });
	try {
		const url = await sbUploadContentPhoto(
			createSupabaseServerClient(event),
			kind,
			currentFacilityOf(event).uuid,
			file as File
		);
		return { uploaded: url };
	} catch (e) {
		return fail(400, { error: messageOf(e) });
	}
}

// ---------------------------------------------------------------- デモ（閲覧のみ）

/** 実データに繋がっていない環境で、画面の形だけ見せるためのデモ部屋一覧（保存はできない）。 */
export function demoRoomContents(facilityId: string): AdminRoomContent[] {
	return roomTypes
		.filter((r) => r.facilityId === facilityId)
		.map((r, i) => ({
			id: r.id,
			code: r.slug,
			name: r.name,
			capacityMin: 1,
			capacityMax: r.capacity,
			isActive: true,
			hasContent: true,
			slug: r.slug,
			headline: r.headline,
			description: r.description,
			isPublished: true,
			tags: r.amenities,
			specs: r.specs,
			sections: r.sections,
			photos: r.photos,
			sortOrder: i,
			updatedAt: null
		}));
}

export function demoPlanContents(facilityId: string): AdminPlanContent[] {
	return ratePlans
		.filter((p) => p.facilityId === facilityId)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((p) => ({
			id: p.id,
			code: p.slug,
			name: p.name,
			isActive: true,
			publicOnDirect: true,
			paymentMethod: null,
			prepayDiscountRate: p.payment.prepayDiscountRate,
			hasContent: true,
			slug: p.slug,
			headline: p.headline,
			description: p.description,
			isPublished: p.isPublished,
			tags: p.highlightTags,
			specs: p.specs,
			sections: p.sections,
			photos: p.photos,
			sortOrder: p.sortOrder,
			updatedAt: null
		}));
}
