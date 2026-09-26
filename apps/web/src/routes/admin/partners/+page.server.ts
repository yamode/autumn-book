// 管理画面: 取引先（エージェント・法人）の一覧と新規作成。autumn-rms の /partners から移設（2026-09-26）。
// 入口の検証（役割・施設・RLS での施設アクセス・service_role の有無）は staffPartnerScope に集約している。
import { redirect } from '@sveltejs/kit';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import { countPartnerCredentials, createPartner, listPartners, PARTNER_KIND_LABELS, PartnerStoreError } from '$lib/server/partners/store';
import { actionFailure, canEditPartners, staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import { parsePartnerKind } from '$lib/server/partners/staff-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const base = {
		kindLabels: PARTNER_KIND_LABELS,
		facilityName: currentFacility.name,
		canEdit: canEditPartners(event)
	};
	try {
		const scope = await staffPartnerScope(event, 'view');
		const partners = await listPartners(scope.db, scope.facilityId);
		const counts = await countPartnerCredentials(scope.db, partners.map((p) => p.id));
		return {
			...base,
			live: true,
			error: null as string | null,
			partners: partners.map((p) => ({
				id: p.id,
				name: p.name,
				kind: p.kind,
				isActive: p.is_active,
				bookingEnabled: p.booking_enabled,
				validFrom: p.valid_from,
				validUntil: p.valid_until,
				pricing: p.pricing,
				updatedAt: p.updated_at,
				...(counts.get(p.id) ?? { accounts: 0, activeAccounts: 0, apiKeys: 0 })
			}))
		};
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
			const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
			return { ...base, live, error: e.message, partners: [] };
		}
		throw e;
	}
};

export const actions: Actions = {
	// 名前だけで取引先を作り、詳細（特別レート・アカウント）は編集画面で設定する。
	create: async (event) => {
		let id: string;
		try {
			const scope = await staffPartnerScope(event, 'edit');
			const fd = await event.request.formData();
			const name = String(fd.get('name') ?? '').trim().slice(0, 120);
			if (!name) return actionFailure(new PartnerStoreError('取引先名を入力してください。'));
			const partner = await createPartner(
				scope.db,
				{ tenantId: scope.tenantId, facilityId: scope.facilityId, userId: scope.userId },
				{
					name,
					kind: parsePartnerKind(fd.get('kind')),
					contact_name: null,
					contact_email: null,
					// 特別レートを決める前に見られないよう、作成直後は公開停止にしておく。
					is_active: false,
					valid_from: null,
					valid_until: null,
					max_days_ahead: 365,
					show_inventory: true,
					include_advance: true,
					pricing: DEFAULT_PARTNER_PRICING,
					note: null,
					// 予約受付は、支払方法と受付ルールを決めてから開ける。
					booking_enabled: false,
					booking_settings: DEFAULT_PARTNER_BOOKING_SETTINGS
				}
			);
			id = partner.id;
		} catch (e) {
			return actionFailure(e);
		}
		redirect(303, `/admin/partners/${id}`);
	}
};
