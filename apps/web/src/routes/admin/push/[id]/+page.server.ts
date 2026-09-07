// 配信の詳細。「送信済 ≠ push 到達」を切り分けて見せる
// （opt-out・端末なしの会員も通知行は sent になるため）。
import { error } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	adminCampaignDetail,
	adminListCampaigns,
	bookAdmin,
	mapRpcError,
	type CampaignRow
} from '$lib/server/admin-app-data';
import type { PageServerLoad } from './$types';

type Detail = Awaited<ReturnType<typeof adminCampaignDetail>>;

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			campaign: null as CampaignRow | null,
			detail: null as Detail | null
		};
	}
	const client = bookAdmin(event);
	try {
		// campaign 数は高々数十件なので一覧 RPC から引く（専用 RPC を増やさない）
		const campaigns = await adminListCampaigns(client, 200, 0);
		const campaign = campaigns.find((c) => c.id === event.params.id) ?? null;
		if (!campaign) error(404, '配信が見つかりません');

		const detail = await adminCampaignDetail(client, campaign.id);
		return { unavailable: false as const, campaign, detail };
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		return {
			unavailable: false as const,
			campaign: null as CampaignRow | null,
			detail: null as Detail | null,
			error: mapRpcError(e)
		};
	}
};
