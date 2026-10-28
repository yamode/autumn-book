/*!
 * autumn-book 検索バー（施設 HP 向けの配布部品・設計書 docs/hp-book-integration.md §3.8）
 * 施設 HP に次の 2 行を置くと、取引先ページの検索バー（PartnerSearchBar）とほぼ同じ見た目のバーが出る。
 *   <yamado-search-bar facility="oga" lang="ja" utm-source="hp_oga" utm-content="search_bar">
 *     <form method="GET" action="https://book.yamado.app/yamado/oga/plans">…（JS が動かないときの代替）…</form>
 *   </yamado-search-bar>
 *   <script src="https://book.yamado.app/embed/search-bar.js" defer></script>
 * 属性:
 *   facility    nishiwaga | oga（必須。これ以外なら何もせず、中の代替フォームをそのまま見せる）
 *   lang        ja | en | zh-TW（省略時は <html lang> から推定。ko は Book に無いので en。既定 ja）
 *   utm-source  省略時は hp_<facility>
 *   utm-content 省略時は search_bar
 * 「検索」で Book のプラン一覧（E2）へ同一タブで遷移する。直前に dataLayer へ search_submit を積む。
 * 空き日は Book の /api/stay-calendar（このスクリプトと同じオリジン）から取る。取れなくても日付は選べる。
 * 色は CSS 変数 --yamado-search-accent / --yamado-search-accent-soft / --yamado-search-font で HP 側から上書きできる。
 * 依存ライブラリなし。Shadow DOM で HP 側の CSS と干渉しない（中の代替フォームは slot を置かないので描かれない）。
 * 純関数は globalThis.__yamadoSearchBar に公開している（vitest: src/lib/embed-search-bar.test.ts）。
 */
