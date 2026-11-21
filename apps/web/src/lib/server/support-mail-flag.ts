// 会員サポートのメール窓口（support@yamado.app）を使うか（docs/member-support.md「実装で決めたこと」）。
// SUPPORT_MAIL_ENABLED='true' のときだけ:
//   - 会員向けメールの問い合わせ先に support@yamado.app を載せる
//   - 受付の控え・管理画面の返信を From・Reply-To とも support@ で送る
// 'true' でないとき（support@ の受信＝Email Routing と受信用 Worker がまだ動いていない）は、お客様が support@ に送っても
// 届かないので、アドレスを出さず、控え・返信は REPORT_EMAIL_FROM から返信先なしで送り、返信はヘルプページのフォームへ案内する。
import { env as privateEnv } from '$env/dynamic/private';
import { supportContactLine } from '$lib/support';

export const supportMailEnabled = (value: string | null | undefined = privateEnv.SUPPORT_MAIL_ENABLED): boolean => String(value ?? '').trim() === 'true';

/** 会員向けメールの末尾に足す「お問い合わせ先」の 1 行（いまの設定で） */
export const memberSupportContactLine = (): string => supportContactLine(supportMailEnabled());
