// 新しいアプリ通知。誤配信は取り返しがつかないため、
// 「テスト受信者へ送る → 宛先件数を確認 → 件数を入力して確定」の三段を UI で強制する。
import { fail, redirect } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	adminAppDashboard,
	adminListMembers,
	adminSendNotification,
	bookAdmin,
	mapRpcError,
	type MemberRow
} from '$lib/server/admin-app-data';
import type { Actions, PageServerLoad } from './$types';

const UNAVAILABLE = 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）';

/** 社内のテスト受信者（メールドメインで判定）。実会員に誤って送らないための入口。 */
const TEST_DOMAIN = '@yamado.co.jp';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			testRecipients: [] as MemberRow[],
			memberCount: 0,
			pushCapable: 0
		};
	}
	const client = bookAdmin(event);
	try {
		const [testRecipients, dashboard] = await Promise.all([
			adminListMembers(client, { q: TEST_DOMAIN, limit: 20 }),
			adminAppDashboard(client)
		]);
		return {
			unavailable: false as const,
			testRecipients,
			memberCount: dashboard.members.active,
			pushCapable: dashboard.members.push_capable
		};
	} catch (e) {
		return {
			unavailable: false as const,
			testRecipients: [] as MemberRow[],
			memberCount: 0,
			pushCapable: 0,
			error: mapRpcError(e)
		};
	}
};

type Composed = {
	type: 'news' | 'coupon' | 'custom';
	title: string;
	body: string | null;
	url: string | null;
};

function compose(form: FormData): Composed {
	const type = String(form.get('type') ?? 'news');
	const url = String(form.get('url') ?? '').trim();
	return {
		type: (['news', 'coupon', 'custom'].includes(type) ? type : 'news') as Composed['type'],
		title: String(form.get('title') ?? '').trim(),
		body: String(form.get('body') ?? '').trim() || null,
		url: url || null
	};
}

/** 宛先の会員 id を決める。null は「全会員」（RPC 側で解決する） */
async function resolveTargets(
	event: Parameters<Actions[string]>[0],
	form: FormData
): Promise<{ ids: string[] | null; target: Record<string, unknown> }> {
	const mode = String(form.get('mode') ?? 'all');
	if (mode === 'all') return { ids: null, target: { mode: 'all' } };

	const ranks = form.getAll('ranks').map(String);
	const members = await adminListMembers(bookAdmin(event), {
		ranks: ranks.length > 0 ? ranks : null,
		limit: 1000
	});
	return { ids: members.map((m) => m.user_id), target: { mode: 'rank', ranks } };
}

export const actions: Actions = {
	/** 実機で見てから本番送信させるためのテスト送信 */
	test: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: '通知の送信は管理者のみ行えます。' });
		}
		const form = await event.request.formData();
		const c = compose(form);
		const ids = form.getAll('testIds').map(String).filter(Boolean);
		if (ids.length === 0) return fail(400, { message: 'テスト受信者を選んでください。' });

		try {
			const res = await adminSendNotification(bookAdmin(event), {
				...c,
				title: `[テスト] ${c.title}`.slice(0, 60),
				memberUserIds: ids,
				scheduledAt: null,
				target: { mode: 'test', client_token: crypto.randomUUID() }
			});
			return { tested: true, testedCount: res.count, fingerprint: String(form.get('fingerprint') ?? '') };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	send: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: '通知の送信は管理者のみ行えます。' });
		}
		const form = await event.request.formData();
		const c = compose(form);

		// 予約配信は JST の入力を +09:00 として ISO 化する
		const at = String(form.get('scheduledAt') ?? '').trim();
		const scheduledAt = at ? new Date(`${at}:00+09:00`).toISOString() : null;

		let campaignId: string;
		try {
			const { ids, target } = await resolveTargets(event, form);
			const res = await adminSendNotification(bookAdmin(event), {
				...c,
				memberUserIds: ids,
				scheduledAt,
				target: { ...target, client_token: String(form.get('clientToken') ?? '') || crypto.randomUUID() }
			});
			campaignId = res.campaign_id;
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
		redirect(303, `/admin/push/${campaignId}`);
	}
};
