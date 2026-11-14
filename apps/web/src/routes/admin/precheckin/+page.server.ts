// 事前チェックインの状況一覧（docs/pre-checkin.md §2・§13 P2）。
// チェックイン日で絞った予約（代表 1 行）に、送信・開封・回答の状態と「送る／再送」ボタンを出す。
// 送信は、メールの手動ボタン（P2）と、携帯番号のときの「SMSで送る／再送」（P4・NTT CPaaS）。当日 9:00 の自動送信は /api/cron/precheckin-send。
import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import { toFacilityUuidStrict } from '$lib/server/supabase-data';
import {
	adminPrecheckinAutosend,
	adminPrecheckinAutosendOverrides,
	adminPrecheckinCaps,
	adminPrecheckinList,
	adminPrecheckinMinutes,
	adminPrecheckinQuestions,
	adminPrecheckinSaveAutosend,
	adminPrecheckinSaveCaps,
	adminPrecheckinSaveMinutes,
	adminPrecheckinSaveQuestions,
	adminPrecheckinSetAutosend,
	sendPrecheckin,
	type PrecheckinCaps,
	type PrecheckinListRow
} from '$lib/server/precheckin';
import { adminSmsStatus, sendPrecheckinSms, smsReady } from '$lib/server/precheckin-sms';
import { customerLinkOrigin } from '$lib/server/public-origin';
import { autosendEnabled, type AutosendSettings, type SmsStatusRow } from '$lib/precheckin-sms';
import { env as privateEnv } from '$env/dynamic/private';
import { addDays, todayStr } from '$lib/format';
import type { MealMinutes } from '$lib/precheckin-p3';
import type { PcQuestion } from '$lib/precheckin';
import { currentFacilityOf } from '$lib/server/admin-content-page';
import type { Actions, PageServerLoad } from './$types';

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function precheckinError(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
	if (msg.includes('partner_booking')) return '取引先経由のご予約は事前チェックインの対象外です。';
	if (msg.includes('stay_expired')) return 'このご滞在は終わっているため送れません。';
	if (msg.includes('invalid_params')) return '期間は 32 日以内で指定してください。';
	return mapRpcError(e);
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const today = todayStr();
	const fromQ = event.url.searchParams.get('from');
	const toQ = event.url.searchParams.get('to');
	const from = isDate(fromQ) ? fromQ : today;
	const to = isDate(toQ) && toQ >= from ? toQ : from;
	const filters = { from, to, today, tomorrow: addDays(today, 1) };

	if (!ADMIN_SUPABASE) {
		return {
			live: false as const,
			filters,
			list: [] as PrecheckinListRow[],
			caps: null as PrecheckinCaps | null,
			minutes: null as MealMinutes | null,
			questions: null as PcQuestion[] | null,
			autosend: null as AutosendSettings | null,
			overrides: {} as Record<string, boolean>,
			autosendSystemOn: autosendEnabled(privateEnv.PRECHECKIN_AUTOSEND),
			sms: [] as SmsStatusRow[],
			smsReady: smsReady(),
			error: null as string | null
		};
	}
	const client = bookAdmin(event);
	const facility = toFacilityUuidStrict(currentFacility.id);
	const [list, caps, sms, minutes, questions, autosend] = await Promise.all([
		adminPrecheckinList(client, facility, from, to).then(
			(rows) => ({ rows, error: null as string | null }),
			(e) => ({ rows: [] as PrecheckinListRow[], error: precheckinError(e) })
		),
		adminPrecheckinCaps(client, facility).catch(() => null as PrecheckinCaps | null),
		// SMS の状態（P4 の DB が未適用なら空のまま一覧は出す）
		adminSmsStatus(client, facility, from, to).catch(() => [] as SmsStatusRow[]),
		// 食事の所要時間の目安（DB 未適用なら欄を出さない）
		adminPrecheckinMinutes(client, facility).catch(() => null as MealMinutes | null),
		// 宿からの質問（DB 未適用なら欄を出さない）
		adminPrecheckinQuestions(client, facility).catch(() => null as PcQuestion[] | null),
		// 自動送信の対象（DB 未適用なら欄を出さない）
		adminPrecheckinAutosend(client, facility).catch(() => null as AutosendSettings | null)
	]);
	const overrides = autosend
		? await adminPrecheckinAutosendOverrides(client, facility, list.rows.map((r) => r.stay_id)).catch(() => ({}) as Record<string, boolean>)
		: ({} as Record<string, boolean>);
	return {
		live: true as const,
		filters,
		list: list.rows,
		caps,
		minutes,
		questions,
		autosend,
		overrides,
		autosendSystemOn: autosendEnabled(privateEnv.PRECHECKIN_AUTOSEND),
		sms,
		smsReady: smsReady(),
		error: list.error
	};
};

