import { fail } from '@sveltejs/kit';
import { listRankCancelPolicies, updateRankCancelPolicy } from '$lib/server/store';
import type { CancellationRule } from '@autumn-book/core';
import type { Actions, PageServerLoad } from './$types';
import { denyDemoStoreWrite } from '$lib/server/admin-demo-guard';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbListRankCancelPolicies } from '$lib/server/supabase-data';
import { supa } from '$lib/server/supabase';

// 本番（ADMIN_SUPABASE）は book.rank_cancel_policies を読み、保存は book.admin_save_rank_cancel_policy（管理者だけ）で行う（2026-11-23）。
// 使われる規定はブロンズ（非会員・シルバー・退会者も）とゴールド（特別会員も）の2つ。シルバー・プラチナの行は DB が揃える。
const LIVE_LABELS: Record<string, string> = {
	standard: 'ブロンズ（非会員・シルバー・退会者にも適用）',
	gold: 'ゴールド（特別会員にも適用）'
};

// グレード別キャンセル料規定（book.rank_cancel_policies）の編集画面。
// rank はテナント横断のグローバルマスタ（施設別ではない）。standard 行が実質の基準規定。
// 本アプリは AUTH_MODE=supabase 前まで admin 全体が demo 運用のため、ここは demo store を直接操作する。
//   （実接続後は service_role 経由の管理 action で book.rank_cancel_policies を upsert する）

export const load: PageServerLoad = async () => {
	if (ADMIN_SUPABASE) {
		const [policies, ranks] = await Promise.all([
			sbListRankCancelPolicies(),
			supa().from('member_ranks').select('code, reward_rate')
		]);
		const rate = new Map((ranks.data ?? []).map((r) => [r.code as string, Number(r.reward_rate)]));
		return {
			policies: policies
				.filter((p) => p.rankCode in LIVE_LABELS)
				.sort((a, b) => (a.rankCode === 'standard' ? -1 : b.rankCode === 'standard' ? 1 : 0))
				.map((p) => ({ ...p, label: LIVE_LABELS[p.rankCode], rewardRate: rate.get(p.rankCode) ?? 0 }))
		};
	}
	return { policies: listRankCancelPolicies() };
};

export const actions: Actions = {
	// グレード1件のルール表・allow_amend_in_penalty・note を保存
	save: async (event) => {
		const { request, locals } = event;
		const blocked = ADMIN_SUPABASE ? null : denyDemoStoreWrite();
		if (blocked) return blocked;
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
			// -1 は不泊（チェックイン後に来なかった場合）。0 は当日
			if (!Number.isFinite(d) || d < -1 || !Number.isFinite(pct) || pct <= 0) continue;
			rules.push({ days_before: d, rate: Math.min(100, pct) / 100 });
		}

		const allowAmendInPenalty = form.get('allowAmendInPenalty') === 'on';
		const note = String(form.get('note') ?? '');
		if (new Set(rules.map((r) => r.days_before)).size !== rules.length) return fail(400, { message: '同じ日数の行が2つあります。' });
		if (ADMIN_SUPABASE) {
			const { error } = await createSupabaseServerClient(event).schema('book').rpc('admin_save_rank_cancel_policy', {
				p_rank_code: rankCode, p_rules: rules, p_allow_amend_in_penalty: allowAmendInPenalty, p_note: note
			});
			if (error) {
				const msg = error.message ?? '';
				return fail(400, { message: msg.includes('forbidden') ? '編集権限がありません' : msg.includes('invalid_rules') ? '日数（-1〜365）と料率（1〜100%）を確かめてください。' : '保存できませんでした。' });
			}
			return { saved: rankCode };
		}
		const ok = updateRankCancelPolicy(rankCode, { rules, allowAmendInPenalty, note });
		if (!ok) return fail(404, { message: 'グレードが見つかりません' });
		return { saved: rankCode };
	}
};
