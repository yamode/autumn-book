// 事前チェックイン（P2・docs/pre-checkin.md）の純関数。DB に触らない（単体テスト: precheckin.test.ts）。
//
// DB 定義: autumn-shared 20261028220125_book_precheckin_p2.sql
//   - book.precheckin_context の戻り（jsonb）→ normalizePrecheckinContext
//   - book.admin_precheckin_list の行 → precheckinState（画面の状態）
//   - マスクは DB の book._mask_phone / _mask_email と同じ規則（フォームの再表示・管理画面の一覧で使う）

export type PcMealType = 'dinner' | 'breakfast';
export const PC_MEAL_TYPES: readonly PcMealType[] = ['dinner', 'breakfast'];

/** 時間枠。remaining = このお客様の部屋を除いた残り室数（null = 上限なし） */
/** full = 宿が満席にした時間（PMS の食事時間割「本日の時間設定」で手動チェック・remaining は 0） */
export type PcSlot = { time: string; max: number | null; remaining: number | null; full?: boolean };
export type PcMealCell = { date: string; offered: boolean; time: string | null };
export type PcNight = { nightDate: string; stayId: string; dinner: PcMealCell; breakfast: PcMealCell };
/** 部屋（partySize = 予約の人数・male / female = いま PMS にある男女人数。2026-11-28） */
export type PcRoom = { index: number; stayId: string; label: string; nights: PcNight[]; partySize?: number; male?: number; female?: number };
/** 男女人数（部屋ごと・伺い項目・必須。2026-11-28）。送信の時点で PMS の泊へ書く。prev_* は前の値（DB が付ける） */
export type PcGender = { stay_id: string; male: number; female: number; room?: number; prev_male?: number; prev_female?: number };
/** 姓・名に分けた欄（2026-11-15）。name / name_kana は 姓 と 名 を半角空白でつなげたもの（今までどおり持つ） */
export type PcContact = {
	name?: string;
	name_kana?: string;
	phone?: string;
	email?: string;
	family_name?: string;
	given_name?: string;
	family_name_kana?: string;
	given_name_kana?: string;
};
export type PcNameParts = { family_name?: string | null; given_name?: string | null; family_name_kana?: string | null; given_name_kana?: string | null };

/** つなげた氏名を 姓 と 名 に分ける（最初の空白〈全角も〉で切る）。空白が無ければ全部を姓に入れる */
export function splitName(full: string | null | undefined): { family: string; given: string } {
	const s = (full ?? '').trim();
	const m = /^(\S+)[\s\u3000]+(.+)$/.exec(s);
	return m ? { family: m[1], given: m[2].trim() } : { family: s, given: '' };
}
export type PcMealChoice = { stay_id: string; type: PcMealType; date: string; time: string };
/** 宿からの質問（book.precheckin_questions・施設ごと・回答は必須） */
export type PcQuestionKind = 'text' | 'choice';
/** kind = 'choice' のときは options から 1 つ選ぶ。note = 質問文の下に小さく出す補足説明（任意・2026-11-28） */
export type PcQuestion = { id: string; question: string; note?: string; kind?: PcQuestionKind; options?: string[] };
/** 管理画面用（オフの質問も含む） */
export type PcAdminQuestion = PcQuestion & { note: string; kind: PcQuestionKind; options: string[]; active: boolean };

/** DB の行・RPC の値を質問の形にそろえる */
export function normalizeQuestion(x: unknown): PcQuestion & { note: string; kind: PcQuestionKind; options: string[] } {
	const r = (x ?? {}) as Record<string, unknown>;
	const kind: PcQuestionKind = r.kind === 'choice' ? 'choice' : 'text';
	const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim()) : [];
	const note = typeof r.note === 'string' ? r.note.trim() : '';
	return { id: String(r.id ?? ''), question: String(r.question ?? ''), note, kind, options: kind === 'choice' ? options : [] };
}
/** 質問への回答（質問文はその時点の写し） */
export type PcQuestionAnswer = { id: string; question?: string; answer: string };
/** 伺い書の項目（① で聞く・住所と生年月日は必須） */
export type PcGuestInfo = { zip?: string | null; address?: string | null; birthdate?: string | null; receipt_name?: string | null };
/** 顧客マスタ・予約から ① に最初から入れる値（伺い書の項目＋予約の到着予定時刻 core.stays.estimated_arrival_time） */
export type PcProfile = PcGuestInfo &
	PcNameParts & {
		arrival_time?: string | null;
		/** 伏せた登録の内容（「登録: 〜」に出す。2026-11-23 レビュー M-5） */
		zip_masked?: string | null;
		address_masked?: string | null;
		birthdate_masked?: string | null;
		/** 顧客マスタに住所・生年月日があるか（必須の判定用） */
		has_address?: boolean;
		has_birthdate?: boolean;
	};
