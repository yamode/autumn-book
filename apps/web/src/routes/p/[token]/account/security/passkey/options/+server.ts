// アカウント → セキュリティ「パスキーを追加」: 登録の options（docs/auth-hardening.md §6.5・S6）。
// POST JSON {} → { ok:true, challengeId, options } / 403 { code:'mfa_required', next } / { ok:false, message }
// 登録は本人確認（aal2）が要る（M4）。例外は passkey_only でパスキーが 0 のアカウントが、パスワード設定リンクから入った直後 30 分
// （本人確認の手段がまだ無いため・§6.8。partner-passkey.ts canBootstrapPasskey）。
// 関所（passkey_only の本人確認待ち）の中から呼ぶので mfaGate を外し、ここで権限を確かめる。
import { json } from '@sveltejs/kit';
import { aal2ApiProblem, sessionHasAal2 } from '$lib/server/partners/mfa';
import { countPasskeys, passkeyRegistrationOptions, passkeyRp } from '$lib/server/partners/passkeys';
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
  try {
    const r = await passkeyRegistrationOptions(db, { partner, accountId: session.id, rp, ip: requestMeta(event).ip });
    return json({ ok: true, ...r }, { headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
