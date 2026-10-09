// 取引先ページの「ユーザー管理」（マスタユーザーが子ユーザーを作る）で送るパスワード設定メール。2026-10-01 追加。
// スタッフ用の sendSetupEmail（staff.ts）は宛名が取引先名・本文が「宿が発行した」前提なので、子ユーザー向けに別に持つ。
// 送信経路は他の取引先メールと同じ（差出人名 = 施設名・返信先 = 施設の予約用アドレス）。
// 複数施設化（2026-10-09 S5b・§7.11）: 差出人は既定の施設（primary_facility_id）、オンの施設が2つ以上なら本文に列挙（setup-brand.ts）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyId } from './crypto';
import { sendPartnerMail } from './mail';
import { childLoginIdPrefix, partnerSetupBrand } from './setup-brand';
import { SETUP_TOKEN_TTL_HOURS, type PartnerContext } from './store';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * ログインIDの自動採番: 接頭辞 + 読み間違えにくい6文字。接頭辞は作るマスタユーザーのログインIDから取る
 * （施設の接頭辞はやめた。取引先が複数の施設で使うため・§9・2026-10-09）。既存のIDは変えない。
 */
export function autoChildLoginId(masterLoginId: string | null | undefined): string {
  return `${childLoginIdPrefix(masterLoginId)}-${friendlyId(6)}`;
}

/** 取引先ページの URL（Book 自身のオリジンで作る）。 */
export const portalUrl = (origin: string, urlToken: string, path = '') => `${origin}/p/${urlToken}${path}`;

/** 子ユーザーへパスワード設定リンクを送る（メール送信が未設定なら送らずに理由を返す）。 */
export async function sendChildSetupEmail(
  db: SupabaseClient,
  args: {
    partner: Pick<PartnerContext, 'name' | 'facility_id' | 'facility_name' | 'facilities' | 'primary_facility_id'>;
    to: string;
    displayName: string | null;
    loginId: string;
    issuedBy: string;
    setupUrl: string;
    loginUrl: string;
    isReset: boolean;
  }
) {
  const days = Math.round(SETUP_TOKEN_TTL_HOURS / 24);
  const who = args.displayName ? `${args.partner.name} ${args.displayName} 様` : `${args.partner.name} 様`;
  const brand = partnerSetupBrand(args.partner);
  const facility = brand.label;
  const intro = args.isReset
    ? `${facility} の取引先専用ページのパスワード設定リンクを、${args.issuedBy} 様のご依頼で再発行しました。`
    : `${facility} の取引先専用ページ（${args.partner.name} 様専用）のログインIDを、${args.issuedBy} 様が発行しました。`;
  const text = [
    who,
    '',
    intro,
    '下記のリンクからパスワードを設定してください。',
    '',
    `ログインID: ${args.loginId}`,
    `パスワード設定: ${args.setupUrl}`,
    `（リンクの有効期限: ${days}日）`,
    '',
    `次回以降のログイン: ${args.loginUrl}`,
    '',
    '※このURLは貴社専用です。社外へは共有しないでください。',
    '※お心当たりのない場合は、このメールを破棄してください。'
  ].join('\n');
  const html = `<p>${escapeHtml(who)}</p>
<p>${escapeHtml(intro)}<br>下記のリンクからパスワードを設定してください。</p>
<p>ログインID: <strong>${escapeHtml(args.loginId)}</strong><br>
パスワード設定: <a href="${escapeHtml(args.setupUrl)}">${escapeHtml(args.setupUrl)}</a><br>
（リンクの有効期限: ${days}日）</p>
<p>次回以降のログイン: <a href="${escapeHtml(args.loginUrl)}">${escapeHtml(args.loginUrl)}</a></p>
<p style="color:#666;font-size:12px">※このURLは貴社専用です。社外へは共有しないでください。<br>※お心当たりのない場合は、このメールを破棄してください。</p>`;
  return sendPartnerMail(db, brand.facilityId, {
    to: [args.to],
    subject: args.isReset
      ? `【${brand.subjectName}】取引先専用ページのパスワード設定のご案内`
      : `【${brand.subjectName}】取引先専用ページのログインID発行のお知らせ`,
    html,
    text
  });
}
