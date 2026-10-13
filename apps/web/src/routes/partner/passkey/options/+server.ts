// 共通ログイン画面の「パスキーでログイン」: options を返す（docs/partner-common-login.md §2.3）。
// POST JSON {} → { ok:true, challengeId, options } / { ok:false, message }
// どの取引先か分かる前なので、チャレンジは取引先なし（account_id・partner_id とも null）で発行する。
// 試行の制限: 共通画面の 1 IP のロック中は出さない。発行も 1 IP 10 分 30 回まで（表に行を作るため・取引先URLと同じ数）。
import { json } from '@sveltejs/kit';
import { passkeyLoginOptions, passkeyRp } from '$lib/server/partners/passkeys';
import { PORTAL_HEADERS, requestMeta } from '$lib/server/partners/portal';
import { GENERIC_LOGIN_ERROR, partnerAdminClient, PartnerStoreError } from '$lib/server/partners/store';
import { ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';

export const POST = async (event) => {
  const db = partnerAdminClient();
  if (!db) return json({ ok: false, message: '現在ご利用いただけません。' }, { status: 503, headers: PORTAL_HEADERS });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  const ip = requestMeta(event).ip;
  const key = `common:${ipKey(ip)}`;
  const [byIp, byOpts] = await Promise.all([
    rateCheck(event.platform, RATE_RULES.commonIp, ipKey(ip)),
    rateCheck(event.platform, RATE_RULES.passkeyLoginOptionsIp, key)
  ]);
  if (byIp.locked || byOpts.locked) return json({ ok: false, message: GENERIC_LOGIN_ERROR }, { status: 429, headers: PORTAL_HEADERS });
  await rateHit(event.platform, RATE_RULES.passkeyLoginOptionsIp, key);
  try {
    const r = await passkeyLoginOptions(db, { partnerId: null, rp, ip });
    return json({ ok: true, ...r }, { headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