export type PcAnswers = {
	contact?: PcContact;
	guest?: PcGuestInfo;
	questions?: PcQuestionAnswer[];
	gender?: PcGender[];
	arrival_time?: string | null;
	/** お客様の備考（自由入力・任意・1000 字まで。2026-11-15） */
	note?: string | null;
	/** 旧フォームの同伴人数（2026-11-14 に入力欄を廃止。過去の回答の表示用に型だけ残す） */
	companions?: number | null;
	allergies?: string | null;
	requests?: string | null;
	locale?: string;
	basic_saved_at?: string;
	meals?: PcMealChoice[];
	meals_saved_at?: string;
};
export type PcContext = {
	/** portalSlug = 予約トップ /yamado/<slug> の slug（book.facility_contents.slug。P3 の DB 前は null） */
	facility: { id: string; slug: string; name: string; timezone: string; portalSlug: string | null };
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
	/** 公式サイト予約か（source=autumn_booking）。P3 の DB（20261028223603）より前は null = 不明 */
	isOfficial: boolean | null;
	/**
	 * 公式扱いか（公式サイト・tripla・直接予約・電話・book._pc_is_direct）。貸切風呂の事前予約ができるか（2026-11-22）。
	 * DB（20261121205842）より前は null = 不明 → isOfficial で代用
	 */
	isDirect: boolean | null;
	/** 直販予約で、滞在に紐付く会員がシルバー以上。 */
	bathEligible: boolean;
	/** 取引先経由か（rms_partner） */
	isPartner: boolean;
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

/** 旧: 回答を直せる期限 = チェックイン日 12:00（2026-11-14 に締め切りを廃止。DB は infinity を返す。見本の表示用に残す） */
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
	// SMS・メールを読んだかではなく、お客様が事前チェックインの URL を開いたか（precheckin_context が first_opened_at を付ける）
	opened: 'URLを開いた',
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

/** 一覧の状態。回答 > URLを開いた > 送信失敗 > 送信済 > 連絡先なし > 未送信 */
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

export const CONTACT_FIELDS: { key: 'name' | 'name_kana' | 'phone' | 'email'; label: string }[] = [
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
		k === 'phone'
			? a.replace(/\D/g, '') === b.replace(/\D/g, '')
			: // 氏名・フリガナは空白の違い（全角・半角・有無）を修正と見なさない
				a.replace(/[\s\u3000]/g, '').toLowerCase() === b.replace(/[\s\u3000]/g, '').toLowerCase();
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
				remaining: s.full === true ? 0 : s.remaining === null || s.remaining === undefined ? null : num(s.remaining),
				full: s.full === true
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
			partySize: num(room.party_size),
			male: num(room.male),
			female: num(room.female),
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
		facility: {
			id: str(f.id),
			slug: str(f.slug),
			name: str(f.name),
			timezone: str(f.timezone) || 'Asia/Tokyo',
			portalSlug: str(f.portal_slug) || null
		},
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
		slots: { dinner: slotsOf(slots.dinner), breakfast: slotsOf(slots.breakfast) },
		isOfficial: typeof r.is_official === 'boolean' ? r.is_official : null,
		isDirect: typeof r.is_direct === 'boolean' ? r.is_direct : null,
		bathEligible: r.bath_eligible === true,
		isPartner: r.is_partner === true
	};
}

