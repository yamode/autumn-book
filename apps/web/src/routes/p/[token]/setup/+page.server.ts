import { fail, redirect } from '@sveltejs/kit';
import { passwordProblem } from '$lib/server/partners/crypto';
import { findAccountBySetupToken, partnerUnavailableReason, setPartnerPassword } from '$lib/server/partners/store';
import { partnerDeviceId, portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal, setPartnerSessionCookie } from '$lib/server/partners/portal';
import { ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';
import { checkTurnstile, TURNSTILE_FAILED_MESSAGE } from '$lib/server/turnstile';

// 無効なリンクの文言（無効・期限切れ・試行の制限中で同じ）
const INVALID_LINK_MESSAGE = 'このリンクは無効か期限切れです。発行した方（貴社のマスタユーザーまたは宿）へ再発行をご依頼ください。';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner } = await resolvePortal(event);
  const setupToken = event.url.searchParams.get('token') ?? '';
  const account = await findAccountBySetupToken(db, partner, setupToken);
  return {
    portal: { ...portalHeader(partner, null), bookingEnabled: false },
    unavailable: partnerUnavailableReason(partner),
    setupToken: account ? setupToken : '',
    loginId: account?.login_id ?? null,
    isReset: Boolean(account?.password_hash)
  };
};

export const actions = {
  default: async (event) => {
    const { db, partner } = await resolvePortal(event);
    const fd = await event.request.formData();
    const setupToken = String(fd.get('token') ?? '');
    const password = String(fd.get('password') ?? '');
    const confirm = String(fd.get('password_confirm') ?? '');
    const meta = requestMeta(event);
    // Turnstile と、設定トークンの総当たり対策（1 IP × 取引先 10 回/10 分 → 15 分・docs/auth-hardening.md §4.1）
    const turnstile = await checkTurnstile(fd, meta.ip);
    if (!turnstile.ok) return fail(400, { message: TURNSTILE_FAILED_MESSAGE });
    const rateKey = `${partner.id}:${ipKey(meta.ip)}`;
    if ((await rateCheck(event.platform, RATE_RULES.setupIp, rateKey)).locked) return fail(400, { message: INVALID_LINK_MESSAGE });
    const account = await findAccountBySetupToken(db, partner, setupToken);
    if (!account) {
      await rateHit(event.platform, RATE_RULES.setupIp, rateKey);
      return fail(400, { message: INVALID_LINK_MESSAGE });
    }
    const problem = passwordProblem(password);
    if (problem) return fail(400, { message: problem });
    if (password !== confirm) return fail(400, { message: '確認用のパスワードが一致しません。' });
    if (password.toLowerCase() === account.login_id.toLowerCase()) return fail(400, { message: 'ログインIDと同じパスワードは使えません。' });
    const sessionToken = await setPartnerPassword(db, partner, account, password, { ...meta, deviceId: await partnerDeviceId(event) });
    // 公開期間外でもパスワード設定だけは済ませられる。ログイン後の画面で公開状態を案内する。
    setPartnerSessionCookie(event.cookies, event.params.token, sessionToken);
    throw redirect(303, partnerUnavailableReason(partner) ? `/p/${event.params.token}` : `/p/${event.params.token}/calendar`);
  }
};
