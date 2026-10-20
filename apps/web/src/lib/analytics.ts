// GA4 event helpers. Events stay in memory until analytics consent and the tag are ready.
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { dbg } from '$lib/debug';

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void };
type PendingEvent = { name: string; params: Record<string, unknown>; purchaseCode?: string };
const pending: PendingEvent[] = [];

export type ConsentState = 'granted' | 'denied' | 'unset';
export const CONSENT_CHANGE_EVENT = 'ab-consent-change';

// 同意を先に聞かなくてよい地域（日本など）からのアクセスか（2026-10-21）。サーバーの国判定を AnalyticsConsent が渡す。
// 決まるまでは聞く側（false）に倒す
let regionAllowsByDefault = false;
export function setConsentRegion(consentRequired: boolean) {
	regionAllowsByDefault = !consentRequired;
}

/** 本人が選んだ値（このブラウザに保存）。選んでいなければ 'unset' */
export function storedConsent(): ConsentState {
	try {
		const value = localStorage.getItem('ab_consent');
		return value === 'granted' || value === 'denied' ? value : 'unset';
	} catch {
		return 'unset';
	}
}

/** 本人の選択を保存し、画面上の各部品に知らせる（バナー・プライバシーポリシーの停止ボタンから） */
export function saveConsent(value: 'granted' | 'denied') {
	try {
		localStorage.setItem('ab_consent', value);
	} catch {
		/* noop */
	}
	if (browser) window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: value }));
}

/** 実際に効いている同意。本人の選択が最優先。選んでいなければ、同意の要らない地域は granted・それ以外は unset */
export function consent(): ConsentState {
	const stored = storedConsent();
	if (stored !== 'unset') return stored;
	return regionAllowsByDefault ? 'granted' : 'unset';
}

function canMeasure(): boolean {
	if (!browser || !env.PUBLIC_GA4_MEASUREMENT_ID) return false;
	const path = location.pathname.replace(/^\/(en|zh-TW)(?=\/|$)/, '');
	return !/^\/(admin|r|p)(\/|$)/.test(path);
}

function send(event: PendingEvent): boolean {
	if (!canMeasure() || consent() !== 'granted') return false;
	const gtag = (window as GtagWindow).gtag;
	if (typeof gtag !== 'function') return false;
	gtag('event', event.name, event.params);
	if (event.purchaseCode) {
		try { sessionStorage.setItem(`ab_ga_tx_${event.purchaseCode}`, '1'); } catch { /* noop */ }
	}
	dbg('ga4 event', event.name);
	return true;
}

function queue(event: PendingEvent) {
	if (!canMeasure() || consent() === 'denied') return;
	if (pending.length < 50) pending.push(event);
}

export function gaEvent(name: string, params: Record<string, unknown> = {}) {
	const event = { name, params };
	if (send(event)) return;
	queue(event);
}

export function gaPurchaseOnce(code: string, params: Record<string, unknown>) {
	if (!canMeasure()) return;
	try { if (sessionStorage.getItem(`ab_ga_tx_${code}`)) return; } catch { /* noop */ }
	if (pending.some((event) => event.purchaseCode === code)) return;
	const event = { name: 'purchase', params: { transaction_id: code, ...params }, purchaseCode: code };
	if (send(event)) return;
	queue(event);
}

export function flushGaEvents() {
	while (pending.length && send(pending[0])) pending.shift();
}

export function discardGaEvents() {
	pending.length = 0;
}
