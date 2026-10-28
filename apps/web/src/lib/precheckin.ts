// 事前チェックイン（P2・docs/pre-checkin.md）の純関数。DB に触らない（単体テスト: precheckin.test.ts）。
//
// DB 定義: autumn-shared 20261028220125_book_precheckin_p2.sql
//   - book.precheckin_context の戻り（jsonb）→ normalizePrecheckinContext
//   - book.admin_precheckin_list の行 → precheckinState（画面の状態）
//   - マスクは DB の book._mask_phone / _mask_email と同じ規則（フォームの再表示・管理画面の一覧で使う）

export type PcMealType = 'dinner' | 'breakfast';
export const PC_MEAL_TYPES: readonly PcMealType[] = ['dinner', 'breakfast'];

/** 時間枠。remaining = このお客様の部屋を除いた残り室数（null = 上限なし） */
export type PcSlot = { time: string; max: number | null; remaining: number | null };
export type PcMealCell = { date: string; offered: boolean; time: string | null };
export type PcNight = { nightDate: string; stayId: string; dinner: PcMealCell; breakfast: PcMealCell };
export type PcRoom = { index: number; stayId: string; label: string; nights: PcNight[] };
export type PcContact = { name?: string; name_kana?: string; phone?: string; email?: string };
export type PcMealChoice = { stay_id: string; type: PcMealType; date: string; time: string };
export type PcAnswers = {
	contact?: PcContact;
	arrival_time?: string | null;
	companions?: number | null;
	allergies?: string | null;
	requests?: string | null;
	locale?: string;
	basic_saved_at?: string;
	meals?: PcMealChoice[];
	meals_saved_at?: string;
};
export type PcContext = {
	facility: { id: string; slug: string; name: string; timezone: string };
	bookingCode: string;
	checkIn: string;
	checkOut: string;
	nights: number;
	roomCount: number;
	adults: number;
	children: number;
	guest: { name: string; nameKana: string; phoneMasked: string; emailMasked: string };
	editableUntil: string;
	editable: boolean;
	expiresAt: string;
	answers: PcAnswers;
	answeredAt: string | null;
	rooms: PcRoom[];
	slots: Record<PcMealType, Record<string, PcSlot[]>>;
};
/** フォームを開けない理由 */
export type PcError = 'invalid_token' | 'expired' | 'cancelled' | 'locked' | 'none';

// ---------------------------------------------------------------- マスク・連絡先

/** 電話番号は下 4 桁だけ残す（DB の book._mask_phone と同じ） */
export function maskPhone(phone: string | null | undefined): string {
	const d = String(phone ?? '').replace(/\D/g, '');
	if (!String(phone ?? '').trim()) return '';
	if (d.length <= 4) return '****';
	return '*'.repeat(d.length - 4) + d.slice(-4);
}

/** メールはローカル部の先頭 2 文字だけ残す（DB の book._mask_email と同じ） */
export function maskEmail(email: string | null | undefined): string {
	const e = String(email ?? '').trim();
	const at = e.indexOf('@');
	if (!e || at < 0) return '';
	return `${e.slice(0, Math.min(2, at))}***@${e.slice(at + 1)}`;
}

/** 国内の携帯番号（070 / 080 / 090・+81 表記も）か。SMS を送れる番号の判定（P4 で使う。P2 は一覧の印だけ） */
export function isMobileJp(phone: string | null | undefined): boolean {
	let d = String(phone ?? '').replace(/[^\d+]/g, '');
	if (d.startsWith('+81')) d = '0' + d.slice(3);
	else if (d.startsWith('81') && d.length === 12) d = '0' + d.slice(2);
	d = d.replace(/\D/g, '');
	return /^0[789]0\d{8}$/.test(d);
}

/** 'H:MM' → 'HH:MM'（PMS の normalizeTime と同じ）。形が違えば null */
export function normTime(t: string | null | undefined): string | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 29 || min > 59) return null;
	return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// ---------------------------------------------------------------- 期限