export const actions: Actions = {
	// 送る／再送（新しいリンクを発行する。前のメールのリンクは無効になる）
	send: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { sendError: 'この環境では送れません（本番データに繋がっていません）。', sentStay: null as string | null });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const stayId = String(form.get('stay_id') ?? '');
		if (!/^[0-9a-f-]{36}$/.test(stayId)) return fail(400, { sendError: '対象のご予約が分かりません。', sentStay: null });
		try {
			const r = await sendPrecheckin(event, bookAdmin(event), facility, stayId);
			if (!r.sent) return fail(502, { sendError: `メールを送れませんでした（${r.reason ?? '不明'}）。一覧の「送信失敗」に理由を残しました。`, sentStay: stayId });
			return { sentStay: stayId, sentTo: r.to, sendError: null as string | null };
		} catch (e) {
			return fail(400, { sendError: precheckinError(e), sentStay: stayId });
		}
	},
	// SMSで送る／再送（P4）。直近 1 時間に送っていれば確認を求める（force=1 で送り直す）
	sms: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { sendError: 'この環境では送れません（本番データに繋がっていません）。', sentStay: null as string | null });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const stayId = String(form.get('stay_id') ?? '');
		const force = form.get('force') === '1';
		if (!/^[0-9a-f-]{36}$/.test(stayId)) return fail(400, { sendError: '対象のご予約が分かりません。', sentStay: null });
		try {
			const r = await sendPrecheckinSms(bookAdmin(event), facility, stayId, force, customerLinkOrigin(event.url));
			if (!r.sent) {
				// 直近に送っている: 画面で確認を出して force で送り直す
				if (r.code === 'recent') return fail(409, { sendError: null as string | null, smsConfirmStay: stayId, smsLastAt: r.lastAt ?? null, sentStay: stayId });
				return fail(r.code === 'send_failed' ? 502 : 400, { sendError: r.message, sentStay: stayId });
			}
			return { sentStay: stayId, smsSentTo: r.toMasked, sendError: null as string | null };
		} catch (e) {
			return fail(400, { sendError: precheckinError(e), sentStay: stayId });
		}
	},
	// 食事の時間枠ごとの受付上限（室数）。空欄は上限なし
	caps: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { capsError: 'この環境では保存できません。' });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const caps: { type: string; time: string; max_rooms: string | null }[] = [];
		for (const [k, v] of form.entries()) {
			const m = /^cap\|(dinner|breakfast)\|(\d{2}:\d{2})$/.exec(k);
			if (!m) continue;
			const n = String(v ?? '').trim();
			if (n !== '' && !/^\d{1,3}$/.test(n)) return fail(400, { capsError: '上限は 0〜999 の数で入れてください（空欄は上限なし）。' });
			caps.push({ type: m[1], time: m[2], max_rooms: n === '' ? null : n });
		}
		try {
			await adminPrecheckinSaveCaps(bookAdmin(event), facility, caps);
			return { capsSaved: true, capsError: null as string | null };
		} catch (e) {
			return fail(400, { capsError: precheckinError(e) });
		}
	},
	// 宿からの質問（お客様の回答は必須）。q|<n> の並び順が表示順、qid|<n> は既存の質問の id
	questions: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { questionsError: 'この環境では保存できません。' });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const rows: { n: number; id: string | null; question: string }[] = [];
		for (const [k, v] of form.entries()) {
			const m = /^q\|(\d{1,2})$/.exec(k);
			if (!m) continue;
			const question = String(v ?? '').trim();
			if (!question) continue;
			if (question.length > 300) return fail(400, { questionsError: '質問は 1 問 300 字までにしてください。' });
			const id = String(form.get(`qid|${m[1]}`) ?? '').trim();
			rows.push({ n: Number(m[1]), id: /^[0-9a-f-]{36}$/.test(id) ? id : null, question });
		}
		if (rows.length > 20) return fail(400, { questionsError: '質問は 20 問までにしてください。' });
		try {
			await adminPrecheckinSaveQuestions(bookAdmin(event), facility, rows.sort((a, b) => a.n - b.n).map(({ id, question }) => ({ id, question })));
			return { questionsSaved: true, questionsError: null as string | null };
		} catch (e) {
			return fail(400, { questionsError: precheckinError(e) });
		}
	},
	// 自動送信（当日 9:00）の対象: 自動送信するか・送る予約経路
	autosend: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { autosendError: 'この環境では保存できません。' });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const routes = form.getAll('route').map(String).filter((r) => /^[a-z0-9_-]{1,40}$/.test(r));
		try {
			await adminPrecheckinSaveAutosend(bookAdmin(event), facility, form.get('enabled') === '1', routes);
			return { autosendSaved: true, autosendError: null as string | null };
		} catch (e) {
			return fail(400, { autosendError: precheckinError(e) });
		}
	},
	// 予約ごとの上書き（mode = auto 経路どおり／on 送る／off 送らない）
	autosendRow: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { sendError: 'この環境では保存できません。', sentStay: null as string | null });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const stayId = String(form.get('stay_id') ?? '');
		const mode = String(form.get('mode') ?? 'auto');
		if (!/^[0-9a-f-]{36}$/.test(stayId)) return fail(400, { sendError: '対象のご予約が分かりません。', sentStay: null });
		try {
			await adminPrecheckinSetAutosend(bookAdmin(event), facility, stayId, mode === 'on' ? true : mode === 'off' ? false : null);
			return { autosendRowSaved: stayId };
		} catch (e) {
			return fail(400, { sendError: precheckinError(e), sentStay: stayId });
		}
	},
	// 食事の所要時間の目安（分）。貸切風呂の時間を選ぶときの目安として、お客様の画面に出す
	minutes: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { minutesError: 'この環境では保存できません。' });
		const facility = currentFacilityOf(event).uuid;
		const form = await event.request.formData();
		const n = (k: string) => String(form.get(k) ?? '').trim();
		const d = n('dinner');
		const b = n('breakfast');
		if (!/^\d{1,3}$/.test(d) || !/^\d{1,3}$/.test(b) || Number(d) > 600 || Number(b) > 600) {
			return fail(400, { minutesError: '所要時間は 0〜600 分の数で入れてください。' });
		}
		try {
			await adminPrecheckinSaveMinutes(bookAdmin(event), facility, { dinner: Number(d), breakfast: Number(b) });
			return { minutesSaved: true, minutesError: null as string | null };
		} catch (e) {
			return fail(400, { minutesError: precheckinError(e) });
		}
	}
};
