// 客室案内（/r）の「精算案内」（2026-10-17・autumn-shared 20261017005358）。画面とサーバで共有する型と純関数。
//
// 3つの表示を施設の既定で出し分け、滞在（滞在コード）ごとに上書きできる:
//   ・items  … 利用明細（PMS の請求書 pms.bills / bill_items / bill_payments）
//   ・front  … フロントでの早め精算のご案内（施設ごとの自由記述）
//   ・online … Stripe によるオンライン決済（その時点の残額全額・滞在中いつでも）
// 残額の数え方は PMS の Square 精算と同じ（DB の book._inroom_bill_dues）。画面の額は信用せず、決済の準備・確定で DB が数え直す。

export type BillFlags = { items: boolean; front: boolean; online: boolean };
export type FrontNote = { ja: string; en: string; zh: string };

export type BillItem = { date: string | null; name: string; quantity: number; unitPrice: number; amount: number };
export type BillPayment = { date: string | null; method: string; amount: number; online: boolean };
export type StayBill = {
	id: string;
	billNo: number | null;
	name: string | null;
	itemsTotal: number;
	paidTotal: number;
	due: number;
	items: BillItem[];
	payments: BillPayment[];
};

export type StayBillView = {
	flags: BillFlags;
	frontNote: FrontNote;
	bills: StayBill[];
	dueTotal: number;
	/** この滞在でオンライン決済された額（返金を除く） */
	paidOnline: number;
	isDemo: boolean;
	hasStay: boolean;
};

export const NO_FLAGS: BillFlags = { items: false, front: false, online: false };
export const EMPTY_NOTE: FrontNote = { ja: '', en: '', zh: '' };

/** 3つのどれかを出すか（トップのカード・/r/bill を出すか） */
export const anyBillFlag = (f: BillFlags): boolean => f.items || f.front || f.online;

/** 施設の既定に滞在ごとの上書き（null は既定どおり）を重ねる（DB の _inroom_bill_flags と同じ） */
export function resolveBillFlags(
	defaults: BillFlags,
	override: { items: boolean | null; front: boolean | null; online: boolean | null } | null | undefined
): BillFlags {
	return {
		items: override?.items ?? defaults.items,
		front: override?.front ?? defaults.front,
		online: override?.online ?? defaults.online
	};
}

/** フロント案内文の表示言語（英語・繁体字が空なら日本語） */
export function frontNoteFor(note: FrontNote, locale: string): string {
	const pick = locale === 'en' ? note.en : locale === 'zh-TW' ? note.zh : note.ja;
	return pick.trim() || note.ja.trim();
}

const num = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const ymd = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** RPC book.stay_bill の結果を画面用に整える（壊れた行は落とす・読めなければ null） */
export function normalizeStayBill(raw: unknown): StayBillView | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.ok !== true) return null;
	const note = (r.front_note ?? {}) as Record<string, unknown>;
	const bills = (Array.isArray(r.bills) ? r.bills : [])
		.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && typeof (b as { id?: unknown }).id === 'string')
		.map((b) => ({
			id: String(b.id),
			billNo: b.bill_no == null ? null : num(b.bill_no),
			name: str(b.name) || null,
			itemsTotal: num(b.items_total),
			paidTotal: num(b.paid_total),
			due: Math.max(0, num(b.due)),
			items: (Array.isArray(b.items) ? b.items : [])
				.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
				.map((i) => ({
					date: ymd(i.date),
					name: str(i.name),
					quantity: num(i.quantity),
					unitPrice: num(i.unit_price),
					amount: num(i.amount)
				})),
			payments: (Array.isArray(b.payments) ? b.payments : [])
				.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
				.map((p) => ({ date: ymd(p.date), method: str(p.method), amount: num(p.amount), online: p.online === true }))
		}));
	return {
		flags: { items: r.show_items === true, front: r.show_front === true, online: r.show_online === true },
		frontNote: { ja: str(note.ja), en: str(note.en), zh: str(note.zh) },
		bills,
		dueTotal: Math.max(0, num(r.due_total)),
		paidOnline: Math.max(0, num(r.paid_online)),
		isDemo: r.is_demo === true,
		hasStay: r.has_stay === true
	};
}

/**
 * 見本（デモ）の館内図・DATA_SOURCE=demo で出す見本の明細（2026-10-17）。実際の請求書には紐づかない。
 * 宿泊料金・入湯税・お飲み物、事前のお支払い済みを並べる。
 */
