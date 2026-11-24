// ログイン中のスタッフに割り当てられた施設（2026-11-24 指示）。
//
// 割り当ての実体は core.memberships（/admin/users の「施設の割り当て（PMS と共通）」が書く行）。
// RLS の memberships_select に `user_id = auth.uid()` があるので、本人のクライアントで自分の行だけ読める
// （service_role は要らない）。
//
// ⚠ private.has_facility_access は使えない。shared_login は rms_role_permissions で cross-facility=true のため、
//    割り当てが男鹿だけの ID でも「全施設 true」を返す（PMS と共通の設定なので Book 側では変えない）。
//    そのため Book の画面では、membership の facility_id をそのまま「操作してよい施設」として扱う。
//
// facility_id が null の行（tenant_admin など）は全施設の担当とみなす。
import type { RequestEvent } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { reverseFacilityUuid } from '$lib/server/supabase-data';
import type { AssignedFacilities } from '$lib/admin-facility-scope';

export { canOperateFacility, type AssignedFacilities } from '$lib/admin-facility-scope';

const cache = new WeakMap<object, Promise<AssignedFacilities>>();

/**
 * 割り当てられた施設（Book の施設 ID）。
 * 読めない・デモ環境・行が1つも無いときは 'all'（締め出さない。締め出しは割り当てを消す事故で起きうるため）。
 */
export function assignedFacilities(event: RequestEvent): Promise<AssignedFacilities> {
	const hit = cache.get(event);
	if (hit) return hit;
	const p = (async (): Promise<AssignedFacilities> => {
		const user = event.locals.user;
		if (!ADMIN_SUPABASE || !user || (user.role !== 'admin' && user.role !== 'staff')) return 'all';
		try {
			const db = createSupabaseServerClient(event);
			const { data, error } = await db.schema('core').from('memberships').select('facility_id').eq('user_id', user.id);
			if (error || !data || data.length === 0) return 'all';
			const rows = data as { facility_id: string | null }[];
			if (rows.some((r) => r.facility_id === null)) return 'all';
			const bookIds = [...new Set(rows.map((r) => reverseFacilityUuid(String(r.facility_id))).filter((v): v is string => !!v))];
			// 知らない UUID だけだった（施設マスタに無い）ときも締め出さない
			return bookIds.length ? { bookIds } : 'all';
		} catch {
			return 'all';
		}
	})();
	cache.set(event, p);
	p.catch(() => cache.delete(event));
	return p;
}
