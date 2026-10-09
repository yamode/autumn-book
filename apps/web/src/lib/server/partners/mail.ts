// 取引先向けメール（予約確認・取消・請求失敗・パスワード設定）の差出人を、Book の直販予約メールに揃える。
//
// Book の直販予約メール（book.mail_outbox → Edge Function send-booking-mail）は
//   - 差出人名 = core.facilities.name（「山人-yamado-」「山人-oga-」）
//   - 差出人アドレス = pms.mail_settings.from_address（reservation@yamado.co.jp 等・Xserver SMTP）
// で送っている（autumn-shared/supabase/functions/send-booking-mail/index.ts）。
//
// 取引先メールは送信経路を mail_outbox に寄せず、今の Cloudflare Email Sending（mailer.ts）のまま、
// 差出人名と返信先だけを揃える。理由:
//   - mail_outbox は kind が CHECK（booking_confirmation / booking_cancelled）で、booking_id も book 側の予約に
//     紐づく設計。取引先予約（rms_partner_bookings）やパスワード設定を載せるには DB と Edge Function の改修が要る。
//   - パスワード設定リンク（1回限りのトークン）を outbox の body_text に残したくない。
//   - Cloudflare Email Sending は Cloudflare に載せたドメイン（yamado.app）からしか送れない。yamado.co.jp の
//     アドレスを From にすると SPF/DKIM が合わず届かなくなるため、アドレスは REPORT_EMAIL_FROM のまま、
//     返信（Reply-To）を施設の予約用アドレスにする。取引先が返信すると施設の予約窓口に届く。
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
 * 取引先宛て: 差出人名 = 施設名・返信先 = 施設の予約用アドレス。
 * args.fromName を渡すと差出人名だけ差し替える（全施設分1枚の月次請求書は発行者名・2026-10-09 §7.11）。
 */
export async function sendPartnerMail(
  db: SupabaseClient,
  facilityId: string,
  args: { to: string[]; subject: string; html: string; text: string; attachments?: MailAttachment[]; fromName?: string }
): Promise<SendEmailResult> {
  const sender = await partnerMailSender(db, facilityId);
  return sendHtmlEmail({ ...args, fromName: args.fromName?.trim() || sender.fromName, replyTo: sender.replyTo ?? undefined });
}

/** 宿（スタッフ）宛ての通知: 差出人名だけ施設名にする（返信先は付けない）。 */
export async function sendFacilityNotice(
  db: SupabaseClient,
  facilityId: string,
  args: { to: string[]; subject: string; html: string; text: string }
): Promise<SendEmailResult> {
  const sender = await partnerMailSender(db, facilityId);
  return sendHtmlEmail({ ...args, fromName: sender.fromName });
}