(function (global) {
	'use strict';

	// ---------------------------------------------------------------- 純関数（DOM に触らない）

	var DEFAULT_ORIGIN = 'https://book.yamado.app';
	var FACILITIES = { nishiwaga: { accent: '#4a6b52', soft: '#e7eee8' }, oga: { accent: '#2d4a5a', soft: '#e4ecf0' } };
	// Book 側（plans/+page.server.ts・/api/stay-calendar）の範囲と既定値
	var LIMITS = { nights: { min: 1, max: 7, def: 1 }, adults: { min: 1, max: 6, def: 2 }, rooms: { min: 1, max: 4, def: 1 } };
	var MONTHS_AHEAD = 11; // 月送りの上限（今月＋11か月。StayDatePanel と同じ）

	var pad = function (n) {
		return String(n).padStart(2, '0');
	};

	/** 言語の表記ゆれを Book の言語に直す（分からなければ空文字） */
	function normalizeLang(value) {
		var s = String(value == null ? '' : value).trim().toLowerCase();
		if (!s) return '';
		if (s.indexOf('zh') === 0) return 'zh-TW'; // HP の中国語は繁体字（簡体字ページは無い）
		if (s.indexOf('en') === 0) return 'en';
		if (s.indexOf('ko') === 0) return 'en'; // Book に韓国語が無いあいだは英語（設計書 §3.1）
		if (s.indexOf('ja') === 0) return 'ja';
		return '';
	}

	/** 要素の lang 属性 → <html lang> → ja の順で決める */
	function resolveLang(attr, htmlLang) {
		return normalizeLang(attr) || normalizeLang(htmlLang) || 'ja';
	}

	function normalizeFacility(value) {
		var s = String(value == null ? '' : value).trim().toLowerCase();
		return Object.prototype.hasOwnProperty.call(FACILITIES, s) ? s : '';
	}

	/** 整数にして範囲に丸める（数字でなければ fallback） */
	function clampInt(value, min, max, fallback) {
		var n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value == null ? '' : value), 10);
		if (!Number.isFinite(n)) return fallback;
		return Math.min(max, Math.max(min, n));
	}

	/** 泊数・人数・室数を Book の範囲に丸める */
	function clampSearch(values) {
		var v = values || {};
		return {
			nights: clampInt(v.nights, LIMITS.nights.min, LIMITS.nights.max, LIMITS.nights.def),
			adults: clampInt(v.adults, LIMITS.adults.min, LIMITS.adults.max, LIMITS.adults.def),
			rooms: clampInt(v.rooms, LIMITS.rooms.min, LIMITS.rooms.max, LIMITS.rooms.def)
		};
	}

	/** 実在する YYYY-MM-DD か */
	function isIsoDate(value) {
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		var t = new Date(value + 'T00:00:00Z');
		return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === value;
	}

	/** スクリプトの src のオリジン（取れなければ本番） */
	function apiOrigin(src) {
		try {
			var u = new URL(String(src));
			if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
		} catch (e) {}
		return DEFAULT_ORIGIN;
	}

	function langPrefix(lang) {
		return lang === 'en' ? '/en' : lang === 'zh-TW' ? '/zh-TW' : '';
	}

	/**
	 * 検索の遷移先（Book のプラン一覧 E2・契約書 v1.1）。
	 * checkin は未選択（または不正）なら付けない。rooms は 1 のとき付けない。
	 */
	function buildSearchUrl(origin, options) {
		var o = options || {};
		var facility = normalizeFacility(o.facility);
		if (!facility) return '';
		var lang = normalizeLang(o.lang) || 'ja';
		var v = clampSearch(o);
		var q = [];
		if (isIsoDate(o.checkin)) q.push(['checkin', o.checkin]);
		q.push(['nights', v.nights], ['adults', v.adults]);
		if (v.rooms > 1) q.push(['rooms', v.rooms]);
		q.push(
			['utm_source', o.utmSource || 'hp_' + facility],
			['utm_medium', 'referral'],
			['utm_campaign', 'reserve'],
			['utm_content', o.utmContent || 'search_bar']
		);
		var base = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
		return (
			base + langPrefix(lang) + '/yamado/' + facility + '/plans?' +
			q.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(String(p[1])); }).join('&')
		);
	}

	/** 空き日の取得先（/api/stay-calendar は施設 slug を受ける） */
	function calendarUrl(origin, facility, nights, adults) {
		var v = clampSearch({ nights: nights, adults: adults });
		return (
			String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '') +
			'/api/stay-calendar?facility=' + encodeURIComponent(facility) + '&nights=' + v.nights + '&adults=' + v.adults + '&months=2'
		);
	}

	/** 今日（JST） */
	function todayJst(nowMs) {
		return new Date((nowMs == null ? Date.now() : nowMs) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
	}

	function addDays(iso, days) {
		var t = new Date(iso + 'T00:00:00Z');
		t.setUTCDate(t.getUTCDate() + days);
		return t.toISOString().slice(0, 10);
	}

	/** 'YYYY-MM' を delta か月ずらす */
	function shiftYm(ym, delta) {
		var parts = ym.split('-').map(Number);
		var t = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
		return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1);
	}

	/** 月のカレンダー: 1日の曜日（日=0）と日付の並び */
	function monthGrid(ym) {
		var parts = ym.split('-').map(Number);
		var count = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
		var dates = [];
		for (var d = 1; d <= count; d += 1) dates.push(ym + '-' + pad(d));
		return { offset: new Date(Date.UTC(parts[0], parts[1] - 1, 1)).getUTCDay(), dates: dates };
	}

	function weekdayOf(iso) {
		return new Date(iso + 'T00:00:00Z').getUTCDay();
	}

	var WEEK = {
		ja: ['日', '月', '火', '水', '木', '金', '土'],
		en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
		'zh-TW': ['日', '一', '二', '三', '四', '五', '六']
	};
	var EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	/** 12月20日（土）／Sat, Dec 20／12月20日（六） */
	function formatDate(iso, lang) {
		var parts = iso.split('-').map(Number);
		var w = (WEEK[lang] || WEEK.ja)[weekdayOf(iso)];
		if (lang === 'en') return w + ', ' + EN_MONTHS[parts[1] - 1].slice(0, 3) + ' ' + parts[2];
		return parts[1] + '月' + parts[2] + '日（' + w + '）';
	}

	/** 2026年 12月／December 2026 */
	function formatMonth(ym, lang) {
		var parts = ym.split('-').map(Number);
		if (lang === 'en') return EN_MONTHS[parts[1] - 1] + ' ' + parts[0];
		return parts[0] + '年 ' + parts[1] + '月';
	}

	/** 料金の表示（ja・zh-TW は「12,000円」、en は「¥12,000」） */
	function formatPrice(price, lang) {
		var s = Math.round(price).toLocaleString('ja-JP');
		return lang === 'en' ? '¥' + s : s + '円';
	}

	/** /api/stay-calendar の応答 → { prices: {日付: 1名1泊の最安}, closed: {日付: true}, through }。形が違えば null */
	function parseCalendar(json) {
		if (!json || !Array.isArray(json.days)) return null;
		var prices = {};
		var closed = {};
		json.days.forEach(function (d) {
			if (d && isIsoDate(d.date) && typeof d.price === 'number' && d.price > 0) prices[d.date] = d.price;
		});
		(Array.isArray(json.closed) ? json.closed : []).forEach(function (d) {
			if (isIsoDate(d)) closed[d] = true;
		});
		return { prices: prices, closed: closed, through: isIsoDate(json.through) ? json.through : '' };
	}

	/**
	 * 1 日分の表示（StayDatePanel と同じ判定）。
	 * data が無い（取得中・失敗）ときは今日以降をすべて選べる＝フォールバック。
	 * 取得範囲（through）を過ぎた日は料金なしで選べる。
	 */
	function dayState(date, today, data) {
		var price = data && Object.prototype.hasOwnProperty.call(data.prices, date) ? data.prices[date] : null;
		var known = !!(data && data.through && date <= data.through && price == null);
		return {
			price: price,
			disabled: date < today || known,
			unavailable: known && date >= today,
			closed: !!(known && data.closed[date])
		};
	}

	// ---------------------------------------------------------------- 文言（Book の messages/*.json の語彙に揃える）

	var T = {
		ja: {
			checkin: 'チェックイン',
			addDate: '日付を追加',
			nights: '泊数',
			nightsN: function (n) { return n + '泊'; },
			guests: 'ご利用人数・室数',
			guestsVal: function (a, r) { return '大人' + a + '名' + (r > 1 ? ' × ' + r + '室' : '・1室'); },
			checkinNights: 'チェックイン・泊数',
			dateNights: function (d, n) { return d + '〜 ' + n + '泊'; },
			search: '検索',
			changeNights: '泊数を変える',
			dec: function (x) { return x + 'を減らす'; },
			inc: function (x) { return x + 'を増やす'; },
			perRoom: '1室あたりの人数',
			adult: '大人',
			roomsTitle: '必要な室数',
			roomsSub: 'お部屋タイプは問いません・各室同じ人数',
			personUnit: function (n) { return n + '名'; },
			roomUnit: function (n) { return n + '室'; },
			comboNote: '1つのお部屋タイプで足りないときは、お部屋タイプを組み合わせた候補（例: 和室1室＋洋室1室）をお出しします。',
			applyCond: 'この条件で検索',
			applyDates: 'この日程で検索',
			applyNoDate: '日付指定なしで検索',
			noDate: '日付指定なし',
			loading: '空き状況を確認中…',
			failed: '空き状況を取得できませんでした',
			hint: '泊数を変えると空き日がすぐ変わります',
			priceNote: function (a) { return '大人' + a + '名・1名あたりの最安'; },
			unavailable: '— は満室・販売なし',
			soldOut: '満室・販売なし',
			closed: '休館日',
			prev: '前の月',
			next: '次の月',
			close: '閉じる',
			range: function (c, o, n) { return c + ' 〜 ' + o + '・' + n + '泊'; },
			undated: function (n) { return '日付指定なし・' + n + '泊（今後3か月の最安で表示）'; },
			dateDialog: 'ご宿泊日',
			region: '空室検索'
		},
		en: {
			checkin: 'Check-in',
			addDate: 'Add dates',
			nights: 'Nights',
			nightsN: function (n) { return n + (n === 1 ? ' night' : ' nights'); },
			guests: 'Guests & rooms',
			guestsVal: function (a, r) { return a + (a === 1 ? ' adult' : ' adults') + (r > 1 ? ' × ' + r + ' rooms' : ' · 1 room'); },
			checkinNights: 'Check-in · Nights',
			dateNights: function (d, n) { return d + ' · ' + n + (n === 1 ? ' night' : ' nights'); },
			search: 'Search',
			changeNights: 'Change nights',
			dec: function (x) { return 'Decrease ' + x.toLowerCase(); },
			inc: function (x) { return 'Increase ' + x.toLowerCase(); },
			perRoom: 'Guests per room',
			adult: 'Adults',
			roomsTitle: 'Rooms needed',
			roomsSub: 'Any room type · same number of guests in each room',
			personUnit: function (n) { return String(n); },
			roomUnit: function (n) { return String(n); },
			comboNote: 'If one room type is not enough, we will suggest combinations of room types (e.g. 1 Japanese-style + 1 Western-style room).',
			applyCond: 'Search',
			applyDates: 'Search these dates',
			applyNoDate: 'Search without dates',
			noDate: 'No specific dates',
			loading: 'Checking availability…',
			failed: 'Could not load availability',
			hint: 'Availability updates as you change nights',
			priceNote: function (a) { return a + (a === 1 ? ' adult' : ' adults') + ' · lowest price per person per night'; },
			unavailable: '— Sold out / not on sale',
			soldOut: 'Sold out / not on sale',
			closed: 'Closed',
			prev: 'Previous month',
			next: 'Next month',
			close: 'Close',
			range: function (c, o, n) { return c + ' – ' + o + ' · ' + n + (n === 1 ? ' night' : ' nights'); },
			undated: function (n) { return 'No dates · ' + n + (n === 1 ? ' night' : ' nights') + ' (lowest price over the next 3 months)'; },
			dateDialog: 'Dates of stay',
			region: 'Search availability'
		},
		'zh-TW': {
			checkin: '入住日期',
			addDate: '新增日期',
			nights: '晚數',
			nightsN: function (n) { return n + '晚'; },
			guests: '入住人數・房間數',
			guestsVal: function (a, r) { return a + '位大人' + (r > 1 ? ' × ' + r + '間' : '・1間'); },
			checkinNights: '入住日期・晚數',
			dateNights: function (d, n) { return d + '〜 ' + n + '晚'; },
			search: '搜尋',
			changeNights: '變更晚數',
			dec: function (x) { return '減少' + x; },
			inc: function (x) { return '增加' + x; },
			perRoom: '每間房的人數',
			adult: '大人',
			roomsTitle: '所需房間數',
			roomsSub: '不限房型・每間人數相同',
			personUnit: function (n) { return n + '位'; },
			roomUnit: function (n) { return n + '間'; },
			comboNote: '若單一房型的空房不足，將為您提供組合不同房型的方案（例：和室1間＋洋室1間）。',
			applyCond: '以此條件搜尋',
			applyDates: '以此日程搜尋',
			applyNoDate: '不指定日期搜尋',
			noDate: '不指定日期',
			loading: '正在確認空房…',
			failed: '無法取得空房狀況',
			hint: '變更晚數後空房會立即更新',
			priceNote: function (a) { return a + '位大人・每人每晚最低價'; },
			unavailable: '— 為客滿或未販售',
			soldOut: '客滿或未販售',
			closed: '休館日',
			prev: '上個月',
			next: '下個月',
			close: '關閉',
			range: function (c, o, n) { return c + ' 〜 ' + o + '・' + n + '晚'; },
			undated: function (n) { return '不指定日期・' + n + '晚（顯示今後3個月的最低價）'; },
			dateDialog: '住宿日期',
			region: '搜尋空房'
		}
	};

	var api = {
		LIMITS: LIMITS,
		T: T,
		normalizeLang: normalizeLang,
		resolveLang: resolveLang,
		normalizeFacility: normalizeFacility,
		clampInt: clampInt,
		clampSearch: clampSearch,
		isIsoDate: isIsoDate,
		apiOrigin: apiOrigin,
		buildSearchUrl: buildSearchUrl,
		calendarUrl: calendarUrl,
		todayJst: todayJst,
		addDays: addDays,
		shiftYm: shiftYm,
		monthGrid: monthGrid,
		formatDate: formatDate,
		formatMonth: formatMonth,
		formatPrice: formatPrice,
		parseCalendar: parseCalendar,
		dayState: dayState
	};
	global.__yamadoSearchBar = api;

	// ---------------------------------------------------------------- ここから DOM（ブラウザだけ）

	if (typeof document === 'undefined' || typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') return;
	if (customElements.get('yamado-search-bar')) return;

	var ORIGIN = apiOrigin(document.currentScript && document.currentScript.src);

	function esc(s) {
		return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	var CSS =
		':host{display:block;position:relative;container-type:inline-size;' +
		'font-family:var(--yamado-search-font,"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic",Meiryo,system-ui,sans-serif);' +
		'font-size:16px;line-height:1.5;font-weight:400;color:#1f1d15;letter-spacing:normal;text-align:left;text-transform:none;white-space:normal;-webkit-text-size-adjust:100%}' +
		':host([hidden]){display:none}' +
		'*,*::before,*::after{box-sizing:border-box}' +
		'button{font:inherit;color:inherit;letter-spacing:inherit;margin:0;border:0;background:none;padding:0;cursor:pointer;text-align:inherit;-webkit-tap-highlight-color:transparent}' +
		'button:disabled{cursor:default}' +
		'button:focus-visible,.pnl:focus-visible{outline:2px solid var(--acc);outline-offset:2px}' +
		'.lbl{display:block;font-size:12px;font-weight:700;letter-spacing:.03em}' +
		'.val{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
		'.val.ph{color:#a8a29e}' +
		// PC: 1 本の角丸バー
		'.pc{display:none;align-items:center;border:1px solid #e7e5e4;border-radius:9999px;padding:6px;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.08)}' +
		'.pc.on{background:#f5f5f4}' +
		'.seg{display:flex;min-width:0;flex-direction:column;justify-content:center;border-radius:9999px;padding:10px 24px;transition:background-color .15s,box-shadow .15s}' +
		'.seg:hover{background:#f5f5f4}.seg.act{background:#fff;box-shadow:0 6px 20px rgba(0,0,0,.12)}' +
		'.s-in{flex:1.3 1 0}.s-n{flex:.7 1 0}' +
		'.s-g{flex:1 1 0;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;padding:6px 6px 6px 24px}' +
		'.s-g .gb{display:flex;flex:1;min-width:0;flex-direction:column}' +
		'.dv{flex:none;width:1px;height:32px;background:#e7e5e4}.pc.on .dv{opacity:0}' +
		'.go{flex:none;border-radius:9999px;background:var(--acc);color:#fff;font-weight:700;font-size:16px;padding:12px 24px;transition:filter .15s}' +
		'.go:hover{filter:brightness(1.1)}' +
		// スマホ: 縦に積んだカード
		'.sp{overflow:hidden;border:1px solid #e7e5e4;border-radius:16px;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.08)}' +
		'.row{display:flex;width:100%;flex-direction:column;padding:12px 16px;text-align:left}' +
		'.row+.row{border-top:1px solid #e7e5e4}' +
		'.sp .sf{border-top:1px solid #e7e5e4;padding:8px}.sp .go{width:100%;border-radius:12px;padding:12px;text-align:center}' +
		'@container (min-width:768px){.pc{display:flex}.sp{display:none}}' +
		// 浮いたパネル
		'.pnl{position:absolute;left:0;right:0;top:100%;margin-top:12px;z-index:2147483000;background:#fff;border:1px solid #e7e5e4;border-radius:24px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:12px 16px 16px;outline:none}' +
		'@container (min-width:640px){.pnl{padding:16px 24px}}' +
		'.gp{padding:20px}' +
		'@container (min-width:768px){.gp{left:auto;width:24rem}}' +
		'.hr{display:flex;flex-wrap:wrap;align-items:center;gap:12px;border-bottom:1px solid #f5f5f4;padding-bottom:12px}' +
		'.mt{font-size:16px;color:#57534e}.fa{font-size:14px;color:#a8a29e}.er{font-size:14px;color:#be123c}.ms{font-size:14px;color:#78716c}' +
		'.ml{margin-left:auto}' +
		'.sq{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:4px;background:var(--acc);color:#fff}' +
		'.sq:disabled{opacity:.3}' +
		'.ct{min-width:40px;text-align:center;font-weight:500;font-variant-numeric:tabular-nums}' +
		'.nd{display:flex;align-items:center;gap:8px;border:1px solid #d6d3d1;border-radius:8px;padding:6px 12px;font-size:16px}' +
		'.nd:not(:disabled):hover{border-color:#1f1d15}.nd:disabled{border-color:#e7e5e4;color:#78716c}' +
		'.bx{display:inline-flex;width:16px;height:16px;align-items:center;justify-content:center;border:1.5px solid currentColor;border-radius:3px;font-size:11px;line-height:1}' +
		'.x{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:9999px;font-size:22px;line-height:1;color:#78716c}.x:hover{background:#f5f5f4}' +
		'.cal{position:relative;margin-top:12px;display:grid;gap:24px}' +
		'.m2{display:none}' +
		'@container (min-width:768px){.cal{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.m2{display:block}}' +
		'.nav{position:absolute;top:0;z-index:1;display:flex;width:32px;height:32px;align-items:center;justify-content:center;border:1px solid #e7e5e4;border-radius:9999px;background:#fff;color:#57534e;font-size:18px;line-height:1}' +
		'.nav:disabled{opacity:.3}.pv{left:0}.nx{right:0}' +
		'.mh{margin:0 0 8px;text-align:center;font-size:18px;font-weight:700;line-height:32px}' +
		'.wk,.ds{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center}' +
		'.wk div{padding:6px 0;font-size:14px;font-weight:500;color:#78716c}.wk .su{color:#e11d48}.wk .sa{color:#0284c7}' +
		'.ds{border-top:1px solid #e7e5e4}.ds>*{min-height:64px;border-bottom:1px solid #f5f5f4}' +
		'.d{display:block;width:100%;padding:6px 2px;text-align:center;transition:background-color .1s}' +
		'.d .n{display:block;font-size:16px;color:#292524}.d.su .n{color:#e11d48}.d.sa .n{color:#0284c7}' +
		'.d .p{display:block;white-space:nowrap;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.03em;color:var(--acc)}' +
		'@container (min-width:640px){.d .p{font-size:13px}}' +
		'.d .st{display:block;font-size:12px}' +
		'.d:not(:disabled):hover{background:var(--acc-soft)}' +
		'.d:disabled{color:#d6d3d1}.d:disabled .n{color:#d6d3d1}' +
		'.d.in{background:var(--acc-soft)}' +
		'.d.sel{background:var(--acc);border-radius:4px;color:#fff}.d.sel .n,.d.sel .p{color:#fff}' +
		'.sh{display:block;margin:4px auto 0;height:14px;width:80%;max-width:56px;border-radius:4px;background:linear-gradient(90deg,#f5f5f4 25%,#e7e5e4 50%,#f5f5f4 75%);background-size:200% 100%;animation:sh 1.2s linear infinite}' +
		'@keyframes sh{from{background-position:200% 0}to{background-position:-200% 0}}' +
		'.ft{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #f5f5f4;padding-top:12px}' +
		'.ft p{margin:0;font-size:16px;color:#44403c}.ft small{margin-left:8px;font-size:14px;color:#a8a29e}' +
		'.ap{border-radius:9999px;background:#1f1d15;color:#fff;font-weight:600;font-size:16px;padding:10px 24px}.ap:hover{background:#2e2b20}' +
		'.gr{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}.gr+.gr{border-top:1px solid #e7e5e4}' +
		'.gr .t{margin:0;font-size:16px;font-weight:600}.gr .s{margin:0;font-size:14px;color:#78716c}' +
		'.pm{display:flex;flex:none;align-items:center;gap:12px}' +
		'.rb{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid #d6d3d1;border-radius:9999px;font-size:18px;color:#57534e}' +
		'.rb:not(:disabled):hover{border-color:#1f1d15}.rb:disabled{opacity:.3}' +
		'.nt{margin:4px 0 0;font-size:12px;line-height:20px;color:#78716c}' +
		'.gf{margin-top:12px;display:flex;justify-content:flex-end}' +
		'@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}';

	var MINUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
	var PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>';

	var uid = 0;

	class YamadoSearchBar extends HTMLElement {
		static get observedAttributes() {
			return ['facility', 'lang'];
		}

		constructor() {
			super();
			this._id = 'ysb' + ++uid;
			this._s = { open: '', seg: 'checkin', checkin: '', nights: LIMITS.nights.def, adults: LIMITS.adults.def, rooms: LIMITS.rooms.def, leftYm: '' };
			this._cache = {};
			this._loading = false;
			this._failed = false;
			this._ctrl = null;
			this._onDocPointer = this._onDocPointer.bind(this);
			this._onDocKey = this._onDocKey.bind(this);
		}

		connectedCallback() {
			this._facility = normalizeFacility(this.getAttribute('facility'));
			if (!this._facility) {
				// 施設が分からないときは何もしない（中の代替フォームがそのまま見える）
				console.warn('[yamado-search-bar] facility は nishiwaga か oga を指定してください');
				return;
			}
			this._lang = resolveLang(this.getAttribute('lang'), document.documentElement.getAttribute('lang'));
			this._t = T[this._lang];
			if (!this.shadowRoot) {
				var root = this.attachShadow({ mode: 'open' });
				root.addEventListener('click', this._onClick.bind(this));
			}
			document.addEventListener('pointerdown', this._onDocPointer);
			document.addEventListener('keydown', this._onDocKey);
			this._render();
		}

		disconnectedCallback() {
			document.removeEventListener('pointerdown', this._onDocPointer);
			document.removeEventListener('keydown', this._onDocKey);
			if (this._ctrl) this._ctrl.abort();
		}

		attributeChangedCallback(name, oldValue, newValue) {
			if (oldValue === newValue || !this.isConnected || !this.shadowRoot) return;
			if (name === 'facility') {
				var f = normalizeFacility(newValue);
				if (!f) return;
				this._facility = f;
				this._cache = {};
			}
			this._lang = resolveLang(this.getAttribute('lang'), document.documentElement.getAttribute('lang'));
			this._t = T[this._lang];
			this._render();
		}

		// ---- 外側クリック・Esc で閉じる
		_onDocPointer(e) {
			if (!this._s.open) return;
			var path = e.composedPath ? e.composedPath() : [];
			if (path.indexOf(this) < 0) this._close(false);
		}

		_onDocKey(e) {
			if (e.key !== 'Escape' || !this._s.open) return;
			// 中にフォーカスがあるときだけ、開いた区画のボタンへ戻す
			this._close(!!(this.shadowRoot && this.shadowRoot.activeElement));
		}

		_close(refocus) {
			var trigger = this._s.open === 'guests' ? 'guests' : this._s.seg;
			this._s.open = '';
			this._render();
			if (refocus) this._focusTrigger(trigger);
		}

		_focusTrigger(seg) {
			var keys = seg === 'guests' ? ['pc-guests', 'sp-guests'] : seg === 'nights' ? ['pc-nights', 'sp-date'] : ['pc-checkin', 'sp-date'];
			for (var i = 0; i < keys.length; i += 1) {
				var el = this.shadowRoot.querySelector('[data-k="' + keys[i] + '"]');
				if (el && el.offsetParent !== null) return el.focus();
			}
		}

		// ---- 空き日（泊数×人数ごとにキャッシュ。続けて変えたら前の取得は捨てる）
		_data() {
			return this._cache[this._s.nights + '|' + this._s.adults] || null;
		}

		_load() {
			var s = this._s;
			var key = s.nights + '|' + s.adults;
			if (this._cache[key]) {
				if (this._ctrl) this._ctrl.abort();
				this._ctrl = null;
				this._loading = false;
				this._failed = false;
				return;
			}
			if (this._ctrl) this._ctrl.abort();
			var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
			this._ctrl = ctrl;
			this._loading = true;
			this._failed = false;
			var self = this;
			var timer = setTimeout(function () {
				if (ctrl) ctrl.abort();
			}, 10000);
			var done = function (ok) {
				clearTimeout(timer);
				if (self._ctrl !== ctrl) return;
				self._ctrl = null;
				self._loading = false;
				self._failed = !ok;
				self._render();
			};
			fetch(calendarUrl(ORIGIN, this._facility, s.nights, s.adults), { credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
				.then(function (r) {
					return r.ok ? r.json() : Promise.reject(new Error('http_' + r.status));
				})
				.then(function (json) {
					var parsed = parseCalendar(json);
					if (!parsed) throw new Error('bad_response');
					if (self._ctrl === ctrl) self._cache[key] = parsed;
					done(true);
				})
				.catch(function () {
					// 取れなくても日付は選べる（料金と空きの表示が出ないだけ）
					done(false);
				});
		}

		// ---- 操作
		_onClick(e) {
			var btn = e.target.closest ? e.target.closest('[data-act]') : null;
			if (!btn || btn.disabled) return;
			var s = this._s;
			var act = btn.getAttribute('data-act');
			var byKeyboard = e.detail === 0;
			switch (act) {
				case 'date':
				case 'guests': {
					var seg = act === 'guests' ? 'guests' : btn.getAttribute('data-seg') || 'checkin';
					var wasOpen = s.open === act && s.seg === seg;
					s.open = wasOpen ? '' : act;
					s.seg = seg;
					if (s.open === 'date') {
						s.leftYm = (s.checkin || todayJst()).slice(0, 7);
						this._load();
					}
					this._render();
					if (s.open && byKeyboard) this._focusPanel();
					return;
				}
				case 'close':
					return this._close(true);
				case 'nights-':
				case 'nights+':
					s.nights = clampInt(s.nights + (act === 'nights+' ? 1 : -1), LIMITS.nights.min, LIMITS.nights.max, s.nights);
					this._load();
					break;
				case 'adults-':
				case 'adults+':
					s.adults = clampInt(s.adults + (act === 'adults+' ? 1 : -1), LIMITS.adults.min, LIMITS.adults.max, s.adults);
					break;
				case 'rooms-':
				case 'rooms+':
					s.rooms = clampInt(s.rooms + (act === 'rooms+' ? 1 : -1), LIMITS.rooms.min, LIMITS.rooms.max, s.rooms);
					break;
				case 'nodate':
					s.checkin = '';
					break;
				case 'prev':
				case 'next':
					s.leftYm = shiftYm(s.leftYm, act === 'next' ? 1 : -1);
					break;
				case 'pick':
					s.checkin = btn.getAttribute('data-date') || '';
					break;
				case 'search':
					return this._search();
				default:
					return;
			}
			this._render();
		}

		_focusPanel() {
			var pnl = this.shadowRoot.querySelector('.pnl');
			if (!pnl) return;
			var first = pnl.querySelector('button:not(:disabled)');
			(first || pnl).focus();
		}

		_search() {
			var s = this._s;
			var v = clampSearch(s);
			var url = buildSearchUrl(ORIGIN, {
				facility: this._facility,
				lang: this._lang,
				checkin: s.checkin,
				nights: v.nights,
				adults: v.adults,
				rooms: v.rooms,
				utmSource: (this.getAttribute('utm-source') || '').trim(),
				utmContent: (this.getAttribute('utm-content') || '').trim()
			});
			if (!url) return;
			// Shadow DOM の中の操作は GTM の自動リンク計測に乗らないので、部品が自分で積む（設計書 §3.5）
			try {
				var dl = window.dataLayer;
				if (dl && typeof dl.push === 'function') {
					dl.push({ event: 'search_submit', facility: this._facility, checkin: isIsoDate(s.checkin) ? s.checkin : '', nights: v.nights, adults: v.adults, rooms: v.rooms });
				}
			} catch (err) {}
			window.location.href = url;
		}

		// ---- 描画（状態を変えるたびに描き直し、フォーカスは data-k で戻す）
		_render() {
			var root = this.shadowRoot;
			if (!root) return;
			var active = root.activeElement;
			var focusKey = active && active.getAttribute ? active.getAttribute('data-k') : null;
			var acc = FACILITIES[this._facility];
			root.innerHTML =
				'<style>:host{--acc:var(--yamado-search-accent,' + acc.accent + ');--acc-soft:var(--yamado-search-accent-soft,' + acc.soft + ')}' + CSS + '</style>' +
				'<div class="w" role="search" aria-label="' + esc(this._t.region) + '" lang="' + esc(this._lang) + '">' +
				this._barHtml() +
				(this._s.open === 'date' ? this._datePanelHtml() : this._s.open === 'guests' ? this._guestsPanelHtml() : '') +
				'</div>';
			if (focusKey) {
				var el = root.querySelector('[data-k="' + focusKey + '"]');
				if (el && !el.disabled && el.offsetParent !== null) el.focus();
				else if (root.querySelector('.pnl')) root.querySelector('.pnl').focus();
			}
		}

		_barHtml() {
			var t = this._t;
			var s = this._s;
			var lang = this._lang;
			var pid = this._id + '-panel';
			var dateVal = s.checkin ? esc(formatDate(s.checkin, lang)) : esc(t.addDate);
			var guestsVal = esc(t.guestsVal(s.adults, s.rooms));
			var seg = function (k) {
				return 'seg' + (s.open && s.seg === k ? ' act' : '');
			};
			var exp = function (k) {
				return ' aria-haspopup="dialog" aria-controls="' + pid + '" aria-expanded="' + (s.open === k ? 'true' : 'false') + '"';
			};
			return (
				'<div class="pc' + (s.open ? ' on' : '') + '">' +
				'<button type="button" class="' + seg('checkin') + ' s-in" data-act="date" data-seg="checkin" data-k="pc-checkin"' + exp('date') + '>' +
				'<span class="lbl">' + esc(t.checkin) + '</span><span class="val' + (s.checkin ? '' : ' ph') + '">' + dateVal + '</span></button>' +
				'<span class="dv" aria-hidden="true"></span>' +
				'<button type="button" class="' + seg('nights') + ' s-n" data-act="date" data-seg="nights" data-k="pc-nights" aria-label="' + esc(t.changeNights + '（' + t.nightsN(s.nights) + '）') + '"' + exp('date') + '>' +
				'<span class="lbl" aria-hidden="true">' + esc(t.nights) + '</span><span class="val" aria-hidden="true">' + esc(t.nightsN(s.nights)) + '</span></button>' +
				'<span class="dv" aria-hidden="true"></span>' +
				'<div class="' + seg('guests') + ' s-g">' +
				'<button type="button" class="gb" data-act="guests" data-k="pc-guests"' + exp('guests') + '>' +
				'<span class="lbl">' + esc(t.guests) + '</span><span class="val">' + guestsVal + '</span></button>' +
				'<button type="button" class="go" data-act="search" data-k="pc-search">' + esc(t.search) + '</button>' +
				'</div></div>' +
				'<div class="sp">' +
				'<button type="button" class="row" data-act="date" data-seg="checkin" data-k="sp-date"' + exp('date') + '>' +
				'<span class="lbl">' + esc(t.checkinNights) + '</span><span class="val' + (s.checkin ? '' : ' ph') + '">' +
				(s.checkin ? esc(t.dateNights(formatDate(s.checkin, lang), s.nights)) : esc(t.addDate)) + '</span></button>' +
				'<button type="button" class="row" data-act="guests" data-k="sp-guests"' + exp('guests') + '>' +
				'<span class="lbl">' + esc(t.guests) + '</span><span class="val">' + guestsVal + '</span></button>' +
				'<div class="sf"><button type="button" class="go" data-act="search" data-k="sp-search">' + esc(t.search) + '</button></div>' +
				'</div>'
			);
		}

		_datePanelHtml() {
			var t = this._t;
			var s = this._s;
			var lang = this._lang;
			var today = todayJst();
			var todayYm = today.slice(0, 7);
			var lastYm = shiftYm(todayYm, MONTHS_AHEAD);
			if (!s.leftYm || s.leftYm < todayYm) s.leftYm = todayYm;
			var data = this._data();
			var loading = this._loading && !data;
			var status = loading
				? '<span class="ms" role="status">' + esc(t.loading) + '</span>'
				: this._failed
					? '<span class="er" role="status">' + esc(t.failed) + '</span>'
					: '<span class="fa">' + esc(t.hint) + '</span>';
			var checkout = s.checkin ? addDays(s.checkin, s.nights) : '';
			var months = [s.leftYm, shiftYm(s.leftYm, 1)];
			var week = WEEK[lang] || WEEK.ja;
			var html =
				'<div class="pnl" id="' + this._id + '-panel" role="dialog" aria-label="' + esc(t.dateDialog) + '" tabindex="-1">' +
				'<div class="hr">' +
				'<span class="mt">' + esc(t.nights) + '</span>' +
				'<button type="button" class="sq" data-act="nights-" data-k="nights-" aria-label="' + esc(t.dec(t.nights)) + '"' + (s.nights <= LIMITS.nights.min ? ' disabled' : '') + '>' + MINUS + '</button>' +
				'<span class="ct" aria-live="polite">' + esc(t.nightsN(s.nights)) + '</span>' +
				'<button type="button" class="sq" data-act="nights+" data-k="nights+" aria-label="' + esc(t.inc(t.nights)) + '"' + (s.nights >= LIMITS.nights.max ? ' disabled' : '') + '>' + PLUS + '</button>' +
				'<button type="button" class="nd" data-act="nodate" data-k="nodate" aria-pressed="' + (s.checkin ? 'false' : 'true') + '"' + (s.checkin ? '' : ' disabled') + '>' +
				'<span class="bx" aria-hidden="true">' + (s.checkin ? '' : '✓') + '</span>' + esc(t.noDate) + '</button>' +
				status +
				'<span class="ml ms">' + esc(t.priceNote(s.adults)) + '</span>' +
				'<button type="button" class="x" data-act="close" data-k="close" aria-label="' + esc(t.close) + '">×</button>' +
				'</div>' +
				'<div class="cal">' +
				'<button type="button" class="nav pv" data-act="prev" data-k="prev" aria-label="' + esc(t.prev) + '"' + (s.leftYm <= todayYm ? ' disabled' : '') + '>‹</button>' +
				'<button type="button" class="nav nx" data-act="next" data-k="next" aria-label="' + esc(t.next) + '"' + (shiftYm(s.leftYm, 1) >= lastYm ? ' disabled' : '') + '>›</button>';
			for (var mi = 0; mi < months.length; mi += 1) {
				var ym = months[mi];
				var grid = monthGrid(ym);
				html +=
					'<section class="' + (mi === 1 ? 'm2' : '') + '" aria-label="' + esc(formatMonth(ym, lang)) + '">' +
					'<h3 class="mh">' + esc(formatMonth(ym, lang)) + '</h3><div class="wk" aria-hidden="true">';
				for (var w = 0; w < 7; w += 1) html += '<div class="' + (w === 0 ? 'su' : w === 6 ? 'sa' : '') + '">' + esc(week[w]) + '</div>';
				html += '</div><div class="ds">';
				for (var b = 0; b < grid.offset; b += 1) html += '<div aria-hidden="true"></div>';
				for (var di = 0; di < grid.dates.length; di += 1) {
					var date = grid.dates[di];
					var st = dayState(date, today, data);
					var pending = loading && date >= today;
					var selected = date === s.checkin;
					var inStay = !!s.checkin && date > s.checkin && date < checkout;
					var dow = weekdayOf(date);
					var cls = 'd' + (dow === 0 ? ' su' : dow === 6 ? ' sa' : '') + (selected ? ' sel' : inStay ? ' in' : '');
					var aria = formatDate(date, lang) + (st.price != null ? ' ' + formatPrice(st.price, lang) : st.unavailable ? ' ' + (st.closed ? t.closed : t.soldOut) : '');
					var inner = '<span class="n">' + Number(date.slice(8)) + '</span>';
					if (pending) inner += '<span class="sh" aria-hidden="true"></span>';
					else if (st.price != null) inner += '<span class="p" aria-hidden="true">' + esc(formatPrice(st.price, lang)) + '</span>';
					else if (st.unavailable) inner += '<span class="st" aria-hidden="true">' + esc(st.closed ? t.closed : '—') + '</span>';
					html +=
						'<button type="button" class="' + cls + '" data-act="pick" data-date="' + date + '" data-k="d' + date + '" aria-label="' + esc(aria) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' +
						(st.disabled || pending ? ' disabled' : '') + '>' + inner + '</button>';
				}
				html += '</div></section>';
			}
			html +=
				'</div><div class="ft"><p>' +
				esc(s.checkin ? t.range(formatDate(s.checkin, lang), formatDate(checkout, lang), s.nights) : t.undated(s.nights)) +
				'<small>' + esc(t.unavailable) + '</small></p>' +
				'<button type="button" class="ap" data-act="search" data-k="apply-date">' + esc(s.checkin ? t.applyDates : t.applyNoDate) + '</button>' +
				'</div></div>';
			return html;
		}

		_guestsPanelHtml() {
			var t = this._t;
			var s = this._s;
			var rows = [
				{ key: 'adults', title: t.perRoom, sub: t.adult, value: s.adults, unit: t.personUnit, lim: LIMITS.adults },
				{ key: 'rooms', title: t.roomsTitle, sub: t.roomsSub, value: s.rooms, unit: t.roomUnit, lim: LIMITS.rooms }
			];
			var html = '<div class="pnl gp" id="' + this._id + '-panel" role="dialog" aria-label="' + esc(t.guests) + '" tabindex="-1">';
			rows.forEach(function (row) {
				html +=
					'<div class="gr"><div><p class="t">' + esc(row.title) + '</p><p class="s">' + esc(row.sub) + '</p></div>' +
					'<div class="pm">' +
					'<button type="button" class="rb" data-act="' + row.key + '-" data-k="' + row.key + '-" aria-label="' + esc(t.dec(row.title)) + '"' + (row.value <= row.lim.min ? ' disabled' : '') + '>' + MINUS + '</button>' +
					'<span class="ct" aria-live="polite">' + esc(row.unit(row.value)) + '</span>' +
					'<button type="button" class="rb" data-act="' + row.key + '+" data-k="' + row.key + '+" aria-label="' + esc(t.inc(row.title)) + '"' + (row.value >= row.lim.max ? ' disabled' : '') + '>' + PLUS + '</button>' +
					'</div></div>';
			});
			html +=
				'<p class="nt">' + esc(t.comboNote) + '</p>' +
				'<div class="gf"><button type="button" class="ap" data-act="search" data-k="apply-guests">' + esc(t.applyCond) + '</button></div>' +
				'</div>';
			return html;
		}
	}

	customElements.define('yamado-search-bar', YamadoSearchBar);
})(typeof globalThis !== 'undefined' ? globalThis : this);
