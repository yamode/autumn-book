// 客室案内の「見本の滞在」のトークン（施設ごとに1本・PMS の「見本の館内図」と Book のプレビューで共通・2026-10-17）。
// 本番は book.get_or_issue_demo_stay_token（スタッフのログインが要る）。DATA_SOURCE=demo は store.ts の固定データ。
import type { RequestEvent } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';

// 見本の部屋名・お客様名（PMS の見本の館内図と同じ）
const DEMO_ROOM = '見本の間';
const DEMO_GUEST = '山人 太郎';
// DATA_SOURCE=demo の見本トークン（store.ts の固定データ）
const DEMO_STORE_TOKEN: Record<string, string> = { 'f-nishiwaga': 'demo-stay-nishiwaga', 'f-oga': 'demo-stay-oga' };

export type DemoStayToken = { token: string; validTo: string };

/** 見本の滞在のトークン（この環境で用意できなければ null・発行に失敗したら Error） */
export async function demoStayToken(event: RequestEvent, facilityId: string): Promise<DemoStayToken | null> {
	if (DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase') {
		const { data, error } = await createSupabaseServerClient(event)
			.schema('book')
			.rpc('get_or_issue_demo_stay_token', {
				p_facility: FACILITY_UUID[facilityId] ?? facilityId,
				p_room_code: DEMO_ROOM,
				p_guest_name: DEMO_GUEST
			});
		if (error) throw new Error('見本の滞在を用意できませんでした（' + error.message + '）');
		const r = data as { token: string; valid_to: string };
		return { token: r.token, validTo: r.valid_to };
	}
	if (DATA_SOURCE !== 'supabase') {
		const token = DEMO_STORE_TOKEN[facilityId];
		return token ? { token, validTo: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : null;
	}
	return null;
}
