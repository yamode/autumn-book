// 以前の予約システム（tripla・予約番）で受けた予約。マイページで見るだけに出す（変更・取消は以前の予約システムかお電話）。
// 元データは PMS の滞在（book.my_legacy_stays）。金額・プラン名は無い。

export type LegacyStay = {
	/** 以前の予約システムの予約番号 */
	code: string;
	/** core.facilities.id */
	facilityUuid: string;
	/** 分かるときだけ（古い予約は空） */
	roomTypeName: string;
	checkin: string;
	checkout: string;
	roomCount: number;
	adults: number;
	children: number;
	/** 予約中／宿泊済み（取消は来ない） */
	status: 'reserved' | 'stayed';
};

/** 泊数（日付の差）。日付が壊れていれば 0 */
export function legacyNights(s: Pick<LegacyStay, 'checkin' | 'checkout'>): number {
	const a = Date.parse(`${s.checkin}T00:00:00Z`);
	const b = Date.parse(`${s.checkout}T00:00:00Z`);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
	return Math.round((b - a) / 86_400_000);
}

/** これからの予約（予約中でチェックアウトが今日以降・近い順）と、過去の利用（新しい順）に分ける */
export function splitLegacyStays<T extends LegacyStay>(list: T[], today: string): { upcoming: T[]; past: T[] } {
	const upcoming = list
		.filter((s) => s.status === 'reserved' && s.checkout >= today)
		.sort((a, b) => a.checkin.localeCompare(b.checkin));
	const past = list
		.filter((s) => !(s.status === 'reserved' && s.checkout >= today))
		.sort((a, b) => b.checkin.localeCompare(a.checkin));
	return { upcoming, past };
}
