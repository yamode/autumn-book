// 日付ピッカー用: 泊数・人数を変えたとき、その条件で予約できる日（と最安「1名1泊」）を /api/stay-calendar から取り直す。
// スマホの下からのシート（ScrollDatePicker）と PC の検索バー直下のパネル（StayDatePanel）で共用する。

export type StayDay = { date: string; price: number | null };
export type StayDays = { days: StayDay[]; through: string };
export type StaySource = { facilityId: string; planId?: string; months?: number };

export class StayDaysLoader {
	/** `${泊数}|${人数}` → 取り直した結果 */
	cache = $state<Record<string, StayDays>>({});
	loading = $state(false);
	failed = $state(false);
	#controller: AbortController | null = null;

	static key(nights: number, adults: number) {
		return `${nights}|${adults}`;
	}

	/** ページのデータや取得元が変わったら捨てる */
	reset() {
		this.#controller?.abort();
		this.#controller = null;
		this.cache = {};
		this.loading = false;
		this.failed = false;
	}

	get(nights: number, adults: number): StayDays | null {
		return this.cache[StayDaysLoader.key(nights, adults)] ?? null;
	}

	/** 未取得なら取りにいく。続けて条件を変えたら前の取得は捨てる */
	load(source: StaySource, nights: number, adults: number) {
		const key = StayDaysLoader.key(nights, adults);
		if (this.cache[key]) return;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		const query = new URLSearchParams({ facility: source.facilityId, nights: String(nights), adults: String(adults) });
		if (source.planId) query.set('plan', source.planId);
		if (source.months) query.set('months', String(source.months));
		this.loading = true;
		this.failed = false;
		fetch(`/api/stay-calendar?${query}`, { signal: controller.signal })
			.then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
			.then((result: StayDays) => {
				if (this.#controller !== controller) return;
				this.cache = { ...this.cache, [key]: result };
				this.loading = false;
			})
			.catch((reason) => {
				if (this.#controller !== controller) return;
				this.loading = false;
				this.failed = true;
				console.error('[stay-days] stay-calendar', reason);
			});
	}
}
