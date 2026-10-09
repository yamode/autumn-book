// 本人確認（ステップアップ）: パスキーで確認するための options（docs/auth-hardening.md §6.5・S6）。
// POST JSON {} → { ok:true, challengeId, options } / { ok:false, message }
// 関所（ログイン直後の本人確認待ち・always / passkey_only）の中でも使えるよう mfaGate を外す。確認モードは POST 自体が 403（portal.ts）。
// パスキーを使えないホスト（*.pages.dev のプレビュー）は 404。
import { json } from '@sveltejs/kit';
import { passkeyRp, passkeyStepUpOptions } from '$lib/server/partners/passkeys';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, session } = await requirePortalApi(event, { mfaGate: false });
  const rp = passkeyRp(event);
  if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: PORTAL_HEADERS });
  try {
    const r = await passkeyStepUpOptions(db, { accountId: session.id, rp, ip: requestMeta(event).ip });
    return json({ ok: true, ...r }, { headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};
