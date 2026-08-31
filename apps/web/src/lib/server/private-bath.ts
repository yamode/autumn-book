// 貸切風呂の公開予約（アプリ3）— Supabase の book RPC を叩く薄いアダプタ。
//
// 台帳は PMS の pms.private_bath_slots のまま。ここでは book スキーマの
// SECURITY DEFINER RPC 越しにしか触らない（anon は pms に権限を持たない）。
// 設計の正は autumn_book_private_bath_design.md。
import { supa } from '$lib/server/supabase';

export type BathSlot = {
	from: string;
	to: string;
	taken: boolean;
	mine: boolean;
	slot_id: string | null;
	/** 締切（利用の N 分前）を過ぎている。 */
	closed: boolean;
};

export type BathDay = { date: string; slots: BathSlot[] };
export type BathUnit = { bath_id: string | null; bath_name: string; days: BathDay[] };

export type BathReservation = {
	id: string;
	date: string;
	from: string;
	to: string | null;
	bath_id: string | null;
	price_yen: number;
	booked_via: string;
	/** ご自身で取り消せるか（QRから取った枠・締切前）。 */
	cancelable: boolean;
};

export type BathContext = {
	ok: boolean;
	/** ok=false のときだけ。stay_not_linked / stay_not_found。 */
	reason?: string;
	facility?: { id: string; slug: string; name: string };
	room_code?: string;
	guest_name?: string | null;
	check_in_date?: string;
	check_out_date?: string;
	enabled?: boolean;
	price_yen?: number;
	per_room_per_range?: number;
	cutoff_min?: number;
	cancel_min?: number;
	baths?: BathUnit[];
	mine?: BathReservation[];
};

/** 公開画面が1回で必要な情報を全部取る。無効なトークンは null。 */
export async function sbBathContext(token: string): Promise<BathContext | null> {
	const { data, error } = await supa().rpc('private_bath_context', { p_token: token });
	if (error) return null; // invalid_token など
	return data as BathContext;
}

/**
 * 枠を取る。RPC の例外は**そのまま投げず**、画面が出し分けられるキーに正規化する。
 * RPC は 'slot_taken:2026-09-01,15:00' のように詳細を付けて投げてくるので頭だけを見る。
 */
export type BathReserveResult =
	| { ok: true; made: number; price_yen: number }
	| { ok: false; code: 'slot_taken' | 'per_room_limit' | 'past_cutoff' | 'other' };

export async function sbBathReserve(
	token: string,
	bathId: string | null,
	slots: Array<{ date: string; from: string }>
): Promise<BathReserveResult> {
	const { data, error } = await supa().rpc('reserve_private_bath', {
		p_token: token,
		p_bath: bathId,
		p_slots: slots
	});
	if (error) {
		const head = String(error.message ?? '').split(':')[0].trim();
		if (head === 'slot_taken') return { ok: false, code: 'slot_taken' };
		if (head === 'per_room_limit') return { ok: false, code: 'per_room_limit' };
		if (head === 'past_cutoff') return { ok: false, code: 'past_cutoff' };
		return { ok: false, code: 'other' };
	}
	const r = data as { made: number; price_yen: number };
	return { ok: true, made: r.made, price_yen: r.price_yen };
}

/** 自分が取った枠を取り消す。失敗しても理由は分けない（画面では1つの案内に寄せる）。 */
export async function sbBathCancel(token: string, slotId: string): Promise<boolean> {
	const { error } = await supa().rpc('cancel_private_bath', {
		p_token: token,
		p_slot_id: slotId
	});
	return !error;
}
