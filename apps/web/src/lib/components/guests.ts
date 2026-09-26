// 検索・予約の人数表示と検索クエリ、施設エリア表示の共通処理。
// 施設は基本的に大人のみ（子ども不可）のため、人数は大人のみを扱う。
import * as m from '$lib/paraglide/messages';

/**
 * 「大人2名」の表示ラベル。
 * 第2引数は予約画面（booking/**）からの呼び出しとの後方互換のためだけに残しており、無視する（常に大人のみ）。
 */
export function guestsLabel(adults: number, _children?: number): string {
	return m.guests_adults({ adults: String(adults) });
}

/** 検索条件のクエリ文字列（`children` は付けない＝大人のみ） */
export function searchQuery(p: { checkin: string; nights: number; adults: number }): string {
	return `checkin=${p.checkin}&nights=${p.nights}&adults=${p.adults}`;
}

/** 施設のエリア表示（例: 「岩手県 西和賀町」）。住所から市区町村まで取れなければ都道府県のみ */
export function areaLabel(f: { prefecture: string; addressPublic?: string }): string {
	const hit = (f.addressPublic ?? '').match(/^(.+?[都道府県])(?:.+?郡)?(.+?[市区町村])/);
	return hit ? `${hit[1]} ${hit[2]}` : f.prefecture;
}
