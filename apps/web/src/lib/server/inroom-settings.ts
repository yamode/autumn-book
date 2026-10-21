// 客室案内（/r）の表示設定（施設ごと・book.inroom_settings）。2026-10-15 指示。
// 「フロントへお電話」メニューを出すか と、全館の湯量の残量目安（2026-10-17・西和賀で使う）。行が無い・読めない施設は従来どおり。
// 公開側は anon で読む。管理画面はログイン中スタッフの権限で RPC（book.admin_save_inroom_settings / admin_save_spring_level）。DATA_SOURCE=demo はプロセス内 Map。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';
import { normalizeSpringBands, type SpringBand } from '$lib/spring-level';
import { demoPreviewJson, EMPTY_DEMO_PREVIEW, normalizeDemoPreview, type DemoPreview } from '$lib/inroom-preview';

// 全館の湯量の残量目安（スタッフが手入力）。percent が null（未入力）なら出さない
// bands は段階ごとの言葉・色（null なら既定・$lib/spring-level.ts）
export type SpringLevel = { enabled: boolean; percent: number | null; note: string; updatedAt: string | null; bands: SpringBand[] | null };
export type InroomSettings = { showFrontCall: boolean; frontPhone: string; springLevel: SpringLevel };

const SPRING_DEFAULT: SpringLevel = { enabled: false, percent: null, note: '', updatedAt: null, bands: null };
const DEFAULTS: InroomSettings = { showFrontCall: true, frontPhone: '', springLevel: SPRING_DEFAULT };
const demoStore = new Map<string, InroomSettings>();

export async function loadInroomSettings(facilityId: string): Promise<InroomSettings> {
	if (DATA_SOURCE !== 'supabase') return demoStore.get(facilityId) ?? DEFAULTS;
	const uuid = FACILITY_UUID[facilityId] ?? facilityId;
	try {
		const { data, error } = await supa()
			.from('inroom_settings')
			.select('show_front_call, front_phone, spring_level_enabled, spring_level_percent, spring_level_note, spring_level_updated_at, spring_level_bands')
			.eq('facility_id', uuid)
			.maybeSingle();
		if (error || !data) return DEFAULTS;
		return {
			showFrontCall: data.show_front_call !== false,
			frontPhone: data.front_phone ?? '',
			springLevel: {
				enabled: data.spring_level_enabled === true,
				percent: typeof data.spring_level_percent === 'number' ? data.spring_level_percent : null,
				note: data.spring_level_note ?? '',
				updatedAt: data.spring_level_updated_at ?? null,
				bands: normalizeSpringBands(data.spring_level_bands)
			}
		};
	} catch {
		return DEFAULTS;
	}
}

// 客室案内のトップに出す湯量（出す設定で、値が入っているときだけ）
export function visibleSpringLevel(s: InroomSettings): SpringLevel | null {
	return s.springLevel.enabled && s.springLevel.percent !== null ? s.springLevel : null;
}

export function saveInroomSettingsDemo(facilityId: string, s: { showFrontCall: boolean; frontPhone: string }): void {
	demoStore.set(facilityId, { ...(demoStore.get(facilityId) ?? DEFAULTS), ...s });
}

export async function sbSaveInroomSettings(client: SupabaseClient, facilityId: string, s: { showFrontCall: boolean; frontPhone: string }): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_inroom_contact', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_show_front_call: s.showFrontCall,
		p_front_phone: s.frontPhone
	});
	if (error) throw new Error('客室案内の表示設定を保存できませんでした（' + error.message + '）');
}

type SpringInput = { enabled: boolean; percent: number | null; note: string; bands: SpringBand[] | null };

export function saveSpringLevelDemo(facilityId: string, s: SpringInput): void {
	const cur = demoStore.get(facilityId) ?? DEFAULTS;
	// 残量の値が変わったときだけ更新時刻を進める（DB の RPC と同じ）
	const updatedAt = cur.springLevel.percent !== s.percent || !cur.springLevel.updatedAt ? new Date().toISOString() : cur.springLevel.updatedAt;
	demoStore.set(facilityId, { ...cur, springLevel: { ...s, updatedAt } });
}

export async function sbSaveSpringLevel(client: SupabaseClient, facilityId: string, s: SpringInput): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_spring_level', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_enabled: s.enabled,
		p_percent: s.percent,
		p_note: s.note,
		p_bands: s.bands
	});
	if (error) throw new Error('湯量の目安を保存できませんでした（' + error.message + '）');
}

// ---- 見本の滞在に出す見本（精算案内・お知らせ・湯量・book.inroom_settings.demo_preview・2026-10-17）----
// 本体（loadInroomSettings）とは別に読む（列がまだ無い環境でも本体の表示を止めない）
const demoPreviewStore = new Map<string, DemoPreview>();

export async function loadDemoPreview(facilityId: string): Promise<DemoPreview> {
	if (DATA_SOURCE !== 'supabase') return demoPreviewStore.get(facilityId) ?? EMPTY_DEMO_PREVIEW;
	try {
		const { data, error } = await supa()
			.from('inroom_settings')
			.select('demo_preview')
			.eq('facility_id', FACILITY_UUID[facilityId] ?? facilityId)
			.maybeSingle();
		if (error || !data) return EMPTY_DEMO_PREVIEW;
		return normalizeDemoPreview(data.demo_preview);
	} catch {
		return EMPTY_DEMO_PREVIEW;
	}
}

export function saveDemoPreviewDemo(facilityId: string, p: DemoPreview): void {
	demoPreviewStore.set(facilityId, p);
}

export async function sbSaveDemoPreview(client: SupabaseClient, facilityId: string, p: DemoPreview): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_inroom_demo_preview', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_preview: demoPreviewJson(p)
	});
	if (error) throw new Error('見本の設定を保存できませんでした（' + error.message + '）');
}
