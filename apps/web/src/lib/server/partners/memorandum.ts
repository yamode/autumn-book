// 取引先ページ「覚書」（2026-10-01 追加）: 取引条件のまとめ（本文）と、宿・取引先の双方が保存するファイル。
//
// 表 rms_partners.memorandum* / rms_partner_documents とバケット partner-documents は service_role 専用
// （autumn-shared 20261001074722）。ここの関数は入口の検証を済ませた呼び出し側からだけ使う:
//   - 取引先ページ: requirePortalSession（限定URL＋セッション）で partner を確定してから
//   - 管理画面: requireStaffPartner（スタッフの施設アクセス）で partner を確定してから
// どの関数も partner.id で絞り込み、別の取引先のファイルには触れない。
import type { SupabaseClient } from '@supabase/supabase-js';
import { PartnerStoreError, type PartnerRow } from './store';
import { isInlineAttachment } from '$lib/partner-attachments';

export const PARTNER_DOCUMENT_BUCKET = 'partner-documents';
export const MAX_PARTNER_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20MB（バケットの file_size_limit と同じ）
export const MAX_PARTNER_DOCUMENTS = 100;
export const MAX_MEMORANDUM_LENGTH = 20000;

// 受け付けるファイル（契約書・見積・請求書・画像・表計算など）。拡張子で判定し、保存時の Content-Type もここから決める。
const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip'
};
export const PARTNER_DOCUMENT_ACCEPT = Object.keys(ALLOWED_TYPES)
  .map((e) => `.${e}`)
  .join(',');

export type PartnerMemorandum = { text: string; updatedAt: string | null };

export type PartnerDocumentRow = {
  id: string;
  partner_id: string;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  uploaded_by_kind: 'staff' | 'partner';
  uploaded_by_account: string | null;
  uploaded_by_label: string | null;
  note: string | null;
  created_at: string;
};

const DOC_COLUMNS = 'id, partner_id, file_name, mime_type, byte_size, uploaded_by_kind, uploaded_by_account, uploaded_by_label, note, created_at';

// ---- 本文 ----

export async function getPartnerMemorandum(db: SupabaseClient, partnerId: string): Promise<PartnerMemorandum> {
  const { data, error } = await db.from('rms_partners').select('memorandum, memorandum_updated_at').eq('id', partnerId).maybeSingle();
  if (error) throw new PartnerStoreError(`覚書を読み込めませんでした（${error.message}）`, 500, 'db_error');
  return { text: (data?.memorandum as string | null) ?? '', updatedAt: (data?.memorandum_updated_at as string | null) ?? null };
}

// 管理画面からだけ呼ぶ（取引条件は宿が書く）。
export async function savePartnerMemorandum(db: SupabaseClient, partner: Pick<PartnerRow, 'id'>, text: string, userId: string | null): Promise<void> {
  const body = text.replace(/\r\n/g, '\n').trim();
  if (body.length > MAX_MEMORANDUM_LENGTH) throw new PartnerStoreError(`覚書は ${MAX_MEMORANDUM_LENGTH.toLocaleString('ja-JP')} 文字までです。`);
  const { error } = await db
    .from('rms_partners')
    .update({ memorandum: body || null, memorandum_updated_at: new Date().toISOString(), memorandum_updated_by: userId })
    .eq('id', partner.id);
  if (error) throw new PartnerStoreError(`覚書を保存できませんでした（${error.message}）`, 500, 'db_error');
}

// ---- ファイル ----

export async function listPartnerDocuments(db: SupabaseClient, partnerId: string): Promise<PartnerDocumentRow[]> {
  const { data, error } = await db
    .from('rms_partner_documents')
    .select(DOC_COLUMNS)
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(MAX_PARTNER_DOCUMENTS);
  if (error) throw new PartnerStoreError(`ファイルの一覧を読み込めませんでした（${error.message}）`, 500, 'db_error');
  return (data ?? []) as PartnerDocumentRow[];
}

const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();

// ファイル名からパス区切り・制御文字を除く（表示・ダウンロード名用。保存キーには使わない）。
export const safeFileName = (name: string) =>
  name
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(-120) || 'file';

export type DocumentUploader =
  | { kind: 'staff'; userId: string | null; label: string | null }
  | { kind: 'partner'; accountId: string; label: string };

