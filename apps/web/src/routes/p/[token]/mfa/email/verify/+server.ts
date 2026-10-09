// 本人確認: 認証コードを確かめる（docs/auth-hardening.md §6.4）。POST JSON { code } → { ok:true } / { ok:false, code, message }
// 合っていればこのセッションを aal2（mfa_at=今・mfa_method='email'）にする。確認モードは POST 自体が 403（portal.ts）。
import { json } from '@sveltejs/kit';
import { verifyEmailOtp } from '$lib/server/partners/mfa';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event, { mfaGate: false });
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await verifyEmailOtp(db, { partner, accountId: session.id, sessionId: session.sessionId, code: body.code, ip: requestMeta(event).ip });
    return json(r, { status: r.ok ? 200 : 400, headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
