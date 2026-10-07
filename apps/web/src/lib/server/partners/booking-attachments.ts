// 取引先予約の添付ファイル（2026-10-07・設計 docs/partner-booking-attachments.md）。
//
// 台帳 public.rms_partner_booking_attachments と、PMS と共用のバケット reservation-attachments の partner-booking/ 配下。
// どちらも service_role 専用（autumn-shared 20261007022950）。ここの関数は入口の検証を済ませた呼び出し側からだけ使う:
//   - 取引先ページ: requirePortalApi / requirePortalSession（限定URL＋セッション・確認モードは GET 以外を断る）で partner を確定してから
//   - 管理画面: admin-reservations.ts の partnerAttachmentTarget（スタッフの施設アクセス）で partner を確定してから
// どの関数も partner.id で絞り込み、別の取引先の予約・添付には触れない（添付は id ＋ partner_id ＋ partner_booking_id の3条件）。
//
// PMS への反映: Book は pms スキーマを書かない。画面が追加・削除のあとに notifyBookingAttachments を1回呼ぶと、
// DB 関数 rms_partner_emit_attachments_event が attachments 電文を出し、PMS の取込が写しの行を作り・消す。
// 呼べなかった分は掃除の cron（maintainBookingAttachments）が attachments_updated_at > attachments_notified_at の予約を拾って出す。
//
// 有効化は環境変数 PARTNER_BOOKING_ATTACHMENTS（既定 off・§11-N10）。off のあいだは画面に出さず、API は 404。
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attachmentChangeOf,
  attachmentPolicyOf,
  attachmentsFlagOn,
  checkAttachmentFile,
  formatAttachmentSize,
  MAX_ATTACHMENTS_PER_BOOKING,
  STAGED_ATTACHMENT_TTL_HOURS,
  type AttachmentPolicy
} from '$lib/partner-attachments';
import { PartnerStoreError, todayJst, type PartnerRow } from './store';

/** PMS の添付と同じバケット（§5.2・N1）。設定（サイズ・種別の制限）は PMS の添付に効くので変えない */
export const BOOKING_ATTACHMENT_BUCKET = 'reservation-attachments';
const PATH_PREFIX = 'partner-booking';

export const partnerBookingAttachmentsEnabled = () => attachmentsFlagOn(env.PARTNER_BOOKING_ATTACHMENTS);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookingAttachmentRow = {
  id: string;
  partner_id: string;
  partner_booking_id: string | null;
  file_name: string;
  mime_type: string;
  byte_size: number;
  storage_path: string;
  uploaded_by_kind: 'partner' | 'staff';
  uploaded_by_account: string | null;
  uploaded_by_label: string | null;
  note: string | null;
  created_at: string;
};

const ATT_COLUMNS =
  'id, partner_id, partner_booking_id, file_name, mime_type, byte_size, storage_path, uploaded_by_kind, uploaded_by_account, uploaded_by_label, note, created_at';

export type AttachmentUploader =
  | { kind: 'staff'; userId: string | null; label: string | null }
  | { kind: 'partner'; accountId: string; label: string };

/** 添付先: 予約（id）か、予約入力中の仮置き（そのログインIDの未束縛） */
export type AttachmentTarget = { bookingId: string } | { stagedFor: string };

/** 添付先の予約（状態の判定に要る列だけ。partner_id で絞る） */
export type AttachmentBooking = { id: string; partner_id: string; status: string; check_out_date: string; booking_code: string };