export async function uploadPartnerDocument(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'tenant_id'>,
  file: File,
  by: DocumentUploader,
  note = ''
): Promise<PartnerDocumentRow> {
  if (!(file instanceof File) || file.size === 0) throw new PartnerStoreError('ファイルを選んでください。');
  if (file.size > MAX_PARTNER_DOCUMENT_BYTES) throw new PartnerStoreError('1ファイル 20MB までです。');
  const fileName = safeFileName(file.name);
  const ext = extOf(fileName);
  const mime = ALLOWED_TYPES[ext];
  if (!mime) throw new PartnerStoreError('この種類のファイルは保存できません（PDF・画像・Word・Excel・PowerPoint・CSV・テキスト・ZIP）。');
  const { count } = await db.from('rms_partner_documents').select('id', { count: 'exact', head: true }).eq('partner_id', partner.id);
  if ((count ?? 0) >= MAX_PARTNER_DOCUMENTS) throw new PartnerStoreError(`ファイルは ${MAX_PARTNER_DOCUMENTS} 件までです。不要なものを削除してください。`);

  const path = `${partner.id}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await db.storage.from(PARTNER_DOCUMENT_BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (upErr) throw new PartnerStoreError(`ファイルを保存できませんでした（${upErr.message}）`, 500, 'storage_error');

  const { data, error } = await db
    .from('rms_partner_documents')
    .insert({
      tenant_id: partner.tenant_id,
      // 覚書のファイルは取引先共通（決定 N4・§7.3）。新規は施設を持たない（2026-10-09 複数施設化 S3）
      facility_id: null,
      partner_id: partner.id,
      file_name: fileName,
      mime_type: mime,
      byte_size: file.size,
      storage_path: path,
      uploaded_by_kind: by.kind,
      uploaded_by_staff: by.kind === 'staff' ? by.userId : null,
      uploaded_by_account: by.kind === 'partner' ? by.accountId : null,
      uploaded_by_label: (by.label ?? '').slice(0, 120) || null,
      note: note.trim().slice(0, 200) || null
    })
    .select(DOC_COLUMNS)
    .single();
  if (error) {
    // 台帳に書けなければ実体も消す（孤児を残さない）
    await db.storage.from(PARTNER_DOCUMENT_BUCKET).remove([path]);
    throw new PartnerStoreError(`ファイルを保存できませんでした（${error.message}）`, 500, 'db_error');
  }
  return data as PartnerDocumentRow;
}

// ダウンロード（partner.id に属するファイルだけ）。本文はサーバが中継する（署名URLを外へ出さない）。
export async function downloadPartnerDocument(
  db: SupabaseClient,
  partnerId: string,
  documentId: string
): Promise<{ doc: PartnerDocumentRow; body: Blob } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return null;
  const { data } = await db
    .from('rms_partner_documents')
    .select(`${DOC_COLUMNS}, storage_path`)
    .eq('id', documentId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (!data) return null;
  const { data: body, error } = await db.storage.from(PARTNER_DOCUMENT_BUCKET).download(String(data.storage_path));
  if (error || !body) throw new PartnerStoreError(`ファイルを読み込めませんでした${error?.message ? `（${error.message}）` : ''}`, 500, 'storage_error');
  return { doc: data as unknown as PartnerDocumentRow, body };
}

// 削除。取引先は自分のログインIDで上げたものだけ（onlyAccountId）、スタッフはすべて。
export async function deletePartnerDocument(
  db: SupabaseClient,
  partnerId: string,
  documentId: string,
  opts: { onlyAccountId?: string } = {}
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new PartnerStoreError('ファイルが見つかりません。', 404);
  const { data } = await db
    .from('rms_partner_documents')
    .select('id, storage_path, uploaded_by_kind, uploaded_by_account')
    .eq('id', documentId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (!data) throw new PartnerStoreError('ファイルが見つかりません。', 404);
  if (opts.onlyAccountId && !(data.uploaded_by_kind === 'partner' && data.uploaded_by_account === opts.onlyAccountId)) {
    throw new PartnerStoreError('ご自身で保存したファイルだけ削除できます。', 403);
  }
  const { error } = await db.from('rms_partner_documents').delete().eq('id', documentId).eq('partner_id', partnerId);
  if (error) throw new PartnerStoreError(`ファイルを削除できませんでした（${error.message}）`, 500, 'db_error');
  const { error: rmErr } = await db.storage.from(PARTNER_DOCUMENT_BUCKET).remove([String(data.storage_path)]);
  // 台帳は消えているので画面には出ない。実体だけ残るので記録しておく
  if (rmErr) console.error('[partner-documents] 実体の削除に失敗', data.storage_path, rmErr.message);
}

// 取引先の削除前に、その取引先のファイル実体をまとめて消す（台帳は FK cascade で消えるが実体は残るため）。
export async function removeAllPartnerDocumentFiles(db: SupabaseClient, partnerId: string): Promise<void> {
  const { data } = await db.from('rms_partner_documents').select('storage_path').eq('partner_id', partnerId);
  const paths = (data ?? []).map((r) => String(r.storage_path)).filter((p) => p.startsWith(`${partnerId}/`));
  if (!paths.length) return;
  const { error } = await db.storage.from(PARTNER_DOCUMENT_BUCKET).remove(paths);
  if (error) console.error('[partner-documents] 取引先削除時の実体削除に失敗', partnerId, error.message);
}

// RFC 5987 の attr-char に収める（encodeURIComponent が残す ! ' ( ) * も符号化する）
const encodeRfc5987 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// ダウンロード応答（取引先ページ・管理画面で共通。取引先予約の添付ファイルでも使う）。日本語のファイル名は RFC 5987 で渡す。
export function documentResponse(doc: Pick<PartnerDocumentRow, 'file_name' | 'mime_type'>, body: Blob, extraHeaders: Record<string, string> = {}): Response {
  const ascii = doc.file_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  // PDF と表示できる画像はブラウザで開く。それ以外（HEIC・Office 等）は保存させる（2026-10-07: HEIC を inline から外した）
  const inline = isInlineAttachment(doc.mime_type);
  return new Response(body, {
    headers: {
      ...extraHeaders,
      'content-type': doc.mime_type ?? 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(doc.file_name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store'
    }
  });
}

export const formatBytes = (n: number | null) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