/** 施設の日付 + 時刻（JST 固定。施設はどちらも Asia/Tokyo）→ ISO */
export function jstAt(date: string, hour: number): string {
	return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString();
}

/** 回答を直せる期限 = チェックイン日 12:00 */
export const editableUntilOf = (checkIn: string) => jstAt(checkIn, 12);
/** リンクの有効期限 = チェックアウト日 11:00 */
export const expiresAtOf = (checkOut: string) => jstAt(checkOut, 11);

/** その時刻（ISO）より前か。読めない値は false（閉じている側に倒す） */
export function isBefore(untilIso: string | null | undefined, now = new Date()): boolean {
	const t = Date.parse(String(untilIso ?? ''));
	return Number.isFinite(t) && now.getTime() < t;
}

/** Cookie（ab_ci）の寿命: リンクの期限 + 1 日（最低 1 時間） */
export function precheckinCookieMaxAge(expiresAt: string, now = Date.now()): number {
	const t = Date.parse(expiresAt);
	if (!Number.isFinite(t)) return 3600;
	return Math.max(3600, Math.ceil((t - now) / 1000) + 86_400);
}

// ---------------------------------------------------------------- 管理画面の状態

export type PrecheckinState = 'no_contact' | 'unsent' | 'sent' | 'opened' | 'answered' | 'failed';

export const PRECHECKIN_STATE_LABEL: Record<PrecheckinState, string> = {
	no_contact: '連絡先なし（メールなし）',
	unsent: '未送信',
	sent: '送信済',
	opened: '開封済',
	answered: '回答済',
	failed: '送信失敗'
};

export const PRECHECKIN_STATE_CLASS: Record<PrecheckinState, string> = {
	no_contact: 'bg-stone-100 text-stone-500 ring-stone-200',
	unsent: 'bg-white text-stone-700 ring-stone-300',
	sent: 'bg-sky-50 text-sky-800 ring-sky-200',
	opened: 'bg-amber-50 text-amber-800 ring-amber-200',
	answered: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	failed: 'bg-red-50 text-red-700 ring-red-200'
};

export type PrecheckinListLike = {
	email: string | null;
	precheckin_id: string | null;
	status: string | null;
	sent_at: string | null;
	first_opened_at: string | null;
	answered_at: string | null;
};

/** 一覧の状態。回答 > 開封 > 送信失敗 > 送信済 > 連絡先なし > 未送信 */
export function precheckinState(r: PrecheckinListLike): PrecheckinState {
	if (r.answered_at) return 'answered';
	if (r.first_opened_at) return 'opened';
	if (r.precheckin_id && r.status === 'failed') return 'failed';
	if (r.sent_at) return 'sent';
	if (!r.email) return 'no_contact';
	return 'unsent';
}

/** 送れるか（メールがあって、まだ期限内） */
export function canSend(r: { email: string | null; check_out_date: string }, now = new Date()): boolean {
	return Boolean(r.email) && isBefore(expiresAtOf(r.check_out_date), now);
}

// ---------------------------------------------------------------- 修正の差分

export const CONTACT_FIELDS: { key: keyof PcContact; label: string }[] = [
	{ key: 'name', label: '氏名' },
	{ key: 'name_kana', label: 'フリガナ' },
	{ key: 'phone', label: '電話番号' },
	{ key: 'email', label: 'メール' }
];

/** 予約の連絡先とお客様の修正の差分（同じ値の修正は出さない） */
export function contactDiff(
	original: Partial<Record<keyof PcContact, string | null>>,
	contact: PcContact | null | undefined
): { key: keyof PcContact; label: string; from: string; to: string }[] {
	const same = (k: keyof PcContact, a: string, b: string) =>
		k === 'phone' ? a.replace(/\D/g, '') === b.replace(/\D/g, '') : a.trim().toLowerCase() === b.trim().toLowerCase();
	return CONTACT_FIELDS.flatMap(({ key, label }) => {
		const to = String(contact?.[key] ?? '').trim();
		const from = String(original[key] ?? '').trim();
		return to && !same(key, from, to) ? [{ key, label, from, to }] : [];
	});
}

