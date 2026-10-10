// 公式サイトの複数室予約（docs/official-multi-room.md）の純関数と型。
//
// M0: 室数の上限・按分（DB の book._allocate と同じ式）・仮押さえの束と予約の部屋の型。
// M1: 予約かご（CartItem / canAddToCart〔施設・日程・支払方法の両立・4 室・残室〕・sessionStorage）・
//     1 室 1 泊 1 行の明細・全室の見積と支払方法の合わせ方。roomRefundPreview は部屋ごとの取消（M2）で足す。
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

// =============================================================================
// M1: 予約かご（プラン詳細の「＋ もう 1 室追加」・docs/official-multi-room.md §8.1・§15）
//   在庫は押さえない。sessionStorage に置き、「予約へ進む」で ?/hold に rooms JSON を送って一括で仮押さえする。
// =============================================================================

/** かごの 1 室（プラン詳細で「＋ もう 1 室追加」を押したときの部屋・プラン・人数と表示用の値） */
export interface CartItem {
	/** かごの中の識別（同じ部屋タイプを 2 室入れても別の行にする） */
	key: string;
	facilityId: string;
	brandSlug: string;
	facilitySlug: string;
	/** 表示用（別の施設のページでかごを見たときの案内） */
	facilityName?: string;
	checkin: string;
	nights: number;
	planId: string;
	planSlug: string;
	planName: string;
	roomTypeId: string;
	roomName: string;
	adults: number;
	/** その部屋の宿泊料金（割引前・税込・全泊） */
	total: number;
	/** 閲覧者（会員かどうか）に合わせたプランの支払方法。両立しない組み合わせはかごで止める（Q3） */
	pay: { onsite: boolean; prepay: boolean };
	/** 追加したときの残室（同じ部屋タイプをこれより多く入れない）。不明は null */
	remaining: number | null;
}

/** かごに入れられない理由 */
export type CartAddBlock = 'full' | 'other_stay' | 'mixed_payment' | 'no_remaining';

/** 支払方法が両立するか（全室で現地払いができる、または全室で予約時決済ができる） */
export function payCompatible(pays: readonly { onsite: boolean; prepay: boolean }[]): boolean {
	if (pays.length === 0) return true;
	return pays.every((p) => p.onsite) || pays.every((p) => p.prepay);
}

type StayKey = Pick<CartItem, 'facilityId' | 'checkin' | 'nights'>;

/** 同じ予約にできる（同じ施設・同じチェックイン日・同じ泊数）か */
export function sameStay(a: StayKey, b: StayKey): boolean {
	return a.facilityId === b.facilityId && a.checkin === b.checkin && a.nights === b.nights;
}

/**
 * かごに 1 室を足せるか。判定の順は 施設・日程 → 室数（4 室）→ 支払方法 → 残室。
 *   other_stay は「かごを空にしますか」を出す（空にしてから足せる）。それ以外は理由を出して足さない。
 */
export function canAddToCart(
	cart: readonly CartItem[],
	item: Pick<CartItem, 'facilityId' | 'checkin' | 'nights' | 'roomTypeId' | 'pay' | 'remaining'>
): { ok: true } | { ok: false; reason: CartAddBlock } {
	if (cart.length > 0 && !sameStay(cart[0], item)) return { ok: false, reason: 'other_stay' };
	if (cart.length >= MAX_ROOMS_PER_BOOKING) return { ok: false, reason: 'full' };
	if (!payCompatible([...cart.map((c) => c.pay), item.pay])) return { ok: false, reason: 'mixed_payment' };
	if (item.remaining !== null) {
		const same = cart.filter((c) => c.roomTypeId === item.roomTypeId).length;
		if (same + 1 > item.remaining) return { ok: false, reason: 'no_remaining' };
	}
	return { ok: true };
}

/** かごが上限（4 室）に達したか（かごバーの上に注意を出す・「＋ もう 1 室追加」を押せない状態にする） */
export const cartIsFull = (cart: readonly unknown[]) => cart.length >= MAX_ROOMS_PER_BOOKING;

/** かごバーの要約（室数・大人の合計・宿泊料金の合計） */
export function cartSummary(cart: readonly Pick<CartItem, 'adults' | 'total'>[]): { rooms: number; adults: number; total: number } {
	return {
		rooms: cart.length,
		adults: cart.reduce((s, c) => s + c.adults, 0),
		total: cart.reduce((s, c) => s + c.total, 0)
	};
}

/** ?/hold に送る rooms（並び順＝1室目・2室目…） */
export function cartRoomsPayload(cart: readonly Pick<CartItem, 'planId' | 'roomTypeId' | 'adults'>[]): HoldRoomRequest[] {
	return cart.map((c) => ({ planId: c.planId, roomTypeId: c.roomTypeId, adults: c.adults }));
}

/** 内訳の表示用に同じ部屋タイプ・プラン・人数をまとめる（「和室 ×2」） */
export function cartGroups(cart: readonly CartItem[]): { item: CartItem; count: number; keys: string[] }[] {
	const out: { item: CartItem; count: number; keys: string[] }[] = [];
	for (const c of cart) {
		const g = out.find((x) => x.item.roomTypeId === c.roomTypeId && x.item.planId === c.planId && x.item.adults === c.adults);
		if (g) {
			g.count += 1;
			g.keys.push(c.key);
		} else out.push({ item: c, count: 1, keys: [c.key] });
	}
	return out;
}

