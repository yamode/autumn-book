// 取引先ページのステップアップ（第2要素）— メール OTP（docs/auth-hardening.md §5.2・§6.2〜6.4・S3）。
//
// - コードは 6 桁。DB（rms_partner_mfa_challenges・service_role 専用）には sha256(code + ':' + challengeId) だけを置く
// - 有効 10 分・1 チャレンジ 5 回まで・再送は 60 秒に 1 回・1 アカウント 1 時間に 5 通（DB で数える）
// - 試行は「先に数えてから照合」する（同時に投げられても 5 回を超えない）。上限で止めたら expires_at を止めた時刻にする（60 秒後から再送可）
// - 成功: チャレンジに used_at・セッションを aal=2 / mfa_at=now / mfa_method='email'・アカウントの email_verified_at（初回）・access_logs mfa_ok
// - 照合するのは最新のチャレンジだけ（再送したら古いコードは使えない）
// パスキー（S6）は同じ markSessionAal2 を method='passkey' で呼べばよい作りにしてある。
import type { RequestEvent } from '@sveltejs/kit';
import { error, json, redirect } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateOtp,
  isAal2Valid,
  maskEmail,
  MFA_REQUIRED_MESSAGE,
  normalizeMfaPolicy,
  normalizeOtp,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  otpChallengeState,
  otpProblem,
  otpResendWaitSeconds,
  portalMfaUrl,
  timingSafeEqualText,
  type MfaRequiredBody,
  type OtpChallengeLike
} from '$lib/partner-mfa';
import { sha256Hex } from './crypto';
import { sendPartnerMail } from './mail';
import { partnerSetupBrand } from './setup-brand';
import { findLoginNoticeRecipient, logPartnerAccess, PartnerStoreError, type PartnerContext, type PartnerSessionAccount } from './store';
import { PORTAL_HEADERS } from './portal';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type MfaAccount = { id: string; partner_id: string; login_id: string; display_name: string | null; email: string | null; email_verified_at: string | null; is_active: boolean };
type ChallengeRow = OtpChallengeLike & { id: string; code_hash: string | null };

export type MfaPartner = Pick<PartnerContext, 'id' | 'name' | 'facility_id' | 'facility_name' | 'facilities' | 'primary_facility_id' | 'mfa_policy'>;

