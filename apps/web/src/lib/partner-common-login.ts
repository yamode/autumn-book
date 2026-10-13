// 取引先の共通ログイン画面（docs/partner-common-login.md）。サーバ・画面の両方から使う。

/** 共通ログイン画面の path。端末クッキーもこの path に書く（lib/server/partners/portal.ts partnerDeviceId） */
export const PARTNER_COMMON_LOGIN_PATH = '/partner';

/** 取引先へ案内するログイン画面の URL（管理画面の表示・設定メール・新しい環境の通知の「次回以降のログイン」） */
export const partnerCommonLoginUrl = (origin: string) => `${origin.replace(/\/+$/, '')}${PARTNER_COMMON_LOGIN_PATH}`;
