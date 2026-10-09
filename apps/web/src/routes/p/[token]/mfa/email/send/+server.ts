// 本人確認: 認証コードをメールで送る（docs/auth-hardening.md §6.4）。POST JSON {} → { ok, to, waitSec } / { ok:false, code, message, waitSec? }
// GET → いまの状態 { aal2, maskedEmail, methods, waitSec, open }（予約一覧のモーダルがその場で本人確認するときに使う）。
// 関所（ログイン直後の本人確認待ち）の中でも使えるよう mfaGate を外す。確認モードは POST 自体が 403（portal.ts）・GET も 403。
import { json } from '@sveltejs/kit';
import { denyPreviewMfa, emailOtpStatus, issueEmailOtp, loadMfaAccount, sessionHasAal2 } from '$lib/server/partners/mfa';
import { maskEmail, mfaMethodsFor, normalizeMfaPolicy } from '$lib/partner-mfa';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event, { mfaGate: false });
  try {
    const r = await issueEmailOtp(db, { partner, accountId: session.id, ip: requestMeta(event).ip });
    return json(r, { status: r.ok ? 200 : r.code === 'wait' ? 429 : r.code === 'send_failed' ? 502 : 400, headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status, headers: PORTAL_HEADERS });
    throw e;
  }
};

export const GET = async (event) => {
  const { db, partner, session } = await requirePortalApi(event, { mfaGate: false });
  denyPreviewMfa(session);
  const policy = normalizeMfaPolicy(partner.mfa_policy);
  const account = await loadMfaAccount(db, partner.id, session.id);
  const status = account?.email ? await emailOtpStatus(db, session.id).catch(() => null) : null;
  return json(
    {
      ok: true,
      aal2: sessionHasAal2(session),
      maskedEmail: maskEmail(account?.email),
      methods: mfaMethodsFor(policy, { email: account?.email ?? null }),
      waitSec: status?.waitSec ?? 0,
      open: status?.open ?? false
    },
    { headers: PORTAL_HEADERS }
  );
};
