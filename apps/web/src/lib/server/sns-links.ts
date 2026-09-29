// 施設ごとの SNS URL の読み書き。公開側は anon で読む（読めなければ空＝ボタンを出さない）。
// 管理画面はログイン中スタッフの権限で RPC（book.admin_save_facility_sns_links）。DATA_SOURCE=demo はプロセス内 Map。
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSnsLinks, type SnsLinks } from '$lib/sns-links';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';

const demoStore = new Map<string, SnsLinks>();

export async function loadSnsLinks(facilityId: string): Promise<SnsLinks> {
	if (DATA_SOURCE !== 'supabase') return demoStore.get(facilityId) ?? {};
	const uuid = FACILITY_UUID[facilityId] ?? facilityId;
	try {
		const { data, error } = await supa().from('facility_sns_links').select('links').eq('facility_id', uuid).maybeSingle();
		if (error || !data) return {};
		return normalizeSnsLinks(data.links);
	} catch {
		return {};
	}
}

export function saveSnsLinksDemo(facilityId: string, links: SnsLinks): void {
	demoStore.set(facilityId, links);
}

export async function sbSaveSnsLinks(client: SupabaseClient, facilityId: string, links: SnsLinks): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_facility_sns_links', {
		p_facility_id: FACILITY_UUID[facilityId] ?? facilityId,
		p_links: links
	});
	if (error) {
		throw new Error(
			error.message.includes('invalid_sns_url')
				? 'URLは https:// で始まる形式で入力してください'
				: 'SNSのURLを保存できませんでした（' + error.message + '）'
		);
	}
}
