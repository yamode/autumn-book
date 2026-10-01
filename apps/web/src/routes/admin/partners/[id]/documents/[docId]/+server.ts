// 管理画面: 覚書のファイルのダウンロード（/admin/partners/[id]/documents/[docId]）。
// 閲覧権限（admin / staff）で開ける。詳細画面の load と同じく、staffPartnerScope（役割・ab_fac の施設・
// 施設へのアクセス権）→ requireStaffPartner（取引先がその施設のものか）の順に確かめてから、
// partner.id に属するファイルだけを中継する（署名URLは外へ出さない）。
import { error } from '@sveltejs/kit';
import { documentResponse, downloadPartnerDocument } from '$lib/server/partners/memorandum';
import { PartnerStoreError, requireStaffPartner } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const partner = await requireStaffPartner(scope.db, scope.facilityId, event.params.id);
		const hit = await downloadPartnerDocument(scope.db, partner.id, event.params.docId);
		if (!hit) error(404, 'ファイルが見つかりません。');
		return documentResponse(hit.doc, hit.body);
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status, e.message);
		throw e;
	}
};
