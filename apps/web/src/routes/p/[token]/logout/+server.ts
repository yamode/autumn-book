import { redirect } from '@sveltejs/kit';
import { endPartnerSession, partnerAdminClient } from '$lib/server/partners/store';
import { clearPartnerSessionCookie, PARTNER_SESSION_COOKIE } from '$lib/server/partners/portal';

export const POST = async ({ params, cookies }) => {
  const db = partnerAdminClient();
  if (db) await endPartnerSession(db, cookies.get(PARTNER_SESSION_COOKIE)).catch(() => undefined);
  clearPartnerSessionCookie(cookies, params.token);
  throw redirect(303, `/p/${params.token}`);
};
