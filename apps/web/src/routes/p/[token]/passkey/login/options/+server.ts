// ログイン画面の「パスキーでログイン」: options を返す（セッション無しで呼ぶ・docs/auth-hardening.md §6.5・§6.7・S6）。
// POST JSON {} → { ok:true, challengeId, options } / { ok:false, message }
// allowCredentials 無し（端末に保存されたパスキーから選ぶ）。Conditional UI（ログインID欄の候補）もこの options を使う。
// 試行の制限: パスワードのログインと同じ「1 IP × 取引先」のロック中は出さない。発行も 1 IP × 取引先 10 分 30 回まで（表に行を作るため）。
import { json } from '@sveltejs/kit';
import { passkeyLoginOptions, passkeyRp } from '$lib/server/partners/passkeys';
import { PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';
import { GENERIC_LOGIN_ERROR, partnerUnavailableReason, PartnerStoreError } from '$lib/server/partners/store';
import { ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';

export const POST = async (event) => {
  const { db, partner } = await resolvePortal(event);
  const unavailable = partnerUnavailableReason(partner);
  if (unavailable) return json({ ok: false, message: unavailable }, { status: 403, headers: PORTAL_HEADERS });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  const ip = requestMeta(event).ip;
  const key = `${partner.id}:${ipKey(ip)}`;
  const [byIp, byPartner, byOpts] = await Promise.all([
    rateCheck(event.platform, RATE_RULES.partnerIp, key),
    rateCheck(event.platform, RATE_RULES.partner, partner.id),
    rateCheck(event.platform, RATE_RULES.passkeyLoginOptionsIp, key)
  ]);
  if (byIp.locked || byPartner.locked || byOpts.locked) return json({ ok: false, message: GENERIC_LOGIN_ERROR }, { status: 429, headers: PORTAL_HEADERS });
  await rateHit(event.platform, RATE_RULES.passkeyLoginOptionsIp, key);
  try {
    const r = await passkeyLoginOptions(db, { partnerId: partner.id, rp, ip });
    return json({ ok: true, ...r }, { headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
