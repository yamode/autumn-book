import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';

export interface AvailabilityAlert {
	id: string;
	facility_id: string;
	checkin: string;
	nights: number;
	adults: number;
	room_count: number;
	room_type_id: string | null;
	rate_plan_id: string | null;
	max_total: number | null;
	status: 'active' | 'queued' | 'notified' | 'stopped' | 'expired' | 'failed';
	created_at: string;
	notified_at: string | null;
}

export interface AlertConditions {
	facility: string;
	checkin: string;
	nights: number;
	adults: number;
	rooms: number;
	room: string;
	plan: string;
	budget: string;
}

// 状態の表示名（画面の言語で出すため関数にする）
export function alertStatusLabel(status: AvailabilityAlert['status']): string {
	switch (status) {
		case 'active': return m.account_alerts_status_active();
		case 'queued': return m.account_alerts_status_queued();
		case 'notified': return m.account_alerts_status_notified();
		case 'stopped': return m.account_alerts_status_stopped();
		case 'expired': return m.account_alerts_status_expired();
		case 'failed': return m.account_alerts_status_failed();
	}
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function alertConditions(params: URLSearchParams | FormData): AlertConditions {
	return {
		facility: String(params.get('facility') ?? ''), checkin: String(params.get('checkin') ?? ''),
		nights: Number(params.get('nights') ?? 1), adults: Number(params.get('adults') ?? 2),
		rooms: Number(params.get('rooms') ?? 1), room: String(params.get('room') ?? ''),
		plan: String(params.get('plan') ?? ''), budget: String(params.get('budget') ?? '')
	};
}

export function validateAlertConditions(c: AlertConditions): string | null {
	if (!uuid.test(c.facility)) return m.alert_invalid_facility();
	const date = new Date(`${c.checkin}T00:00:00Z`);
	const maxDate = new Date(`${todayStr()}T00:00:00Z`);
	maxDate.setUTCDate(maxDate.getUTCDate() + 365);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(c.checkin) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== c.checkin || c.checkin <= todayStr() || date > maxDate) return m.alert_invalid_checkin();
	if (!Number.isInteger(c.nights) || c.nights < 1 || c.nights > 7) return m.alert_invalid_nights();
	if (!Number.isInteger(c.adults) || c.adults < 1 || c.adults > 6) return m.alert_invalid_adults();
	if (!Number.isInteger(c.rooms) || c.rooms < 1 || c.rooms > 4) return m.alert_invalid_rooms();
	if ((c.room && !uuid.test(c.room)) || (c.plan && !uuid.test(c.plan))) return m.alert_invalid_room_plan();
	if (c.budget && (!/^\d+$/.test(c.budget) || Number(c.budget) < 1 || Number(c.budget) > 10000000)) return m.alert_invalid_budget();
	return null;
}
