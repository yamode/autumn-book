import { redirect } from '@sveltejs/kit';
import { normalizeMfaPolicy, safePortalNext } from '$lib/partner-mfa';
import { canBootstrapPasskey, ONE_PERSON_ONE_ID_NOTICE } from '$lib/partner-passkey';
import { sessionHasAal2 } from '$lib/server/partners/mfa';
import { passkeyRp, stepUpState } from '$lib/server/partners/passkeys';
import { portalHeader, PORTAL_HEADERS, portalNeedsMfa, requirePortalSession } from '$lib/server/partners/portal';

// 取引先ページの本人確認（ステップアップ・docs/auth-hardening.md §6.2〜6.5・§6.7・S3／S6）。
// ?next= は /p/<token> の中だけ（safePortalNext）。確認が済んでいれば（関所にも掛かっていなければ）そのまま next へ。
// 確認モード（管理画面からの閲覧）は本人確認をしない（next へそのまま）。
// 方法: パスキー（登録があり、このホストで使えるとき）とメールの認証コード（passkey_only では使わない）。
// passkey_only でパスキーが 0: パスワード設定リンクから入った直後 30 分だけ、ここで最初のパスキーを登録できる（§6.8・bootstrap）。
// それ以外はログインできない旨と、マスタ・宿へのリセットの依頼を案内する（PartnerStepUp の passkeyOnly）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event, { mfaGate: false });
  const token = event.params.token;
  const next = safePortalNext(token, event.url.searchParams.get('next'));
  if (session.preview) throw redirect(303, next);
  if (sessionHasAal2(session) && !portalNeedsMfa(partner, session)) throw redirect(303, next);
  const policy = normalizeMfaPolicy(partner.mfa_policy);
  const rp = passkeyRp(event);
  // パスキーを使えないホスト（プレビュー）では passkeyCount=0・登録もさせない
  const state = await stepUpState(db, event, partner, session);
  const bootstrap =
    Boolean(rp) && canBootstrapPasskey({ policy, passkeyCount: state.passkeyCount, mfaMethod: session.mfaMethod, sessionCreatedAt: session.createdAt });
  return {
    portal: portalHeader(partner, session),
    next,
    // 関所で止められている（ログイン直後・always・passkey_only）か。画面の説明を変える
    gated: portalNeedsMfa(partner, session),
    policy,
    maskedEmail: state.maskedEmail,
    methods: state.methods,
    waitSec: state.waitSec,
    open: state.open,
    bootstrap,
    oneIdNotice: ONE_PERSON_ONE_ID_NOTICE
  };
};
