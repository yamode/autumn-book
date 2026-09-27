// 施設の代表写真。ポータル・検索結果・施設ページの共有サムネイルで同じ URL を使う。
const facilityThumbnails = new Map([
	['nishiwaga', '/portal/yamado-ikyu-hero.jpg'],
	['oga', '/portal/oga-ikyu-hero.jpg']
]);

export function facilityThumbnailUrl(slug: string, fallback: string): string {
	return facilityThumbnails.get(slug) ?? fallback;
}
