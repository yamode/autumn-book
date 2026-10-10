// 公式サイトの複数室予約（docs/official-multi-room.md）の純関数と型。
//
// M0（このファイルの今の範囲）: 室数の上限・按分（DB の book._allocate と同じ式）・仮押さえの束と予約の部屋の型。
// M1 で足すもの（§14.7）: CartItem / canAddToCart（施設・日程・支払方法の両立・4 室・残室）・roomRefundPreview。
import type { Quote } from '@autumn-book/core';

/** 1 回の予約で取れる部屋の数（DB の book._max_rooms_per_booking() と同じ値。超えるときは電話） */
export const MAX_ROOMS_PER_BOOKING = 4;

/**
 * 金額を重みの比で按分する（最大剰余法）。DB の book._allocate と同じ式。
 *   各部屋に floor(amount × w / Σw) を配り、残りの円を剰余の大きい部屋から 1 円ずつ（同じなら若い部屋から）。
 *   重みが全部 0（または負）のときは均等に分ける。合計は必ず amount に一致する。
 * 例: クーポン 1,000 円・部屋 30,000 / 20,000 → [600, 400]。ポイント 1,001 → [601, 400]（端数は剰余の大きい 1 室目）。
 */
export function allocateByWeight(amount: number, weights: readonly number[]): number[] {
	const n = weights.length;
	if (n === 0) return [];
	if (!Number.isInteger(amount) || amount < 0) throw new RangeError(`allocateByWeight: amount は 0 以上の整数（${amount}）`);
	let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0));
	let sum = w.reduce((s, x) => s + x, 0);
	if (sum === 0) {
		w = w.map(() => 1);
		sum = n;
	}
	// 円 × 重みは大きくても 1e7 × 1e6 程度なので Number の整数範囲（2^53）に収まる
	const out = w.map((x) => Math.floor((amount * x) / sum));
	const rem = w.map((x) => (amount * x) % sum);
	let left = amount - out.reduce((s, x) => s + x, 0);
	while (left > 0) {
		let best = 0;
		for (let i = 1; i < n; i++) if (rem[i] > rem[best]) best = i;
		out[best] += 1;
		rem[best] = -1;
		left -= 1;
	}
	return out;
}

/** 仮押さえの束の部屋（book.get_hold_group の rooms[]） */
export interface HoldGroupRoom {
	/** 1 始まり（予約の room_index と同じ） */
	index: number;
	/** 部屋の仮押さえ id（holds.id。1 室目は束 id と同じ値） */
	holdId: string;
	roomTypeId: string;
	planId: string;
	adults: number;
	children: number;
	quote: Quote;
}

/**
 * 仮押さえの束（book.get_hold_group を画面向けに整えたもの）。
 * M0 では画面が 1 室のまま動くよう、1 室目の値を最上位（roomTypeId / planId / adults / children / quote）にも写す。
 * M1 の画面は rooms[] を使う。
 */
export interface HoldGroup {
	/** 束 id（/booking/hold?id= ・direct_payments.hold_id ・Stripe の metadata.hold_id） */
	id: string;
	facilityId: string;
	checkin: string;
	nights: number;
	/** 期限（ミリ秒・HoldTimer 用） */
	expiresAt: number;
	status: string;
	/** 全室の宿泊料金の和（割引前） */
	total: number;
	rooms: HoldGroupRoom[];
	// ---- 1 室目の写し（M0 の 1 室の画面の互換）
	roomTypeId: string;
	planId: string;
	adults: number;
	children: number;
	quote: Quote;
}

/** 予約の部屋（book._booking_rooms_view・my_reservations の rooms[] の主な列） */
export interface BookingRoom {
	index: number;
	stayCode: string;
	roomTypeId: string;
	planId: string | null;
	adults: number;
	/** 宿泊料金（割引前） */
	roomTotal: number;
	/** クーポン按分後（＝この部屋の予約金額） */
	charge: number;
	pointsShare: number;
	cancelled: boolean;
	cancelFee: number;
}

/** 仮押さえに渡す 1 室（プラン詳細の ?/hold の rooms JSON の要素） */
export interface HoldRoomRequest {
	planId: string;
	roomTypeId: string;
	adults: number;
}

export type ParseHoldRoomsResult =
	| { ok: true; rooms: HoldRoomRequest[] }
	| { ok: false; code: 'missing' | 'too_many_rooms' | 'invalid' };

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[a-z0-9][a-z0-9_-]{0,63}$/i;

/**
 * プラン詳細の「予約へ進む」（?/hold）のフォームから部屋の並びを読む。
 *   rooms … JSON `[{planId, roomTypeId, adults}]`（1〜4 室・M1 のかご）
 *   無ければ従来の 1 室のフィールド planId / roomTypeId / adults（M0 の画面）
 * id は UUID（実データ）かデモの id（英数・-・_）。大人は 1〜6 名の整数。
 */
export function parseHoldRooms(get: (key: string) => FormDataEntryValue | null): ParseHoldRoomsResult {
	const raw = get('rooms');
	let items: unknown[];
	if (typeof raw === 'string' && raw.trim() !== '') {
		try {
			const v = JSON.parse(raw);
			if (!Array.isArray(v)) return { ok: false, code: 'invalid' };
			items = v;
		} catch {
			return { ok: false, code: 'invalid' };
		}
	} else {
		const planId = get('planId');
		const roomTypeId = get('roomTypeId');
		if (typeof planId !== 'string' || typeof roomTypeId !== 'string' || !planId || !roomTypeId) return { ok: false, code: 'missing' };
		items = [{ planId, roomTypeId, adults: Number(get('adults')) }];
	}
	if (items.length === 0) return { ok: false, code: 'missing' };
	if (items.length > MAX_ROOMS_PER_BOOKING) return { ok: false, code: 'too_many_rooms' };
	const rooms: HoldRoomRequest[] = [];
	for (const it of items) {
		if (!it || typeof it !== 'object') return { ok: false, code: 'invalid' };
		const o = it as Record<string, unknown>;
		const planId = String(o.planId ?? '');
		const roomTypeId = String(o.roomTypeId ?? '');
		const adults = Number(o.adults);
		if (!ID_RE.test(planId) || !ID_RE.test(roomTypeId)) return { ok: false, code: 'invalid' };
		if (!Number.isInteger(adults) || adults < 1 || adults > 6) return { ok: false, code: 'invalid' };
		rooms.push({ planId, roomTypeId, adults });
	}
	return { ok: true, rooms };
}

/** 子ども人数の合計（holds.child_counts の値の和。数でないものは 0） */
export function childTotalOf(counts: Record<string, unknown> | null | undefined): number {
	return Object.values(counts ?? {}).reduce<number>((s, v) => s + (Number(v) || 0), 0);
}
