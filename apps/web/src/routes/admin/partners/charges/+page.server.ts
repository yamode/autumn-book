// 管理画面: 今後の請求予定（/admin/partners/charges?range=all|this_month|next_month|custom&from=&to=[&cancelled=1]）。
// 2026-10-10 ユーザー指示: 取引先予約の「オンライン決済（チェックアウト日）」で、これからカードへ請求する予定を一覧にする。
//   請求予定（請求予定日＝チェックアウト日の順・期間で絞る）と合計額、請求失敗（要対応・期間に関係なく先頭）、
//   キャンセル料のカード請求が残っているもの（別区分）、切替で最近取り消したもの（請求なし・取消日時付き）。
// 公式サイトの予約は予約時に請求が済む（後日のカード請求は無い）ので含めない。
// 閲覧は admin / staff（staffPartnerScope 'view'）。施設は管理画面で選んでいる施設（ab_fac）。ここでは請求・取消はしない
// （再請求・取消は予約管理の詳細 /admin/reservations/[code] か取引先の詳細で行う）。
import { parseChargeRange } from '$lib/partner-upcoming-charges';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import { loadUpcomingCharges, RECENT_CANCEL_DAYS, type UpcomingChargesResult } from '$lib/server/partners/upcoming-charges';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const today = todayJst();
	const sp = event.url.searchParams;
	const range = parseChargeRange({ range: sp.get('range'), from: sp.get('from'), to: sp.get('to') }, today);
	const includeCancelled = sp.get('cancelled') === '1';
	const base = { facilityName: currentFacility.name, today, range, includeCancelled, recentCancelDays: RECENT_CANCEL_DAYS };
	const empty: UpcomingChargesResult = { scheduled: [], failed: [], cancelFees: [], cancelled: [], truncated: false };
	try {
		const scope = await staffPartnerScope(event, 'view');
		const result = await loadUpcomingCharges(scope.db, { tenantId: scope.tenantId, facilityId: scope.facilityId }, { range, includeCancelled });
		return { ...base, live: true, error: null as string | null, ...result };
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
			const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
			return { ...base, live, error: e.message, ...empty };
		}
		throw e;
	}
};
