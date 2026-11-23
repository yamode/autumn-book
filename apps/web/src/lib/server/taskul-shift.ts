// taskul 系 Supabase（ynzpjdarpfaurzomrddu）のシフトを読むだけのクライアント（出張シェフの受付枠で使う・サーバー専用）。
// 設計: yamode/hp-pchef docs/design.md 5章
// - 対応できるシェフ: 勤務パターン（shift_patterns）の名前が「出張シェフ」のパターンを、
//   担当できる（shift_staff_pattern_capability.capability > 0）在籍中のスタッフ（shift_staff）。taskul 側に表や列は足さない。
// - 休み: shift_assignments をその人・その日で読み、taskul-shift-day.ts の classifyShiftDay で判定する。
//
// 【必要な環境変数（Cloudflare Pages のシークレット）】
//   TASKUL_SUPABASE_URL              … taskul 系の URL（https://ynzpjdarpfaurzomrddu.supabase.co）
//   TASKUL_SUPABASE_SERVICE_ROLE_KEY … taskul 系の service_role キー（読むだけに使う・ブラウザに出さない）
//   TASKUL_TENANT_ID                 … 任意。taskul のテナント（既定 1＝山人）。他テナントの同名パターンを拾わないため
// 未設定なら taskulShiftClient() は null（画面は「taskul に接続できないため受付枠を開けられません」）。
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import { classifyShiftDay, type ShiftDay, type ShiftRow } from './taskul-shift-day';

export const CHEF_PATTERN_NAME = '出張シェフ';

let cached: { key: string; client: SupabaseClient } | null = null;

export function taskulShiftClient(): SupabaseClient | null {
	const url = privateEnv.TASKUL_SUPABASE_URL?.trim();
	const key = privateEnv.TASKUL_SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!url || !key) return null;
	const k = `${url}|${key}`;
	if (cached?.key === k) return cached.client;
	const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
	cached = { key: k, client };
	return client;
}

function tenantId(): number {
	const n = Number(privateEnv.TASKUL_TENANT_ID ?? '1');
	return Number.isFinite(n) && n > 0 ? n : 1;
}

export type TaskulChef = { id: string; name: string };

/** 対応できるシェフ（勤務パターン「出張シェフ」を担当できる在籍中のスタッフ）。読めなければ例外 */
export async function listChefs(db: SupabaseClient): Promise<TaskulChef[]> {
	const tid = tenantId();
	const { data: patterns, error: pe } = await db.from('shift_patterns').select('id').eq('tenant_id', tid).eq('name', CHEF_PATTERN_NAME);
	if (pe) throw new Error('taskul の勤務パターンを読めませんでした。');
	const patternIds = (patterns ?? []).map((p) => p.id as string);
	if (!patternIds.length) return [];
	const { data: caps, error: ce } = await db
		.from('shift_staff_pattern_capability')
		.select('staff_id')
		.eq('tenant_id', tid)
		.in('pattern_id', patternIds)
		.gt('capability', 0);
	if (ce) throw new Error('taskul の担当できる人を読めませんでした。');
	const staffIds = [...new Set((caps ?? []).map((c) => c.staff_id as string))];
	if (!staffIds.length) return [];
	const { data: staff, error: se } = await db
		.from('shift_staff')
		.select('id,name,sort_order,is_active')
		.in('id', staffIds)
		.order('sort_order')
		.order('name');
	if (se) throw new Error('taskul のスタッフを読めませんでした。');
	return (staff ?? []).filter((s) => s.is_active !== false).map((s) => ({ id: s.id as string, name: s.name as string }));
}

/** シェフたちの期間内の各日の勤務（キーは `${staffId}|${date}`）。割り当ての無い日はキーが無い＝シフト未作成 */
export async function shiftDays(db: SupabaseClient, staffIds: string[], from: string, to: string): Promise<Map<string, ShiftDay>> {
	const out = new Map<string, ShiftDay>();
	if (!staffIds.length) return out;
	const tid = tenantId();
	const [rows, leaves] = await Promise.all([
		db
			.from('shift_assignments')
			.select('staff_id,date,pattern_id,is_day_off,is_desired_off,holiday_type,half_day_type,custom_start_time')
			.in('staff_id', staffIds)
			.gte('date', from)
			.lte('date', to),
		// テナントが足した休暇区分（特別休暇など）の表示名
		db.from('shift_leave_types').select('code,name').eq('tenant_id', tid)
	]);
	if (rows.error) throw new Error('taskul のシフトを読めませんでした。');
	const names = Object.fromEntries((leaves.data ?? []).map((l) => [l.code as string, l.name as string]));
	const grouped = new Map<string, ShiftRow[]>();
	for (const r of (rows.data ?? []) as (ShiftRow & { staff_id: string; date: string })[]) {
		const key = `${r.staff_id}|${r.date}`;
		grouped.set(key, [...(grouped.get(key) ?? []), r]);
	}
	for (const [key, list] of grouped) {
		const day = classifyShiftDay(list, names);
		if (day.kind !== 'none') out.set(key, day);
	}
	return out;
}

/** 1人・1日の勤務（開ける直前の確認用） */
export async function shiftDay(db: SupabaseClient, staffId: string, date: string): Promise<ShiftDay> {
	const m = await shiftDays(db, [staffId], date, date);
	return m.get(`${staffId}|${date}`) ?? { kind: 'none', label: 'シフト未作成' };
}
