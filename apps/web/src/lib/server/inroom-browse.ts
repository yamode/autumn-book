// 客室案内の「コードなしで見る館内案内」（2026-10-10 指示）。
// 客室の入口QR（/r/start?f=<slug>）を読むと、まず館内案内（Wi-Fi・館内のご案内カード）が開き、
// トップで6桁コードを入れたときだけお客様の滞在（食事時間・貸切風呂のご予約など）に紐づく。
// どの施設の案内を見ているかは Cookie（ab_facility・slug だけ）に覚え、案内の詳細（/r/g/<id>）でも使う。
import type { Cookies } from '@sveltejs/kit';
import { endedFacilityBySlug, type EndedFacility } from './inroom-banners';
import type { Locale } from '$lib/types';

export const BROWSE_FACILITY_COOKIE = 'ab_facility';
const MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** 入口QRの施設を覚える（slug が施設として解決できるときだけ） */
export function rememberBrowseFacility(cookies: Cookies, slug: string | null, locale: Locale): boolean {
	if (!slug || !endedFacilityBySlug(slug, locale)) return false;
	cookies.set(BROWSE_FACILITY_COOKIE, slug, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_SEC });
	return true;
}

/** コードなしでは出さない案内（Wi-Fi はコードを入れてから・2026-10-10 指示。入口QRの URL は施設名だけで推測できるため） */
export const browseVisibleGuide = (g: { section: string }) => g.section !== 'wifi';

/** 見ている施設（URL の f が優先・無ければ Cookie）。解決できなければ null */
export function browseFacility(cookies: Cookies, slugParam: string | null, locale: Locale): EndedFacility | null {
	return endedFacilityBySlug(slugParam, locale) ?? endedFacilityBySlug(cookies.get(BROWSE_FACILITY_COOKIE), locale);
}
