// ログイン画面の「パスキーでログイン」: 応答を確かめてログインする（docs/auth-hardening.md §6.5・S6）。
// POST JSON { challengeId, response } → { ok:true, next } / { ok:false, message }
//   - credential_id → パスキー → アカウント → partner_id が限定URLの取引先と一致し、アカウントが有効なときだけ（passkeys.ts）
//   - パスワード不要。セッションははじめから aal2（mfa_method='passkey'）。ログイン直後の本人確認（/mfa）は求めない
//   - 試行の制限はパスワードのログインと共用（1 IP × 取引先 10 回/10 分・取引先全体 60 回/10 分）。失敗の文言は統一
//   - 端末クッキー・新しい環境からのログイン通知はパスワードのログインと同じ
import { json } from '@sveltejs/kit';
import { passkeyRp, verifyPasskeyLogin } from '$lib/server/partners/passkeys';
import {
  deferTask,
  partnerDeviceId,
  PORTAL_HEADERS,
  requestLocation,
  requestMeta,
  resolvePortal,
  setPartnerSessionCookie
} from '$lib/server/partners/portal';
import { notifyNewEnvironmentLogin, portalUrl } from '$lib/server/partners/portal-users';
import { loginPartnerWithPasskey, logPartnerAccess, partnerUnavailableReason } from '$lib/server/partners/store';
import { ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';

const FAILED = 'パスキーでログインできませんでした。このログイン画面（貴社専用のURL）で登録したパスキーかご確認のうえ、ログインIDとパスワードでお入りください。';

export const POST = async (event) => {
  const { db, partner } = await resolvePortal(event);
  const unavailable = partnerUnavailableReason(partner);
  if (unavailable) return json({ ok: false, message: unavailable }, { status: 403, headers: PORTAL_HEADERS });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  const meta = requestMeta(event);
  const ipRateKey = `${partner.id}:${ipKey(meta.ip)}`;
  const [byIp, byPartner] = await Promise.all([
    rateCheck(event.platform, RATE_RULES.partnerIp, ipRateKey),
    rateCheck(event.platform, RATE_RULES.partner, partner.id)
  ]);
  if (byIp.locked || byPartner.locked) {
    await logPartnerAccess(db, { partnerId: partner.id, channel: 'web', action: 'login_rate_limited', detail: { scope: byIp.locked ? 'ip' : 'partner', method: 'passkey' }, ip: meta.ip });
    return json({ ok: false, message: FAILED }, { status: 429, headers: PORTAL_HEADERS });
  }
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await verifyPasskeyLogin(db, { partnerId: partner.id, challengeId: body.challengeId, response: body.response, rp });
  const failed = async (reason: string, accountId?: string) => {
    await Promise.all([rateHit(event.platform, RATE_RULES.partnerIp, ipRateKey), rateHit(event.platform, RATE_RULES.partner, partner.id)]);
    await logPartnerAccess(db, { partnerId: partner.id, accountId: accountId ?? null, channel: 'web', action: 'passkey_failed', detail: { reason, at: 'login' }, ip: meta.ip });
    return json({ ok: false, message: FAILED }, { status: 400, headers: PORTAL_HEADERS });
  };
  if (!result.ok) return failed(result.reason, result.accountId);
  const deviceId = await partnerDeviceId(event);
  const login = await loginPartnerWithPasskey(db, partner, result.accountId, { ...meta, deviceId, passkeyId: result.passkeyId });
  if (!login) return failed('account_unavailable', result.accountId);
  await rateReset(event.platform, RATE_RULES.partnerIp, ipRateKey);
  setPartnerSessionCookie(event.cookies, event.params.token, login.sessionToken);
  if (login.newEnvironment) {
    deferTask(
      event,
      notifyNewEnvironmentLogin(db, {
        partner,
        account: login.account,
        meta,
        location: requestLocation(event),
        loginUrl: portalUrl(event.url.origin, event.params.token)
      })
    );
  }
  return json({ ok: true, next: `/p/${event.params.token}/calendar` }, { headers: PORTAL_HEADERS });
};