/** フォームの「基本情報」の送信値を RPC の形にする（空欄は落とす）。宿からの質問は name = q|<id> */
export function answersFromForm(form: FormData, locale: string): PcAnswers & { contact: PcContact; questions: PcQuestionAnswer[]; guest: PcGuestInfo } {
	const t = (k: string) => String(form.get(k) ?? '').trim();
	const contact: PcContact = {};
	for (const { key } of CONTACT_FIELDS) {
		const v = t(`contact_${key}`);
		if (v) contact[key] = v;
	}
	// 氏名・フリガナは 姓 と 名 の 2 欄で受け取り、つなげたもの（name / name_kana）も作る
	for (const [full, fam, giv] of [
		['name', 'family_name', 'given_name'],
		['name_kana', 'family_name_kana', 'given_name_kana']
	] as const) {
		const f = t(`contact_${fam}`);
		const g = t(`contact_${giv}`);
		if (!f && !g) continue;
		if (f) contact[fam] = f;
		if (g) contact[giv] = g;
		contact[full] = [f, g].filter(Boolean).join(' ');
	}
	const questions: PcQuestionAnswer[] = [];
	// 男女人数（name = g|<stay_id>|male / female）。空欄は -1（＝未入力。必須の判定で止める）
	const gender = new Map<string, PcGender>();
	for (const [k, v] of form.entries()) {
		const m = /^q\|([0-9a-z-]{1,64})$/i.exec(k);
		if (m) questions.push({ id: m[1], answer: String(v ?? '').trim() });
		const g = /^g\|([0-9a-z-]{1,64})\|(male|female)$/i.exec(k);
		if (g) {
			const row = gender.get(g[1]) ?? { stay_id: g[1], male: -1, female: -1 };
			const n = String(v ?? '').trim();
			row[g[2].toLowerCase() as 'male' | 'female'] = /^\d{1,2}$/.test(n) ? Number(n) : -1;
			gender.set(g[1], row);
		}
	}
	return {
		contact,
		guest: {
			zip: t('guest_zip') || null,
			address: t('guest_address') || null,
			birthdate: t('guest_birthdate') || null,
			receipt_name: t('guest_receipt_name') || null
		},
		questions,
		gender: [...gender.values()],
		arrival_time: t('arrival_time') || null,
		note: t('note').slice(0, 1000) || null,
		locale
	};
}

/** 伺い書の必須（住所・生年月日）で足りない最初の欄。足りていれば null */
export function missingGuestField(
	g: PcGuestInfo,
	/** 顧客マスタに登録があるか（値は伏せて受け取るので、有無だけで判定する・2026-11-23） */
	registered: { address?: boolean; birthdate?: boolean } = {}
): 'address' | 'birthdate' | null {
	if (!g.address?.trim() && !registered.address) return 'address';
	if (g.birthdate?.trim() ? !/^\d{4}-\d{2}-\d{2}$/.test(g.birthdate.trim()) : !registered.birthdate) return 'birthdate';
	return null;
}

/** 宿からの質問に全部答えているか。答えていない最初の質問の id を返す（全部答えていれば null） */
export function missingQuestion(questions: PcQuestion[], answers: PcQuestionAnswer[]): string | null {
	for (const q of questions) {
		const a = answers.find((x) => x.id === q.id)?.answer?.trim() ?? '';
		if (!a) return q.id;
		// 選択肢形式は選択肢のどれか（最終判定は RPC）
		if (q.kind === 'choice' && q.options?.length && !q.options.includes(a)) return q.id;
	}
	return null;
}

/** 男女人数で足りない最初の部屋の stay_id（0〜50 人・合わせて 1 人以上）。足りていれば null */
export function missingGender(rooms: Pick<PcRoom, 'stayId'>[], gender: PcGender[]): string | null {
	for (const r of rooms) {
		const g = gender.find((x) => x.stay_id === r.stayId);
		if (!g || g.male < 0 || g.female < 0 || g.male > 50 || g.female > 50 || g.male + g.female === 0) return r.stayId;
	}
	return null;
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
	/**
	 * 貸切風呂の事前予約を案内するか。公式サイト（Book）の予約だけ true（2026-11-21: 事前予約は公式サイト限定）。
	 * false のときは「到着後に客室案内から」と書く。省略時は true（従来どおり）
	 */
	bath?: boolean;
	/** 施設の slug（yamado / oga）。ロゴ・住所・電話・公式サイトを選ぶ。知らない値なら出さない */
	facilitySlug?: string | null;
	/** ロゴの画像の置き場（https の起点。例 https://book.yamado.app）。無ければロゴを出さない */
	assetOrigin?: string | null;
};

