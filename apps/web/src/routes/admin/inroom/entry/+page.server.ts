import { facilities } from '$lib/server/store';
import type { PageServerLoad } from './$types';

// 客室に常設する「客室案内の入口QR」の印刷（2026-10-09）。
// QR は施設ごとに1つで、お客様・日付によらず同じ（/r/start?f=<slug>）。読んだお客様は、チェックイン時にお渡しした
// 6桁コードを入れると、その方のその日の客室案内になる（コードはチェックイン日 12:00 〜 チェックアウト日 11:00）。
export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const slug = facilities.find((f) => f.id === currentFacility.id)?.slug ?? '';
	const size = event.url.searchParams.get('size') === 'A7' ? ('A7' as const) : ('A6' as const);
	return {
		facilityName: currentFacility.name,
		size,
		qrUrl: `${event.url.origin}/r/start${slug ? `?f=${encodeURIComponent(slug)}` : ''}`
	};
};