// ---------------------------------------------------------------- 食事の時間枠

/** その時間を選べるか。満席でも今の時間（変えない）は選べたままにする */
export function slotSelectable(slot: PcSlot, current: string | null): boolean {
	if (current && normTime(current) === slot.time) return true;
	return slot.remaining === null || slot.remaining > 0;
}

export type MealCheck =
	| { ok: true; changed: PcMealChoice[] }
	| { ok: false; error: 'invalid_meal' | 'slot_full'; type?: PcMealType; date?: string; time?: string };

/**
 * フォームの選択を確かめる（RPC book.precheckin_save_meals と同じ規則）。
 *   - その部屋のその泊に付いている食事か・その日に選べる時間か
 *   - 受付上限: 残り（自分の部屋を除く）から、変えない自分の部屋のぶんを引いた数まで
 * changed は今と違う時間だけ（RPC に送る候補）。
 */
export function checkMealChoices(ctx: Pick<PcContext, 'rooms' | 'slots'>, choices: PcMealChoice[]): MealCheck {
	const cells = new Map<string, PcMealCell>();
	for (const r of ctx.rooms)
		for (const n of r.nights) for (const t of PC_MEAL_TYPES) cells.set(`${n.stayId}|${t}|${n[t].date}`, n[t]);

	const latest = new Map<string, PcMealChoice>();
	for (const c of choices) {
		if (!c.time) continue;
		const time = normTime(c.time);
		const cell = cells.get(`${c.stay_id}|${c.type}|${c.date}`);
		if (!time || !cell || !cell.offered) return { ok: false, error: 'invalid_meal' };
		const slots = ctx.slots[c.type]?.[c.date] ?? [];
		// 今の時間（宿が時間枠の外で決めた時間も）はそのまま通す
		if (cell.time !== time && !slots.some((s) => s.time === time)) return { ok: false, error: 'invalid_meal', type: c.type, date: c.date, time };
		latest.set(`${c.stay_id}|${c.type}|${c.date}`, { ...c, time });
	}
	const changed = [...latest.entries()].filter(([k, c]) => cells.get(k)?.time !== c.time).map(([, c]) => c);
	const changedKeys = new Set(changed.map((c) => `${c.stay_id}|${c.type}|${c.date}`));

	// 時間枠ごとに「今回その時間にする部屋の数」と「その時間のまま変えない自分の部屋の数」
	const want = new Map<string, number>();
	for (const c of changed) want.set(`${c.type}|${c.date}|${c.time}`, (want.get(`${c.type}|${c.date}|${c.time}`) ?? 0) + 1);
	for (const [key, n] of want) {
		const [type, date, time] = key.split('|') as [PcMealType, string, string];
		const slot = (ctx.slots[type]?.[date] ?? []).find((s) => s.time === time);
		if (!slot || slot.remaining === null) continue;
		let keep = 0;
		for (const [k, cell] of cells) {
			const [, t, d] = k.split('|');
			if (t === type && d === date && cell.time === time && !changedKeys.has(k)) keep++;
		}
		if (n > slot.remaining - keep) return { ok: false, error: 'slot_full', type, date, time };
	}
	return { ok: true, changed };
}

/** 付いている食事が 1 つも無いか（素泊まりなど。食事のステップは案内だけにする） */
export function hasAnyMeal(rooms: PcRoom[]): boolean {
	return rooms.some((r) => r.nights.some((n) => n.dinner.offered || n.breakfast.offered));
}

// ---------------------------------------------------------------- RPC の戻りを整える

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function cellOf(raw: unknown): PcMealCell {
	const r = (raw ?? {}) as Record<string, unknown>;
	return { date: str(r.date).slice(0, 10), offered: r.offered === true, time: normTime(str(r.time)) };
}