/** この取引先の有効なアカウント（本人確認の宛先を読む） */
export async function loadMfaAccount(db: SupabaseClient, partnerId: string, accountId: string): Promise<MfaAccount | null> {
  const { data, error: e } = await db
    .from('rms_partner_accounts')
    .select('id, partner_id, login_id, display_name, email, email_verified_at, is_active')
    .eq('id', accountId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (e) throw new PartnerStoreError('アカウントを読み込めませんでした。', 500);
  const a = data as MfaAccount | null;
  return a && a.is_active ? a : null;
}

async function recentEmailChallenges(db: SupabaseClient, accountId: string): Promise<ChallengeRow[]> {
  const { data, error: e } = await db
    .from('rms_partner_mfa_challenges')
    .select('id, code_hash, created_at, expires_at, attempts, used_at')
    .eq('account_id', accountId)
    .eq('kind', 'email')
    .gte('created_at', new Date(Date.now() - 2 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  if (e) throw new PartnerStoreError('認証コードの状態を読み込めませんでした。', 500);
  return (data ?? []) as ChallengeRow[];
}

const codeHash = (code: string, challengeId: string) => sha256Hex(`${code}:${challengeId}`);

/** /mfa の初期表示: 次に送れるまでの秒数と、入力を受け付けているコードがあるか */
export async function emailOtpStatus(db: SupabaseClient, accountId: string): Promise<{ waitSec: number; open: boolean; expiresAt: string | null }> {
  const list = await recentEmailChallenges(db, accountId);
  const latest = list[0] ?? null;
  const open = otpChallengeState(latest) === 'open';
  return { waitSec: otpResendWaitSeconds(list), open, expiresAt: open ? latest!.expires_at : null };
}

export type IssueOtpResult =
  | { ok: true; to: string; waitSec: number; expiresAt: string }
  | { ok: false; code: 'no_email' | 'wait' | 'policy' | 'send_failed'; message: string; waitSec?: number };

/** 認証コードのメール（件名にコードを入れない・M5。本文の冒頭に大きく） */
export function buildOtpEmail(args: { label: string; subjectName: string; code: string; loginId: string; displayName: string | null; partnerName: string }) {
  const who = `${args.partnerName} ${args.displayName ? `${args.displayName} 様` : '様'}`;
  const lines = [
    `${args.label} の取引先専用ページの認証コードです。画面に入力してください（有効期限 ${OTP_TTL_MINUTES} 分）。`,
    `ログインID: ${args.loginId}`
  ];
  const caution = [
    'このコードを宿や第三者に伝えないでください。宿が電話やメールでコードをお尋ねすることはありません。',
    'お心当たりがない場合は、パスワードが第三者に知られている可能性があります。貴社のマスタユーザーに連絡してパスワードの再設定を依頼してください。'
  ];
  const text = [`認証コード: ${args.code}`, '', who, '', ...lines, '', ...caution].join('\n');
  const html = `<p style="font-size:14px;color:#444">認証コード</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:4px 0 16px">${escapeHtml(args.code)}</p>
<p>${escapeHtml(who)}</p>
<p>${lines.map(escapeHtml).join('<br>')}</p>
<p style="color:#666;font-size:12px">${caution.map(escapeHtml).join('<br>')}</p>`;
  return { subject: `【${args.subjectName}】取引先専用ページの認証コード`, text, html };
}

/** 認証コードを作ってメールで送る（§6.4） */
export async function issueEmailOtp(db: SupabaseClient, args: { partner: MfaPartner; accountId: string; ip: string | null }): Promise<IssueOtpResult> {
  const { partner, accountId, ip } = args;
  if (normalizeMfaPolicy(partner.mfa_policy) === 'passkey_only') {
    return { ok: false, code: 'policy', message: 'この取引先ではパスキーでの確認が必要です。宿へお問い合わせください。' };
  }
  const account = await loadMfaAccount(db, partner.id, accountId);
  const email = String(account?.email ?? '').trim();
  if (!account || !email) {
    return { ok: false, code: 'no_email', message: 'メールアドレスが登録されていないため、認証コードを送れません。「アカウント」→「セキュリティ」から登録してください。' };
  }
  const list = await recentEmailChallenges(db, account.id);
  const waitSec = otpResendWaitSeconds(list);
  if (waitSec > 0) {
    return { ok: false, code: 'wait', message: `認証コードの再送は ${waitSec} 秒ほどお待ちください。`, waitSec };
  }
  // 1 日より古いチャレンジの掃除（ついでに・失敗は無視）
  await db
    .from('rms_partner_mfa_challenges')
    .delete()
    .lt('created_at', new Date(Date.now() - 86400_000).toISOString())
    .then(
      () => undefined,
      () => undefined
    );
  const id = crypto.randomUUID();
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();
  const { error: e } = await db.from('rms_partner_mfa_challenges').insert({
    id,
    account_id: account.id,
    kind: 'email',
    code_hash: await codeHash(code, id),
    expires_at: expiresAt,
    ip
  });
  if (e) throw new PartnerStoreError('認証コードを用意できませんでした。時間をおいてお試しください。', 500);

  const brand = partnerSetupBrand(partner);
  const mail = buildOtpEmail({ label: brand.label, subjectName: brand.subjectName, code, loginId: account.login_id, displayName: account.display_name, partnerName: partner.name });
  const sent = await sendPartnerMail(db, brand.facilityId, { to: [email], ...mail }).catch(() => ({ sent: false, reason: 'error' }));
  if (!sent.sent) {
    // 届かなかったコードは数えない（作り直せるように消す）
    await db.from('rms_partner_mfa_challenges').delete().eq('id', id).then(
      () => undefined,
      () => undefined
    );
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'mfa_sent', detail: { method: 'email', sent: false, reason: sent.reason ?? null }, ip });
    return { ok: false, code: 'send_failed', message: '認証コードのメールを送れませんでした。時間をおいてお試しください。' };
  }
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'mfa_sent', detail: { method: 'email', to: maskEmail(email) }, ip });
  return { ok: true, to: maskEmail(email), waitSec: otpResendWaitSeconds([{ created_at: new Date().toISOString(), expires_at: expiresAt, attempts: 0, used_at: null }]), expiresAt };
}

export type VerifyOtpResult = { ok: true } | { ok: false; code: 'invalid' | 'expired' | 'locked' | 'policy'; message: string; remaining?: number };

/** セッションを aal2 にする（メール OTP・将来のパスキー共通）。自分のアカウントのセッションだけ */
export async function markSessionAal2(db: SupabaseClient, args: { accountId: string; sessionId: string; method: 'email' | 'passkey' }): Promise<void> {
  const { data, error: e } = await db
    .from('rms_partner_sessions')
    .update({ aal: 2, mfa_at: new Date().toISOString(), mfa_method: args.method })
    .eq('id', args.sessionId)
    .eq('account_id', args.accountId)
    .select('id');
  if (e || !(data ?? []).length) throw new PartnerStoreError('本人確認の結果を保存できませんでした。もう一度ログインしてください。', 500);
}

