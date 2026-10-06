import { fail, redirect } from '@sveltejs/kit';
import { loginPartner, partnerUnavailableReason } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal, setPartnerSessionCookie } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { partner, session } = await resolvePortal(event);
  const unavailable = partnerUnavailableReason(partner);
  if (session && (!unavailable || session.preview)) throw redirect(303, `/p/${event.params.token}/calendar`);
  return {
    portal: portalHeader(partner, session),
    unavailable
  };
};

export const actions = {
  default: async (event) => {
    const { db, partner } = await resolvePortal(event);
    const unavailable = partnerUnavailableReason(partner);
    if (unavailable) return fail(403, { message: unavailable, loginId: '' });
    const fd = await event.request.formData();
    const loginId = String(fd.get('login_id') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!loginId || !password) return fail(400, { message: 'ログインIDとパスワードを入力してください。', loginId });
    const result = await loginPartner(db, partner, loginId, password, requestMeta(event));
    if (!result.ok) return fail(400, { message: result.message, loginId });
    setPartnerSessionCookie(event.cookies, event.params.token, result.sessionToken);
    throw redirect(303, `/p/${event.params.token}/calendar`);
  }
};
