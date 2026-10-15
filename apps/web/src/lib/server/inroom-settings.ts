// 客室案内（/r）の表示設定（施設ごと・book.inroom_settings）。2026-10-15 指示。
// 今は「フロントへお電話」メニューを出すかだけ。行が無い・読めない施設は従来どおり出す。
// 公開側は anon で読む。管理画面はログイン中スタッフの権限で RPC（book.admin_save_inroom_settings）。DATA_SOURCE=demo はプロセス内 Map。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';

export type InroomSettings = { showFrontCall: boolean };

const DEFAULTS: InroomSettings = { showFrontCall: true };
const demoStore = new Map<string, InroomSettings>();

export async function loadInroomSettings(facilityId: string): Promise<InroomSettings> {
	if (DATA_SOURCE !== 'supabase') return demoStore.get(facilityId) ?? DEFAULTS;
	const uuid = FACILITY_UUID[facilityId] ?? facilityId;
	try {
		const { data, error } = await supa().from('inroom_settings').select('show_front_call').eq('facility_id', uuid).maybeSingle();
		if (error || !data) return DEFAULTS;
		return { showFrontCall: data.show_front_call !== false };
	} catch {
		return DEFAULTS;
	}
}

export function saveInroomSettingsDemo(facilityId: string, s: InroomSettings): void {
	demoStore.set(facilityId, s);
}

export async function sbSaveInroomSettings(client: SupabaseClient, facilityId: string, s: InroomSettings): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_inroom_settings', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_show_front_call: s.showFrontCall
	});
	if (error) throw new Error('客室案内の表示設定を保存できませんでした（' + error.message + '）');
}
