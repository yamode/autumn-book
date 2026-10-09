import { fail } from '@sveltejs/kit';
import { LOGIN_LOG_LABELS, summarizeUserAgent } from '$lib/partner-login-security';
import { portalAal2, portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import {
  GENERIC_LOGIN_ERROR,
  listOwnSecurityLogs,
  listOwnSessions,
  logPartnerAccess,
  PartnerStoreError,
  revokeOtherSessions,
  revokeOwnSession,
  verifyOwnPassword
} from '$lib/server/partners/store';
import { changeAccountEmail, loadMfaAccount, requireAal2 } from '$lib/server/partners/mfa';
import { isEmail } from '$lib/server/partners/staff-form';
import { ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';
import { maskEmail, MFA_AAL2_HOURS, portalMfaUrl } from '$lib/partner-mfa';

// 取引先専用ページ: アカウント → セキュリティ（docs/auth-hardening.md §4.4・S2）。
// 自分のログイン中の端末と、直近 30 件のログイン関係の記録を出し、他の端末をログアウトできる。
// 読み書きはセッションで確かめた自分のアカウント（session.id）の行だけ。
// 本人確認（S3）: 認証コードの送り先（このログインIDのメールアドレス）の確認済み印・変更と、このブラウザの本人確認の状態。
//   メールの変更は本人確認（aal2）が要る。まだ登録が無いアカウントの初回だけはパスワードの再入力で登録できる（M4）。
//   ログイン直後の本人確認待ち（メールが無くて確認できない）でもメールを登録できるよう、load と set_email は関所を外す。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event, { mfaGate: false });
  // 管理画面からの確認モードは取引先のアカウントではないので出さない
  if (session.preview) return { portal: portalHeader(partner, session), preview: true, sessions: [], logs: [], loadError: null, mfa: null };
  const token = event.params.token;
  const aal2 = portalAal2(session);
  const mfa = await loadMfaAccount(db, partner.id, session.id)
    .then((a) => ({
      maskedEmail: maskEmail(a?.email),
      hasEmail: Boolean(a?.email),
      verified: Boolean(a?.email && a.email_verified_at),
      aal2,
      aal2Until: aal2 && session.mfaAt ? new Date(Date.parse(session.mfaAt) + MFA_AAL2_HOURS * 3600_000).toISOString() : null,
      mfaHref: portalMfaUrl(token, `/p/${token}/account/security`)
    }))
    .catch(() => null);
  try {
    const [sessions, logs] = await Promise.all([listOwnSessions(db, session.id), listOwnSecurityLogs(db, partner.id, session.id, 30)]);
    return {
      portal: portalHeader(partner, session),
      preview: false,
      mfa,
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        ip: s.ip,
        browser: summarizeUserAgent(s.user_agent),
        current: s.id === session.sessionId
      })),
      logs: logs.map((l) => ({
        id: l.id,
        at: l.created_at,
        label: LOGIN_LOG_LABELS[l.action] ?? l.action,
        action: l.action,
        ip: l.ip,
        notified: l.action === 'login_new_device' ? (l.detail as { notified?: boolean } | null)?.notified === true : null
      })),
      loadError: null
    };
  } catch (e) {
    if (!(e instanceof PartnerStoreError)) throw e;
    return { portal: portalHeader(partner, session), preview: false, sessions: [], logs: [], loadError: e.message, mfa };
  }
};

export const actions = {
  // 認証コードの送り先（このログインIDのメールアドレス）の登録・変更（§6.4・M4）
  //   登録済み → 本人確認（aal2）が要る（乗っ取りで宛先を書き換えられないように）
  //   未登録（初回）→ パスワードの再入力（試行はログインと同じ IP の制限で数える）
  set_email: async (event) => {
    const { db, partner, session } = await requirePortalSession(event, { mfaGate: false });
    const account = await loadMfaAccount(db, partner.id, session.id);
    if (!account) return fail(403, { emailMessage: 'アカウントを確認できませんでした。' });
    if (account.email) requireAal2(event, session, { next: `/p/${event.params.token}/account/security` });
    const fd = await event.request.formData();
    const email = String(fd.get('email') ?? '').trim();
    if (!email || email.length > 254 || !isEmail(email)) return fail(400, { emailMessage: 'メールアドレスの形式が正しくありません。', email });
    const ip = requestMeta(event).ip;
    if (!account.email) {
      const rateKey = `${partner.id}:${ipKey(ip)}`;
      const limited = await rateCheck(event.platform, RATE_RULES.partnerIp, rateKey);
      if (limited.locked) return fail(400, { emailMessage: GENERIC_LOGIN_ERROR, email });
      const ok = await verifyOwnPassword(db, partner.id, session.id, String(fd.get('password') ?? ''));
      if (!ok) {
        await rateHit(event.platform, RATE_RULES.partnerIp, rateKey);
        return fail(400, { emailMessage: 'パスワードが違います。', email });
      }
    }
    try {
      await changeAccountEmail(db, { partner, accountId: session.id, email, ip });
      return { emailSaved: maskEmail(email) };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { emailMessage: e.message, email });
      throw e;
    }
  },

  // 他の端末からログアウト（いまのブラウザ以外のセッションをすべて消す）
  logout_others: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    try {
      const count = await revokeOtherSessions(db, session.id, session.sessionId);
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'logout_others',
        detail: { count },
        ip: requestMeta(event).ip
      });
      return { loggedOut: count };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  },

  // 端末を 1 つログアウト（自分のアカウントのセッションだけ。いまのブラウザはヘッダーのログアウトを使ってもらう）
  logout_session: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const id = String(fd.get('session_id') ?? '');
    if (id === session.sessionId) return fail(400, { message: 'このブラウザは、画面上部の「ログアウト」からログアウトしてください。' });
    try {
      const ok = await revokeOwnSession(db, session.id, id);
      if (!ok) return fail(404, { message: 'その端末は見つかりませんでした（すでにログアウトしています）。' });
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'logout_session',
        ip: requestMeta(event).ip
      });
      return { loggedOut: 1 };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  }
};