// 試行を 1 回数える（attempts が読んだ値のままのときだけ進める＝同時の試行でも上限を超えない）。数えた後の値を返す。数えられなければ null
async function claimAttempt(db: SupabaseClient, c: ChallengeRow): Promise<number | null> {
  let cur = c.attempts;
  for (let i = 0; i < 4; i += 1) {
    // 既に上限 → 上限を超えた値を返す（照合させない）
    if (cur >= OTP_MAX_ATTEMPTS) return OTP_MAX_ATTEMPTS + 1;
    const { data } = await db
      .from('rms_partner_mfa_challenges')
      .update({ attempts: cur + 1 })
      .eq('id', c.id)
      .eq('attempts', cur)
      .is('used_at', null)
      .select('attempts');
    const row = (data ?? [])[0] as { attempts: number } | undefined;
    if (row) return row.attempts;
    const { data: again } = await db.from('rms_partner_mfa_challenges').select('attempts, used_at').eq('id', c.id).maybeSingle();
    if (!again || (again as { used_at: string | null }).used_at) return null;
    cur = Number((again as { attempts: number }).attempts);
  }
  return null;
}

/** 認証コードを確かめ、合っていればセッションを aal2 にする（§6.4） */
export async function verifyEmailOtp(
  db: SupabaseClient,
  args: { partner: MfaPartner; accountId: string; sessionId: string; code: unknown; ip: string | null }
): Promise<VerifyOtpResult> {
  const { partner, accountId, sessionId, ip } = args;
  if (normalizeMfaPolicy(partner.mfa_policy) === 'passkey_only') {
    return { ok: false, code: 'policy', message: 'この取引先ではパスキーでの確認が必要です。宿へお問い合わせください。' };
  }
  const problem = otpProblem(args.code);
  const code = normalizeOtp(args.code);
  if (problem || !code) return { ok: false, code: 'invalid', message: problem ?? '認証コードが正しくありません。' };
  const account = await loadMfaAccount(db, partner.id, accountId);
  if (!account) return { ok: false, code: 'expired', message: 'アカウントを確認できませんでした。もう一度ログインしてください。' };
  const [latest] = await recentEmailChallenges(db, account.id);
  const state = otpChallengeState(latest ?? null);
  if (state === 'locked') return { ok: false, code: 'locked', message: '入力の誤りが続いたため、このコードは使えなくなりました。新しいコードを送ってください。' };
  if (state !== 'open') return { ok: false, code: 'expired', message: '認証コードの有効期限が切れました。新しいコードを送ってください。' };

  const used = await claimAttempt(db, latest);
  if (used === null) return { ok: false, code: 'expired', message: '認証コードの有効期限が切れました。新しいコードを送ってください。' };
  if (used > OTP_MAX_ATTEMPTS) return { ok: false, code: 'locked', message: '入力の誤りが続いたため、このコードは使えなくなりました。新しいコードを送ってください。' };

  const match = timingSafeEqualText(await codeHash(code, latest.id), String(latest.code_hash ?? ''));
  if (!match) {
    if (used >= OTP_MAX_ATTEMPTS) {
      // 上限: このチャレンジを止める（expires_at = 止めた時刻。新しいコードは 60 秒後から）
      await db.from('rms_partner_mfa_challenges').update({ expires_at: new Date().toISOString() }).eq('id', latest.id);
      await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'mfa_locked', detail: { method: 'email' }, ip });
      return { ok: false, code: 'locked', message: '入力の誤りが続いたため、このコードは使えなくなりました。1分ほどおいて新しいコードを送ってください。' };
    }
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'mfa_failed', detail: { method: 'email', attempts: used }, ip });
    return { ok: false, code: 'invalid', message: `認証コードが正しくありません（あと ${OTP_MAX_ATTEMPTS - used} 回）。`, remaining: OTP_MAX_ATTEMPTS - used };
  }
  // 1 回限り: 先に used_at を立てられたものだけを成功にする（同時の 2 回目は期限切れ扱い）
  const { data: claimed } = await db
    .from('rms_partner_mfa_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', latest.id)
    .is('used_at', null)
    .select('id');
  if (!(claimed ?? []).length) return { ok: false, code: 'expired', message: '認証コードの有効期限が切れました。新しいコードを送ってください。' };
  await markSessionAal2(db, { accountId: account.id, sessionId, method: 'email' });
  if (!account.email_verified_at) {
    await db
      .from('rms_partner_accounts')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', account.id)
      .eq('partner_id', partner.id)
      .then(
        () => undefined,
        () => undefined
      );
  }
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'mfa_ok', detail: { method: 'email' }, ip });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// aal2 の関所（§5.2）
// ---------------------------------------------------------------------------

type AalSession = Pick<PartnerSessionAccount, 'aal' | 'mfaAt' | 'preview'>;

/** セッションの aal2 が今も有効か（確認モードは false＝書き込みはそもそも 403） */
export const sessionHasAal2 = (session: AalSession | null | undefined) => Boolean(session && !session.preview && isAal2Valid(session));

