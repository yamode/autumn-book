// 本人確認（ステップアップ）: パスキーの応答を確かめ、このセッションを aal2（mfa_method='passkey'）にする（docs/auth-hardening.md §6.5・S6）。
// POST JSON { challengeId, response } → { ok:true } / { ok:false, message }
// 自分のアカウントのパスキーだけを受け付ける。counter はライブラリと DB の両方で確かめる（passkeys.ts）。
import { json } from '@sveltejs/kit';
import { passkeyRp, verifyPasskeyStepUp } from '$lib/server/partners/passkeys';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event, { mfaGate: false });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const r = await verifyPasskeyStepUp(db, {
      partner,
      accountId: session.id,
      sessionId: session.sessionId,
      challengeId: body.challengeId,
      response: body.response,
      rp,
      ip: requestMeta(event).ip
    });
    return json(r, { status: r.ok ? 200 : 400, headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