/**
 * メールに載せる施設の情報（2026-11-26）。ロゴは static/mail/（Gmail などは HTML に埋め込んだ画像を出さないため、https の画像を読ませる）。
 * 住所・電話・公式サイトは末尾に載せ、宿からの本物のメールだと確かめやすくする
 */
export const PRECHECKIN_MAIL_FACILITY: Record<string, { logo: string; logoW: number; logoH: number; phone: string; address: string; site: string }> = {
	yamado: { logo: '/mail/logo-yamado.png', logoW: 176, logoH: 92, phone: '0197-82-2222', address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10', site: 'https://www.yamado.co.jp/' },
	oga: { logo: '/mail/logo-oga.png', logoW: 176, logoH: 92, phone: '0185-47-7776', address: '〒010-0531 秋田県男鹿市船川港台島字鵜ノ崎62-29', site: 'https://oga.yamado.co.jp/' }
};

/** 事前チェックインのご案内の差出人（送信専用・名前は「<施設名> ご到着前の事前確認サービス」。お客様向けの名称・2026-11-28） */
export const precheckinMailFrom = (facilityName: string) => ({ address: 'noreply@yamado.app', name: `${facilityName.trim() || 'YAMADO'} ご到着前の事前確認サービス` });

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

/**
 * 事前チェックインのご案内メール（日本語のあとに英語）。差出人は送信専用（noreply@yamado.app・名前「<施設名> 事前チェックイン」・呼び出し側）。
 * 2026-11-26 に見本（Dropbox output/2026-11/precheckin-email）で決めた文面:
 * - 件名は「【施設名】事前チェックインのご案内」だけ。次回予約をすすめる広告の枠は入れない。締め切りは書かない
 * - 本物の宿からのメールと分かるように: 施設のロゴ・予約番号と日程・リンク先が公式予約サイトであること・
 *   「カード番号やパスワードをお尋ねしない」・施設の住所と電話と公式サイト（末尾）
 * - 手続きの一覧の見出しは「事前チェックインの内容」（2026-11-26 指示）
 * - 貸切風呂は公式サイトの予約だけ（bath=false のときは本文の「・貸切風呂」と一覧の③を出さない）
 */
export function buildPrecheckinMail(i: PrecheckinMailInput): { subject: string; text: string; html: string } {
	const name = i.guestName.trim() || 'お客様';
	const bath = i.bath !== false;
	const fac = i.facilitySlug ? PRECHECKIN_MAIL_FACILITY[i.facilitySlug] : undefined;
	const host = (() => {
		try {
			return new URL(i.url).host;
		} catch {
			return '';
		}
	})();
	const logoSrc = fac && i.assetOrigin && /^https:\/\//.test(i.assetOrigin) ? `${i.assetOrigin.replace(/\/+$/, '')}${fac.logo}` : null;
	const subject = `【${i.facilityName}】ご到着前の事前確認サービスのご案内`;
	const stayJa = `${dateJa(i.checkIn)}から${i.nights}泊（チェックアウト ${dateJa(i.checkOut)}）`;
	const stayEn = `${dateEn(i.checkIn)}, ${i.nights} night${i.nights === 1 ? '' : 's'} (check-out ${dateEn(i.checkOut)})`;
	const choose = bath ? 'ご夕食・ご朝食・貸切風呂のお時間' : 'ご夕食・ご朝食のお時間';
	const steps = ['① ご連絡先（お電話・メール）の確認', '② ご夕食・ご朝食のお時間のご指定（そのまま確定します）', ...(bath ? ['③ 貸切風呂のお時間のご予約（空いている時間からお選びいただけます）'] : [])];
	const notes = [
		'このリンクはお客様専用です。他の方へ転送しないでください。新しいご案内をお送りした場合、前のメールのリンクは使えなくなります。',
		'うまく開けない場合は、ご到着時にフロントで承りますのでご安心ください。',
		`このメールは送信専用のアドレスからお送りしています。ご返信いただいてもお答えできませんので、ご質問はお電話${fac ? `（${fac.phone}）` : ''}でお問い合わせください。`,
		'当館から、メールでクレジットカード番号やパスワードをお尋ねすることはありません。'
	];
	const footer = [i.facilityName, ...(fac ? [fac.address, `TEL ${fac.phone}`, fac.site] : [])];

	const text = [
		`${name} 様`,
		'',
		`本日は${i.facilityName}をご予約いただき、ありがとうございます。`,
		'',
		'ご到着の前に、下記のリンクからご到着前の事前確認サービスのお手続きができます。',
		`ご連絡先の確認と、${choose}をお選びいただけます。`,
		'',
		...(i.bookingCode ? [`ご予約番号: ${i.bookingCode}`] : []),
		`ご宿泊: ${stayJa}`,
		'',
		'▼ ご到着前の事前確認サービス',
		i.url,
		...(host ? [`（リンク先は${i.facilityName}の公式予約サイト ${host} です）`] : []),
		'',
		'ご到着前の事前確認サービスの内容',
		...steps,
		'',
		...notes.map((n) => `※ ${n}`),
		'',
		'----------------------------------------',
		'',
		`Dear ${i.guestName.trim() || 'Guest'},`,
		'',
		`Thank you for booking ${i.facilityName}.`,
		`Before you arrive, you can complete the pre-arrival confirmation from the link below. You can confirm your contact details and choose your dinner, breakfast${bath ? ' and private bath' : ''} times.`,
		'',
		...(i.bookingCode ? [`Booking number: ${i.bookingCode}`] : []),
		`Stay: ${stayEn}`,
		'',
		i.url,
		'',
		'This link is for you only. Please do not forward it. This is a send-only address; please call us if you have any questions. We will never ask for your card number or password by email.',
		'',
		'----------------------------------------',
		...footer
	].join('\n');

	const SANS = "font-family:'Hiragino Sans','Yu Gothic','YuGothic',Meiryo,sans-serif;";
	const SERIF = "font-family:'Hiragino Mincho ProN','Yu Mincho','YuMincho',serif;";
	const row = (inner: string, pad = '0 32px') => `<tr><td style="padding:${pad};">${inner}</td></tr>`;
	const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#efede8;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(`${stayJa}のご予約のご到着前の事前確認サービスのご案内です。`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#efede8;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;color:#292524;${SANS}">
${logoSrc ? row(`<img src="${esc(logoSrc)}" width="${fac!.logoW}" height="${fac!.logoH}" alt="${esc(i.facilityName)}" style="display:block;margin:0 auto;border:0;width:${fac!.logoW}px;max-width:60%;height:auto;">`, '32px 32px 4px;text-align:center') : ''}
${row(`<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.2em;color:#8f6f2a;text-align:center;">PRE-ARRIVAL CONFIRMATION</p><h1 style="margin:0;${SERIF}font-size:22px;line-height:1.6;font-weight:500;text-align:center;">ご到着前の事前確認サービスのご案内</h1>`, `${logoSrc ? '12px' : '36px'} 32px 0`)}
${row(`<p style="margin:0 0 14px;">${esc(name)} 様</p><p style="margin:0 0 14px;">本日は${esc(i.facilityName)}をご予約いただき、ありがとうございます。</p><p style="margin:0;">ご到着の前に、下記のボタンからご到着前の事前確認サービスのお手続きができます。<br>ご連絡先の確認と、${esc(choose)}をお選びいただけます。</p>`, '24px 32px 0;font-size:15px;line-height:1.9')}
${row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f6f2;font-size:14px;line-height:1.8;"><tr><td style="padding:14px 18px;">${i.bookingCode ? `<span style="color:#78716c;">ご予約番号</span>　${esc(i.bookingCode)}<br>` : ''}<span style="color:#78716c;">ご宿泊</span>　${esc(stayJa)}</td></tr></table>`, '20px 32px 0')}
${row(`<a href="${esc(i.url)}" style="display:inline-block;background:#292524;color:#ffffff;padding:15px 36px;font-size:16px;font-weight:bold;text-decoration:none;letter-spacing:0.06em;">事前確認へ進む</a>`, '26px 32px 6px;text-align:center')}
${host ? row(`リンク先は${esc(i.facilityName)}の公式予約サイト（${esc(host)}）です`, '0 32px;font-size:12px;color:#78716c;text-align:center') : ''}
${row(`<span style="word-break:break-all;">${esc(i.url)}</span>`, '4px 32px 0;font-size:11px;color:#a8a29e;text-align:center')}
${row(`<p style="margin:0 0 6px;font-weight:bold;color:#292524;">ご到着前の事前確認サービスの内容</p><p style="margin:0;">${steps.map(esc).join('<br>')}</p>`, '24px 32px 0;font-size:13px;line-height:1.85;color:#44403c')}
${row(notes.map((n) => `※ ${esc(n)}`).join('<br>'), '20px 32px 0;font-size:12px;line-height:1.8;color:#78716c')}
${row('<div style="border-top:1px solid #eeeae2;"></div>', '28px 32px 0')}
${row(`<p style="margin:0 0 10px;">Dear ${esc(i.guestName.trim() || 'Guest')},</p><p style="margin:0 0 10px;">Thank you for booking ${esc(i.facilityName)}. Before you arrive, you can complete the pre-arrival confirmation. You can confirm your contact details and choose your dinner, breakfast${bath ? ' and private bath' : ''} times.</p><p style="margin:0 0 10px;">${i.bookingCode ? `Booking number: ${esc(i.bookingCode)}<br>` : ''}Stay: ${esc(stayEn)}</p><p style="margin:0;"><a href="${esc(i.url)}" style="color:#8f6f2a;">Start pre-arrival confirmation</a> — This link is for you only. Please do not forward it. This is a send-only address; please call us if you have any questions. We will never ask for your card number or password by email.</p>`, '20px 32px 0;font-size:13px;line-height:1.8;color:#57534e')}
${row(footer.map((l) => (/^https:\/\//.test(l) ? `<a href="${esc(l)}" style="color:#a8a29e;">${esc(l)}</a>` : esc(l))).join('<br>'), '28px 32px 32px;font-size:12px;line-height:1.8;color:#a8a29e')}
</table></td></tr></table></body></html>`;
	return { subject, text, html };
}

// ---------------------------------------------------------------- 見本

/** 見本のトークン（どのデータ源でも開ける。DB に触れない見本で、管理画面の「お客様フォームの見本」の入口） */
export const DEMO_PRECHECKIN_TOKEN = 'demo-precheckin-000000000000000000000000000';
export const DEMO_PRECHECKIN_GUEST_TOKEN = 'demo-precheckin-guest';

export function isDemoPrecheckinToken(token: string): boolean {
	return token === DEMO_PRECHECKIN_TOKEN || token === DEMO_PRECHECKIN_GUEST_TOKEN;
}

/** 見本の中身（1 泊・1 室。非会員の見本は翌日の直販予約） */
export const DEMO_PRECHECKIN_CODE = 'DEMO-0001';
export const DEMO_PRECHECKIN_FACILITY_SLUG = 'yamado';

export function demoPrecheckinContext(answers: PcAnswers = {}, now = new Date(), isGuest = false): PcContext {
	const checkInJst = now.getTime() + (isGuest ? 33 : 9) * 3600_000;
	const checkIn = new Date(checkInJst).toISOString().slice(0, 10);
	const checkOut = new Date(checkInJst + 24 * 3600_000).toISOString().slice(0, 10);
	const stayId = '00000000-0000-4000-8000-000000000001';
	const pick = (type: PcMealType, date: string) =>
		answers.meals?.find((m) => m.stay_id === stayId && m.type === type && m.date === date)?.time ?? null;
	const until = editableUntilOf(checkIn);
	return {
		facility: { id: 'f-nishiwaga', slug: DEMO_PRECHECKIN_FACILITY_SLUG, name: '山人-yamado-（見本）', timezone: 'Asia/Tokyo', portalSlug: 'nishiwaga' },
		isOfficial: false,
		isDirect: isGuest,
		bathEligible: !isGuest,
		isPartner: false,
		bookingCode: DEMO_PRECHECKIN_CODE,
		checkIn,
		checkOut,
		nights: 1,
		roomCount: 1,
		adults: 2,
		children: 0,
		guest: { name: '山人 太郎', nameKana: 'ヤマド タロウ', phoneMasked: maskPhone('090-1234-5678'), emailMasked: maskEmail('taro@example.com') },
		editableUntil: until,
		// 見本はいつでも入力できる（当日 12:00 を過ぎても閲覧のみにしない）
		editable: true,
		expiresAt: expiresAtOf(checkOut),
		answers,
		answeredAt: answers.meals_saved_at ?? null,
		rooms: [
			{
				index: 1,
				stayId,
				label: '和室（見本）',
				partySize: 2,
				male: 0,
				female: 0,
				nights: [
					{
						nightDate: checkIn,
						stayId,
						dinner: { date: checkIn, offered: true, time: pick('dinner', checkIn) },
						breakfast: { date: checkOut, offered: true, time: pick('breakfast', checkOut) }
					}
				]
			}
		],
		slots: {
			dinner: {
				[checkIn]: [
					{ time: '17:30', max: 4, remaining: 2 },
					{ time: '18:00', max: null, remaining: 0, full: true },
					{ time: '18:30', max: null, remaining: null },
					{ time: '19:00', max: null, remaining: null }
				]
			},
			breakfast: {
				[checkOut]: [
					{ time: '07:30', max: null, remaining: null },
					{ time: '08:00', max: null, remaining: null },
					{ time: '08:30', max: null, remaining: null }
				]
			}
		}
	};
}

// ---------------------------------------------------------------- ① の入力欄（到着予定時刻・生年月日）

/** 到着予定時刻の選択肢の範囲（分）。チェックインは 15:00 から。30 分単位で 22:00 まで */
export const ARRIVAL_FIRST_MIN = 15 * 60;
export const ARRIVAL_LAST_MIN = 22 * 60;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 到着予定時刻の選択肢（'15:00' '15:30' … '22:00'） */
export function arrivalOptions(): string[] {
	const out: string[] = [];
	for (let t = ARRIVAL_FIRST_MIN; t <= ARRIVAL_LAST_MIN; t += 30) out.push(hhmm(t));
	return out;
}

/**
 * 登録の時刻（'14:35'・'16:10:00' など）を、選択肢のどれかに寄せる。30 分単位に切り上げ、範囲の外は端に収める。
 * 時刻でなければ ''（未選択）。
 */
export function snapArrival(v: string | null | undefined): string {
	const m = /^(\d{1,2}):(\d{2})/.exec(v?.trim() ?? '');
	if (!m) return '';
	const min = Number(m[1]) * 60 + Number(m[2]);
	if (Number(m[1]) > 23 || Number(m[2]) > 59) return '';
	const up = Math.ceil(min / 30) * 30;
	return hhmm(Math.min(ARRIVAL_LAST_MIN, Math.max(ARRIVAL_FIRST_MIN, up)));
}

/** 'YYYY-MM-DD' を 年・月・日 の選択欄の値に分ける（月・日は 0 を付けない）。読めなければ全部 '' */
export function birthParts(v: string | null | undefined): { y: string; m: string; d: string } {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v?.trim() ?? '');
	return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : { y: '', m: '', d: '' };
}

/** その年・月の日数。年が未選択なら 2 月は 29、月が未選択なら 31 */
export function daysInMonth(y: string, m: string): number {
	const mo = Number(m);
	if (!mo) return 31;
	return new Date(Date.UTC(Number(y) || 2000, mo, 0)).getUTCDate();
}

/** 年・月・日 の選択欄の値を 'YYYY-MM-DD' に。そろっていない・無い日付は '' */
export function joinBirth(y: string, m: string, d: string): string {
	const [yy, mm, dd] = [Number(y), Number(m), Number(d)];
	if (!yy || !mm || !dd || mm > 12 || dd > daysInMonth(y, m)) return '';
	return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** 西暦の年の和暦（年の選択欄に添える。年の途中の改元は新しい元号で出す）。例: 1990 → '平成2'・2019 → '令和元' */
export function eraYear(year: number): string {
	const eras: [number, string][] = [
		[2019, '令和'],
		[1989, '平成'],
		[1926, '昭和'],
		[1912, '大正'],
		[1868, '明治']
	];
	const e = eras.find(([start]) => year >= start);
	if (!e) return '';
	const n = year - e[0] + 1;
	return `${e[1]}${n === 1 ? '元' : n}`;
}
