import { todayStr } from '$lib/format';

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

export const ALERT_STATUS: Record<AvailabilityAlert['status'], string> = {
	active: '空室を確認中', queued: 'メール送信待ち', notified: '通知済み',
	stopped: '停止済み', expired: '期限終了', failed: 'メール送信失敗'
};

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
	if (!uuid.test(c.facility)) return '施設を選択してください。';
	const date = new Date(`${c.checkin}T00:00:00Z`);
	const maxDate = new Date(`${todayStr()}T00:00:00Z`);
	maxDate.setUTCDate(maxDate.getUTCDate() + 365);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(c.checkin) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== c.checkin || c.checkin <= todayStr() || date > maxDate) return '宿泊日は明日から1年以内の日付を指定してください。';
	if (!Number.isInteger(c.nights) || c.nights < 1 || c.nights > 7) return '泊数は1〜7泊で指定してください。';
	if (!Number.isInteger(c.adults) || c.adults < 1 || c.adults > 6) return '大人の人数は1室あたり1〜6名で指定してください。';
	if (!Number.isInteger(c.rooms) || c.rooms < 1 || c.rooms > 4) return '室数は1〜4室で指定してください。';
	if ((c.room && !uuid.test(c.room)) || (c.plan && !uuid.test(c.plan))) return 'お部屋・プランを選び直してください。';
	if (c.budget && (!/^\d+$/.test(c.budget) || Number(c.budget) < 1 || Number(c.budget) > 10000000)) return '予算は1〜10,000,000円の整数で指定してください。';
	return null;
}
