// シークレットプランの公開範囲（book.plan_contents.audience / min_rank / link_only・autumn-shared 20261030142707）。
// 画面とサーバーの両方で使う純関数だけを置く（DB・Cookie を触る処理は $lib/server/secret-plans.ts）。
//
//   public  + linkOnly=false … 普通のプラン
//   public  + linkOnly=true  … 専用 URL を知っていれば誰でも
//   members + linkOnly=false … 対象の会員にだけ一覧に出る
//   members + linkOnly=true  … 専用 URL を知っている対象の会員だけ

export const RANK_CODES = ['standard', 'silver', 'gold', 'platinum'] as const;
export type RankCode = (typeof RANK_CODES)[number];

export interface PlanAccess {
	audience: 'public' | 'members';
	/** audience='members' のとき、このグレード以上。null はグレードを問わない */
	minRank: RankCode | null;
	/** true＝一覧・検索に出さず、専用 URL を開いた人だけ */
	linkOnly: boolean;
}

export const PUBLIC_ACCESS: PlanAccess = { audience: 'public', minRank: null, linkOnly: false };

/** 閲覧者（会員でなければ rank は null） */
export interface PlanViewer {
	isMember: boolean;
	rank: RankCode | null;
}

export const isRankCode = (v: unknown): v is RankCode => (RANK_CODES as readonly unknown[]).includes(v);

/** DB の行（v_plans・plan_contents）→ PlanAccess。列が無い・不正値は普通のプラン扱い */
export function planAccessOf(row: { audience?: unknown; min_rank?: unknown; link_only?: unknown }): PlanAccess {
	const audience = row.audience === 'members' ? 'members' : 'public';
	return {
		audience,
		minRank: audience === 'members' && isRankCode(row.min_rank) ? row.min_rank : null,
		linkOnly: row.link_only === true
	};
}

/** 普通のプラン（誰にでも一覧に出る）か */
export const isOpenPlan = (a: PlanAccess | undefined): boolean => !a || (a.audience === 'public' && !a.linkOnly);

const rankOrder = (r: RankCode) => RANK_CODES.indexOf(r);

/** グレードの条件を満たすか（会員でなければ false） */
export function rankMeets(viewer: PlanViewer, minRank: RankCode | null): boolean {
	if (!viewer.isMember) return false;
	if (!minRank) return true;
	return rankOrder(viewer.rank ?? 'standard') >= rankOrder(minRank);
}

/** 予約できるか（会員・グレードの条件だけ。URL を開いたかどうかは unlocked で渡す） */
export function canBookPlan(a: PlanAccess | undefined, viewer: PlanViewer, unlocked: boolean): boolean {
	if (!a) return true;
	if (a.linkOnly && !unlocked) return false;
	return a.audience === 'public' || rankMeets(viewer, a.minRank);
}

/** プラン一覧に出すか（URL 限定は出さない。会員限定は対象の会員にだけ） */
export function listPlanFor(a: PlanAccess | undefined, viewer: PlanViewer): boolean {
	if (!a) return true;
	if (a.linkOnly) return false;
	return a.audience === 'public' || rankMeets(viewer, a.minRank);
}

/**
 * プラン詳細を開いたときの扱い。
 *   ok      … 見られて予約できる
 *   login   … 会員限定（ログインまたは入会で予約できる）
 *   rank    … ログイン済みだがグレードが足りない
 *   hidden  … URL 限定で URL を開いていない（存在を知らせない＝404）
 */
export type PlanGate = 'ok' | 'login' | 'rank' | 'hidden';

export function planGateFor(a: PlanAccess | undefined, viewer: PlanViewer, unlocked: boolean): PlanGate {
	if (!a) return 'ok';
	if (a.linkOnly && !unlocked) return 'hidden';
	if (a.audience === 'public') return 'ok';
	// 会員限定は、プランの中身を見せたうえで「ログイン・入会で予約できます」「◯◯以上の会員の方へ」を出す
	if (!viewer.isMember) return 'login';
	return rankMeets(viewer, a.minRank) ? 'ok' : 'rank';
}

/** 専用 URL のトークン（DB は gen_random_uuid の 32 桁 16 進） */
export const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

/** 専用 URL のパス */
export const planShareLinkPath = (token: string) => `/plan/${token}`;

/** 管理画面の表示用（日本語のみ） */
export const RANK_LABELS_JA: Record<RankCode, string> = {
	standard: 'スタンダード',
	silver: 'シルバー',
	gold: 'ゴールド',
	platinum: 'プラチナ'
};

/** 管理画面の一覧・編集に出す短い説明 */
export function planAccessSummaryJa(a: PlanAccess | undefined): string | null {
	if (isOpenPlan(a)) return null;
	const who = a!.audience === 'public' ? '誰でも' : a!.minRank && a!.minRank !== 'standard' ? `${RANK_LABELS_JA[a!.minRank]}以上の会員` : '会員';
	return a!.linkOnly ? `URL限定・${who}` : `${who}限定`;
}
