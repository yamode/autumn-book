import type { Cookies } from '@sveltejs/kit';
import type { PcContext } from '$lib/precheckin';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import type { BathContext, BathUnit, BathReservation } from '$lib/server/private-bath';
import { DATA_SOURCE } from '$lib/server/supabase';

const COOKIE = 'ab_ci_demo_bath';
const ROOM_PATH = '/r';
const cookieOptions = { path: '/ci', httpOnly: true, sameSite: 'lax', maxAge: 4 * 3600 } as const;

type Slot = { date: string; from: string; to: string; range_idx: number; closed: boolean; cancelable: boolean };
type Bath = { bath_id: string | null; bath_name: string; range_limit: number; slots: Slot[] };
type Schedule = { enabled: boolean; cutoff_min: number; cancel_min: number; price_yen: number; baths: Bath[] };
type Stay = Pick<PcContext, 'facility' | 'checkIn' | 'checkOut'>;

export function copyDemoBathToRoom(cookies: Cookies): void {
	cookies.set(COOKIE, JSON.stringify([...readPicks(cookies)]), { ...cookieOptions, path: ROOM_PATH });
}

export function clearDemoBath(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: cookieOptions.path });
	cookies.delete(COOKIE, { path: ROOM_PATH });
}

function readPicks(cookies: Cookies): Set<string> {
	try {
		const value: unknown = JSON.parse(cookies.get(COOKIE) ?? '[]');
		return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
	} catch {
		return new Set();
	}
}

const slotId = (bathId: string | null, slot: Pick<Slot, 'date' | 'from'>) =>
	`${bathId ?? ''}|${slot.date}|${slot.from}`;

async function loadSchedule(stay: Stay): Promise<Schedule | null> {
	if (DATA_SOURCE === 'supabase') {
		const db = partnerServiceClient();
		if (!db) return null;
		const { data, error } = await db.schema('book').rpc('precheckin_demo_bath_schedule', {
			p_facility: stay.facility.id,
			p_check_in: stay.checkIn
		});
		if (error) {
			console.warn('[ci] Demo bath schedule unavailable:', error.code);
			return null;
		}
		return data as Schedule | null;
	}

	// ローカルのデータソースには施設設定がない。
	const hm = (minutes: number) =>
		`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	const slots = [
		{ date: stay.checkIn, range: 1, start: 900, count: 9 },
		{ date: stay.checkOut, range: 2, start: 360, count: 5 }
	].flatMap(({ date, range, start, count }) => Array.from({ length: count }, (_, i) => ({
		date, from: hm(start + i * 50), to: hm(start + i * 50 + 40), range_idx: range,
		closed: false, cancelable: true
	})));
	return {
		enabled: true, cutoff_min: 30, cancel_min: 60, price_yen: 0,
		baths: [{ bath_id: 'demo-bath', bath_name: '貸切風呂（見本）', range_limit: 1, slots }]
	};
}

function rangeFull(bath: Bath, slot: Slot, picks: Set<string>): boolean {
	return bath.slots.filter((other) =>
		other.date === slot.date && other.range_idx === slot.range_idx && picks.has(slotId(bath.bath_id, other))
	).length >= bath.range_limit;
}

/** 見本の予約はブラウザ内だけに保存し、本番の予約台帳には触れない。 */
export async function demoBathContext(stay: Stay, cookies: Cookies, reservationsOnly = false): Promise<BathContext | null> {
	const picks = readPicks(cookies);
	if (reservationsOnly && picks.size === 0) return null;
	const schedule = await loadSchedule(stay);
	if (!schedule) return null;
	const { baths, ...rules } = schedule;
	const mine: BathReservation[] = [];
	const units: BathUnit[] = baths.map((bath) => {
		const days = new Map<string, BathUnit['days'][number]>();
		for (const slot of bath.slots) {
			const { date, from, to, closed, cancelable } = slot;
			const id = slotId(bath.bath_id, slot);
			const taken = picks.has(id);
			if (taken) mine.push({
				id, date, from, to, bath_id: bath.bath_id, price_yen: rules.price_yen, booked_via: 'guest', cancelable
			});
			const day = days.get(date) ?? { date, slots: [] };
			day.slots.push({
				from, to, closed, taken, mine: taken, slot_id: taken ? id : null,
				limit_reached: rangeFull(bath, slot, picks)
			});
			days.set(date, day);
		}
		return { bath_id: bath.bath_id, bath_name: bath.bath_name, days: [...days.values()] };
	});
	return {
		ok: true, ...rules, check_in_date: stay.checkIn, check_out_date: stay.checkOut,
		baths: units, mine, group: { shared: false }
	};
}

export async function demoBathReserve(stay: Stay, cookies: Cookies, bathId: string | null, selected: Pick<Slot, 'date' | 'from'>[]) {
	const schedule = await loadSchedule(stay);
	if (!schedule?.enabled) return 'not_open';
	const bath = schedule.baths.find((b) => b.bath_id === bathId);
	if (!bath) return 'slot_unavailable';
	// 一括予約の検証がすべて通ってから保存する。
	const picks = readPicks(cookies);
	for (const pick of selected) {
		const slot = bath.slots.find((s) => s.date === pick.date && s.from === pick.from);
		if (!slot) return 'slot_unavailable';
		if (slot.closed) return 'past_cutoff';
		const id = slotId(bathId, slot);
		if (picks.has(id)) return 'slot_taken';
		if (rangeFull(bath, slot, picks)) return 'per_room_limit';
		picks.add(id);
	}
	cookies.set(COOKIE, JSON.stringify([...picks]), cookieOptions);
	return 'ok';
}

export async function demoBathCancel(stay: Stay, cookies: Cookies, id: string): Promise<boolean> {
	const context = await demoBathContext(stay, cookies);
	if (!context?.mine?.some((r) => r.id === id && r.cancelable)) return false;
	const picks = readPicks(cookies);
	picks.delete(id);
	cookies.set(COOKIE, JSON.stringify([...picks]), cookieOptions);
	return true;
}
