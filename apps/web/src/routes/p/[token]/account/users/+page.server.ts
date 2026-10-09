import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { accountStatus } from '$lib/partner-account-roles';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { autoChildLoginId, portalUrl, sendChildSetupEmail } from '$lib/server/partners/portal-users';
import { isEmail } from '$lib/server/partners/staff-form';
import {
  createChildAccount,
  deleteChildAccount,
  listPortalUsers,
  logPartnerAccess,
  PartnerStoreError,
  reissueChildSetup,
  revokeAccountSessions,
  setChildAccountActive,
  type PartnerAccountRow
} from '$lib/server/partners/store';

// 取引先専用ページ: アカウント → ユーザー管理（マスタユーザーだけ。2026-10-01 追加）。
// マスタユーザーは取引先内の子ユーザーを作成・停止/再開・削除・パスワード設定リンクの再送ができる。
// 権限は store.ts の requireMasterAccount / requireChildTarget が DB 条件で毎回確かめる（ここでの session.is_master は入口の早期判定）。

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  // 子ユーザーが URL を直打ちしたら担当者情報へ戻す
  if (!session.is_master) throw redirect(303, `/p/${event.params.token}/account`);
  let rows: PartnerAccountRow[];
  try {
    rows = await listPortalUsers(db, partner.id, session.id);
  } catch (e) {
    if (e instanceof PartnerStoreError && e.status === 403) throw error(403, e.message);
    throw e;
  }
  // パスワードのハッシュ等は画面へ渡さない（表示に要る列だけ）
  const users = rows.map((a) => ({
    id: a.id,
    loginId: a.login_id,
    displayName: a.display_name,
    email: a.email,
    status: accountStatus(a),
    isMaster: a.is_master,
    isSelf: a.id === session.id,
    lastLoginAt: a.last_login_at,
    lockedUntil: a.locked_until && new Date(a.locked_until).getTime() > Date.now() ? a.locked_until : null,
    createdAt: a.created_at
  }));
  return {
    portal: portalHeader(partner, session),
    users
  };
};

function failure(e: unknown) {
  if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.message });
  throw e;
}

async function masterScope(event: RequestEvent) {
  const scope = await requirePortalSession(event);
  if (!scope.session.is_master) throw error(403, 'ユーザー管理はマスタユーザーだけが使えます。');
  return scope;
}

type Scope = Awaited<ReturnType<typeof masterScope>>;

// パスワード設定リンクをメールで送る。送れなかったときはリンクを画面に出す（マスタから本人へ伝えてもらう）。
async function deliverSetupLink(event: RequestEvent, s: Scope, account: PartnerAccountRow, setupToken: string, isReset: boolean) {
  const token = event.params.token ?? '';
  const origin = event.url.origin;
  const setupUrl = portalUrl(origin, token, `/setup?token=${encodeURIComponent(setupToken)}`);
  const result = account.email
    ? await sendChildSetupEmail(s.db, {
        partner: s.partner,
        to: account.email,
        displayName: account.display_name,
        loginId: account.login_id,
        issuedBy: s.session.display_name || s.session.login_id,
        setupUrl,
        loginUrl: portalUrl(origin, token),
        isReset
      })
    : { sent: false, reason: 'メールアドレスがありません。' };
  return {
    loginId: account.login_id,
    email: account.email,
    emailSent: result.sent,
    // 送れなかったときだけリンクを返す（送れたときは画面に残さない）
    setupUrl: result.sent ? null : setupUrl,
    emailReason: result.sent ? null : (result.reason ?? null)
  };
}

