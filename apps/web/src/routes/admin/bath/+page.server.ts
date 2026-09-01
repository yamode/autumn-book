// 管理画面: 貸切風呂の予約フォーム（/r/bath）の中身を編集する ＋ QR コードのテスト。
//
// ■ 保存先は必ず実データ
//   admin の書き込みは DATA_SOURCE=supabase かつ AUTH_MODE=supabase のときだけ通す。
//   デモ（プロセス内メモリ）へ書くと Cloudflare Workers では isolate ごとに消え、
//   「保存したのに初期値に戻る」が起きる（この repo が v0.32.1 で踏んだのと同じ罠）。
//   条件を満たさないときは **黙って成功させず**、その旨を画面に出す。
//
// ■ QR テストは「実際の予約」で行う（2026-08-31 決定）
//   その日に泊まっているお客様を選び、トークンを取り出して（無ければ発行して）QR にする。
//   館内図に刷る前に、スマホで読んで /r/bath まで実際に通せる。
//   発行は get-or-create なので、何度押しても同じ QR になる。
import { fail } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import {
	sbBathContentSave,
	sbBathContentsAdmin,
	sbGetOrIssueStayToken,
	sbListBookableStays,
	sbUploadBathPhoto,
	type BookableStay
} from '$lib/server/private-bath';
import {
	BATH_CONTENT_FIELDS,
	EMPTY_BATH_CONTENT,
	normalizeBathContent,
	type BathContent
} from '$lib/private-bath-content';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const LANGS = ['ja', 'en', 'zh-TW'] as const;
type Lang = (typeof LANGS)[number];

const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';
const parseLang = (v: unknown): Lang =>
	(LANGS as readonly string[]).includes(String(v ?? '')) ? (String(v) as Lang) : 'ja';

const NOT_LIVE =
	'この環境では保存できません（管理画面が実データに繋がっていません）。本番でお試しください。';

function facilityUuidOf(id: string): string {
	return FACILITY_UUID[id] ?? id;
}

/**
 * いま選んでいる施設。action からは event.parent() を呼べないので、
 * 管理画面の共通レイアウトと同じ `ab_fac` クッキーから解決する。
 */
function currentFacilityOf(event: RequestEvent): { id: string; name: string } {
	const facId = event.cookies.get('ab_fac') ?? facilities[0].id;
	const f = facilities.find((x) => x.id === facId) ?? facilities[0];
	return { id: f.id, name: f.name };
}

/** 編集できるのは管理者・スタッフだけ（他の管理画面と同じ線引き）。 */
function denyIfNotStaff(event: RequestEvent) {
	const role = event.locals.user?.role;
	if (role !== 'admin' && role !== 'staff') return fail(403, { error: '権限がありません。' });
	return null;
}

/** その施設の3言語ぶんの中身。読めなければ空で返す（画面は落とさない）。 */
async function loadContents(event: RequestEvent, facilityUuid: string) {
	if (!useSupabaseAdmin) return { contents: {} as Record<string, BathContent>, error: NOT_LIVE };
	try {
		const client = createSupabaseServerClient(event);
		return { contents: await sbBathContentsAdmin(client, facilityUuid), error: null };
	} catch (e) {
		return { contents: {} as Record<string, BathContent>, error: messageOf(e) };
	}
}

function messageOf(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	if (m.includes('forbidden')) return 'この施設を編集する権限がありません。';
	if (m.includes('not_authenticated')) return 'ログインし直してください。';
	return m;
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const facilityUuid = facilityUuidOf(currentFacility.id);
	const date = /^\d{4}-\d{2}-\d{2}$/.test(event.url.searchParams.get('date') ?? '')
		? (event.url.searchParams.get('date') as string)
		: null;

	const { contents, error } = await loadContents(event, facilityUuid);

	// QR テスト用の滞在一覧。権限が無い・繋がらないだけで画面を落とさない。
	let stays: BookableStay[] = [];
	let staysError: string | null = useSupabaseAdmin ? null : NOT_LIVE;
	if (useSupabaseAdmin) {
		try {
			stays = await sbListBookableStays(createSupabaseServerClient(event), facilityUuid, date);
		} catch (e) {
			staysError = messageOf(e);
		}
	}

	return {
		fields: BATH_CONTENT_FIELDS,
		langs: LANGS,
		contents,
		loadError: error,
		stays,
		staysError,
		date,
		live: useSupabaseAdmin,
		facilityName: currentFacility.name
	};
};

