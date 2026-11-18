// 取引先向けメールは Cloudflare Email Sending で送信し、返信は施設の予約窓口で受ける。
// 施設名は件名や本文で使う。
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendHtmlEmail, type MailAttachment, type SendEmailResult } from '$lib/server/mailer';

export type PartnerMailSender = { fromName: string; replyTo: string | null };

// 施設ごとに isolate 内で10分だけ覚える（取引先予約のたびに同じ行を読みに行かない）。
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: PartnerMailSender }>();

const FALLBACK_NAME = '山人';

export async function partnerMailSender(db: SupabaseClient, facilityId: string): Promise<PartnerMailSender> {
  const hit = cache.get(facilityId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [fac, settings] = await Promise.all([
    db.schema('core').from('facilities').select('name').eq('id', facilityId).maybeSingle(),
    // password 等は読まない（差出人アドレスと有効かどうかだけ）
    db.schema('pms').from('mail_settings').select('from_address, is_active').eq('facility_id', facilityId).maybeSingle()
  ]);
  const name = String((fac.data as { name?: string } | null)?.name ?? '').trim();
  const s = settings.data as { from_address?: string | null; is_active?: boolean } | null;
  const replyTo = s?.is_active && s.from_address && /^[^\s@]+@[^\s@]+$/.test(s.from_address) ? s.from_address : null;
  const value = { fromName: name || FALLBACK_NAME, replyTo };
  // 読めなかったとき（一時的なエラー）は覚えない
  if (!fac.error && !settings.error) cache.set(facilityId, { at: Date.now(), value });
  return value;
}

/**
 * 取引先宛ての返信は施設の予約窓口で受ける。
 */
export async function sendPartnerMail(
  db: SupabaseClient,
  facilityId: string,
  args: { to: string[]; subject: string; html: string; text: string; attachments?: MailAttachment[] }
): Promise<SendEmailResult> {
  const sender = await partnerMailSender(db, facilityId);
  return sendHtmlEmail({ ...args, replyTo: sender.replyTo ?? undefined });
}

/** 宿（スタッフ）宛ての通知。 */
export async function sendFacilityNotice(
  args: { to: string[]; subject: string; html: string; text: string }
): Promise<SendEmailResult> {
  return sendHtmlEmail(args);
}
