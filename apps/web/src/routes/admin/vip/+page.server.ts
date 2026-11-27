// 管理画面: VIP（特別会員）の専用ページの一覧（2026-11-27・取引先とメニューを分けた）。
// 専用ページは PMS の顧客マスタで VIP を付けると自動で作られ（ensureVipPages）、会員登録の前から料金を決められる。
// お客様はこのページの料金・特典で、公式サイトの「プライベートブック」から予約する（docs/private-book.md）。
// 1 ページの設定（料金ルール・特典・施設・対象の会員）は取引先と同じ詳細画面 /admin/partners/<id> を使う。
// VIP は施設をまたいだ（ブランド共通の）制度なので、施設で絞らず全部を出す。
import { listTenantPartners, PartnerStoreError } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import { ensureVipPages } from '$lib/server/partners/member-bookings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	try {
		const scope = await staffPartnerScope(event, 'view');
		// PMS で VIP を付けた顧客に、まだ専用ページが無ければここで作る（ふだんは VIP を付けたときに DB の知らせで作られる。
		// 知らせが届かなかったときの取りこぼし拾い・足りない施設の追加も同じ関数）。作れなくても一覧は出す
		await ensureVipPages(scope.db).catch((e) => console.error('[vip] 専用ページを作れませんでした', e instanceof Error ? e.message : e));
		const listed = await listTenantPartners(scope.db, scope.tenantId, scope.facilityId);
		const pages = listed.map((l) => l.partner).filter((p) => p.kind === 'member');
		// 入っている会員の数（0 = ご本人の Book の会員登録待ち）
		const ids = pages.map((p) => p.id);
		let counts: Map<string, number> | null = new Map();
		if (ids.length) {
			const { data, error } = await scope.db.from('rms_partner_members').select('partner_id').in('partner_id', ids);
			if (error) counts = null;
			else for (const r of (data ?? []) as { partner_id: string }[]) counts.set(r.partner_id, (counts.get(r.partner_id) ?? 0) + 1);
		}
		return {
			live: true,
			error: null as string | null,
			facilityName: currentFacility.name,
			pages: pages.map((p) => ({
				id: p.id,
				name: p.name,
				isActive: p.is_active,
				validFrom: p.valid_from,
				validUntil: p.valid_until,
				ruleCount: p.pricing.rules.filter((r) => r.action === 'adjust').length,
				facilities: p.facilities.map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, bookingEnabled: f.bookingEnabled })),
				members: counts ? (counts.get(p.id) ?? 0) : null
			}))
		};
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
			const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
			return { live, error: e.message, facilityName: currentFacility.name, pages: [] };
		}
		throw e;
	}
};
