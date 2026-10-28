// 検索バー（共通コンポーネント $lib/components/stay-search/*）の文言。
// ja は取引先ページ（/p/[token]）の文言そのもの。en・zh-TW は HP 配布の <yamado-search-bar> 用（Book の messages/*.json の語彙に揃える）。
// paraglide は使わない（embed のビルドに同梱するため）。
import type { StaySearchLang } from './params';

export type StaySearchLabels = {
	checkin: string;
	addDate: string;
	nights: string;
	nightsN: (n: number) => string;
	guests: string;
	guestsVal: (adults: number, rooms: number) => string;
	checkinNights: string;
	dateNights: (date: string, nights: number) => string;
	search: string;
	changeNights: string;
	dec: (what: string) => string;
	inc: (what: string) => string;
	perRoom: string;
	adult: string;
	/** crossType=true: 部屋タイプ横断で数える */
	roomsTitle: (crossType: boolean) => string;
	roomsSub: (crossType: boolean) => string;
	personUnit: (n: number) => string;
	roomUnit: (n: number) => string;
	comboNote: (crossType: boolean) => string;
	applyCond: string;
	applyDates: string;
	applyNoDate: string;
	noDate: string;
	loading: string;
	failed: string;
	hint: string;
	priceNote: (adults: number, rooms: number) => string;
	unavailable: string;
	soldOut: string;
	closed: string;
	prev: string;
	next: string;
	close: string;
	range: (checkin: string, checkout: string, nights: number) => string;
	undated: (nights: number) => string;
	pickHint: string;
	dateDialog: string;
	region: string;
};

const enNights = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
const enAdults = (n: number) => `${n} ${n === 1 ? 'adult' : 'adults'}`;

