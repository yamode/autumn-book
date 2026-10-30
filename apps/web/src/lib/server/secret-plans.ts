// シークレットプラン（会員限定・グレード以上・URL 限定）のサーバー側。公開範囲の判定は $lib/plan-access。
//
// 秘密のプランは anon から見えない（book.plan_contents の公開読み取り RLS が普通のプランだけ・autumn-shared 20261030142707）。
// そこで Book のサーバーが、閲覧者の判定（会員・グレード・専用 URL を開いたか）を通したときだけ service_role で読む。
//
// 専用 URL /plan/<token> を開くと、トークンを Cookie（ab_plan_links）に足してプラン詳細へ移る。
// 以後、予約の手続き（仮押さえ）まで同じ端末では URL を開いた扱いになる。トークンを作り直すと古い Cookie は効かなくなる。
import type { Cookies } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { mapPlanRow } from '$lib/server/supabase-data';
import { memberById, ratePlans } from '$lib/server/store';
import {
	SHARE_TOKEN_RE,
	canBookPlan,
	isOpenPlan,
	isRankCode,
	listPlanFor,
	planGateFor,
	type PlanGate,
	type PlanViewer,
	type RankCode
} from '$lib/plan-access';
import type { RatePlan } from '$lib/types';

const DEBUG = true;
const dbg = (...args: unknown[]) => {
	if (DEBUG) console.log('[DBG secret-plans]', ...args);
};

export const PLAN_LINKS_COOKIE = 'ab_plan_links';
/** 覚えておく専用 URL の数（古いものから捨てる） */
const MAX_LINKS = 20;

type Locals = { user?: { id?: string; role?: string } | null };

// ---------------------------------------------------------------- 閲覧者

/** 閲覧者が会員か・グレードは何か（会員の判定は direct-payments の viewerIsMember と同じ） */
export async function viewerOf(locals: Locals): Promise<PlanViewer> {
	const id = locals.user?.role === 'member' ? locals.user.id : undefined;
	if (!id) return { isMember: false, rank: null };
	if (DATA_SOURCE !== 'supabase') return { isMember: true, rank: rankOr(memberById(id)?.rank) };
	if (!MEMBER_SUPABASE) return { isMember: false, rank: null };
	const sb = partnerServiceClient();
	if (!sb) return { isMember: true, rank: 'standard' };
	const { data, error } = await sb.schema('book').from('members').select('rank_code, withdrawn_at').eq('user_id', id).maybeSingle();
	if (error) {
		dbg('viewerOf', error.message);
		return { isMember: true, rank: 'standard' };
	}
	if (!data || data.withdrawn_at) return { isMember: false, rank: null };
	return { isMember: true, rank: rankOr(data.rank_code) };
}

const rankOr = (v: unknown): RankCode => (isRankCode(v) ? v : 'standard');

// ---------------------------------------------------------------- 専用 URL（Cookie）

/** Cookie に入っているトークン（形の正しいものだけ） */
export function linkTokensOf(cookies: Cookies): string[] {
	return (cookies.get(PLAN_LINKS_COOKIE) ?? '')
		.split('.')
		.filter((t) => SHARE_TOKEN_RE.test(t))
		.slice(-MAX_LINKS);
}

/** トークンを Cookie に足す（同じものは末尾へ動かす） */
export function rememberLinkToken(cookies: Cookies, token: string): void {
	const tokens = [...linkTokensOf(cookies).filter((t) => t !== token), token].slice(-MAX_LINKS);
	cookies.set(PLAN_LINKS_COOKIE, tokens.join('.'), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 60 * 60 * 24 * 90
	});
}

// デモ（DATA_SOURCE=demo）のトークンはプロセス内だけ
const demoTokens = new Map<string, string>();

function newToken(): string {
	return crypto.randomUUID().replaceAll('-', '');
}

/** デモ: プランの専用 URL のトークン（無ければ作る・rotate で作り直す） */
export function demoShareToken(planId: string, rotate = false): string {
	let t = demoTokens.get(planId);
	if (!t || rotate) {
		t = newToken();
		demoTokens.set(planId, t);
	}
	return t;
}

/** トークン → プラン id（複数まとめて）。読めないときは空 */
async function planIdsOfTokens(tokens: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (tokens.length === 0) return out;
	if (DATA_SOURCE !== 'supabase') {
		for (const [planId, t] of demoTokens) if (tokens.includes(t)) out.set(t, planId);
		return out;
	}
	const sb = partnerServiceClient();
	if (!sb) return out;
	const { data, error } = await sb.schema('book').from('plan_share_links').select('rate_plan_id, token').in('token', tokens);
	if (error) {
		dbg('planIdsOfTokens', error.message);
		return out;
	}
	for (const r of (data ?? []) as { rate_plan_id: string; token: string }[]) out.set(r.token, r.rate_plan_id);
	return out;
}

/** この端末で専用 URL を開いたプランの id */
export async function unlockedPlanIds(cookies: Cookies): Promise<Set<string>> {
	return new Set((await planIdsOfTokens(linkTokensOf(cookies))).values());
}

// ---------------------------------------------------------------- 秘密のプランを読む（service_role）

