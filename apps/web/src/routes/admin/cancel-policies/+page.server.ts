import { fail } from '@sveltejs/kit';
import { listRankCancelPolicies, updateRankCancelPolicy } from '$lib/server/store';
import type { CancellationRule } from '@autumn-book/core';
import type { Actions, PageServerLoad } from './$types';

// グレード別キャンセル料規定（book.rank_cancel_policies）の編集画面。
// rank はテナント横断のグローバルマスタ（施設別ではない）。standard 行が実質の基準規定。
// 本アプリは AUTH_MODE=supabase 前まで admin 全体が demo 運用のため、ここは demo store を直接操作する。
//   （実接続後は service_role 経由の管理 action で book.rank_cancel_policies を upsert する）

export const load: PageServerLoad = async () => {
	return { policies: listRankCancelPolicies() };
};

export const actions: Actions = {
	// グレード1件のルール表・allow_amend_in_penalty・note を保存
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const rankCode = String(form.get('rankCode') ?? '');

		// 「◯日前 ◯%」の行（days[] / rate[]）。rate は % 入力 → 0〜1 の fraction へ変換。
		const days = form.getAll('days').map((d) => Math.floor(Number(d)));
		const rates = form.getAll('rate').map((r) => Number(r));
		const rules: CancellationRule[] = [];
		for (let i = 0; i < days.length; i++) {
			const d = days[i];
			const pct = rates[i];
			if (!Number.isFinite(d) || d < 0 || !Number.isFinite(pct) || pct <= 0) continue;
			rules.push({ days_before: d, rate: Math.min(100, pct) / 100 });
		}

		const allowAmendInPenalty = form.get('allowAmendInPenalty') === 'on';
		const note = String(form.get('note') ?? '');
		const ok = updateRankCancelPolicy(rankCode, { rules, allowAmendInPenalty, note });
		if (!ok) return fail(404, { message: 'グレードが見つかりません' });
		return { saved: rankCode };
	}
};
