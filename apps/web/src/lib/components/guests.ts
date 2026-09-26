// 検索・予約の人数（大人・子ども）の共通処理。URL パラメータ `children` の解釈と表示ラベル。
import * as m from '$lib/paraglide/messages';

/** 子どもの人数の上限（SearchBar の選択肢と同じ） */
export const MAX_CHILDREN = 4;

/** URL / フォームの `children` を 0〜MAX_CHILDREN の整数に丸める（未指定・不正値は 0 = 従来の大人のみ URL と互換） */
export function parseChildren(v: string | null | undefined | FormDataEntryValue): number {
	const n = Math.floor(Number(v ?? 0));
	if (!Number.isFinite(n)) return 0;
	return Math.min(MAX_CHILDREN, Math.max(0, n));
}

/** 「大人2名」「大人2名・子ども1名」の表示ラベル */
export function guestsLabel(adults: number, children = 0): string {
	return children > 0
		? m.guests_adults_children({ adults: String(adults), children: String(children) })
		: m.guests_adults({ adults: String(adults) });
}

/** 検索条件のクエリ文字列（children=0 は付けない＝既存 URL と同じ形を保つ） */
export function searchQuery(p: { checkin: string; nights: number; adults: number; children?: number }): string {
	const q = `checkin=${p.checkin}&nights=${p.nights}&adults=${p.adults}`;
	return p.children ? `${q}&children=${p.children}` : q;
}

/** 施設のエリア表示（例: 「岩手県 西和賀町」）。住所から市区町村まで取れなければ都道府県のみ */
export function areaLabel(f: { prefecture: string; addressPublic?: string }): string {
	const hit = (f.addressPublic ?? '').match(/^(.+?[都道府県])(?:.+?郡)?(.+?[市区町村])/);
	return hit ? `${hit[1]} ${hit[2]}` : f.prefecture;
}
