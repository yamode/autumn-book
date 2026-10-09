import { fail, redirect } from '@sveltejs/kit';
import { GENERIC_LOGIN_ERROR, loginPartner, logPartnerAccess, partnerUnavailableReason } from '$lib/server/partners/store';
import {
  deferTask,
  partnerDeviceId,
  portalHeader,
  PORTAL_HEADERS,
  requestLocation,
  requestMeta,
  resolvePortal,
  setPartnerSessionCookie
} from '$lib/server/partners/portal';
import { notifyNewEnvironmentLogin, portalUrl } from '$lib/server/partners/portal-users';
import { ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { checkTurnstile, TURNSTILE_FAILED_MESSAGE } from '$lib/server/turnstile';
import { portalMfaUrl } from '$lib/partner-mfa';
import { passkeyRp } from '$lib/server/partners/passkeys';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { partner, session } = await resolvePortal(event);
  const unavailable = partnerUnavailableReason(partner);
  if (session && (!unavailable || session.preview)) throw redirect(303, `/p/${event.params.token}/calendar`);
  return {
    portal: portalHeader(partner, session),
    unavailable,
    // パスキーでログイン（本番ドメインとローカルだけ・*.pages.dev のプレビューでは出さない・§6.5）
    passkeyEnabled: Boolean(passkeyRp(event))
  };
};

// ログイン（docs/auth-hardening.md §4・S2）:
//   1. Turnstile（未設定なら素通り）
//   2. KV のレート制限: 1 IP × 取引先 10 回/10 分・取引先全体 60 回/10 分 → 15 分止める（アカウント単位の 5 回ロックはそのまま・二段構え）
//      キーは限定URLのトークンではなく取引先 ID（URL を再発行しても数えが続く）
//   3. ID・パスワードの照合（失敗・ロック中・制限中はすべて同じ文言＝ID の有無を漏らさない・§4.5）
//   4. 成功: IP の数えをやめる（続けて 5. 本人確認が要るログインなら /mfa へ）（取引先全体の数は減らさない）・端末クッキー・新しい環境なら通知メール（応答の後で送る）
export const actions = {
  default: async (event) => {
    const { db, partner } = await resolvePortal(event);
    const unavailable = partnerUnavailableReason(partner);
    if (unavailable) return fail(403, { message: unavailable, loginId: '' });
    const fd = await event.request.formData();
    const loginId = String(fd.get('login_id') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!loginId || !password) return fail(400, { message: 'ログインIDとパスワードを入力してください。', loginId });

    const meta = requestMeta(event);
    const turnstile = await checkTurnstile(fd, meta.ip);
    if (!turnstile.ok) return fail(400, { message: TURNSTILE_FAILED_MESSAGE, loginId });

    const ipRateKey = `${partner.id}:${ipKey(meta.ip)}`;
    const [byIp, byPartner] = await Promise.all([
      rateCheck(event.platform, RATE_RULES.partnerIp, ipRateKey),
      rateCheck(event.platform, RATE_RULES.partner, partner.id)
    ]);
    if (byIp.locked || byPartner.locked) {
      await logPartnerAccess(db, {
        partnerId: partner.id,
        channel: 'web',
        action: 'login_rate_limited',
        detail: { scope: byIp.locked ? 'ip' : 'partner', loginId: loginId.slice(0, 64) },
        ip: meta.ip
      });
      return fail(400, { message: GENERIC_LOGIN_ERROR, loginId });
    }

    const deviceId = await partnerDeviceId(event);
    const result = await loginPartner(db, partner, loginId, password, { ...meta, deviceId });
    if (!result.ok) {
      await Promise.all([
        rateHit(event.platform, RATE_RULES.partnerIp, ipRateKey),
        rateHit(event.platform, RATE_RULES.partner, partner.id)
      ]);
      return fail(400, { message: result.message, loginId });
    }
    await rateReset(event.platform, RATE_RULES.partnerIp, ipRateKey);
    setPartnerSessionCookie(event.cookies, event.params.token, result.sessionToken);
    if (result.newEnvironment) {
      deferTask(
        event,
        notifyNewEnvironmentLogin(db, {
          partner,
          account: result.account,
          meta,
          location: requestLocation(event),
          loginUrl: portalUrl(event.url.origin, event.params.token)
        })
      );
    }
    // ログイン直後の本人確認（§6.2・S3）: always は毎回、step_up は新しい環境か前回の本人確認から 30 日以上（メールがあるとき）
    if (result.stepUp) throw redirect(303, portalMfaUrl(event.params.token, `/p/${event.params.token}/calendar`));
    throw redirect(303, `/p/${event.params.token}/calendar`);
  }
};