export const STAY_SEARCH_LABELS: Record<StaySearchLang, StaySearchLabels> = {
	ja: {
		checkin: 'チェックイン',
		addDate: '日付を追加',
		nights: '泊数',
		nightsN: (n) => `${n}泊`,
		guests: 'ご利用人数・室数',
		guestsVal: (a, r) => `大人${a}名${r > 1 ? ` × ${r}室` : '・1室'}`,
		checkinNights: 'チェックイン・泊数',
		dateNights: (d, n) => `${d}〜 ${n}泊`,
		search: '検索',
		changeNights: '泊数を変える',
		dec: (x) => `${x}を減らす`,
		inc: (x) => `${x}を増やす`,
		perRoom: '1室あたりの人数',
		adult: '大人',
		roomsTitle: (c) => (c ? '必要な室数' : '室数'),
		roomsSub: (c) => (c ? 'お部屋タイプは問いません・各室同じ人数' : '同じお部屋タイプ・各室同じ人数'),
		personUnit: (n) => `${n}名`,
		roomUnit: (n) => `${n}室`,
		comboNote: (c) =>
			c
				? '1つのお部屋タイプで足りないときは、お部屋タイプを組み合わせた候補（例: 和室1室＋洋室1室）をお出しします。'
				: 'お部屋タイプの違う組み合わせ（例: 和室1室＋洋室1室）は、お部屋ごとに分けてご予約ください。',
		applyCond: 'この条件で検索',
		applyDates: 'この日程で検索',
		applyNoDate: '日付指定なしで検索',
		noDate: '日付指定なし',
		loading: '空き状況を確認中…',
		failed: '料金を読み込めませんでした',
		hint: '泊数を変えると空き日がすぐ変わります',
		priceNote: (a, r) => `大人${a}名${r > 1 ? `×${r}室` : '・1室'}・1名あたりの最安`,
		unavailable: '— は満室・料金なし',
		soldOut: '満室・料金なし',
		closed: '休館日',
		prev: '前の月',
		next: '次の月',
		close: '閉じる',
		range: (c, o, n) => `${c} 〜 ${o}・${n}泊`,
		undated: (n) => `日付指定なし・${n}泊（今後3か月の最安で表示）`,
		pickHint: 'チェックイン日を選ぶと、その日の料金でプランの詳細を表示します',
		dateDialog: 'ご宿泊日',
		region: '空室検索'
	},
	en: {
		checkin: 'Check-in',
		addDate: 'Add dates',
		nights: 'Nights',
		nightsN: enNights,
		guests: 'Guests & rooms',
		guestsVal: (a, r) => `${enAdults(a)}${r > 1 ? ` × ${r} rooms` : ' · 1 room'}`,
		checkinNights: 'Check-in · Nights',
		dateNights: (d, n) => `${d} · ${enNights(n)}`,
		search: 'Search',
		changeNights: 'Change nights',
		dec: (x) => `Decrease ${x.toLowerCase()}`,
		inc: (x) => `Increase ${x.toLowerCase()}`,
		perRoom: 'Guests per room',
		adult: 'Adults',
		roomsTitle: (c) => (c ? 'Rooms needed' : 'Rooms'),
		roomsSub: (c) => (c ? 'Any room type · same number of guests in each room' : 'Same room type · same number of guests in each room'),
		personUnit: (n) => String(n),
		roomUnit: (n) => String(n),
		comboNote: (c) =>
			c
				? 'If one room type is not enough, we will suggest combinations of room types (e.g. 1 Japanese-style + 1 Western-style room).'
				: 'To combine different room types (e.g. 1 Japanese-style + 1 Western-style room), please book each room separately.',
		applyCond: 'Search',
		applyDates: 'Search these dates',
		applyNoDate: 'Search without dates',
		noDate: 'No specific dates',
		loading: 'Checking availability…',
		failed: 'Could not load prices',
		hint: 'Availability updates as you change nights',
		priceNote: (a, r) => `${enAdults(a)}${r > 1 ? ` × ${r} rooms` : ' · 1 room'} · lowest price per person`,
		unavailable: '— Sold out / no price',
		soldOut: 'Sold out / no price',
		closed: 'Closed',
		prev: 'Previous month',
		next: 'Next month',
		close: 'Close',
		range: (c, o, n) => `${c} – ${o} · ${enNights(n)}`,
		undated: (n) => `No dates · ${enNights(n)} (lowest price over the next 3 months)`,
		pickHint: 'Choose a check-in date to see the plan details for that day',
		dateDialog: 'Dates of stay',
		region: 'Search availability'
	},
	'zh-TW': {
		checkin: '入住日期',
		addDate: '新增日期',
		nights: '晚數',
		nightsN: (n) => `${n}晚`,
		guests: '入住人數・房間數',
		guestsVal: (a, r) => `${a}位大人${r > 1 ? ` × ${r}間` : '・1間'}`,
		checkinNights: '入住日期・晚數',
		dateNights: (d, n) => `${d}〜 ${n}晚`,
		search: '搜尋',
		changeNights: '變更晚數',
		dec: (x) => `減少${x}`,
		inc: (x) => `增加${x}`,
		perRoom: '每間房的人數',
		adult: '大人',
		roomsTitle: (c) => (c ? '所需房間數' : '房間數'),
		roomsSub: (c) => (c ? '不限房型・每間人數相同' : '相同房型・每間人數相同'),
		personUnit: (n) => `${n}位`,
		roomUnit: (n) => `${n}間`,
		comboNote: (c) =>
			c ? '若單一房型的空房不足，將為您提供組合不同房型的方案（例：和室1間＋洋室1間）。' : '如需組合不同房型（例：和室1間＋洋室1間），請分別預訂每間房。',
		applyCond: '以此條件搜尋',
		applyDates: '以此日程搜尋',
		applyNoDate: '不指定日期搜尋',
		noDate: '不指定日期',
		loading: '正在確認空房…',
		failed: '無法載入價格',
		hint: '變更晚數後空房會立即更新',
		priceNote: (a, r) => `${a}位大人${r > 1 ? `×${r}間` : '・1間'}・每人最低價`,
		unavailable: '— 為客滿或無價格',
		soldOut: '客滿或無價格',
		closed: '休館日',
		prev: '上個月',
		next: '下個月',
		close: '關閉',
		range: (c, o, n) => `${c} 〜 ${o}・${n}晚`,
		undated: (n) => `不指定日期・${n}晚（顯示今後3個月的最低價）`,
		pickHint: '選擇入住日期後，將以當日價格顯示方案詳情',
		dateDialog: '住宿日期',
		region: '搜尋空房'
	}
};
