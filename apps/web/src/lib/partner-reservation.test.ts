import { describe, expect, it } from 'vitest';
import {
	canRetryPartnerCharge,
	canStaffCancelPartnerBooking,
	isPartnerReservationCode,
	isPartnerStay,
	partnerBookingCodeOf,
	partnerFirstRoomCode,
	partnerPaymentStatusLabel
} from './partner-reservation';

describe('isPartnerStay', () => {
	it('source または channel_code が rms_partner なら取引先予約', () => {
		expect(isPartnerStay({ source: 'rms_partner', channel_code: 'rms_partner' })).toBe(true);
		expect(isPartnerStay({ source: 'rms_partner', channel_code: null })).toBe(true);
		expect(isPartnerStay({ source: null, channel_code: 'rms_partner' })).toBe(true);
	});
	it('直販・OTA・空は取引先予約ではない', () => {
		expect(isPartnerStay({ source: 'autumn_booking', channel_code: 'autumn_booking' })).toBe(false);
		expect(isPartnerStay({ source: 'ota', channel_code: 'ota' })).toBe(false);
		expect(isPartnerStay(null)).toBe(false);
		expect(isPartnerStay({})).toBe(false);
	});
});

describe('予約番号の変換', () => {
	it('末尾 -N を除いて台帳の booking_code にする', () => {
		expect(partnerBookingCodeOf('PB-2026-000123')).toBe('PB-2026-000123');
		expect(partnerBookingCodeOf('PB-2026-000123-2')).toBe('PB-2026-000123');
		expect(partnerBookingCodeOf(' PB-2026-000123-10 ')).toBe('PB-2026-000123');
	});
	it('取引先予約の形でなければ null', () => {
		expect(partnerBookingCodeOf('YM-2026-000123')).toBeNull();
		expect(partnerBookingCodeOf('PB-26-1')).toBeNull();
		expect(partnerBookingCodeOf('')).toBeNull();
		expect(partnerBookingCodeOf(null)).toBeNull();
		expect(isPartnerReservationCode('OTA-1KYU-7741')).toBe(false);
		expect(isPartnerReservationCode('PB-2026-000123-1')).toBe(true);
	});
	it('台帳番号（-N 無し）だけ 1室目へ読み替える', () => {
		expect(partnerFirstRoomCode('PB-2026-000123')).toBe('PB-2026-000123-1');
		expect(partnerFirstRoomCode('PB-2026-000123-1')).toBeNull();
		expect(partnerFirstRoomCode('AB-2026-000123')).toBeNull();
	});
});

describe('操作の可否', () => {
	it('取消は予約中・支払待ちでチェックイン前だけ', () => {
		expect(canStaffCancelPartnerBooking({ status: 'confirmed' })).toBe(true);
		expect(canStaffCancelPartnerBooking({ status: 'pending_payment' })).toBe(true);
		expect(canStaffCancelPartnerBooking({ status: 'confirmed', checkedIn: true })).toBe(false);
		expect(canStaffCancelPartnerBooking({ status: 'cancelled' })).toBe(false);
		expect(canStaffCancelPartnerBooking({ status: 'expired' })).toBe(false);
	});
	it('再請求はチェックアウト日決済の請求失敗、またはチェックアウト日を迎えた請求予定だけ', () => {
		const base = { status: 'confirmed', paymentOption: 'online_checkin', paymentStatus: 'charge_failed', checkOut: '2026-10-05' };
		expect(canRetryPartnerCharge(base, '2026-10-01')).toBe(true);
		expect(canRetryPartnerCharge({ ...base, paymentStatus: 'scheduled' }, '2026-10-01')).toBe(false);
		expect(canRetryPartnerCharge({ ...base, paymentStatus: 'scheduled' }, '2026-10-05')).toBe(true);
		expect(canRetryPartnerCharge({ ...base, paymentOption: 'online' }, '2026-10-05')).toBe(false);
		expect(canRetryPartnerCharge({ ...base, status: 'cancelled' }, '2026-10-05')).toBe(false);
	});
	it('支払状況の表示名', () => {
		expect(partnerPaymentStatusLabel('scheduled', 'Visa 4242')).toBe('チェックアウト日に請求（Visa 4242）');
		expect(partnerPaymentStatusLabel('paid')).toBe('支払済み');
		expect(partnerPaymentStatusLabel(null)).toBe('—');
	});
});
