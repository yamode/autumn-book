// 取引先予約の添付ファイル（2026-10-07・設計 docs/partner-booking-attachments.md）の純関数。
// ファイルの種類・サイズ・件数の検査、予約の状態ごとに「追加・削除できるか」、取引先の削除権限、表示の整形。
// サーバ（lib/server/partners/booking-attachments.ts）と画面の両方から使う（DB・Storage には触れない）。

/** 1ファイルの上限（PMS の添付・覚書のファイルと同じ 20MB） */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** 1予約あたりの件数・合計（§11-N8: 10件・50MB。DB の上限ではなくサーバの定数） */
export const MAX_ATTACHMENTS_PER_BOOKING = 10;
export const MAX_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;
/** チェックアウトから何日まで追加・削除できるか（§11-N4: 90日） */
export const ATTACHMENT_EDIT_DAYS_AFTER_CHECKOUT = 90;
/** 予約入力中の仮置きを何時間残すか（掃除の cron が消す） */
export const STAGED_ATTACHMENT_TTL_HOURS = 24;

// 受け付けるファイル（覚書のファイルの表から zip を外したもの・§11-N9）。拡張子で判定し、保存時の Content-Type もここから決める
// （クライアントの file.type は使わない）。HTML・SVG・XML・実行形式・マクロ付き Office（xlsm・docm）は入れない。
const ATTACHMENT_TYPES: Record<string, string> = {
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
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

/** <input type="file" accept> に渡す値 */
export const PARTNER_ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((e) => `.${e}`)
  .join(',');

/** 画面の説明文（予約入力・予約一覧・管理画面で同じ文言） */
export const PARTNER_ATTACHMENT_HINT = `PDF・画像・Word・Excel・PowerPoint・CSV・テキスト（1ファイル 20MB・1予約 ${MAX_ATTACHMENTS_PER_BOOKING}件・合計 50MB まで）。`;

const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toLowerCase();

/** 拡張子から種類を決める（許可リストに無ければ null） */
export function attachmentTypeOf(fileName: string): { ext: string; mime: string } | null {
  const ext = extOf(fileName);
  const mime = ATTACHMENT_TYPES[ext];
  return mime ? { ext, mime } : null;
}

/** ファイル名からパス区切り・制御文字を除く（表示・ダウンロード名用。保存キーには使わない・120文字） */
export const safeAttachmentName = (name: string) =>
  name
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(-120) || 'file';

export type AttachmentCheck =
  | { ok: true; fileName: string; ext: string; mime: string }
  | { ok: false; message: string };

/**
 * 上げようとしているファイルを検査する。existing は同じ予約（仮置きなら同じログインIDの仮置き）に既にある分。
 * 順番: 空 → 種類 → 1ファイルのサイズ → 件数 → 合計（理由が分かりやすいものから）
 */
export function checkAttachmentFile(
  file: { name: string; size: number },
  existing: { count: number; bytes: number }
): AttachmentCheck {
  if (!file.size || file.size <= 0) return { ok: false, message: '空のファイルは添付できません。' };
  const fileName = safeAttachmentName(file.name);
  const t = attachmentTypeOf(fileName);
  if (!t) {
    return { ok: false, message: 'この種類のファイルは添付できません（PDF・画像・Word・Excel・PowerPoint・CSV・テキスト）。' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: '1ファイル 20MB までです。' };
  if (existing.count >= MAX_ATTACHMENTS_PER_BOOKING) {
    return { ok: false, message: `添付ファイルは1予約 ${MAX_ATTACHMENTS_PER_BOOKING}件までです。` };
  }
  if (existing.bytes + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, message: '添付ファイルは1予約 合計 50MB までです。' };
  }
  return { ok: true, fileName, ext: t.ext, mime: t.mime };
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type AttachmentPolicy = {
  canAdd: boolean;
  canDelete: boolean;
  /** 追加できないときの理由（画面の注記）。追加できるときは null */
  note: string | null;
};

/**
 * 予約の状態ごとに、添付の追加・削除ができるか（§9.3）。閲覧・ダウンロードはいつでもできる。
 *   確定・支払待ち（チェックイン済みを含む）… 追加・削除○（チェックアウトから 90 日まで）
 *   取消済み … 追加×・削除○（名簿等を後から参照することがあるので消さない。整理のための削除はできる）
 *   期限切れ … 追加×・削除×（7日後に掃除で消える）
 */
export function attachmentPolicyOf(b: { status: string; check_out_date: string }, today: string): AttachmentPolicy {
  if (b.status === 'expired') {
    return { canAdd: false, canDelete: false, note: 'お支払い期限切れのご予約です。添付ファイルは7日後に削除されます。' };
  }
  if (b.status === 'cancelled') return { canAdd: false, canDelete: true, note: '取消済みのご予約には添付ファイルを追加できません。' };
  if (b.status !== 'confirmed' && b.status !== 'pending_payment') return { canAdd: false, canDelete: false, note: null };
  if (today > addDays(b.check_out_date, ATTACHMENT_EDIT_DAYS_AFTER_CHECKOUT)) {
    return {
      canAdd: false,
      canDelete: false,
      note: `チェックアウトから ${ATTACHMENT_EDIT_DAYS_AFTER_CHECKOUT}日を過ぎたご予約の添付ファイルは変更できません。`
    };
  }
  return { canAdd: true, canDelete: true, note: null };
}

/**
 * 取引先（取引先ページ）がその添付を削除できるか（§9.2・§11-N3: 自分の分＋マスターは同じ取引先の全件）。
 * 宿（スタッフ）が付けたファイルは取引先からは消せない（宿の管理画面から消す）。
 */
export function partnerCanDeleteAttachment(
  a: { uploaded_by_kind: string; uploaded_by_account: string | null },
  session: { id: string; is_master?: boolean }
): boolean {
  if (a.uploaded_by_kind !== 'partner') return false;
  return session.is_master === true || a.uploaded_by_account === session.id;
}

/** 表示用のサイズ（48 KB・1.2 MB） */
export const formatAttachmentSize = (n: number | null | undefined) =>
  n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/**
 * ブラウザで開く（inline）種類か。PDF と、ブラウザが表示できる画像（png・jpeg・gif・webp）だけ。
 * SVG（スクリプトを含みうる）と HEIC（多くのブラウザで表示できない）は保存させる（attachment）
 */
export const isInlineAttachment = (mime: string | null | undefined) =>
  !!mime && /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(mime);

/** メール・確認画面の1行（「添付ファイル: 名簿.xlsx, 行程表.pdf」）。無ければ null */
export function attachmentLine(names: string[], suffix = ''): string | null {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (!list.length) return null;
  return `添付ファイル: ${list.join(', ')}${suffix}`;
}

/**
 * attachments 電文の attachment_change（通知の文面の材料）を整える。
 * 画面から来た名前の配列は信用しない（長さ・件数を切る）。同期には使わないので中身の真偽は問わない。
 */
export function attachmentChangeOf(
  input: { added?: unknown; removed?: unknown },
  by: { kind: 'partner' | 'staff'; label: string | null },
  at = new Date()
): { added: string[]; removed: string[]; by_kind: 'partner' | 'staff'; by_label: string | null; at: string } {
  const names = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === 'string')
      .map((x) => safeAttachmentName(x))
      .slice(0, MAX_ATTACHMENTS_PER_BOOKING * 2);
  return { added: names(input.added), removed: names(input.removed), by_kind: by.kind, by_label: (by.label ?? '').slice(0, 120) || null, at: at.toISOString() };
}

/** 環境変数 PARTNER_BOOKING_ATTACHMENTS の値を ON/OFF に（既定 off・§11-N10） */
export const attachmentsFlagOn = (v: string | null | undefined) => ['true', '1', 'on'].includes(String(v ?? '').trim().toLowerCase());

/** 送られてきた添付 id の並び（カンマ区切り）を uuid だけに絞る（重複を除き最大 10 件） */
export function parseAttachmentIds(raw: string): string[] {
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s));
  return [...new Set(ids)].slice(0, MAX_ATTACHMENTS_PER_BOOKING);
}
