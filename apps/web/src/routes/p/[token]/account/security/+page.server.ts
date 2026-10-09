import { fail } from '@sveltejs/kit';
import { LOGIN_LOG_LABELS, summarizeUserAgent } from '$lib/partner-login-security';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { listOwnSecurityLogs, listOwnSessions, logPartnerAccess, PartnerStoreError, revokeOtherSessions, revokeOwnSession } from '$lib/server/partners/store';

// 取引先専用ページ: アカウント → セキュリティ（docs/auth-hardening.md §4.4・S2）。
// 自分のログイン中の端末と、直近 30 件のログイン関係の記録を出し、他の端末をログアウトできる。
// 読み書きはセッションで確かめた自分のアカウント（session.id）の行だけ。第2要素の設定（§6）は S3 以降でここに足す。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  // 管理画面からの確認モードは取引先のアカウントではないので出さない
  if (session.preview) return { portal: portalHeader(partner, session), preview: true, sessions: [], logs: [], loadError: null };
  try {
    const [sessions, logs] = await Promise.all([listOwnSessions(db, session.id), listOwnSecurityLogs(db, partner.id, session.id, 30)]);
    return {
      portal: portalHeader(partner, session),
      preview: false,
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        ip: s.ip,
        browser: summarizeUserAgent(s.user_agent),
        current: s.id === session.sessionId
      })),
      logs: logs.map((l) => ({
        id: l.id,
        at: l.created_at,
        label: LOGIN_LOG_LABELS[l.action] ?? l.action,
        action: l.action,
        ip: l.ip,
        notified: l.action === 'login_new_device' ? (l.detail as { notified?: boolean } | null)?.notified === true : null
      })),
      loadError: null
    };
  } catch (e) {
    if (!(e instanceof PartnerStoreError)) throw e;
    return { portal: portalHeader(partner, session), preview: false, sessions: [], logs: [], loadError: e.message };
  }
};

export const actions = {
  // 他の端末からログアウト（いまのブラウザ以外のセッションをすべて消す）
  logout_others: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    try {
      const count = await revokeOtherSessions(db, session.id, session.sessionId);
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'logout_others',
        detail: { count },
        ip: requestMeta(event).ip
      });
      return { loggedOut: count };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  },

  // 端末を 1 つログアウト（自分のアカウントのセッションだけ。いまのブラウザはヘッダーのログアウトを使ってもらう）
  logout_session: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const id = String(fd.get('session_id') ?? '');
    if (id === session.sessionId) return fail(400, { message: 'このブラウザは、画面上部の「ログアウト」からログアウトしてください。' });
    try {
      const ok = await revokeOwnSession(db, session.id, id);
      if (!ok) return fail(404, { message: 'その端末は見つかりませんでした（すでにログアウトしています）。' });
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: session.id,
        channel: 'web',
        action: 'logout_session',
        ip: requestMeta(event).ip
      });
      return { loggedOut: 1 };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  }
};
