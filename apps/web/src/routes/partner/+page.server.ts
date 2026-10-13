// 取引先の共通ログイン画面（docs/partner-common-login.md）。全取引先で同じURL。
// ログインIDから取引先を引き、取引先URL（/p/<token>）のログインと同じ手順でセッションを作って /p/<token>/calendar へ移す。
//   1. Turnstile（未設定なら素通り）
//   2. KV: 1 IP（全取引先共通）10 回/10 分 → 15 分。ID から取引先が分かれば取引先URLと同じ「IP × 取引先」「取引先全体」も合算
//   3. ID・パスワードの照合（存在しない ID も同じ計算・同じ文言＝ID の有無を漏らさない）
//   4. 停止中・公開期間外の取引先は、正しい ID・パスワードのときだけその案内（セッションは作らない）
//   5. 成功: 端末クッキー（両 path）・セッションクッキー（/p/<token>）・新しい環境なら通知メール・本人確認が要れば /mfa
import { fail, redirect } from '@sveltejs/kit';
import { GENERIC_LOGIN_ERROR, loginPartner, logPartnerAccess, partnerAdminClient, partnerUnavailableReason } from '$lib/server/partners/store';
import { deferTask, partnerDeviceId, PORTAL_HEADERS, requestLocation, requestMeta, setPartnerSessionCookie } from '$lib/server/partners/portal';
import { findPartnerTokenByLoginId, partnerPasswordMatches, resolveCommonPortal } from '$lib/server/partners/common-login';
import { notifyNewEnvironmentLogin } from '$lib/server/partners/portal-users';
import { verifyPassword } from '$lib/server/partners/crypto';
import { ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { checkTurnstile, TURNSTILE_FAILED_MESSAGE } from '$lib/server/turnstile';
import { portalMfaUrl } from '$lib/partner-mfa';
import { passkeyRp } from '$lib/server/partners/passkeys';
import { partnerCommonLoginUrl } from '$lib/partner-common-login';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  // パスキーでログイン（本番ドメインとローカルだけ・*.pages.dev のプレビューでは出さない）
  return { passkeyEnabled: Boolean(passkeyRp(event)) };
};

export const actions = {
  default: async (event) => {
    const db = partnerAdminClient();
    if (!db) return fail(503, { message: '現在ご利用いただけません。', loginId: '' });
    const fd = await event.request.formData();
    const loginId = String(fd.get('login_id') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!loginId || !password) return fail(400, { message: 'ログインIDとパスワードを入力してください。', loginId });

    const meta = requestMeta(event);
    const turnstile = await checkTurnstile(fd, meta.ip);
    if (!turnstile.ok) return fail(400, { message: TURNSTILE_FAILED_MESSAGE, loginId });

    const commonKey = ipKey(meta.ip);
    if ((await rateCheck(event.platform, RATE_RULES.commonIp, commonKey)).locked) return fail(400, { message: GENERIC_LOGIN_ERROR, loginId });

    const token = await findPartnerTokenByLoginId(db, loginId).catch(() => null);
    if (!token) {
      // 存在しない ID でもパスワードの照合と同じ計算をする（応答時間で ID の有無が分からないように）
      await verifyPassword(password, null);
      await rateHit(event.platform, RATE_RULES.commonIp, commonKey);
      return fail(400, { message: GENERIC_LOGIN_ERROR, loginId });
    }
    const { partner } = await resolveCommonPortal(event, token);

    // 取引先URLのログインと同じ数え（どちらの画面から打っても合算）
    const ipRateKey = `${partner.id}:${ipKey(meta.ip)}`;
    const [byIp, byPartner] = await Promise.all([
      rateCheck(event.platform, RATE_RULES.partnerIp, ipRateKey),
      rateCheck(event.platform, RATE_RULES.partner, partner.id)
    ]);
    if (byIp.locked || byPartner.locked) {
      await rateHit(event.platform, RATE_RULES.commonIp, commonKey);
      await logPartnerAccess(db, {
        partnerId: partner.id,
        channel: 'web',
        action: 'login_rate_limited',
        detail: { scope: byIp.locked ? 'ip' : 'partner', loginId: loginId.slice(0, 64), via: 'common' },
        ip: meta.ip
      });
      return fail(400, { message: GENERIC_LOGIN_ERROR, loginId });
    }

    const failed = async () => {
      await Promise.all([
        rateHit(event.platform, RATE_RULES.commonIp, commonKey),
        rateHit(event.platform, RATE_RULES.partnerIp, ipRateKey),
        rateHit(event.platform, RATE_RULES.partner, partner.id)
      ]);
      return fail(400, { message: GENERIC_LOGIN_ERROR, loginId });
    };

    const unavailable = partnerUnavailableReason(partner);
    if (unavailable) {
      if (!(await partnerPasswordMatches(db, partner.id, loginId, password))) return failed();
      return fail(403, { message: unavailable, loginId });
    }

    const deviceId = await partnerDeviceId(event, token);
    const result = await loginPartner(db, partner, loginId, password, { ...meta, deviceId });
    if (!result.ok) return failed();
    await Promise.all([
      rateReset(event.platform, RATE_RULES.commonIp, commonKey),
      rateReset(event.platform, RATE_RULES.partnerIp, ipRateKey)
    ]);
    setPartnerSessionCookie(event.cookies, token, result.sessionToken);
    if (result.newEnvironment) {
      deferTask(
        event,
        notifyNewEnvironmentLogin(db, {
          partner,
          account: result.account,
          meta,
          location: requestLocation(event),
          loginUrl: partnerCommonLoginUrl(event.url.origin)
        })
      );
    }
    if (result.stepUp) throw redirect(303, portalMfaUrl(token, `/p/${token}/calendar`));
    throw redirect(303, `/p/${token}/calendar`);
  }
};