/** フォームから1言語ぶんの中身を組み立てる（写真は hidden の JSON で持ち回る）。 */
function contentFromForm(fd: FormData): BathContent {
	const fields: Record<string, string> = {};
	for (const f of BATH_CONTENT_FIELDS) fields[f.key] = String(fd.get(`f_${f.key}`) ?? '');
	let images: unknown = [];
	try {
		images = JSON.parse(String(fd.get('imagesJson') ?? '[]'));
	} catch {
		images = [];
	}
	return normalizeBathContent({ fields, images });
}

export const actions: Actions = {
	// 文章の保存（写真は下の action で即時保存されるので、ここでは持ち回った値をそのまま書く）
	save: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!useSupabaseAdmin) return fail(503, { error: NOT_LIVE });
		const currentFacility = currentFacilityOf(event);
		const fd = await event.request.formData();
		const lang = parseLang(fd.get('lang'));
		try {
			await sbBathContentSave(
				createSupabaseServerClient(event),
				facilityUuidOf(currentFacility.id),
				lang,
				contentFromForm(fd)
			);
			return { saved: lang };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	},

	// 写真の追加。アップロードしてから、その言語の中身へ足して保存まで済ませる
	// （画面を離れて戻ってきたら消えていた、が起きないように）。
	addPhoto: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!useSupabaseAdmin) return fail(503, { error: NOT_LIVE });
		const facilityUuid = facilityUuidOf(currentFacilityOf(event).id);
		const fd = await event.request.formData();
		const lang = parseLang(fd.get('lang'));
		const file = fd.get('photo');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: '写真を選んでください。' });
		if (file.size > 10 * 1024 * 1024) return fail(400, { error: '写真は10MBまでです。' });

		try {
			const client = createSupabaseServerClient(event);
			const url = await sbUploadBathPhoto(client, facilityUuid, file);
			const cur = contentFromForm(fd);
			const next = normalizeBathContent({
				fields: cur.fields,
				images: [...cur.images, { url, caption: String(fd.get('caption') ?? ''), sort: 999 }]
			});
			await sbBathContentSave(client, facilityUuid, lang, next);
			return { saved: lang, added: true };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	},

	// 写真の削除・並べ替え。どちらもその場で保存する。
	// （Storage のファイルは消さない ── 別の言語や過去の版がまだ参照している可能性があるため）
	editPhoto: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!useSupabaseAdmin) return fail(503, { error: NOT_LIVE });
		const currentFacility = currentFacilityOf(event);
		const fd = await event.request.formData();
		const lang = parseLang(fd.get('lang'));
		const op = String(fd.get('op') ?? '');
		const index = Number(fd.get('index') ?? -1);
		const cur = contentFromForm(fd);
		const images = [...cur.images];
		if (index < 0 || index >= images.length) return fail(400, { error: '対象の写真が分かりません。' });

		if (op === 'remove') images.splice(index, 1);
		else if (op === 'up' && index > 0) [images[index - 1], images[index]] = [images[index], images[index - 1]];
		else if (op === 'down' && index < images.length - 1)
			[images[index], images[index + 1]] = [images[index + 1], images[index]];

		try {
			await sbBathContentSave(
				createSupabaseServerClient(event),
				facilityUuidOf(currentFacility.id),
				lang,
				normalizeBathContent({ fields: cur.fields, images: images.map((x, i) => ({ ...x, sort: i })) })
			);
			return { saved: lang };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	},

	// QR テスト: その予約のトークンを取り出す（無ければ発行）。
	issueQr: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!useSupabaseAdmin) return fail(503, { error: NOT_LIVE });
		const currentFacility = currentFacilityOf(event);
		const fd = await event.request.formData();
		const stay = {
			stay_id: String(fd.get('stayId') ?? ''),
			room_code: String(fd.get('roomCode') ?? ''),
			guest_name: String(fd.get('guestName') ?? ''),
			check_out_date: String(fd.get('checkOutDate') ?? '')
		};
		if (!stay.stay_id || !/^\d{4}-\d{2}-\d{2}$/.test(stay.check_out_date)) {
			return fail(400, { error: '対象の予約が分かりません。' });
		}
		try {
			const r = await sbGetOrIssueStayToken(
				createSupabaseServerClient(event),
				facilityUuidOf(currentFacility.id),
				stay
			);
			return { qr: { ...r, stayId: stay.stay_id, roomCode: stay.room_code } };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	}
};
