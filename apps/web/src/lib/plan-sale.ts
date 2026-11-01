// プランの販売状態（販売スイッチ＋販売表示期間）。DB の book.plan_on_sale（autumn-shared 20261101045650）と同じ判定を
// 画面の表示用に持つ（実際の出し分け・仮押さえの可否は DB が決める）。日付は日本時間の YYYY-MM-DD。

export type PlanSaleState = 'on' | 'before' | 'ended' | 'off';

/** 今日（日本時間）の YYYY-MM-DD */
export function todayJstDate(now: Date = new Date()): string {
	return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** off＝スイッチが停止中／before＝販売開始前／ended＝期間終了／on＝販売中 */
export function planSaleState(onSale: boolean, start: string | null, end: string | null, today: string = todayJstDate()): PlanSaleState {
	if (!onSale) return 'off';
	if (start && today < start) return 'before';
	if (end && today > end) return 'ended';
	return 'on';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** フォーム → 販売スイッチと販売表示期間。不正なら理由（日本語） */
export function planSaleFromForm(form: FormData): { onSale: boolean; bookingStart: string | null; bookingEnd: string | null } | { error: string } {
	const onSale = form.get('on_sale') === 'on';
	const date = (key: string): string | null | 'bad' => {
		const raw = String(form.get(key) ?? '').trim();
		if (!raw) return null;
		return DATE_RE.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : 'bad';
	};
	const bookingStart = date('booking_start');
	const bookingEnd = date('booking_end');
	if (bookingStart === 'bad' || bookingEnd === 'bad') return { error: '販売表示期間の日付が正しくありません。' };
	if (bookingStart && bookingEnd && bookingStart > bookingEnd) return { error: '販売表示期間は、開始日が終了日より後にならないようにしてください。' };
	return { onSale, bookingStart, bookingEnd };
}
