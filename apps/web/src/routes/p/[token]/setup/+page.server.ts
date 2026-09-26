import { fail, redirect } from '@sveltejs/kit';
import { passwordProblem } from '$lib/server/partners/crypto';
import { findAccountBySetupToken, partnerUnavailableReason, setPartnerPassword } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal, setPartnerSessionCookie } from '$lib/server/partners/portal';

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
    const account = await findAccountBySetupToken(db, partner, setupToken);
    if (!account) return fail(400, { message: 'このリンクは無効か期限切れです。宿へ再発行をご依頼ください。' });
    const problem = passwordProblem(password);
    if (problem) return fail(400, { message: problem });
    if (password !== confirm) return fail(400, { message: '確認用のパスワードが一致しません。' });
    if (password.toLowerCase() === account.login_id.toLowerCase()) return fail(400, { message: 'ログインIDと同じパスワードは使えません。' });
    const sessionToken = await setPartnerPassword(db, partner, account, password, requestMeta(event));
    // 公開期間外でもパスワード設定だけは済ませられる。ログイン後の画面で公開状態を案内する。
    setPartnerSessionCookie(event.cookies, event.params.token, sessionToken);
    throw redirect(303, partnerUnavailableReason(partner) ? `/p/${event.params.token}` : `/p/${event.params.token}/calendar`);
  }
};
