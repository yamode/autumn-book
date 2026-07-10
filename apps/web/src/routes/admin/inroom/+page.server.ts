import { fail } from '@sveltejs/kit';
import {
	listHouseGuidesAdmin,
	listStayTokens,
	upsertHouseGuide,
	deleteHouseGuide,
	issueStayToken,
	revokeStayToken,
	addAuditLog
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import {
	FACILITY_UUID,
	sbListStayTokens,
	sbListHouseGuides,
	sbUpsertHouseGuide,
	sbDeleteHouseGuide,
	sbIssueStayToken,
	sbRevokeStayToken
} from '$lib/server/supabase-data';
import type { Locale } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// 本番系（実データ + 実認証）でのみ Supabase アダプタを使う。
// 現状 .env は DATA_SOURCE=supabase / AUTH_MODE=demo のため admin は demo（store.ts）で完結する。
// authenticated RPC（発行/失効/一覧・ガイド CRUD）は has_facility_access を要するため両方 supabase が条件。
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

const LANGS: Locale[] = ['ja', 'en', 'zh-TW'];
function parseLang(v: unknown): Locale {
	const s = String(v ?? 'ja');
	return (LANGS as string[]).includes(s) ? (s as Locale) : 'ja';
}

// チェックアウト日（YYYY-MM-DD）→ その日の 11:00 JST を valid_to（ISO）にする
function checkoutToValidTo(dateStr: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
	const d = new Date(`${dateStr}T11:00:00+09:00`);
	return isNaN(d.getTime()) ? null : d.toISOString();
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const includeInactive = event.url.searchParams.get('all') === '1';

	if (useSupabaseAdmin) {
		const client = createSupabaseServerClient(event);
		const facilityUuid = FACILITY_UUID[currentFacility.id] ?? currentFacility.id;
		try {
			const tokens = await sbListStayTokens(client, facilityUuid, includeInactive);
			// 管理用ガイド一覧（未公開含む）RPC は P8a には無い（P5 Auth 本接続時に追加）。
			// 暫定で公開済みガイドのみ anon RPC 経由で表示する。未公開の確認は demo モードでのみ可能。
			const guides = await sbListHouseGuides(facilityUuid, 'ja');
			return { guides, tokens, includeInactive, loadError: null };
		} catch (e) {
			// 管理者の core.memberships 未登録（forbidden）や Supabase 到達不可でも
			// 管理画面自体は落とさない（v0.12.1 と同じ安全側設計）
			return {
				guides: [],
				tokens: [],
				includeInactive,
				loadError:
					'Supabase からの取得に失敗しました。管理者アカウントの core.memberships 登録（施設アクセス権）を確認してください。' +
					(e instanceof Error ? `（${e.message}）` : '')
			};
		}
	}

	return {
		guides: listHouseGuidesAdmin(currentFacility.id),
		tokens: listStayTokens(currentFacility.id, includeInactive),
		includeInactive,
		loadError: null
	};
};

// 館内案内 CRUD の共通処理（追加・保存）。admin のみ。
async function saveGuide(event: Parameters<Actions[string]>[0], withId: boolean) {
	if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
	const form = await event.request.formData();
	const facilityId = String(form.get('facilityId') ?? '');
	const section = String(form.get('section') ?? '').trim();
	const title = String(form.get('title') ?? '').trim();
	const body = String(form.get('body') ?? '');
	const lang = parseLang(form.get('lang'));
	const sortOrder = Number(form.get('sortOrder') ?? 0) || 0;
	const isPublished = form.get('isPublished') === 'on';
	const id = withId ? String(form.get('guideId') ?? '') : undefined;

	if (!section || !title || !body.trim()) {
		return fail(400, { message: 'セクション・タイトル・本文は必須です' });
	}

	if (useSupabaseAdmin) {
		const client = createSupabaseServerClient(event);
		try {
			await sbUpsertHouseGuide(client, { id, facilityId, section, title, body, lang, sortOrder, isPublished });
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
		}
		return withId ? { guideSaved: id } : { guideAdded: true };
	}

	const g = upsertHouseGuide({ id, facilityId, section, title, body, lang, sortOrder, isPublished });
	return withId ? { guideSaved: g.id } : { guideAdded: true };
}

export const actions: Actions = {
	// ---- 館内案内（admin のみ）----
	guideAdd: (event) => saveGuide(event, false),
	guideSave: (event) => saveGuide(event, true),
	guideDelete: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const id = String(form.get('guideId') ?? '');
		if (!id) return fail(400, { message: '対象が不明です' });
		if (useSupabaseAdmin) {
			const client = createSupabaseServerClient(event);
			try {
				await sbDeleteHouseGuide(client, id);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '削除に失敗しました' });
			}
			return { guideDeleted: true };
		}
		deleteHouseGuide(id);
		return { guideDeleted: true };
	},

	// ---- 客室スリップ（トークン発行/失効・admin または staff）----
	tokenIssue: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
			return fail(403, { message: '権限がありません' });
		}
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const roomCode = String(form.get('roomCode') ?? '').trim();
		const guestName = String(form.get('guestName') ?? '').trim() || undefined;
		const checkout = String(form.get('checkout') ?? '').trim();
		if (!roomCode) return fail(400, { message: '部屋名を入力してください' });
		const validTo = checkoutToValidTo(checkout);
		if (!validTo) return fail(400, { message: 'チェックアウト日を正しく入力してください' });

		try {
			if (useSupabaseAdmin) {
				const client = createSupabaseServerClient(event);
				const uuid = FACILITY_UUID[facilityId] ?? facilityId;
				const tok = await sbIssueStayToken(client, { facilityId: uuid, roomCode, guestName, validTo });
				return { issued: { id: tok.id, shortCode: tok.shortCode, roomCode: tok.roomCode, token: tok.token } };
			}
			const tok = issueStayToken({ facilityId, roomCode, guestName, validTo });
			addAuditLog(user.name, 'stay_token_issue', `room=${roomCode} code=${tok.shortCode} validTo=${validTo}`);
			return { issued: { id: tok.id, shortCode: tok.shortCode, roomCode: tok.roomCode, token: tok.token } };
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '発行に失敗しました' });
		}
	},
	tokenRevoke: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
			return fail(403, { message: '権限がありません' });
		}
		const form = await event.request.formData();
		const tokenId = String(form.get('tokenId') ?? '');
		if (!tokenId) return fail(400, { message: '対象が不明です' });
		try {
			if (useSupabaseAdmin) {
				const client = createSupabaseServerClient(event);
				await sbRevokeStayToken(client, tokenId);
			} else {
				revokeStayToken(tokenId);
				addAuditLog(user.name, 'stay_token_revoke', `token_id=${tokenId}`);
			}
			return { revoked: true };
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '失効に失敗しました' });
		}
	}
};
