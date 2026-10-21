import { fail } from '@sveltejs/kit';
import {
	listHouseGuidesAdmin,
	listStayTokens,
	upsertHouseGuide,
	deleteHouseGuide,
	issueStayToken,
	revokeStayToken,
	addAuditLog,
	facilities
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
// 実際のご予約から公開URL/QRを出す部分は貸切風呂（/admin/bath）と同じ RPC を使う。
// get-or-create なので、同じご予約なら何度押しても同じ URL・同じ QR になる。
import { sbGetOrIssueStayToken, sbListBookableStays, type BookableStay } from '$lib/server/private-bath';
import { todayJstIso } from '$lib/early-prepay';
import type { Locale, StayToken } from '$lib/types';
import { SNS_KINDS, normalizeSnsLinks } from '$lib/sns-links';
import { loadSnsLinks, saveSnsLinksDemo, sbSaveSnsLinks } from '$lib/server/sns-links';
import {
	loadInroomSettings,
	saveInroomSettingsDemo,
	saveSpringLevelDemo,
	sbSaveInroomSettings,
	sbSaveSpringLevel
} from '$lib/server/inroom-settings';
import {
	endNoticeDemo,
	updateNoticeDemo,
	listNoticesDemo,
	saveNoticeDemo,
	sbEndNotice,
	sbListNotices,
	sbSaveNotice,
	type AdminInroomNotice
} from '$lib/server/inroom-notices';
import { sbAdminIntercom, sbListIntercomCalls, sbSaveIntercom, type AdminIntercom, type BusinessHours, type IntercomCall } from '$lib/server/intercom';
import { normalizeSpringBands } from '$lib/spring-level';
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

const STAYS_NOT_LIVE =
	'この環境では実際のご予約を出せません（管理画面が実データに繋がっていません）。本番でお試しください。';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const includeInactive = event.url.searchParams.get('all') === '1';
	const dateParam = event.url.searchParams.get('date') ?? '';
	const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;

	// 以下の読み込みは互いに依存しないので、同時に投げる（2026-10-18 高速化。以前は 6 回の往復を順番に待っていた）。
	// どれも取れなくても画面は落とさない（それぞれの欄に理由を出す）。
	const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
	const client = useSupabaseAdmin ? createSupabaseServerClient(event) : null;
	const facilityUuid = FACILITY_UUID[currentFacility.id] ?? currentFacility.id;

	// 実際のご予約の一覧（公開URL・QR を出す元）
	// 日付を指定しないとき（既定の表示）は「昨日宿泊のお客様」と「本日チェックインのお客様」の2つ（2026-10-18 指示）。
	//   ・昨日宿泊 … 昨夜泊まった方（今日チェックアウトの方と連泊中の方）。ご精算の案内を出すのはこの方たち
	//   ・本日チェックイン … チェックイン日が今日の方だけ（連泊中の方は昨日宿泊のほうに出ているので重ねない）
	// 日付を指定したときは従来どおり、その日にご滞在のお客様を1つの一覧で出す。
	const today = todayJstIso();
	const yesterday = todayJstIso(new Date(Date.now() - 86_400_000));
	type StaysR = {
		stays: BookableStay[];
		yesterdayStays: BookableStay[];
		todayStays: BookableStay[];
		staysError: string | null;
	};
	const noStays = { stays: [] as BookableStay[], yesterdayStays: [] as BookableStay[], todayStays: [] as BookableStay[] };
	const staysP: Promise<StaysR> = !client
		? Promise.resolve({ ...noStays, staysError: STAYS_NOT_LIVE })
		: date
			? sbListBookableStays(client, facilityUuid, date).then(
					(stays) => ({ ...noStays, stays, staysError: null }),
					(e) => ({ ...noStays, staysError: errText(e) })
				)
			: Promise.all([sbListBookableStays(client, facilityUuid, yesterday), sbListBookableStays(client, facilityUuid, today)]).then(
					([y, t]) => ({
						...noStays,
						yesterdayStays: y,
						todayStays: t.filter((s) => s.check_in_date === today),
						staysError: null
					}),
					(e) => ({ ...noStays, staysError: errText(e) })
				);
	// 内線（客室からの Wi-Fi 通話）の設定と通話ログ。実データに繋がっているときだけ
	const intercomP: Promise<{ intercom: AdminIntercom | null; intercomCalls: IntercomCall[]; intercomError: string | null }> = client
		? Promise.all([sbAdminIntercom(client, currentFacility.id), sbListIntercomCalls(client, currentFacility.id, 7)]).then(
				([intercom, intercomCalls]) => ({ intercom, intercomCalls, intercomError: null }),
				(e) => ({ intercom: null, intercomCalls: [] as IntercomCall[], intercomError: errText(e) })
			)
		: Promise.resolve({ intercom: null, intercomCalls: [] as IntercomCall[], intercomError: STAYS_NOT_LIVE });
	// 全客室へのお知らせ（2026-10-17）
	const noticesP: Promise<{ notices: AdminInroomNotice[]; noticesError: string | null }> = client
		? sbListNotices(client, currentFacility.id).then(
				(notices) => ({ notices, noticesError: null }),
				(e) => ({ notices: [] as AdminInroomNotice[], noticesError: errText(e) })
			)
		: Promise.resolve({ notices: listNoticesDemo(currentFacility.id), noticesError: null });
	// 客室スリップと館内案内。管理用ガイド一覧（未公開含む）RPC は P8a には無い（P5 Auth 本接続時に追加）。
	// 暫定で公開済みガイドのみ anon RPC 経由で表示する。未公開の確認は demo モードでのみ可能。
	// 管理者の core.memberships 未登録（forbidden）や Supabase 到達不可でも管理画面自体は落とさない（v0.12.1 と同じ安全側設計）
	const listsP: Promise<{ guides: Awaited<ReturnType<typeof sbListHouseGuides>>; tokens: StayToken[]; loadError: string | null }> = client
		? Promise.all([sbListStayTokens(client, facilityUuid, includeInactive), sbListHouseGuides(facilityUuid, 'ja')]).then(
				([tokens, guides]) => ({ guides, tokens, loadError: null }),
				(e) => ({
					guides: [],
					tokens: [] as StayToken[],
					loadError:
						'Supabase からの取得に失敗しました。管理者アカウントの core.memberships 登録（施設アクセス権）を確認してください。' +
						(e instanceof Error ? `（${e.message}）` : '')
				})
			)
		: Promise.resolve({ guides: listHouseGuidesAdmin(currentFacility.id), tokens: listStayTokens(currentFacility.id, includeInactive), loadError: null });

	const [staysR, snsLinks, inroomSettings, intercomR, noticesR, listsR] = await Promise.all([
		staysP,
		loadSnsLinks(currentFacility.id),
		loadInroomSettings(currentFacility.id),
		intercomP,
		noticesP,
		listsP
	]);
	// 案内ページ1件だけの QR（/r/start?f=<slug>&g=<id>）に入れる施設の slug（2026-10-15）
	const facilitySlug = facilities.find((f) => f.id === currentFacility.id)?.slug ?? '';
	return {
		facilitySlug,
		includeInactive,
		date,
		today,
		yesterday,
		live: useSupabaseAdmin,
		snsLinks,
		inroomSettings,
		...staysR,
		...intercomR,
		...noticesR,
		...listsR
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
	// ---- 内線（客室からの Wi-Fi 通話）の設定（admin のみ。DB 側も施設の管理者に限る）----
	intercomSave: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		if (!useSupabaseAdmin) return fail(400, { message: STAYS_NOT_LIVE });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const allDay = form.get('allDay') === 'on';
		const from = String(form.get('from') ?? '');
		const to = String(form.get('to') ?? '');
		let businessHours: BusinessHours = {};
		if (!allDay) {
			if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to) {
				return fail(400, { message: '受付時間は「開始 < 終了」で入力してください（日をまたぐ設定はできません）' });
			}
			const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
			businessHours = Object.fromEntries(days.map((d) => [d, [[from, to]]]));
		}
		const ringTimeoutSec = Math.min(120, Math.max(10, Number(form.get('ringTimeoutSec') ?? 30) || 30));
		try {
			await sbSaveIntercom(createSupabaseServerClient(event), facilityId, {
				isEnabled: form.get('isEnabled') === 'on',
				businessHours,
				ringTimeoutSec,
				rateLimit: 5
			});
		} catch (e) {
			return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
		}
		return { intercomSaved: true };
	},

	// ---- 客室案内フッターの SNS ボタン（施設ごと・admin のみ）----
	snsSave: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const raw: Record<string, string> = {};
		for (const k of SNS_KINDS) {
			const v = String(form.get(k) ?? '').trim();
			if (v && !/^https:\/\/[^\s<>"']+$/i.test(v)) {
				return fail(400, { message: 'URLは https:// で始まる形式で入力してください' });
			}
			raw[k] = v;
		}
		const links = normalizeSnsLinks(raw);
		if (useSupabaseAdmin) {
			try {
				await sbSaveSnsLinks(createSupabaseServerClient(event), facilityId, links);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		} else {
			saveSnsLinksDemo(facilityId, links);
		}
		return { snsSaved: true };
	},

	// ---- 客室案内の表示設定（admin のみ・2026-10-15）----
	inroomSettingsSave: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const frontPhone = String(form.get('frontPhone') ?? '').normalize('NFKC').trim();
		if (frontPhone && (frontPhone.length > 32 || !/^\+?[0-9 ()-]+$/.test(frontPhone) || !/[0-9]/.test(frontPhone))) {
			return fail(400, { message: '電話番号は32文字以内の数字・ハイフン・括弧・先頭の+で入力してください。' });
		}
		const settings = { showFrontCall: form.get('showFrontCall') === 'on', frontPhone };
		if (useSupabaseAdmin) {
			try {
				await sbSaveInroomSettings(createSupabaseServerClient(event), facilityId, settings);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		} else {
			saveInroomSettingsDemo(facilityId, settings);
		}
		return { inroomSettingsSaved: true };
	},

	// ---- 全館の湯量の残りの目安（スタッフも入力できる・2026-10-17）----
	springLevelSave: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const raw = String(form.get('percent') ?? '').trim();
		const percent = raw === '' ? null : Number(raw);
		if (percent !== null && (!Number.isInteger(percent) || percent < 0 || percent > 100)) {
			return fail(400, { message: '湯量の目安は 0〜100 の整数（%）で入力してください' });
		}
		const note = String(form.get('note') ?? '').trim();
		if (note.length > 300) return fail(400, { message: '説明は300文字以内で入力してください' });
		// 段階ごとの表現（画面で組み立てた JSON・2026-10-17）。空・壊れていれば既定に戻す
		let bandsRaw: unknown = null;
		try {
			bandsRaw = JSON.parse(String(form.get('bands') ?? 'null'));
		} catch {
			return fail(400, { message: '表現の設定を読み取れませんでした。もう一度お試しください' });
		}
		const bands = form.get('bandsDefault') === 'on' ? null : normalizeSpringBands(bandsRaw);
		if (bands && !bands.some((b) => b.min === 0)) {
			return fail(400, { message: '表現は「0%以上」の段階を必ず1つ入れてください（残量が少ないときに出す言葉です）' });
		}
		const input = { enabled: form.get('enabled') === 'on', percent, note, bands };
		if (useSupabaseAdmin) {
			try {
				await sbSaveSpringLevel(createSupabaseServerClient(event), facilityId, input);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '保存に失敗しました' });
			}
		} else {
			saveSpringLevelDemo(facilityId, input);
		}
		return { springLevelSaved: true };
	},

	// ---- 全客室へのお知らせ（スタッフも出せる・2026-10-17）----
	noticeSend: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '権限がありません' });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const body = String(form.get('body') ?? '').trim();
		if (!body) return fail(400, { message: 'お知らせの本文を入力してください' });
		if (title.length > 100 || body.length > 2000) return fail(400, { message: 'タイトルは100文字・本文は2000文字までです' });
		// 掲載終了（datetime-local は JST として読む）。空なら取り下げるまで出す
		const endsRaw = String(form.get('endsAt') ?? '').trim();
		let endsAt: string | null = null;
		if (endsRaw) {
			const d = new Date(`${endsRaw}:00+09:00`);
			if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endsRaw) || isNaN(d.getTime())) {
				return fail(400, { message: '掲載終了の日時を正しく入力してください' });
			}
			if (d.getTime() <= Date.now()) return fail(400, { message: '掲載終了は今より後の日時にしてください' });
			endsAt = d.toISOString();
		}
		// 掲載中のお知らせの編集（2026-10-17）。既定は書き換えるだけ（確認済みの端末には出さない）。
		// 「確認済みの端末にももう一度出す」なら、今のを取り下げて新しいお知らせとして出し直す（既読は id ごとのため）
		const editId = String(form.get('noticeId') ?? '');
		const reshow = form.get('reshow') === 'on';
		const input = { title, body, endsAt };
		if (useSupabaseAdmin) {
			try {
				const client = createSupabaseServerClient(event);
				if (editId && !reshow) await sbSaveNotice(client, facilityId, input, editId);
				else {
					if (editId) await sbEndNotice(client, editId);
					await sbSaveNotice(client, facilityId, input);
				}
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : 'お知らせを出せませんでした' });
			}
		} else if (editId && !reshow) {
			updateNoticeDemo(editId, input);
		} else {
			if (editId) endNoticeDemo(editId);
			saveNoticeDemo(facilityId, input);
		}
		if (editId) return { noticeEdited: reshow ? 'reshow' : 'quiet' };
		return { noticeSent: true };
	},
	noticeEnd: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '権限がありません' });
		const id = String((await event.request.formData()).get('noticeId') ?? '');
		if (!id) return fail(400, { message: '対象が不明です' });
		if (useSupabaseAdmin) {
			try {
				await sbEndNotice(createSupabaseServerClient(event), id);
			} catch (e) {
				return fail(500, { message: e instanceof Error ? e.message : '取り下げに失敗しました' });
			}
		} else {
			endNoticeDemo(id);
		}
		return { noticeEnded: true };
	},

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
	},

	// ---- 実際のご予約から公開URL・QRを出す（/admin/bath の QR テストと同じ仕組み）----
	// 発行済みなら同じトークンを取り出すだけなので、何度押しても URL は変わらない。
	issueQr: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
			return fail(403, { message: '権限がありません' });
		}
		if (!useSupabaseAdmin) return fail(503, { message: STAYS_NOT_LIVE });
		const form = await event.request.formData();
		const facilityId = String(form.get('facilityId') ?? '');
		const stay = {
			stay_id: String(form.get('stayId') ?? ''),
			room_code: String(form.get('roomCode') ?? ''),
			guest_name: String(form.get('guestName') ?? ''),
			check_out_date: String(form.get('checkOutDate') ?? '')
		};
		if (!stay.stay_id || !/^\d{4}-\d{2}-\d{2}$/.test(stay.check_out_date)) {
			return fail(400, { message: '対象のご予約が分かりません' });
		}
		try {
			const r = await sbGetOrIssueStayToken(
				createSupabaseServerClient(event),
				FACILITY_UUID[facilityId] ?? facilityId,
				stay
			);
			return {
				qr: {
					token: r.token,
					shortCode: r.short_code,
					roomCode: stay.room_code,
					guestName: stay.guest_name,
					checkOutDate: stay.check_out_date
				}
			};
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : 'URLの取得に失敗しました' });
		}
	}
};