export const actions = {
  create: async (event) => {
    const s = await masterScope(event);
    const fd = await event.request.formData();
    const values = {
      login_id: String(fd.get('login_id') ?? '').trim(),
      display_name: String(fd.get('display_name') ?? '').trim().slice(0, 80),
      email: String(fd.get('email') ?? '').trim()
    };
    try {
      if (!values.display_name) throw new PartnerStoreError('お名前を入力してください。');
      if (!values.email) throw new PartnerStoreError('メールアドレスを入力してください。');
      if (!isEmail(values.email) || values.email.length > 254) throw new PartnerStoreError('メールアドレスの形式が正しくありません。');
      // 自動採番の接頭辞は作るマスタユーザーのログインIDから（施設の接頭辞はやめた・2026-10-09）
      const loginId = values.login_id || autoChildLoginId(s.session.login_id);
      const { account, setupToken } = await createChildAccount(s.db, s.partner.id, s.session.id, {
        loginId,
        displayName: values.display_name,
        email: values.email
      });
      const issued = await deliverSetupLink(event, s, account, setupToken, false);
      await logPartnerAccess(s.db, {
        partnerId: s.partner.id,
        accountId: s.session.id,
        channel: 'web',
        action: 'child_create',
        detail: { targetAccountId: account.id, loginId: account.login_id, emailSent: issued.emailSent },
        ip: requestMeta(event).ip
      });
      return { created: issued };
    } catch (e) {
      const r = failure(e);
      return fail(r.status, { ...r.data, values });
    }
  },

  resend: async (event) => {
    const s = await masterScope(event);
    const fd = await event.request.formData();
    try {
      const { account, setupToken } = await reissueChildSetup(s.db, s.partner.id, s.session.id, String(fd.get('account_id') ?? ''));
      const issued = await deliverSetupLink(event, s, account, setupToken, Boolean(account.password_hash));
      await logPartnerAccess(s.db, {
        partnerId: s.partner.id,
        accountId: s.session.id,
        channel: 'web',
        action: 'child_setup_resend',
        detail: { targetAccountId: account.id, loginId: account.login_id, emailSent: issued.emailSent },
        ip: requestMeta(event).ip
      });
      return { resent: issued };
    } catch (e) {
      return failure(e);
    }
  },

  toggle: async (event) => {
    const s = await masterScope(event);
    const fd = await event.request.formData();
    const active = String(fd.get('op') ?? '') === 'enable';
    try {
      const account = await setChildAccountActive(s.db, s.partner.id, s.session.id, String(fd.get('account_id') ?? ''), active);
      await logPartnerAccess(s.db, {
        partnerId: s.partner.id,
        accountId: s.session.id,
        channel: 'web',
        action: active ? 'child_enable' : 'child_disable',
        detail: { targetAccountId: account.id, loginId: account.login_id },
        ip: requestMeta(event).ip
      });
      return { updated: { loginId: account.login_id, active } };
    } catch (e) {
      return failure(e);
    }
  },

  // 子ユーザーをすべての端末からログアウトさせる（停止はしない・docs/auth-hardening.md §4.4）
  logout_all: async (event) => {
    const s = await masterScope(event);
    const fd = await event.request.formData();
    try {
      const { account, count } = await revokeAccountSessions(s.db, s.partner.id, s.session.id, String(fd.get('account_id') ?? ''));
      await logPartnerAccess(s.db, {
        partnerId: s.partner.id,
        accountId: s.session.id,
        channel: 'web',
        action: 'child_logout_all',
        detail: { targetAccountId: account.id, loginId: account.login_id, count },
        ip: requestMeta(event).ip
      });
      return { loggedOut: { loginId: account.login_id, count } };
    } catch (e) {
      return failure(e);
    }
  },

  delete: async (event) => {
    const s = await masterScope(event);
    const fd = await event.request.formData();
    try {
      const account = await deleteChildAccount(s.db, s.partner.id, s.session.id, String(fd.get('account_id') ?? ''));
      await logPartnerAccess(s.db, {
        partnerId: s.partner.id,
        accountId: s.session.id,
        channel: 'web',
        action: 'child_delete',
        detail: { targetAccountId: account.id, loginId: account.login_id },
        ip: requestMeta(event).ip
      });
      return { deleted: { loginId: account.login_id } };
    } catch (e) {
      return failure(e);
    }
  }
};