/** 秘密のプランも含めてプランを読む（id 指定）。公開を外したプランは返さない */
export async function planIncludingSecret(planId: string): Promise<RatePlan | undefined> {
	if (DATA_SOURCE !== 'supabase') return ratePlans.find((p) => p.id === planId && p.isPublished);
	const sb = partnerServiceClient();
	if (!sb) return undefined;
	const { data, error } = await sb.schema('book').from('v_plans').select('*').eq('rate_plan_id', planId).maybeSingle();
	if (error) throw error;
	return data ? mapPlanRow(data as Record<string, unknown>) : undefined;
}

/** 施設の秘密のプラン（普通のプラン以外）。読めないときは空 */
async function secretPlansOf(facilityId: string): Promise<RatePlan[]> {
	if (DATA_SOURCE !== 'supabase') {
		return ratePlans.filter((p) => p.facilityId === facilityId && p.isPublished && !isOpenPlan(p.access));
	}
	const sb = partnerServiceClient();
	if (!sb) return [];
	const { data, error } = await sb
		.schema('book')
		.from('v_plans')
		.select('*')
		.eq('facility_id', facilityId)
		.or('audience.neq.public,link_only.eq.true');
	if (error) {
		dbg('secretPlansOf', error.message);
		return [];
	}
	return ((data ?? []) as Record<string, unknown>[]).map(mapPlanRow);
}

/** 施設の全プラン（秘密のものも）。管理画面の予約詳細などプラン名を引くだけの用途 */
export async function plansIncludingSecret(facilityId: string, open: RatePlan[]): Promise<RatePlan[]> {
	const secret = await secretPlansOf(facilityId);
	const ids = new Set(open.map((p) => p.id));
	return [...open, ...secret.filter((p) => !ids.has(p.id))];
}

/** プラン一覧に足す会員限定プラン（閲覧者が対象のものだけ。URL 限定は足さない） */
export async function listedSecretPlans(facilityId: string, viewer: PlanViewer): Promise<RatePlan[]> {
	if (!viewer.isMember) return [];
	return (await secretPlansOf(facilityId)).filter((p) => listPlanFor(p.access, viewer));
}

/**
 * プラン詳細: 普通のプランで見つからなければ、秘密のプランから slug で探して閲覧者の扱いを決める。
 * 戻り値 undefined は 404（URL 限定で URL を開いていない場合も 404＝存在を知らせない）。
 */
export async function secretPlanBySlug(
	facilityId: string,
	slug: string,
	locals: Locals,
	cookies: Cookies
): Promise<{ plan: RatePlan; gate: Exclude<PlanGate, 'hidden'> } | undefined> {
	const plan = (await secretPlansOf(facilityId)).find((p) => p.slug === slug);
	if (!plan) return undefined;
	const gate = await planGate(plan, locals, cookies);
	dbg('secretPlanBySlug', slug, gate);
	return gate === 'hidden' ? undefined : { plan, gate };
}

/** 見つけたプランを閲覧者が開いたときの扱い（普通のプランは DB を読まずに ok） */
export async function planGate(plan: RatePlan, locals: Locals, cookies: Cookies): Promise<PlanGate> {
	if (isOpenPlan(plan.access)) return 'ok';
	const [viewer, unlocked] = await Promise.all([viewerOf(locals), unlockedPlanIds(cookies)]);
	return planGateFor(plan.access, viewer, unlocked.has(plan.id));
}

/** 専用 URL → プラン（とその施設 id）。無効なトークンは undefined */
export async function planOfShareToken(token: string): Promise<RatePlan | undefined> {
	if (!SHARE_TOKEN_RE.test(token)) return undefined;
	const planId = (await planIdsOfTokens([token])).get(token);
	if (!planId) return undefined;
	return planIncludingSecret(planId);
}

/**
 * 仮押さえの前に、閲覧者がそのプランを予約できるか確かめる（create_hold_group は service_role 専用で
 * DB は閲覧者を知らないため、ここが唯一の関所）。予約できないプランがあれば false。
 * 普通のプランは DB を読まずに通す（anon で読めるもの＝普通のプラン、とは限らないので id で確かめる）。
 */
export async function canBookPlans(planIds: string[], locals: Locals, cookies: Cookies): Promise<boolean> {
	const ids = [...new Set(planIds)];
	if (ids.length === 0) return true;
	const plans = await Promise.all(ids.map((id) => planIncludingSecret(id).catch(() => undefined)));
	const secret = plans.filter((p): p is RatePlan => !!p && !isOpenPlan(p.access));
	if (secret.length === 0) return true;
	const [viewer, unlocked] = await Promise.all([viewerOf(locals), unlockedPlanIds(cookies)]);
	const ok = secret.every((p) => canBookPlan(p.access, viewer, unlocked.has(p.id)));
	dbg('canBookPlans', ids, ok);
	return ok;
}

/** 秘密のプランか（yamado-one の /api/hold など、閲覧者を判定できない入口で断る用） */
export async function isSecretPlan(planId: string): Promise<boolean> {
	const plan = await planIncludingSecret(planId).catch(() => undefined);
	return !!plan && !isOpenPlan(plan.access);
}

