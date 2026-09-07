// アプリ通知の一覧。手動配信（campaign）と cron の自動通知（reminder/thanks）を分けて見せる。
import { fail } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	adminAutoNotificationStats,
	adminCancelCampaign,
	adminListCampaigns,
	adminNotificationQueueStatus,
	bookAdmin,
	mapRpcError,
	type CampaignRow,
	type QueueStatus
} from '$lib/server/admin-app-data';
import type { Actions, PageServerLoad } from './$types';

type AutoRow = { day: string; type: string; queued: number; sent: number; failed: number; read: number };

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			campaigns: [] as CampaignRow[],
			auto: [] as AutoRow[],
			queue: null as QueueStatus | null
		};
	}
	const client = bookAdmin(event);
	try {
		const [queue, campaigns, auto] = await Promise.all([
			adminNotificationQueueStatus(client),
			adminListCampaigns(client, 50, 0),
			adminAutoNotificationStats(client, 30)
		]);
		return { unavailable: false as const, queue, campaigns, auto };
	} catch (e) {
		return {
			unavailable: false as const,
			campaigns: [] as CampaignRow[],
			auto: [] as AutoRow[],
			queue: null as QueueStatus | null,
			error: mapRpcError(e)
		};
	}
};

export const actions: Actions = {
	/** 予約配信の取消。送信開始（drain）済みのものは取り消せない */
	cancel: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では利用できません。' });
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: '通知の取り消しは管理者のみ行えます。' });
		}
		const form = await event.request.formData();
		try {
			const n = await adminCancelCampaign(bookAdmin(event), String(form.get('campaignId') ?? ''));
			return { cancelled: n };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	}
};
