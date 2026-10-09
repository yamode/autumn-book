// アカウント → セキュリティ「パスキーを追加」: 登録の応答を確かめて保存する（docs/auth-hardening.md §6.5・S6）。
// POST JSON { challengeId, response, name } → { ok:true, passkey:{ id, name } } / { ok:false, message }
// 権限は options と同じ（aal2、または passkey_only の初回だけ設定リンク直後）。保存したら登録完了のメールとログ passkey_registered。
// 登録だけではセッションを aal2 にしない（passkey_only の初回は、続けてそのパスキーで本人確認してもらう）。
import { json } from '@sveltejs/kit';
import { aal2ApiProblem, sessionHasAal2 } from '$lib/server/partners/mfa';
import { countPasskeys, passkeyRp, verifyPasskeyRegistration } from '$lib/server/partners/passkeys';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';
import { canBootstrapPasskey } from '$lib/partner-passkey';
import { normalizeMfaPolicy } from '$lib/partner-mfa';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event, { mfaGate: false });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  if (!sessionHasAal2(session)) {
    const bootstrap = canBootstrapPasskey({
      policy: normalizeMfaPolicy(partner.mfa_policy),
      passkeyCount: await countPasskeys(db, session.id),
      mfaMethod: session.mfaMethod,
      sessionCreatedAt: session.createdAt
    });
    if (!bootstrap) return aal2ApiProblem(event, session, `/p/${event.params.token}/account/security`)!;
  }
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const meta = requestMeta(event);
  try {
    const r = await verifyPasskeyRegistration(db, {
      partner,
      accountId: session.id,
      challengeId: body.challengeId,
      response: body.response,
      deviceName: body.name,
      userAgent: meta.userAgent,
      rp,
      ip: meta.ip
    });
    return json(r, { status: r.ok ? 200 : 400, headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
