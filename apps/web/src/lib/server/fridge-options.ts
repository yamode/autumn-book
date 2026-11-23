// 冷蔵庫のカスタマイズ（2026-11-23）。予約フォームでチェックした内容を仮押さえに置く。
// 確定のとき DB（book._apply_fridge_options・booking_rooms の trigger）が滞在へオプションとして登録する。
// 会員（ブロンズ以上）だけ。チェック欄が画面に出ていたとき（fridgeShown）だけ触る。
import type { RequestEvent } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from './auth';
import { sbListOptionItems } from './supabase-data';
import type { OptionItem } from '$lib/types';
import type { Locale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';

/** その施設の冷蔵庫のカスタマイズ（公開中のもの） */
export async function fridgeOptionsFor(facilityUuid: string, locale: Locale): Promise<OptionItem[]> {
	if (!MEMBER_SUPABASE) return [];
	try {
		return (await sbListOptionItems(facilityUuid, locale)).filter((o) => o.category === 'fridge');
	} catch {
		return [];
	}
}

export async function saveFridgeOptions(event: RequestEvent, holdId: string, sessionId: string, form: FormData) {
	if (form.get('fridgeShown') !== '1') return null;
	if (!MEMBER_SUPABASE || event.locals.user?.role !== 'member') return m.hold_fridge_error();
	const ids = form.getAll('fridgeOption').map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
	const { error } = await createSupabaseServerClient(event).schema('book').rpc('set_hold_fridge_options', {
		p_hold_id: holdId, p_session_id: sessionId, p_option_ids: ids
	});
	return error ? m.hold_fridge_error() : null;
}
