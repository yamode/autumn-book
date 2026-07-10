// GA4 計測ヘルパ（設計書 §9・2026-06-10 決定）
// PUBLIC_GA4_MEASUREMENT_ID 未設定時は window.gtag が定義されず全イベントが no-op になる
// （ローダー・同意バナーは AnalyticsConsent.svelte。ここは送信ヘルパのみ）。
import { browser } from '$app/environment';
import { dbg } from '$lib/debug';

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };

export function gaEvent(name: string, params: Record<string, unknown> = {}) {
	if (!browser) return;
	const w = window as GtagWindow;
	if (typeof w.gtag !== 'function') return;
	w.gtag('event', name, params);
	dbg('ga4 event', name);
}

// 予約完了（purchase）はリロード再送を sessionStorage で抑止する
export function gaPurchaseOnce(code: string, params: Record<string, unknown>) {
	if (!browser) return;
	const key = `ab_ga_tx_${code}`;
	try {
		if (sessionStorage.getItem(key)) return;
		sessionStorage.setItem(key, '1');
	} catch {
		// sessionStorage 不可（プライベートモード等）でも送信自体は行う
	}
	gaEvent('purchase', { transaction_id: code, ...params });
}
