// 管理画面: 取引先（エージェント・法人）の一覧と新規作成。autumn-rms の /partners から移設（2026-09-26）。
// 入口の検証（役割・施設・RLS での施設アクセス・service_role の有無）は staffPartnerScope に集約している。
import { redirect } from '@sveltejs/kit';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import {
	countPartnerCredentials,
	createPartner,
	listPartners,
	listTenantPartners,
	PARTNER_KIND_LABELS,
	PartnerStoreError
} from '$lib/server/partners/store';
import { actionFailure, canEditPartners, staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import { parsePartnerKind } from '$lib/server/partners/staff-form';
import { loadInvoiceIssuer, parseBillingSettingsForm, saveInvoiceIssuer } from '$lib/server/partners/invoices';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	// 「すべて」（N8・2026-10-09 複数施設化 S3）: テナントの取引先すべてを施設バッジ付きで。既定は ab_fac の施設に行がある取引先だけ
	const showAll = event.url.searchParams.get('all') === '1';
	const base = {
		kindLabels: PARTNER_KIND_LABELS,
		facilityName: currentFacility.name,
		canEdit: canEditPartners(event),
		showAll
	};
	try {
		const scope = await staffPartnerScope(event, 'view');
		const listed = showAll
			? await listTenantPartners(scope.db, scope.tenantId, scope.facilityId)
			: (await listPartners(scope.db, scope.facilityId)).map((partner) => ({ partner, onCurrent: true }));
		const partners = listed.map((l) => l.partner);
		const onCurrent = new Map(listed.map((l) => [l.partner.id, l.onCurrent]));
		const [counts, billing] = await Promise.all([
			countPartnerCredentials(scope.db, partners.map((p) => p.id)),
			// 請求書の発行元設定（会社で1つ・ab_fac に依らない・2026-10-09 N3。読めなくても一覧は出す）
			loadInvoiceIssuer(scope.db, scope.tenantId)
				.then((settings) => ({ settings, error: null as string | null }))
				.catch((e) => ({ settings: null, error: e instanceof Error ? e.message : String(e) }))
		]);
		return {
			...base,
			live: true,
			error: null as string | null,
			billing,
			partners: partners.map((p) => ({
				id: p.id,
				name: p.name,
				kind: p.kind,
				isActive: p.is_active,
				// 予約受付は ab_fac の施設のもの（その施設に行が無い取引先は false）
				bookingEnabled: onCurrent.get(p.id) ? p.booking_enabled : false,
				onCurrent: onCurrent.get(p.id) ?? false,
				// 施設のバッジ（オン／オフ・予約受付）。施設設定の行がある施設だけ
				facilities: p.facilities.map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, bookingEnabled: f.bookingEnabled })),
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
			return { ...base, live, error: e.message, partners: [], billing: { settings: null, error: null as string | null } };
		}
		throw e;
	}
};

export const actions: Actions = {
	// 請求書の発行元・振込先・通知先（会社で1つ・どの施設から保存しても同じ・2026-10-09 N3）。管理者だけ
	saveBilling: async (event) => {
		try {
			const scope = await staffPartnerScope(event, 'edit');
			const input = parseBillingSettingsForm(await event.request.formData());
			await saveInvoiceIssuer(scope.db, scope.tenantId, input, scope.userId);
			return { billingSaved: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

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