export function demoStayBill(flags: BillFlags, frontNote: FrontNote, now = new Date(), paidOnline = 0): StayBillView {
	const today = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
	const items: BillItem[] = [
		{ date: today, name: 'ご宿泊料金（1泊2食付・2名様）', quantity: 1, unitPrice: 52800, amount: 52800 },
		{ date: today, name: '入湯税', quantity: 2, unitPrice: 150, amount: 300 },
		{ date: today, name: '生ビール', quantity: 2, unitPrice: 800, amount: 1600 },
		{ date: today, name: '日本酒（地酒）', quantity: 1, unitPrice: 1400, amount: 1400 }
	];
	// 支払いは1行ずつ出すので、見本も2行（事前決済と会員割引）
	const payments: BillPayment[] = [
		{ date: today, method: 'オンライン事前決済', amount: 52800, online: false },
		{ date: today, method: '公式サイト会員割引', amount: 1600, online: false }
	];
	if (paidOnline > 0) payments.push({ date: today, method: 'オンライン決済(stripe)', amount: paidOnline, online: true });
	const itemsTotal = items.reduce((s, i) => s + i.amount, 0);
	const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
	const due = Math.max(0, itemsTotal - paidTotal);
	return {
		flags,
		frontNote,
		bills: [{ id: 'demo-bill', billNo: 1, name: null, itemsTotal, paidTotal, due, items, payments }],
		dueTotal: due,
		paidOnline,
		isDemo: true,
		hasStay: true
	};
}

/** 精算・決済で DB / Stripe から返る理由を、お客様向けの文言の種類に寄せる */
export type BillPayErrorKind = 'changed' | 'unavailable' | 'nothing' | 'generic';
export function billPayErrorKind(e: unknown): BillPayErrorKind {
	const msg = e instanceof Error ? e.message : String(e ?? '');
	if (/amount_changed|nothing_due/.test(msg)) return msg.includes('nothing_due') ? 'nothing' : 'changed';
	if (/online_disabled|demo|no_stay|invalid_token|unavailable|amount_too_small|amount_too_large/.test(msg)) return 'unavailable';
	return 'generic';
}

/** 管理画面の台帳の状態の日本語 */
export const INROOM_PAYMENT_STATUS: Record<string, string> = {
	pending: '未決済',
	paid: '入金済み（PMS に入金行）',
	refunded: '返金済み',
	partially_refunded: '一部返金',
	mismatch: '金額の食い違い（返金待ち）',
	mismatch_refunded: '金額の食い違い（返金済み）',
	refund_failed: '返金に失敗',
	test_paid: 'テスト決済（プレビュー・未返金）',
	test_refunded: 'テスト決済（返金済み）'
};

/**
 * プレビュー（見本の滞在）で管理者が試す、本番 Stripe のテスト決済の額（円・2026-10-17）。
 * 実際の額は DB（book.inroom_test_payment_prepare）が決める。画面の表示用
 */
export const INROOM_TEST_AMOUNT = 100;

// ---------------------------------------------------------------------------
// 管理画面のプレビュー（/admin/inroom/preview）で見せる精算の見本（2026-10-17 指示「プレビューでも精算のデモが見えるように」）
// ---------------------------------------------------------------------------
/** プレビューで選んだ出し分けを覚える Cookie（見本の滞在にだけ効く。本物の滞在・決済には関係しない） */
export const PREVIEW_BILL_COOKIE = 'ab_preview_bill';

/** Cookie の値（"items,front,online" / "none"）→ 出し分け。無い・読めないときは null（＝管理画面の設定どおり） */
export function parsePreviewBillFlags(v: string | null | undefined): BillFlags | null {
	if (!v) return null;
	if (v === 'none') return { ...NO_FLAGS };
	const parts = v.split(',');
	const flags = { items: parts.includes('items'), front: parts.includes('front'), online: parts.includes('online') };
	return anyBillFlag(flags) ? flags : null;
}

/** 出し分け → Cookie の値 */
export function previewBillCookieValue(f: BillFlags): string {
	const parts = (['items', 'front', 'online'] as const).filter((k) => f[k]);
	return parts.length ? parts.join(',') : 'none';
}

/** プレビューで案内文が空のときに出す見本の文（管理画面の「精算案内」で書いた文がここに出る） */
export const PREVIEW_FRONT_NOTE: FrontNote = {
	ja: '（見本）ここに、管理画面「精算案内」で書いたフロントでの早め精算のご案内が出ます。\n\n例：ご出発の朝はフロントが混み合います。前日の夜 21:00 までにフロントへお越しいただければ、先にご精算いただけます。',
	en: '',
	zh: ''
};
