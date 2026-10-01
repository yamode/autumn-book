// 取引先ページの「ユーザー管理」（マスタユーザーが子ユーザーを作る）で送るパスワード設定メール。2026-10-01 追加。
// スタッフ用の sendSetupEmail（staff.ts）は宛名が取引先名・本文が「宿が発行した」前提なので、子ユーザー向けに別に持つ。
// 送信経路は他の取引先メールと同じ（差出人名 = 施設名・返信先 = 施設の予約用アドレス）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { friendlyId } from './crypto';
import { sendPartnerMail } from './mail';
import { SETUP_TOKEN_TTL_HOURS, type PartnerContext } from './store';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** ログインIDの自動採番（スタッフの発行と同じ規則: 施設の接頭辞 + 読み間違えにくい6文字）。 */
export function autoChildLoginId(partner: Pick<PartnerContext, 'facility_id'>): string {
  const prefix = partner.facility_id === FACILITY_UUID['f-oga'] ? 'oga' : 'yamado';
  return `${prefix}-${friendlyId(6)}`;
}

/** 取引先ページの URL（Book 自身のオリジンで作る）。 */
export const portalUrl = (origin: string, urlToken: string, path = '') => `${origin}/p/${urlToken}${path}`;

/** 子ユーザーへパスワード設定リンクを送る（メール送信が未設定なら送らずに理由を返す）。 */
export async function sendChildSetupEmail(
  db: SupabaseClient,
  args: {
    partner: Pick<PartnerContext, 'name' | 'facility_id' | 'facility_name'>;
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
  const facility = args.partner.facility_name;
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
  return sendPartnerMail(db, args.partner.facility_id, {
    to: [args.to],
    subject: args.isReset
      ? `【${facility}】取引先専用ページのパスワード設定のご案内`
      : `【${facility}】取引先専用ページのログインID発行のお知らせ`,
    html,
    text
  });
}
