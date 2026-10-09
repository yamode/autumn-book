import { redirect } from '@sveltejs/kit';
import { maskEmail, mfaMethodsFor, normalizeMfaPolicy, safePortalNext } from '$lib/partner-mfa';
import { emailOtpStatus, loadMfaAccount, sessionHasAal2 } from '$lib/server/partners/mfa';
import { portalHeader, PORTAL_HEADERS, portalNeedsMfa, requirePortalSession } from '$lib/server/partners/portal';

// 取引先ページの本人確認（ステップアップ・docs/auth-hardening.md §6.2〜6.4・§6.7・S3）。
// ?next= は /p/<token> の中だけ（safePortalNext）。確認が済んでいれば（関所にも掛かっていなければ）そのまま next へ。
// 確認モード（管理画面からの閲覧）は本人確認をしない（next へそのまま）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event, { mfaGate: false });
  const token = event.params.token;
  const next = safePortalNext(token, event.url.searchParams.get('next'));
  if (session.preview) throw redirect(303, next);
  if (sessionHasAal2(session) && !portalNeedsMfa(partner, session)) throw redirect(303, next);
  const policy = normalizeMfaPolicy(partner.mfa_policy);
  const account = await loadMfaAccount(db, partner.id, session.id);
  const status = account?.email ? await emailOtpStatus(db, session.id).catch(() => ({ waitSec: 0, open: false, expiresAt: null })) : { waitSec: 0, open: false, expiresAt: null };
  return {
    portal: portalHeader(partner, session),
    next,
    // 関所で止められている（ログイン直後・always）か。画面の説明を変える
    gated: portalNeedsMfa(partner, session),
    policy,
    maskedEmail: maskEmail(account?.email),
    methods: mfaMethodsFor(policy, { email: account?.email ?? null }),
    waitSec: status.waitSec,
    open: status.open
  };
};