/** sessionStorage のキー（タブを閉じれば消える） */
export const CART_STORAGE_KEY = 'ab_booking_cart_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isCartItem(v: unknown): v is CartItem {
	if (!v || typeof v !== 'object') return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.key === 'string' &&
		typeof o.facilityId === 'string' &&
		typeof o.brandSlug === 'string' &&
		typeof o.facilitySlug === 'string' &&
		typeof o.checkin === 'string' &&
		Number.isInteger(o.nights) &&
		typeof o.planId === 'string' &&
		typeof o.planSlug === 'string' &&
		typeof o.roomTypeId === 'string' &&
		Number.isInteger(o.adults) &&
		typeof o.total === 'number' &&
		!!o.pay &&
		typeof o.pay === 'object'
	);
}

/** かごを読む。読めない・壊れている・別の日程が混ざっているときは空（プライベートモード等で例外になっても空） */
export function readCart(storage: StorageLike | null | undefined): CartItem[] {
	try {
		const raw = storage?.getItem(CART_STORAGE_KEY);
		if (!raw) return [];
		const v: unknown = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		const items: CartItem[] = v.filter(isCartItem).map((c) => ({
			...c,
			planName: String(c.planName ?? ''),
			roomName: String(c.roomName ?? ''),
			pay: { onsite: c.pay.onsite === true, prepay: c.pay.prepay === true },
			remaining: typeof c.remaining === 'number' ? c.remaining : null
		}));
		if (items.some((c) => !sameStay(items[0], c))) return [];
		return items.slice(0, MAX_ROOMS_PER_BOOKING);
	} catch {
		return [];
	}
}

/** かごを書く（空なら消す）。書けなくても画面は動かす */
export function writeCart(storage: StorageLike | null | undefined, cart: readonly CartItem[]): void {
	try {
		if (!storage) return;
		if (cart.length === 0) storage.removeItem(CART_STORAGE_KEY);
		else storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart.slice(0, MAX_ROOMS_PER_BOOKING)));
	} catch {
		/* 保存できない環境（プライベートモード・容量超過）は画面の中だけで持つ */
	}
}

// =============================================================================
// M1: 予約入力・完了・マイページの部屋ごとの表示
// =============================================================================

/** 料金の明細の部屋の行（その泊のその部屋。「1名様 ○円 × ○名様」） */
export interface NightRoomRow {
	/** 0 始まりの部屋の番号（複数室のとき「N室目」と出す。1 室は出さない） */
	room: number;
	/** 1 名あたり（その泊・税込） */
	unitPrice: number;
	adults: number;
	subtotal: number;
}

/** 料金の明細の泊（見出し「N泊目: 4月15日（水）」とその下の部屋の行） */
export interface NightGroup {
	/** 1 始まりの泊の番号 */
	night: number;
	date: string;
	rows: NightRoomRow[];
}

/**
 * 料金の明細を「泊ごとの見出し → その下に部屋ごとの行」に並べる（2026-10-10 指示。公式の予約入力・確認・完了・マイページ・メール共通）。
 *   2 室 2 泊なら 見出し 2 つ × 部屋の行 2 つ。1 室 1 泊でも見出しは出す。泊は日付の順、部屋は部屋の順。
 *   子ども区分ができたら、大人の行の後に区分ごとの行を足す（今は大人のみ・Q6）。
 */
export function nightGroups(
	rooms: readonly { lines: readonly { date: string; unitPrice: number; adults: number; subtotal: number }[] }[]
): NightGroup[] {
	const dates = [...new Set(rooms.flatMap((r) => r.lines.map((l) => l.date)))].sort();
	return dates.map((date, i) => ({
		night: i + 1,
		date,
		rows: rooms.flatMap((r, room) =>
			r.lines.filter((l) => l.date === date).map((l) => ({ room, unitPrice: l.unitPrice, adults: l.adults, subtotal: l.subtotal }))
		)
	}));
}

/** 全室の見積をまとめた見積（合計・内消費税は部屋の和。明細は部屋の順 → 日付の順） */
export function combineQuotes(quotes: readonly Quote[]): Quote {
	const total = quotes.reduce((s, q) => s + q.total, 0);
	const adults = quotes.reduce((s, q) => s + (q.lines[0]?.adults ?? 0), 0);
	return {
		lines: quotes.flatMap((q) => [...q.lines].sort((a, b) => a.date.localeCompare(b.date))),
		total,
		perPerson: adults > 0 ? Math.round(total / adults) : total,
		taxIncluded: quotes.reduce((s, q) => s + q.taxIncluded, 0),
		pointsUsed: 0,
		payable: total
	};
}

/**
 * 支払方法を全室で合わせる（全室で許されているものだけ・Q3）。
 * 予約時決済の手段は全室の共通部分。何も残らないとき（かごを通らずに来た組み合わせ）は onsite も prepay も false。
 */
export function combinePayments<M extends string>(
	payments: readonly { onsite: boolean; prepay: boolean; prepayMethods: readonly M[] }[]
): { onsite: boolean; prepay: boolean; prepayMethods: M[] } {
	if (payments.length === 0) return { onsite: false, prepay: false, prepayMethods: [] };
	const onsite = payments.every((p) => p.onsite);
	const prepay = payments.every((p) => p.prepay);
	const methods = prepay ? payments[0].prepayMethods.filter((m) => payments.every((p) => p.prepayMethods.includes(m))) : [];
	return { onsite, prepay: prepay && methods.length > 0, prepayMethods: methods };
}