export async function getAttachmentBooking(db: SupabaseClient, partnerId: string, bookingId: string): Promise<AttachmentBooking | null> {
  if (!UUID_RE.test(bookingId)) return null;
  const { data } = await db
    .from('rms_partner_bookings')
    .select('id, partner_id, status, check_out_date, booking_code')
    .eq('id', bookingId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  return (data as AttachmentBooking | null) ?? null;
}

/** 予約の状態ごとの追加・削除の可否（今日は JST） */
export const bookingAttachmentPolicy = (b: Pick<AttachmentBooking, 'status' | 'check_out_date'>): AttachmentPolicy => attachmentPolicyOf(b, todayJst());

function dbError(what: string, e: { message: string }): PartnerStoreError {
  return new PartnerStoreError(`${what}（${e.message}）`, 500, 'db_error');
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------

/** 予約ごとの添付（古い順）。予約一覧で一度に引く（partner_id で絞る） */
export async function listBookingAttachments(db: SupabaseClient, partnerId: string, bookingIds: string[]): Promise<Map<string, BookingAttachmentRow[]>> {
  const out = new Map<string, BookingAttachmentRow[]>();
  const ids = [...new Set(bookingIds.filter((id) => UUID_RE.test(id)))];
  if (!ids.length) return out;
  // URL の長さを抑えるため 100 件ずつ
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from('rms_partner_booking_attachments')
      .select(ATT_COLUMNS)
      .eq('partner_id', partnerId)
      .in('partner_booking_id', ids.slice(i, i + 100))
      .order('created_at', { ascending: true });
    if (error) throw dbError('添付ファイルの一覧を読み込めませんでした', error);
    for (const r of (data ?? []) as BookingAttachmentRow[]) {
      const k = r.partner_booking_id as string;
      out.set(k, [...(out.get(k) ?? []), r]);
    }
  }
  return out;
}

/**
 * このログインIDの仮置き（未束縛）の添付（古い順）。予約入力を開き直したとき・別のタブで上げたときも欄に出し、
 * 消す・そのまま予約に使うができるようにする（見えない仮置きで 10件・50MB の上限が埋まらないように）。
 * 掃除で消える前（24時間以内）のものだけ。読めなければ空
 */
export async function listStagedAttachments(db: SupabaseClient, partnerId: string, accountId: string): Promise<BookingAttachmentRow[]> {
  const since = new Date(Date.now() - STAGED_ATTACHMENT_TTL_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from('rms_partner_booking_attachments')
    .select(ATT_COLUMNS)
    .eq('partner_id', partnerId)
    .eq('uploaded_by_account', accountId)
    .is('partner_booking_id', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(MAX_ATTACHMENTS_PER_BOOKING * 2);
  if (error) return [];
  return (data ?? []) as BookingAttachmentRow[];
}

/** 予約ごとの件数（管理画面の取引先の予約一覧の 📎 N）。読めなければ空 */
export async function countBookingAttachments(db: SupabaseClient, partnerId: string, bookingIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    for (const [k, rows] of await listBookingAttachments(db, partnerId, bookingIds)) out.set(k, rows.length);
  } catch {
    // 件数は補助情報
  }
  return out;
}

/** メールの「添付ファイル: …」の行に使う名前（予約に結ばれたもの）。無効・読めなければ空 */
export async function bookingAttachmentNames(db: SupabaseClient, partnerId: string | null, bookingId: string): Promise<string[]> {
  if (!partnerBookingAttachmentsEnabled() || !partnerId) return [];
  try {
    return ((await listBookingAttachments(db, partnerId, [bookingId])).get(bookingId) ?? []).map((r) => r.file_name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 追加
// ---------------------------------------------------------------------------

async function existingOf(db: SupabaseClient, partnerId: string, target: AttachmentTarget): Promise<{ count: number; bytes: number }> {
  let q = db.from('rms_partner_booking_attachments').select('byte_size').eq('partner_id', partnerId);
  // 仮置きは予約入力の欄に出るもの（listStagedAttachments と同じ 24 時間以内）だけを数える（掃除待ちの古い行で上限を埋めない）
  q =
    'bookingId' in target
      ? q.eq('partner_booking_id', target.bookingId)
      : q
          .is('partner_booking_id', null)
          .eq('uploaded_by_account', target.stagedFor)
          .gte('created_at', new Date(Date.now() - STAGED_ATTACHMENT_TTL_HOURS * 3600 * 1000).toISOString());
  const { data, error } = await q.limit(MAX_ATTACHMENTS_PER_BOOKING * 5);
  if (error) throw dbError('添付ファイルを確認できませんでした', error);
  const rows = (data ?? []) as { byte_size: number }[];
  return { count: rows.length, bytes: rows.reduce((s, r) => s + Number(r.byte_size || 0), 0) };
}

/**
 * 1ファイルを保存する（1リクエスト1ファイル・サーバ中継・§6.3）。予約に付けるときは状態を呼び出し側で確かめてから。
 * 実体 → 台帳の順に書き、台帳に書けなければ実体を消す（孤児を残さない）。
 */
export async function uploadBookingAttachment(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'tenant_id' | 'facility_id'>,
  file: File,
  by: AttachmentUploader,
  target: AttachmentTarget,
  note = ''
): Promise<BookingAttachmentRow> {
  if (!(file instanceof File)) throw new PartnerStoreError('ファイルを選んでください。');
  const check = checkAttachmentFile(file, await existingOf(db, partner.id, target));
  if (!check.ok) throw new PartnerStoreError(check.message);

  // 予約 id をパスに含めない（仮置き → 確定時の束縛を行の更新だけで済ませるため・§5.2）
  const path = `${PATH_PREFIX}/${partner.facility_id}/${partner.id}/${crypto.randomUUID()}.${check.ext}`;
  const { error: upErr } = await db.storage.from(BOOKING_ATTACHMENT_BUCKET).upload(path, file, { contentType: check.mime, upsert: false });
  if (upErr) throw new PartnerStoreError(`ファイルを保存できませんでした（${upErr.message}）`, 500, 'storage_error');

  const { data, error } = await db
    .from('rms_partner_booking_attachments')
    .insert({
      tenant_id: partner.tenant_id,
      facility_id: partner.facility_id,
      partner_id: partner.id,
      partner_booking_id: 'bookingId' in target ? target.bookingId : null,
      file_name: check.fileName,
      mime_type: check.mime,
      byte_size: file.size,
      storage_path: path,
      uploaded_by_kind: by.kind,
      uploaded_by_staff: by.kind === 'staff' ? by.userId : null,
      uploaded_by_account: by.kind === 'partner' ? by.accountId : null,
      uploaded_by_label: (by.label ?? '').slice(0, 120) || null,
      note: note.trim().slice(0, 200) || null
    })
    .select(ATT_COLUMNS)
    .single();
  if (error) {
    await db.storage.from(BOOKING_ATTACHMENT_BUCKET).remove([path]);
    throw dbError('ファイルを保存できませんでした', error);
  }
  return data as BookingAttachmentRow;
}

/** アップロードの本文の上限（1ファイル 20MB＋multipart の枠の余裕 1MB） */
export const MAX_UPLOAD_REQUEST_BYTES = 21 * 1024 * 1024;

/**
 * 本文を読む前（formData() はメモリに丸ごと載せる・Worker は 128MB）に content-length で大きすぎる送信を断る（413）。
 * content-length が無い送信はここでは通し、読んだ後のファイルのサイズ検査（checkAttachmentFile）で断る。
 */
export function rejectOversizedUpload(request: Request, headers: Record<string, string> = {}): Response | null {
  const len = Number(request.headers.get('content-length') ?? '');
  if (!Number.isFinite(len) || len <= MAX_UPLOAD_REQUEST_BYTES) return null;
  return json({ ok: false, message: '1ファイル 20MB までです。' }, { status: 413, headers });
}

// ---------------------------------------------------------------------------
// 取得・削除
// ---------------------------------------------------------------------------

/** 添付1件（id ＋ partner_id ＋ 添付先の3条件）。別の取引先・別の予約の id なら null */
export async function getBookingAttachment(
  db: SupabaseClient,
  partnerId: string,
  attachmentId: string,
  target: AttachmentTarget
): Promise<BookingAttachmentRow | null> {
  if (!UUID_RE.test(attachmentId)) return null;
  let q = db.from('rms_partner_booking_attachments').select(ATT_COLUMNS).eq('id', attachmentId).eq('partner_id', partnerId);
  q = 'bookingId' in target ? q.eq('partner_booking_id', target.bookingId) : q.is('partner_booking_id', null).eq('uploaded_by_account', target.stagedFor);
  const { data } = await q.maybeSingle();
  return (data as BookingAttachmentRow | null) ?? null;
}

/** ダウンロード（本文はサーバが中継する。署名URLを外へ出さない） */
export async function downloadBookingAttachment(
  db: SupabaseClient,
  partnerId: string,
  attachmentId: string,
  target: AttachmentTarget
): Promise<{ row: BookingAttachmentRow; body: Blob } | null> {
  const row = await getBookingAttachment(db, partnerId, attachmentId, target);
  if (!row) return null;
  const { data: body, error } = await db.storage.from(BOOKING_ATTACHMENT_BUCKET).download(row.storage_path);
  if (error || !body) throw new PartnerStoreError(`ファイルを読み込めませんでした${error?.message ? `（${error.message}）` : ''}`, 500, 'storage_error');
  return { row, body };
}

/**
 * 削除（台帳 → 実体）。権限（誰が消せるか）・予約の状態は呼び出し側で確かめてから。
 * 実体の削除に失敗しても台帳は消えている（画面・PMS の同期からは消える）ので、記録だけ残す。
 */
export async function deleteBookingAttachment(db: SupabaseClient, row: BookingAttachmentRow): Promise<void> {
  const { error } = await db.from('rms_partner_booking_attachments').delete().eq('id', row.id).eq('partner_id', row.partner_id);
  if (error) throw dbError('ファイルを削除できませんでした', error);
  await removeObjects(db, [row.storage_path], row.partner_id);
}

// partner-booking/<facility>/<partner>/ の配下だけを消す（PMS の手動アップロードや事前応対記録の実体には触れない）
async function removeObjects(db: SupabaseClient, paths: string[], partnerId: string | null): Promise<boolean> {
  const safe = paths.filter((p) => p.startsWith(`${PATH_PREFIX}/`) && (!partnerId || p.split('/')[2] === partnerId));
  if (!safe.length) return true;
  const { error } = await db.storage.from(BOOKING_ATTACHMENT_BUCKET).remove(safe);
  if (error) console.error('[partner-booking-attachments] 実体の削除に失敗', safe.length, error.message);
  return !error;
}

// ---------------------------------------------------------------------------
// PMS への通知（attachments 電文）
// ---------------------------------------------------------------------------

/**
 * 添付だけの変更を PMS へ知らせる（画面が追加・削除のあとに1回）。new を出す前の予約・変化の無い予約には
 * DB 関数が出さない（null）。added / removed は通知の文面の材料（同期は電文の全件で行う）。
 */
export async function notifyBookingAttachments(
  db: SupabaseClient,
  bookingId: string,
  change: { added?: unknown; removed?: unknown },
  by: { kind: 'partner' | 'staff'; label: string | null }
): Promise<{ sent: boolean }> {
  const { data, error } = await db.rpc('rms_partner_emit_attachments_event', {
    p_partner_booking_id: bookingId,
    p_extra: attachmentChangeOf(change, by)
  });
  if (error) throw dbError('宿（PMS）へ知らせることができませんでした', error);
  return { sent: !!data };
}

// ---------------------------------------------------------------------------
// 掃除（cron）・取引先の削除
// ---------------------------------------------------------------------------

/**
 * 掃除の cron（/api/cron/partner-charge に相乗り）:
 *   1. 古い仮置き（24時間）・PMS へ送らずに終わった予約の添付（7日）を、条件を確かめ直して行 → 実体の順に消す
 *   2. 画面が通知できなかった変化（attachments_updated_at > attachments_notified_at）を attachments 電文で知らせ直す
 * 無効（PARTNER_BOOKING_ATTACHMENTS=false）でも 1 は行う（有効だった時期の残りを消すため）。2 は有効のときだけ。
 */
export async function maintainBookingAttachments(db: SupabaseClient): Promise<{ removed: number; notified: number; errors: number }> {
  const result = { removed: 0, notified: 0, errors: 0 };
  const { data: orphans, error } = await db.rpc('rms_partner_attachment_orphans', { p_older_than: `${STAGED_ATTACHMENT_TTL_HOURS} hours` });
  if (error) {
    // 表・関数が無い（migration 未適用）環境では何もしない
    console.warn('[partner-booking-attachments] 掃除の対象を読めませんでした:', error.message);
    result.errors += 1;
    return result;
  }
  const rows = (orphans ?? []) as { id: string; storage_path: string; reason: 'unbound' | 'unsent' }[];
  // 一覧を読んでから消すまでの間に、仮置きが予約に結ばれる（予約の確定）ことがある。対象を読み直した条件で
  // 行を先に消し（returning で確定した行だけ）、その行の実体を消す。実体の削除に失敗したときは記録だけ残す
  // （行はもう無いので画面・PMS の同期には出ない。束縛された添付の実体を消してしまう方が害が大きい）。
  const removedRows: { id: string; storage_path: string }[] = [];
  const unbound = rows.filter((r) => r.reason === 'unbound').map((r) => r.id);
  for (let i = 0; i < unbound.length; i += 100) {
    const { data, error: delErr } = await db
      .from('rms_partner_booking_attachments')
      .delete()
      .in('id', unbound.slice(i, i + 100))
      .is('partner_booking_id', null)
      .select('id, storage_path');
    if (delErr) result.errors += 1;
    else removedRows.push(...((data ?? []) as { id: string; storage_path: string }[]));
  }
  const unsent = rows.filter((r) => r.reason === 'unsent').map((r) => r.id);
  for (let i = 0; i < unsent.length; i += 100) {
    const ids = unsent.slice(i, i + 100);
    // 予約の状態を読み直す（期限切れ・取消は終わった状態なので、ここで確かめた予約の行だけを消す）
    const { data: atts } = await db.from('rms_partner_booking_attachments').select('id, partner_booking_id').in('id', ids);
    const bookingIds = [...new Set(((atts ?? []) as { partner_booking_id: string | null }[]).map((a) => a.partner_booking_id).filter((x): x is string => !!x))];
    if (!bookingIds.length) continue;
    const { data: done } = await db.from('rms_partner_bookings').select('id').in('id', bookingIds).in('status', ['expired', 'cancelled']);
    const doneIds = ((done ?? []) as { id: string }[]).map((b) => b.id);
    if (!doneIds.length) continue;
    const { data, error: delErr } = await db
      .from('rms_partner_booking_attachments')
      .delete()
      .in('id', ids)
      .in('partner_booking_id', doneIds)
      .select('id, storage_path');
    if (delErr) result.errors += 1;
    else removedRows.push(...((data ?? []) as { id: string; storage_path: string }[]));
  }
  for (let i = 0; i < removedRows.length; i += 100) {
    if (!(await removeObjects(db, removedRows.slice(i, i + 100).map((r) => r.storage_path), null))) result.errors += 1;
  }
  result.removed = removedRows.length;

  if (partnerBookingAttachmentsEnabled()) {
    // 変化があって未通知の予約（列どうしの比較は PostgREST でできないので、変化のあった最近の予約を引いてここで比べる）
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const { data: pending } = await db
      .from('rms_partner_bookings')
      .select('id, attachments_updated_at, attachments_notified_at')
      .gte('attachments_updated_at', since)
      .limit(500);
    for (const b of (pending ?? []) as { id: string; attachments_updated_at: string; attachments_notified_at: string | null }[]) {
      // 時刻は文字列でなく Date.parse で比べる（PostgREST の表記・桁の違いで順序を取り違えない）
      if (b.attachments_notified_at && Date.parse(b.attachments_notified_at) >= Date.parse(b.attachments_updated_at)) continue;
      try {
        const r = await notifyBookingAttachments(db, b.id, {}, { kind: 'staff', label: '自動（未通知の変更）' });
        if (r.sent) result.notified += 1;
      } catch {
        result.errors += 1;
      }
    }
  }
  return result;
}

/** 取引先の削除前に、その取引先の添付の実体をまとめて消す（台帳は FK cascade で消えるが実体は残るため） */
export async function removeAllBookingAttachmentFiles(db: SupabaseClient, partnerId: string): Promise<void> {
  const { data, error } = await db.from('rms_partner_booking_attachments').select('storage_path').eq('partner_id', partnerId);
  // 表が無い（migration 未適用）なら何もしない
  if (error || !data?.length) return;
  const paths = data.map((r) => String(r.storage_path));
  for (let i = 0; i < paths.length; i += 100) await removeObjects(db, paths.slice(i, i + 100), partnerId);
}

// ---------------------------------------------------------------------------
// 画面に渡す形
// ---------------------------------------------------------------------------

export type AttachmentView = {
  id: string;
  fileName: string;
  mime: string;
  bytes: number;
  size: string;
  /** 「貴社（jtb-sendai）」「宿（山田）」 */
  uploader: string;
  byPartner: boolean;
  createdAt: string;
  canDelete: boolean;
  /** ダウンロードの URL（サーバ中継） */
  href: string;
};

export function attachmentView(
  r: BookingAttachmentRow,
  opts: { href: string; canDelete: boolean; audience: 'partner' | 'staff' }
): AttachmentView {
  const label = r.uploaded_by_label ?? '';
  return {
    id: r.id,
    fileName: r.file_name,
    mime: r.mime_type,
    bytes: Number(r.byte_size) || 0,
    size: formatAttachmentSize(Number(r.byte_size)),
    uploader:
      r.uploaded_by_kind === 'staff'
        ? opts.audience === 'partner'
          ? '宿'
          : `宿（${label || 'スタッフ'}）`
        : opts.audience === 'partner'
          ? `貴社（${label || 'ログインID 不明'}）`
          : `取引先（${label || 'ログインID 不明'}）`,
    byPartner: r.uploaded_by_kind === 'partner',
    createdAt: r.created_at,
    canDelete: opts.canDelete,
    href: opts.href
  };
}
