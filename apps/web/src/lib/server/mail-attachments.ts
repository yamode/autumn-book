// メールの添付ファイル（Cloudflare Email Sending REST の attachments）を組み立てる純関数。
// mailer.ts は $env を読むのでテストしにくい。組み立てと上限の判定だけをここに切り出してテストする（mail-attachments.test.ts）。
//
// REST の形: attachments: [{ content: <base64>, filename, type: <MIME>, disposition: 'attachment' }]
// 上限: 添付の合計（元のバイト数）で 5MiB。超えるときは送らずに理由を返す（呼び出し側で添付なしに切り替える）。

export const MAX_ATTACHMENT_TOTAL_BYTES = 5 * 1024 * 1024;

export type MailAttachment = {
  filename: string;
  /** MIME（例: application/pdf） */
  type: string;
  /** 中身。Uint8Array ならここで base64 にする */
  content: Uint8Array;
};

export type RestAttachment = { content: string; filename: string; type: string; disposition: 'attachment' };

/** バイト列を base64 に（Workers / Node どちらでも動くよう btoa を小分けで使う）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 添付の合計バイト数（元のサイズ）。 */
export const attachmentsTotalBytes = (list: MailAttachment[]) => list.reduce((s, a) => s + a.content.byteLength, 0);

/** 添付できる大きさか（合計 5MiB 以内）。 */
export const fitsAttachmentLimit = (list: MailAttachment[], limit = MAX_ATTACHMENT_TOTAL_BYTES) => attachmentsTotalBytes(list) <= limit;

// ファイル名からヘッダを壊しうる文字（改行・制御文字・パス区切り・引用符）を除く
const safeFilename = (name: string) =>
  name
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '')
    .trim()
    .slice(0, 150) || 'attachment';

/**
 * REST に渡す attachments を作る。空なら undefined（キーごと送らない）。
 * 合計が上限を超えるときは { error } を返す。
 */
export function buildRestAttachments(
  list: MailAttachment[] | undefined,
  limit = MAX_ATTACHMENT_TOTAL_BYTES
): { attachments?: RestAttachment[]; error?: string } {
  if (!list?.length) return {};
  const total = attachmentsTotalBytes(list);
  if (total > limit) return { error: `attachments-too-large: ${total}bytes > ${limit}bytes` };
  return {
    attachments: list.map((a) => ({
      content: bytesToBase64(a.content),
      filename: safeFilename(a.filename),
      type: a.type || 'application/octet-stream',
      disposition: 'attachment' as const
    }))
  };
}