function slotsOf(raw: unknown): Record<string, PcSlot[]> {
	const out: Record<string, PcSlot[]> = {};
	for (const [date, list] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(list)) continue;
		out[date] = list
			.map((s) => (s ?? {}) as Record<string, unknown>)
			.map((s) => ({
				time: normTime(str(s.time)) ?? '',
				max: s.max === null || s.max === undefined ? null : num(s.max),
				remaining: s.remaining === null || s.remaining === undefined ? null : num(s.remaining)
			}))
			.filter((s) => s.time);
	}
	return out;
}

/** book.precheckin_context の戻りを画面用に整える。ok=false は理由を返す */
export function normalizePrecheckinContext(raw: unknown): PcContext | { error: PcError } {
	const r = (raw ?? {}) as Record<string, unknown>;
	if (r.ok !== true) {
		const e = str(r.error);
		return { error: e === 'expired' || e === 'cancelled' ? e : 'invalid_token' };
	}
	const f = (r.facility ?? {}) as Record<string, unknown>;
	const g = (r.guest ?? {}) as Record<string, unknown>;
	const slots = (r.slots ?? {}) as Record<string, unknown>;
	const rooms = (Array.isArray(r.rooms) ? r.rooms : []).map((x) => {
		const room = (x ?? {}) as Record<string, unknown>;
		return {
			index: num(room.index),
			stayId: str(room.stay_id),
			label: str(room.label),
			nights: (Array.isArray(room.nights) ? room.nights : []).map((n) => {
				const night = (n ?? {}) as Record<string, unknown>;
				return {
					nightDate: str(night.night_date).slice(0, 10),
					stayId: str(night.stay_id),
					dinner: cellOf(night.dinner),
					breakfast: cellOf(night.breakfast)
				};
			})
		};
	});
	return {
		facility: { id: str(f.id), slug: str(f.slug), name: str(f.name), timezone: str(f.timezone) || 'Asia/Tokyo' },
		bookingCode: str(r.booking_code),
		checkIn: str(r.check_in).slice(0, 10),
		checkOut: str(r.check_out).slice(0, 10),
		nights: num(r.nights),
		roomCount: num(r.room_count) || rooms.length || 1,
		adults: num(r.adults),
		children: num(r.children),
		guest: { name: str(g.name), nameKana: str(g.name_kana), phoneMasked: str(g.phone_masked), emailMasked: str(g.email_masked) },
		editableUntil: str(r.editable_until),
		editable: r.editable === true,
		expiresAt: str(r.expires_at),
		answers: (r.answers && typeof r.answers === 'object' ? r.answers : {}) as PcAnswers,
		answeredAt: r.answered_at ? str(r.answered_at) : null,
		rooms,
		slots: { dinner: slotsOf(slots.dinner), breakfast: slotsOf(slots.breakfast) }
	};
}

/** フォームの「基本情報」の送信値を RPC の形にする（空欄は落とす） */
export function answersFromForm(form: FormData, locale: string): PcAnswers & { contact: PcContact } {
	const t = (k: string) => String(form.get(k) ?? '').trim();
	const contact: PcContact = {};
	for (const { key } of CONTACT_FIELDS) {
		const v = t(`contact_${key}`);
		if (v) contact[key] = v;
	}
	const comp = t('companions');
	return {
		contact,
		arrival_time: t('arrival_time') || null,
		companions: comp === '' ? null : Number(comp),
		allergies: t('allergies') || null,
		requests: t('requests') || null,
		locale
	};
}

