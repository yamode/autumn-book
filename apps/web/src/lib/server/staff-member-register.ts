// 施設側が電話で頼まれて、非会員の予約のお客様の会員登録を代行する（2026-09-27 ユーザー指示）。
// DB: autumn-shared 20260926235403（book.admin_register_member_for_booking）。
//
//   1. スタッフの権限で RPC を呼ぶ（会員の作成・入会ボーナス・予約の紐づけ・監査ログ）
//   2. そのメールのログイン用アカウントが無ければ（auth_user_missing）、service_role で作ってからもう一度呼ぶ。
//      パスワードは作らない（会員ログインはメールに届くコード＝signInWithOtp）。email は確認済みにする
//   3. アカウントに会員の印（user_metadata.member）を付け、お客様へ「会員登録のお知らせ」を送る（失敗しても登録は成立）
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendHtmlEmail } from '$lib/server/mailer';
import { partnerServiceClient } from '$lib/server/partners/admin-client';

export type StaffRegisterResult = {
  memberCode: string;
  welcomeBonus: number;
  refinalize: boolean;
  accountCreated: boolean;
  mailSent: boolean;
};

export class StaffRegisterError extends Error {}

const TEXT: Record<string, string> = {
  invalid_email: 'メールアドレスを確かめてください。',
  cancelled: '取り消し済みの予約では会員登録を代行できません。',
  already_member: 'この予約はすでに会員の予約です。',
  staff_account: 'このメールアドレスは管理画面のアカウントです。会員には登録できません。',
  member_exists: 'このメールアドレスはすでに会員です。下の「会員に紐づける」で、この予約を紐づけてください。',
  forbidden: 'この予約の施設を操作する権限がありません。',
  not_found: '予約が見つかりません。'
};

function textOf(message: string): string {
  for (const [code, text] of Object.entries(TEXT)) if (message.includes(code)) return text;
  if (message.includes('Could not find the function')) return 'DB の更新（autumn-shared 20260926235403）がまだ適用されていません。';
  return `会員登録を代行できませんでした（${message}）`;
}

async function callRegister(client: SupabaseClient, code: string, email: string, mailOptIn: boolean) {
  return client.schema('book').rpc('admin_register_member_for_booking', {
    p_booking_code: code,
    p_email: email,
    p_mail_opt_in: mailOptIn,
    p_locale: 'ja'
  });
}

export async function registerMemberForBooking(args: {
  staffClient: SupabaseClient;
  bookingCode: string;
  email: string;
  name: string | null;
  mailOptIn: boolean;
  facilityName: string;
  origin: string;
}): Promise<StaffRegisterResult> {
  const email = args.email.trim().toLowerCase();
  let accountCreated = false;

  let { data, error } = await callRegister(args.staffClient, args.bookingCode, email, args.mailOptIn);
  if (error && error.message.includes('auth_user_missing')) {
    const svc = partnerServiceClient();
    if (!svc) throw new StaffRegisterError('この環境ではログイン用アカウントを作れません（SUPABASE_SERVICE_ROLE_KEY が未設定）。');
    const created = await svc.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { member: true, ...(args.name ? { name: args.name } : {}) }
    });
    if (created.error) throw new StaffRegisterError(`ログイン用アカウントを作れませんでした（${created.error.message}）`);
    accountCreated = true;
    ({ data, error } = await callRegister(args.staffClient, args.bookingCode, email, args.mailOptIn));
  }
  if (error) throw new StaffRegisterError(textOf(error.message));
  const r = data as { member_code: string; user_id: string; refinalize: boolean; welcome_bonus?: number };
  // 入会ボーナス（管理画面 → 会員 で設定。0 なら付かない）
  const bonus = Math.max(0, Number(r.welcome_bonus ?? 0) || 0);

  // 既存のアカウント（ログインしたことはあるが会員登録していない人）にも会員の印を付ける
  if (!accountCreated) {
    const svc = partnerServiceClient();
    await svc?.auth.admin.updateUserById(r.user_id, { user_metadata: { member: true } }).catch(() => {});
  }

  const mail = await sendHtmlEmail({
    to: [email],
    subject: `【${args.facilityName}】会員登録のお知らせ`,
    fromName: args.facilityName,
    text: welcomeText(args, r.member_code, bonus),
    html: welcomeHtml(args, r.member_code, bonus)
  }).catch(() => ({ sent: false }));

  return { memberCode: r.member_code, welcomeBonus: bonus, refinalize: r.refinalize, accountCreated, mailSent: mail.sent };
}

function welcomeText(args: { name: string | null; facilityName: string; origin: string }, memberCode: string, bonus: number): string {
  return [
    `${args.name ? `${args.name} 様` : 'お客様'}`,
    '',
    `お電話でのご依頼により、${args.facilityName} の会員登録を承りました。`,
    `会員番号: ${memberCode}`,
    '',
    `ご予約は会員のご予約として登録済みです。${bonus > 0 ? `入会ボーナスとして ${bonus.toLocaleString('ja-JP')} ポイントを差し上げました。` : ''}`,
    'ご宿泊後には会員ポイントが付きます（次回のご宿泊で 1pt=1円としてお使いいただけます）。',
    '',
    'ログインはこのメールアドレスで行います。パスワードはありません。',
    `ログイン画面（${args.origin}/auth/login）でメールアドレスを入れると、確認コードが届きます。`,
    '',
    'お心当たりがない場合は、お手数ですがこのメールにご返信ください。'
  ].join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function welcomeHtml(args: { name: string | null; facilityName: string; origin: string }, memberCode: string, bonus: number): string {
  return welcomeText(args, memberCode, bonus)
    .split('\n')
    .map((l) => (l ? `<p style="margin:0 0 6px">${esc(l)}</p>` : '<p style="margin:0 0 6px">&nbsp;</p>'))
    .join('');
}
