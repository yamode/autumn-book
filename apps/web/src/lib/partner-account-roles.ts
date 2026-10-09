// 取引先ページのユーザー（マスタユーザー／子ユーザー）の権限判定（純関数。2026-10-01 追加）。
//
// - マスタユーザー: Book のスタッフが発行したログインID（rms_partner_accounts.is_master = true）。
//   取引先内の子ユーザーを作成・停止/再開・削除・パスワード設定リンクの再送ができる。
// - 子ユーザー: マスタが作ったログインID（is_master = false）。ユーザー管理以外はすべて使える
//   （予約・予約一覧・覚書・ご請求書・自分の担当者情報）。他のユーザーは管理できない。
// - マスタ自身・他のマスタは、取引先ページからは操作できない（停止・削除は Book のスタッフが行う）。

export type AccountRoleSubject = {
  id: string;
  partner_id: string;
  is_master: boolean;
  is_active?: boolean;
};

/** ユーザー管理（一覧・作成）を使えるか。 */
export const canManageUsers = (actor: Pick<AccountRoleSubject, 'is_master' | 'is_active'>) =>
  actor.is_master === true && actor.is_active !== false;

/** actor が target を操作（停止/再開・削除・設定リンクの再送）してよいか。 */
export function canManageAccount(actor: AccountRoleSubject, target: AccountRoleSubject): boolean {
  if (!canManageUsers(actor)) return false;
  if (actor.partner_id !== target.partner_id) return false;
  if (actor.id === target.id) return false;
  // マスタ（自分以外も）は取引先ページから触らせない
  return target.is_master === false;
}

export type AccountStatus = 'active' | 'disabled' | 'pending';

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: '有効',
  disabled: '停止',
  pending: '設定待ち'
};

/** 一覧に出す状態: 停止 → 停止／パスワード未設定 → 設定待ち／それ以外 → 有効。 */
export function accountStatus(a: { is_active: boolean; password_hash?: string | null; password_set_at?: string | null }): AccountStatus {
  if (!a.is_active) return 'disabled';
  if (!a.password_hash && !a.password_set_at) return 'pending';
  return 'active';
}

/**
 * アカウント画面のタブ。ユーザー管理はマスタだけ。お支払いカード（保存カード・2026-10-07）は全ユーザー（取引先で共有・N2）。
 * セキュリティ（ログイン中の端末・ログイン履歴・他端末ログアウト・docs/auth-hardening.md §4.4）は全ユーザー。
 */
export function accountTabs(isMaster: boolean): { path: '' | 'invoices' | 'cards' | 'security' | 'users'; label: string }[] {
  return [
    { path: '', label: '担当者情報' },
    { path: 'invoices', label: 'ご請求書' },
    { path: 'cards', label: 'お支払いカード' },
    { path: 'security', label: 'セキュリティ' },
    ...(isMaster ? [{ path: 'users' as const, label: 'ユーザー管理' }] : [])
  ];
}

/**
 * 保存カード（お支払いカード）の登録・削除・既定の変更をしてよいか（docs/auth-hardening.md §5.1・M2）。
 * マスタユーザー（有効）だけ。一覧の表示と、予約時に保存カードを選ぶのは全ユーザー（どちらも本人確認＝aal2 が別に要る）。
 */
export const canManageSavedCards = (actor: Pick<AccountRoleSubject, 'is_master' | 'is_active'>) =>
  actor.is_master === true && actor.is_active !== false;