/** 戻り先（いま開いているページ）。form action の URL（?/remove 等）は外す */
function currentPath(event: Pick<RequestEvent, 'url'>): string {
  const u = new URL(event.url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('/')) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}`;
}

/** form action・画面の load 用: aal2 でなければ /mfa へ 303（戻り先は next か、いまのページ） */
export function requireAal2(event: Pick<RequestEvent, 'url' | 'params'>, session: AalSession, opts: { next?: string } = {}): void {
  if (sessionHasAal2(session)) return;
  throw redirect(303, portalMfaUrl(event.params.token ?? '', opts.next ?? currentPath(event)));
}

/** JSON API 用: aal2 でなければ 403 { code:'mfa_required', next:'/p/<token>/mfa?next=…' } の応答を返す（aal2 なら null） */
export function aal2ApiProblem(event: Pick<RequestEvent, 'params'>, session: AalSession, next: string): Response | null {
  if (sessionHasAal2(session)) return null;
  const body: MfaRequiredBody = { ok: false, code: 'mfa_required', message: MFA_REQUIRED_MESSAGE, next: portalMfaUrl(event.params.token ?? '', next) };
  return json(body, { status: 403, headers: PORTAL_HEADERS });
}

/** 確認モードでは本人確認の画面・API を使わせない（取引先のアカウントではない） */
export function denyPreviewMfa(session: { preview?: boolean } | null) {
  if (session?.preview) throw error(403, '確認モードでは本人確認を行いません。');
}

// ---------------------------------------------------------------------------
// 認証コードの送り先（アカウントのメールアドレス）の変更（§6.4 の「宛先の変更」）
// ---------------------------------------------------------------------------

/**
 * 自分のアカウントのメールアドレスを変える。確認済みの印（email_verified_at）は外す（次の認証コードで付け直す）。
 * 呼ぶ側で権限（登録済み → aal2・未登録 → パスワードの再入力・M4）を確かめること。
 * 変更前の宛先（無ければマスタ）へ変更のお知らせを送る（乗っ取りで宛先を書き換えられたときに気づけるように）。
 */
export async function changeAccountEmail(
  db: SupabaseClient,
  args: { partner: MfaPartner; accountId: string; email: string; ip: string | null }
): Promise<{ before: string | null }> {
  const account = await loadMfaAccount(db, args.partner.id, args.accountId);
  if (!account) throw new PartnerStoreError('アカウントを確認できませんでした。', 403);
  const before = String(account.email ?? '').trim() || null;
  if (before && before.toLowerCase() === args.email.toLowerCase()) return { before };
  const { error: e } = await db
    .from('rms_partner_accounts')
    .update({ email: args.email, email_verified_at: null })
    .eq('id', account.id)
    .eq('partner_id', args.partner.id);
  if (e) throw new PartnerStoreError('メールアドレスを変更できませんでした。', 500);
  // 前の宛先に送った、まだ使える認証コードは無効にする
  await db
    .from('rms_partner_mfa_challenges')
    .update({ expires_at: new Date().toISOString() })
    .eq('account_id', account.id)
    .eq('kind', 'email')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .then(
      () => undefined,
      () => undefined
    );
  await logPartnerAccess(db, {
    partnerId: args.partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'email_change',
    detail: { from: before ? maskEmail(before) : null, to: maskEmail(args.email) },
    ip: args.ip
  });
  // お知らせ（失敗しても変更は止めない）
  const recipient = before ? { email: before, to: 'self' as const } : await findLoginNoticeRecipient(db, args.partner.id, { id: account.id, email: null }).catch(() => null);
  if (recipient) {
    const brand = partnerSetupBrand(args.partner);
    const who = recipient.to === 'self' ? `${args.partner.name} ${account.display_name ? `${account.display_name} 様` : '様'}` : `${args.partner.name} マスタユーザー 様`;
    const lines = [
      `${brand.label} の取引先専用ページで、ログインID ${account.login_id} のメールアドレス（通知・認証コードの送り先）が ${maskEmail(args.email)} に${before ? '変更' : '登録'}されました。`,
      'お心当たりがない場合は、パスワードが第三者に知られている可能性があります。貴社のマスタユーザーに連絡するか、宿までご連絡ください。',
      '※宿がメールや電話でパスワードや認証コードをお尋ねすることはありません。'
    ];
    await sendPartnerMail(db, brand.facilityId, {
      to: [recipient.email],
      subject: `【${brand.subjectName}】取引先専用ページのメールアドレスが${before ? '変更' : '登録'}されました`,
      text: [who, '', ...lines].join('\n'),
      html: `<p>${escapeHtml(who)}</p><p>${lines.map(escapeHtml).join('<br>')}</p>`
    }).catch(() => undefined);
  }
  return { before };
}
