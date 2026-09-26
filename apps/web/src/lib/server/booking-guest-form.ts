// 公式サイトの予約入力（/booking/hold のフォーム）の解析と検証。
// 現地払いの form action（?/submit）と、オンライン決済の API（/booking/pay）で共有する。
import { combineName, combineKana } from '$lib/name';
import * as m from '$lib/paraglide/messages';
import type { GuestInfo } from '$lib/types';
import { ONSITE_METHODS, type OnsiteMethod } from '$lib/direct-payment';

export type ParsedGuestForm = {
	holdId: string;
	guest: GuestInfo & { familyName: string; givenName: string; middleName: string; familyNameKana: string; givenNameKana: string };
	pointsRequested: number;
	payment: 'onsite' | 'card' | 'paypay';
	// 現地払いの内訳（現地PayPay・現地カード・現地現金）。payment は 'onsite' のまま。宿への申し送りに使う
	onsiteMethod: OnsiteMethod | null;
	errors: Record<string, string>;
};

export const PHONE_RE = /^[0-9\-+ ]{10,}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseGuestForm(form: FormData): ParsedGuestForm {
	const familyName = String(form.get('familyName') ?? '').trim();
	const givenName = String(form.get('givenName') ?? '').trim();
	const middleName = String(form.get('middleName') ?? '').trim();
	const familyNameKana = String(form.get('familyNameKana') ?? '').trim();
	const givenNameKana = String(form.get('givenNameKana') ?? '').trim();
	const guest = {
		name: combineName(familyName, givenName),
		kana: combineKana(familyNameKana, givenNameKana),
		familyName,
		givenName,
		middleName,
		familyNameKana,
		givenNameKana,
		phone: String(form.get('phone') ?? '').trim(),
		email: String(form.get('email') ?? '').trim(),
		arrival: String(form.get('arrival') ?? ''),
		shuttle: form.get('shuttle') === 'on',
		notes: String(form.get('notes') ?? '').trim()
	};
	const errors: Record<string, string> = {};
	// 姓・名は必須（カナは任意＝海外ゲスト対応）
	if (!familyName) errors.familyName = m.error_name_required();
	if (!givenName) errors.givenName = m.error_name_required();
	if (!PHONE_RE.test(guest.phone)) errors.phone = m.error_phone_invalid();
	if (!EMAIL_RE.test(guest.email)) errors.email = m.error_email_invalid();
	const raw = String(form.get('payment') ?? 'onsite');
	const payment = raw === 'card' || raw === 'paypay' ? raw : 'onsite';
	const sub = raw.startsWith('onsite_') ? raw.slice('onsite_'.length) : '';
	const onsiteMethod = (ONSITE_METHODS as readonly string[]).includes(sub) ? (sub as OnsiteMethod) : null;
	return {
		holdId: String(form.get('holdId') ?? ''),
		guest,
		pointsRequested: Math.max(0, Math.floor(Number(form.get('points') ?? 0)) || 0),
		payment,
		onsiteMethod,
		errors
	};
}
