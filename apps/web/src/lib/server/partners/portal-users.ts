// 取引先ページの「ユーザー管理」（マスタユーザーが子ユーザーを作る）で送るパスワード設定メール。2026-10-01 追加。
// スタッフ用の sendSetupEmail（staff.ts）は宛名が取引先名・本文が「宿が発行した」前提なので、子ユーザー向けに別に持つ。
// 送信経路は他の取引先メールと同じ（差出人名 = 施設名・返信先 = 施設の予約用アドレス）。
// 複数施設化（2026-10-09 S5b・§7.11）: 差出人は既定の施設（primary_facility_id）、オンの施設が2つ以上なら本文に列挙（setup-brand.ts）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { friendlyId } from './crypto';
import { sendPartnerMail } from './mail';
import { childLoginIdPrefix, partnerSetupBrand } from './setup-brand';
import { findLoginNoticeRecipient, logPartnerAccess, SETUP_TOKEN_TTL_HOURS, type LoginResult, type PartnerContext, type RequestMeta } from './store';
import { loadInvoiceFacilities } from './invoices';
import { formatJst, summarizeUserAgent } from '$lib/partner-login-security';

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

// ---- 新しい環境からのログイン通知（docs/auth-hardening.md §4.3・S2） ----
// 端末（rms_partner_device）も IP も直近 90 日に無いログインのとき、本人のメール（無ければマスタ・M9）へ知らせる。
// 送信の失敗はログインを止めない。結果は access_logs の login_new_device（notified・宛先の種類）に残す（宛先そのものは残さない）。

export type LoginNoticeArgs = {
  partner: Pick<PartnerContext, 'id' | 'name' | 'facility_id' | 'facility_name' | 'facilities' | 'primary_facility_id'>;
  to: string;
  /** 宛先がマスタ（本人にメールが無い）のとき true。本文の書き出しを変える */
  toMaster: boolean;
  loginId: string;
  displayName: string | null;
  at: Date;
  ip: string | null;
  location: string | null;
  userAgent: string | null;
  loginUrl: string;
  facilityTel: string | null;
};

/** 通知メールの件名・本文（純関数に近い形。テストしやすいように送信と分けた） */
export function buildLoginNoticeEmail(args: LoginNoticeArgs & { subjectName: string; label: string }) {
  const who = args.toMaster ? `${args.partner.name} マスタユーザー 様` : `${args.partner.name} ${args.displayName ? `${args.displayName} 様` : '様'}`;
  const intro = args.toMaster
    ? `${args.label} の取引先専用ページで、貴社のユーザー（ログインID: ${args.loginId}）が新しい環境からログインしました。このユーザーにメールアドレスが登録されていないため、マスタユーザーの方へお知らせしています。`
    : `${args.label} の取引先専用ページに、新しい環境からログインがありました。`;
  const where = [args.ip ?? '不明', args.location].filter(Boolean).join('（') + (args.location ? '）' : '');
  const contact = args.facilityTel ? `宿（${args.label}・電話 ${args.facilityTel}）` : `宿（${args.label}）`;
  const lines = [
    `日時: ${formatJst(args.at)}（日本時間）`,
    `ログインID: ${args.loginId}`,
    `接続元: ${where}`,
    `ブラウザ: ${summarizeUserAgent(args.userAgent)}`
  ];
  const caution = [
    'お心当たりがない場合は、貴社のマスタユーザーに連絡してパスワードの再設定とログアウトを依頼するか、' + `${contact}までご連絡ください。`,
    'ご本人のログインであれば、このメールへの対応は不要です。',
    '※宿がメールや電話でパスワードや認証コードをお尋ねすることはありません。'
  ];
  const text = [who, '', intro, '', ...lines, '', ...caution, '', `取引先専用ページ: ${args.loginUrl}`].join('\n');
  const html = `<p>${escapeHtml(who)}</p>
<p>${escapeHtml(intro)}</p>
<p>${lines.map(escapeHtml).join('<br>')}</p>
<p>${escapeHtml(caution[0])}<br>${escapeHtml(caution[1])}</p>
<p style="color:#666;font-size:12px">${escapeHtml(caution[2])}</p>
<p>取引先専用ページ: <a href="${escapeHtml(args.loginUrl)}">${escapeHtml(args.loginUrl)}</a></p>`;
  return { subject: `【${args.subjectName}】取引先専用ページに新しい環境からログインがありました`, text, html };
}

/** 新しい環境からのログイン通知を送り、結果をログに残す。呼び出し側は deferTask に渡す（応答を待たせない） */
export async function notifyNewEnvironmentLogin(
  db: SupabaseClient,
  args: {
    partner: LoginNoticeArgs['partner'];
    account: Extract<LoginResult, { ok: true }>['account'];
    meta: RequestMeta;
    location: string | null;
    loginUrl: string;
  }
): Promise<void> {
  const { partner, account, meta } = args;
  const recipient = await findLoginNoticeRecipient(db, partner.id, account).catch(() => null);
  let notified = false;
  let reason: string | null = recipient ? null : 'no_email';
  if (recipient) {
    const brand = partnerSetupBrand(partner);
    const tel = await loadInvoiceFacilities(db)
      .then((list) => list.find((f) => f.id === brand.facilityId)?.tel ?? null)
      .catch(() => null);
    const mail = buildLoginNoticeEmail({
      partner,
      to: recipient.email,
      toMaster: recipient.to === 'master',
      loginId: account.login_id,
      displayName: account.display_name,
      at: new Date(),
      ip: meta.ip,
      location: args.location,
      userAgent: meta.userAgent,
      loginUrl: args.loginUrl,
      facilityTel: tel,
      subjectName: brand.subjectName,
      label: brand.label
    });
    const result = await sendPartnerMail(db, brand.facilityId, { to: [recipient.email], ...mail }).catch(() => ({ sent: false, reason: 'error' }));
    notified = result.sent;
    if (!result.sent) reason = 'send_failed';
  }
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'login_new_device',
    detail: { notified, to: recipient?.to ?? null, ...(reason ? { reason } : {}) },
    ip: meta.ip
  });
}