/** フォームの食事の送信値（name = meal|<stay_id>|<type>|<date>）を選択の配列にする */
export function mealChoicesFromForm(form: FormData): PcMealChoice[] {
	const out: PcMealChoice[] = [];
	for (const [k, v] of form.entries()) {
		const m = /^meal\|([0-9a-f-]{36})\|(dinner|breakfast)\|(\d{4}-\d{2}-\d{2})$/.exec(k);
		if (!m) continue;
		out.push({ stay_id: m[1], type: m[2] as PcMealType, date: m[3], time: String(v ?? '').trim() });
	}
	return out;
}

// ---------------------------------------------------------------- メール本文（日本語＋英語）

export type PrecheckinMailInput = {
	facilityName: string;
	guestName: string;
	checkIn: string;
	checkOut: string;
	nights: number;
	bookingCode: string;
	url: string;
	editableUntil: string;
};

const esc = (s: string) =>
	s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymd(d: string): { y: number; m: number; day: number; dow: number } {
	const [y, m, day] = d.split('-').map(Number);
	return { y, m, day, dow: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
}
export const dateJa = (d: string) => {
	const x = ymd(d);
	return `${x.y}年${x.m}月${x.day}日（${DOW_JA[x.dow]}）`;
};
export const dateEn = (d: string) => {
	const x = ymd(d);
	return `${DOW_EN[x.dow]}, ${MON_EN[x.m - 1]} ${x.day}, ${x.y}`;
};
/** ISO → 'M月D日 HH:MM'（JST） */
export function deadlineJa(iso: string): string {
	const t = new Date(Date.parse(iso) + 9 * 3600_000);
	if (!Number.isFinite(t.getTime())) return '';
	return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日 ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}
/** ISO → 'M/D HH:MM'（JST・言語によらない短い表記） */
export function shortJst(iso: string): string {
	const t = new Date(Date.parse(iso) + 9 * 3600_000);
	if (!Number.isFinite(t.getTime())) return '';
	return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
}
/** 'YYYY-MM-DD' → 'YYYY/M/D' */
export const slashDate = (d: string) => {
	const x = ymd(d);
	return Number.isFinite(x.y) ? `${x.y}/${x.m}/${x.day}` : d;
};
function deadlineEn(iso: string): string {
	const t = new Date(Date.parse(iso) + 9 * 3600_000);
	if (!Number.isFinite(t.getTime())) return '';
	return `${MON_EN[t.getUTCMonth()]} ${t.getUTCDate()}, ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} (JST)`;
}

/** 事前チェックインのご案内メール（日本語のあとに英語）。差出人名は「<施設名> 事前チェックイン」（呼び出し側） */
export function buildPrecheckinMail(i: PrecheckinMailInput): { subject: string; text: string; html: string } {
	const name = i.guestName.trim() || 'お客様';
	const subject = `【${i.facilityName}】事前チェックインのご案内 / Online pre-check-in`;
	const jaLines = [
		`${name} 様`,
		'',
		`${i.facilityName}をご予約いただき、ありがとうございます。`,
		'ご到着前に、下のリンクから「事前チェックイン」をお願いいたします。',
		'ご連絡先の確認と、夕食・朝食のお時間をお選びいただけます（3分ほどで終わります）。',
		'',
		`ご予約番号: ${i.bookingCode}`,
		`ご宿泊: ${dateJa(i.checkIn)} から ${i.nights}泊（チェックアウト ${dateJa(i.checkOut)}）`,
		`入力の締め切り: ${deadlineJa(i.editableUntil)}`,
		'',
		i.url,
		'',
		'※ このリンクはお客様専用です。他の方へ転送しないでください。',
		'※ 新しいご案内を送った場合、前のメールのリンクは使えなくなります。',
		'※ 貸切風呂のご予約は、ご到着当日から客室案内でお受けしています。'
	];
	const enLines = [
		`Dear ${i.guestName.trim() || 'Guest'},`,
		'',
		`Thank you for booking ${i.facilityName}.`,
		'Before you arrive, please complete the online pre-check-in from the link below.',
		'You can confirm your contact details and choose your dinner and breakfast times (about 3 minutes).',
		'',
		`Booking number: ${i.bookingCode}`,
		`Stay: ${dateEn(i.checkIn)}, ${i.nights} night${i.nights === 1 ? '' : 's'} (check-out ${dateEn(i.checkOut)})`,
		`Please complete by: ${deadlineEn(i.editableUntil)}`,
		'',
		i.url,
		'',
		'This link is for you only. Please do not forward it.'
	];
	const text = [...jaLines, '', '----------------------------------------', '', ...enLines, '', i.facilityName].join('\n');
	const para = (lines: string[]) =>
		lines
			.map((l) => (l === i.url ? `<p style="margin:16px 0"><a href="${esc(i.url)}" style="display:inline-block;background:#1c1917;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">事前チェックインへ進む / Start pre-check-in</a></p><p style="font-size:12px;color:#78716c;word-break:break-all">${esc(i.url)}</p>` : l ? `<p style="margin:4px 0">${esc(l)}</p>` : '<br>'))
			.join('');
	const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1c1917;max-width:560px">${para(jaLines)}<hr style="margin:24px 0;border:none;border-top:1px solid #e7e5e4">${para(enLines)}<p style="margin-top:24px;color:#78716c">${esc(i.facilityName)}</p></div>`;
	return { subject, text, html };
}

// ---------------------------------------------------------------- 見本

/** 見本のトークン（どのデータ源でも開ける。DB に触れない見本で、管理画面の「お客様フォームの見本」の入口） */
export const DEMO_PRECHECKIN_TOKEN = 'demo-precheckin-000000000000000000000000000';

/** 見本の中身（今日チェックイン・1 泊・1 室） */
export const DEMO_PRECHECKIN_CODE = 'DEMO-0001';

export function demoPrecheckinContext(answers: PcAnswers = {}, now = new Date()): PcContext {
	const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
	const tomorrow = new Date(now.getTime() + 33 * 3600_000).toISOString().slice(0, 10);
	const stayId = '00000000-0000-4000-8000-000000000001';
	const pick = (type: PcMealType, date: string) =>
		answers.meals?.find((m) => m.stay_id === stayId && m.type === type && m.date === date)?.time ?? null;
	const until = editableUntilOf(today);
	return {
		facility: { id: 'f-nishiwaga', slug: 'yamado', name: '山人-yamado-（見本）', timezone: 'Asia/Tokyo' },
		bookingCode: DEMO_PRECHECKIN_CODE,
		checkIn: today,
		checkOut: tomorrow,
		nights: 1,
		roomCount: 1,
		adults: 2,
		children: 0,
		guest: { name: '山人 太郎', nameKana: 'ヤマド タロウ', phoneMasked: maskPhone('090-1234-5678'), emailMasked: maskEmail('taro@example.com') },
		editableUntil: until,
		// 見本はいつでも入力できる（当日 12:00 を過ぎても閲覧のみにしない）
		editable: true,
		expiresAt: expiresAtOf(tomorrow),
		answers,
		answeredAt: answers.meals_saved_at ?? null,
		rooms: [
			{
				index: 1,
				stayId,
				label: '和室（見本）',
				nights: [
					{
						nightDate: today,
						stayId,
						dinner: { date: today, offered: true, time: pick('dinner', today) },
						breakfast: { date: tomorrow, offered: true, time: pick('breakfast', tomorrow) }
					}
				]
			}
		],
		slots: {
			dinner: {
				[today]: [
					{ time: '17:30', max: 4, remaining: 2 },
					{ time: '18:00', max: 4, remaining: 0 },
					{ time: '18:30', max: null, remaining: null },
					{ time: '19:00', max: null, remaining: null }
				]
			},
			breakfast: {
				[tomorrow]: [
					{ time: '07:30', max: null, remaining: null },
					{ time: '08:00', max: null, remaining: null },
					{ time: '08:30', max: null, remaining: null }
				]
			}
		}
	};
}
