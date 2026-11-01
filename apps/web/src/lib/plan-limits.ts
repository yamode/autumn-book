// プランの絞り込み（宿泊日の販売期間・人数・部屋タイプ）。autumn-shared 20261101035437 の
// booking.rate_plans.sales_start / sales_end / min_guests / max_guests / room_type_ids。
// 料金はテンプレート側で共有し、Book プランは絞り込みだけ（広げられない）。空欄＝テンプレート／料金式どおり。

export interface PlanLimits {
	/** 宿泊日の販売期間（YYYY-MM-DD・空は null）。予約受付期間ではない */
	salesStart: string | null;
	salesEnd: string | null;
	/** 1〜6（空は null） */
	minGuests: number | null;
	maxGuests: number | null;
	/** 対象の部屋タイプ（空＝制限なし） */
	roomTypeIds: string[];
}

export const NO_LIMITS: PlanLimits = { salesStart: null, salesEnd: null, minGuests: null, maxGuests: null, roomTypeIds: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateOf(v: unknown): string | null {
	const s = String(v ?? '').trim();
	return DATE_RE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

/** DB の行（null や文字列混じり）→ PlanLimits */
export function planLimitsOf(row: Record<string, unknown> | undefined): PlanLimits {
	if (!row) return { ...NO_LIMITS, roomTypeIds: [] };
	const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
	return {
		salesStart: dateOf(row.sales_start),
		salesEnd: dateOf(row.sales_end),
		minGuests: n(row.min_guests),
		maxGuests: n(row.max_guests),
		roomTypeIds: Array.isArray(row.room_type_ids) ? row.room_type_ids.map(String) : []
	};
}

/** フォーム → PlanLimits。不正なら理由（日本語）を返す */
export function planLimitsFromForm(form: FormData): { limits: PlanLimits } | { error: string } {
	const rawStart = String(form.get('sales_start') ?? '').trim();
	const rawEnd = String(form.get('sales_end') ?? '').trim();
	const salesStart = dateOf(rawStart);
	const salesEnd = dateOf(rawEnd);
	if ((rawStart && !salesStart) || (rawEnd && !salesEnd)) return { error: '販売期間の日付が正しくありません。' };
	if (salesStart && salesEnd && salesStart > salesEnd) return { error: '販売期間は、開始日が終了日より後にならないようにしてください。' };

	const guests = (key: string): number | null | 'bad' => {
		const raw = String(form.get(key) ?? '').trim();
		if (!raw) return null;
		const v = Number(raw);
		return Number.isInteger(v) && v >= 1 && v <= 6 ? v : 'bad';
	};
	const minGuests = guests('min_guests');
	const maxGuests = guests('max_guests');
	if (minGuests === 'bad' || maxGuests === 'bad') return { error: '人数は 1〜6 名で指定してください。' };
	if (minGuests != null && maxGuests != null && minGuests > maxGuests) return { error: '人数は、最小が最大より多くならないようにしてください。' };

	const roomTypeIds = [...new Set(form.getAll('room_type_ids').map(String).filter(Boolean))];
	return { limits: { salesStart, salesEnd, minGuests, maxGuests, roomTypeIds } };
}

// ---------------------------------------------------------------------------
// 宿泊不可（期間・曜日）。book.plan_contents.stay_blackouts / stay_closed_dows（autumn-shared 20261101211300・20261101211430）。
// 該当する宿泊日の日別料金を DB が閉じるので、検索・空室カレンダー・仮押さえに出なくなる。
// ---------------------------------------------------------------------------

export interface StayBlackout {
	/** YYYY-MM-DD（両端を含む宿泊日） */
	start: string;
	end: string;
}

export interface StayClosed {
	blackouts: StayBlackout[];
	/** 宿泊日の曜日 0=日〜6=土 */
	dows: number[];
}

export const NO_STAY_CLOSED: StayClosed = { blackouts: [], dows: [] };

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const BLACKOUT_MAX = 100;

/** DB の行（book.plan_contents）→ StayClosed。壊れた要素は捨てる */
export function stayClosedOf(row: Record<string, unknown> | undefined): StayClosed {
	const list = Array.isArray(row?.stay_blackouts) ? (row.stay_blackouts as unknown[]) : [];
	const blackouts = list
		.map((x) => {
			const o = (x ?? {}) as Record<string, unknown>;
			const start = dateOf(o.start);
			const end = dateOf(o.end);
			return start && end ? { start, end } : null;
		})
		.filter((x): x is StayBlackout => x != null);
	const dows = Array.isArray(row?.stay_closed_dows)
		? [...new Set(row.stay_closed_dows.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
		: [];
	return { blackouts, dows };
}

/** フォーム（blackout_start / blackout_end の組・closed_dows）→ StayClosed。両方空の行は捨てる。不正なら理由（日本語） */
export function stayClosedFromForm(form: FormData): { stayClosed: StayClosed } | { error: string } {
	const starts = form.getAll('blackout_start').map((v) => String(v).trim());
	const ends = form.getAll('blackout_end').map((v) => String(v).trim());
	const blackouts: StayBlackout[] = [];
	for (let i = 0; i < Math.max(starts.length, ends.length); i++) {
		const rawStart = starts[i] ?? '';
		const rawEnd = ends[i] ?? '';
		if (!rawStart && !rawEnd) continue;
		// 片方だけなら 1 日だけの不可とみなす
		const start = dateOf(rawStart || rawEnd);
		const end = dateOf(rawEnd || rawStart);
		if (!start || !end) return { error: '宿泊不可期間の日付が正しくありません。' };
		if (start > end) return { error: '宿泊不可期間は、開始日が終了日より後にならないようにしてください。' };
		blackouts.push({ start, end });
	}
	if (blackouts.length > BLACKOUT_MAX) return { error: `宿泊不可期間は ${BLACKOUT_MAX} 件までです。` };
	blackouts.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));

	const dows: number[] = [];
	for (const v of form.getAll('closed_dows')) {
		const n = Number(v);
		if (!Number.isInteger(n) || n < 0 || n > 6) return { error: '宿泊不可の曜日が正しくありません。' };
		if (!dows.includes(n)) dows.push(n);
	}
	dows.sort();
	return { stayClosed: { blackouts, dows } };
}
