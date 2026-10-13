// 共通ログイン画面の「パスキーでログイン」: 応答を確かめてログインする（docs/partner-common-login.md §2.3）。
// POST JSON { challengeId, response } → { ok:true, next } / { ok:false, message }
//   - credential_id → パスキー → アカウント → 取引先。取引先が公開中で、特別会員の専用ページでないときだけ
//   - パスワード不要。セッションははじめから aal2（mfa_method='passkey'）。取引先URLのパスキーのログインと同じ
//   - 試行の制限: 共通画面の 1 IP。取引先が分かれば取引先URLと同じ「IP × 取引先」「取引先全体」も合算
import { json } from '@sveltejs/kit';
import { passkeyRp, verifyPasskeyLogin } from '$lib/server/partners/passkeys';
import { deferTask, partnerDeviceId, PORTAL_HEADERS, requestLocation, requestMeta, setPartnerSessionCookie } from '$lib/server/partners/portal';
import { findPartnerTokenById, resolveCommonPortal } from '$lib/server/partners/common-login';
import { notifyNewEnvironmentLogin } from '$lib/server/partners/portal-users';
import { loginPartnerWithPasskey, logPartnerAccess, partnerAdminClient, partnerUnavailableReason } from '$lib/server/partners/store';
import { ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { partnerCommonLoginUrl } from '$lib/partner-common-login';

const FAILED = 'パスキーでログインできませんでした。ログインIDとパスワードでお入りください。';

export const POST = async (event) => {
  const db = partnerAdminClient();
  if (!db) return json({ ok: false, message: '現在ご利用いただけません。' }, { status: 503, headers: PORTAL_HEADERS });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  const meta = requestMeta(event);
  const commonKey = ipKey(meta.ip);
  if ((await rateCheck(event.platform, RATE_RULES.commonIp, commonKey)).locked) return json({ ok: false, message: FAILED }, { status: 429, headers: PORTAL_HEADERS });

  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await verifyPasskeyLogin(db, { partnerId: null, challengeId: body.challengeId, response: body.response, rp });
  const failed = async (reason: string, partnerId?: string, accountId?: string) => {
    const hits: Promise<unknown>[] = [rateHit(event.platform, RATE_RULES.commonIp, commonKey)];
    if (partnerId) {
      hits.push(rateHit(event.platform, RATE_RULES.partnerIp, `${partnerId}:${commonKey}`), rateHit(event.platform, RATE_RULES.partner, partnerId));
      hits.push(logPartnerAccess(db, { partnerId, accountId: accountId ?? null, channel: 'web', action: 'passkey_failed', detail: { reason, at: 'login', via: 'common' }, ip: meta.ip }));
    }
    await Promise.all(hits);
    return json({ ok: false, message: FAILED }, { status: 400, headers: PORTAL_HEADERS });
  };
  if (!result.ok) return failed(result.reason, result.partnerId, result.accountId);

  const token = await findPartnerTokenById(db, result.partnerId).catch(() => null);
  if (!token) return failed('partner_not_found', result.partnerId, result.accountId);
  const { partner } = await resolveCommonPortal(event, token);
  const ipRateKey = `${partner.id}:${commonKey}`;
  const [byIp, byPartner] = await Promise.all([
    rateCheck(event.platform, RATE_RULES.partnerIp, ipRateKey),
    rateCheck(event.platform, RATE_RULES.partner, partner.id)
  ]);
  if (byIp.locked || byPartner.locked) {
    await logPartnerAccess(db, { partnerId: partner.id, channel: 'web', action: 'login_rate_limited', detail: { scope: byIp.locked ? 'ip' : 'partner', method: 'passkey', via: 'common' }, ip: meta.ip });
    return json({ ok: false, message: FAILED }, { status: 429, headers: PORTAL_HEADERS });
  }
  // 停止中・公開期間外（パスキーの署名は確かめ済み＝本人なので案内を出す）
  const unavailable = partnerUnavailableReason(partner);
  if (unavailable) return json({ ok: false, message: unavailable }, { status: 403, headers: PORTAL_HEADERS });

  const deviceId = await partnerDeviceId(event, token);
  const login = await loginPartnerWithPasskey(db, partner, result.accountId, { ...meta, deviceId, passkeyId: result.passkeyId });
  if (!login) return failed('account_unavailable', partner.id, result.accountId);
  await Promise.all([rateReset(event.platform, RATE_RULES.commonIp, commonKey), rateReset(event.platform, RATE_RULES.partnerIp, ipRateKey)]);
  setPartnerSessionCookie(event.cookies, token, login.sessionToken);
  if (login.newEnvironment) {
    deferTask(
      event,
      notifyNewEnvironmentLogin(db, {
        partner,
        account: login.account,
        meta,
        location: requestLocation(event),
        loginUrl: partnerCommonLoginUrl(event.url.origin)
      })
    );
  }
  return json({ ok: true, next: `/p/${token}/calendar` }, { headers: PORTAL_HEADERS });
};
