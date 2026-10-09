import { fail } from '@sveltejs/kit';
import { logPartnerAccess, PartnerStoreError } from '$lib/server/partners/store';
import {
  deletePartnerDocument,
  formatBytes,
  getPartnerMemorandum,
  listPartnerDocuments,
  MAX_PARTNER_DOCUMENT_BYTES,
  PARTNER_DOCUMENT_ACCEPT,
  uploadPartnerDocument
} from '$lib/server/partners/memorandum';
import { deferTask, portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: 覚書（宿が書いた取引条件のまとめ＋双方が保存するファイル。2026-10-01 追加）。
// 本文・ファイルは service_role で読むので、必ず requirePortalSession で確定した partner.id で絞る。
// 本文・ファイルの一覧は後から流す（content: Promise・2026-10-10）。画面は届くまで枠を出し、読めなければ本文の位置に案内を出す
// （以前は 503 の画面）。アクセスログは応答を待たせない（waitUntil）
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  deferTask(event, logPartnerAccess(db, { partnerId: partner.id, accountId: session.id, channel: 'web', action: 'memorandum_view', ip: requestMeta(event).ip }));
  const content = Promise.all([getPartnerMemorandum(db, partner.id), listPartnerDocuments(db, partner.id)]).then(
    ([memorandum, docs]) => ({
      error: null as string | null,
      memorandum,
      documents: docs.map((d) => ({
        id: d.id,
        fileName: d.file_name,
        size: formatBytes(d.byte_size),
        // 保存者: 宿 / 貴社のログインID
        uploader: d.uploaded_by_kind === 'staff' ? '宿' : `貴社（${d.uploaded_by_label ?? 'ログインID 不明'}）`,
        byPartner: d.uploaded_by_kind === 'partner',
        // 取引先が消せるのは、自分のログインIDで保存したものだけ（サーバの削除でも同じ条件で確かめる）
        canDelete: d.uploaded_by_kind === 'partner' && d.uploaded_by_account === session.id,
        note: d.note ?? '',
        createdAt: d.created_at
      }))
    }),
    () => ({ error: '覚書を読み込めませんでした。時間をおいてお試しください。', memorandum: null, documents: [] })
  );
  return {
    portal: portalHeader(partner, session),
    content,
    accept: PARTNER_DOCUMENT_ACCEPT,
    maxBytes: MAX_PARTNER_DOCUMENT_BYTES,
    maxBytesLabel: formatBytes(MAX_PARTNER_DOCUMENT_BYTES)
  };
};

export const actions = {
  upload: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return fail(400, { message: 'ファイルを選んでください。' });
    try {
      const doc = await uploadPartnerDocument(
        db,
        partner,
        file,
        { kind: 'partner', accountId: session.id, label: session.login_id },
        String(fd.get('note') ?? '')
      );
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'document_upload',
        detail: { documentId: doc.id, fileName: doc.file_name, bytes: doc.byte_size },
        ip: requestMeta(event).ip
      });
      return { uploaded: doc.file_name };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.message });
      throw e;
    }
  },
  delete: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const id = String(fd.get('id') ?? '');
    try {
      // 自分のログインIDで保存したものだけ（onlyAccountId）
      await deletePartnerDocument(db, partner.id, id, { onlyAccountId: session.id });
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'document_delete',
        detail: { documentId: id },
        ip: requestMeta(event).ip
      });
      return { deleted: true };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
