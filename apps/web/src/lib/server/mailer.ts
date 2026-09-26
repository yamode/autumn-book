// HTMLメール送信（Cloudflare Email Sending REST API）。取引先専用ページ（autumn-rms から移設）の通知で使う。
//
// アプリは Cloudflare Pages 上で動くため、Worker ランタイムから素の fetch で REST API を叩く
// （send_email バインディングは Pages では使えないことがあるため REST を採用）。
// 第三者メールサービス不要＝送信元ドメイン(yamado.app)が Cloudflare ゾーンなので、
// `wrangler email sending enable yamado.app` で DNS(SPF/DKIM)が自動設定される。
//
// 【必要な環境変数（Cloudflare Pages）】
//   - CF_ACCOUNT_ID      … Cloudflare アカウントID
//   - CF_EMAIL_API_TOKEN … Email Sending 権限を持つ API トークン（秘匿）
//   - REPORT_EMAIL_FROM  … 送信元（任意・既定 'rms@yamado.app'）。yamado.app配下である必要がある。
// いずれか未設定なら送信せず {sent:false, reason} を返す（graceful＝本番未設定でもクラッシュしない）。
import { env as privateEnv } from '$env/dynamic/private';

const DEFAULT_FROM = 'rms@yamado.app';
const DEFAULT_FROM_NAME = 'Autumn RMS';

export type SendEmailResult = { sent: boolean; reason?: string; delivered?: number };

export async function sendHtmlEmail(args: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}): Promise<SendEmailResult> {
  const accountId = privateEnv.CF_ACCOUNT_ID;
  const token = privateEnv.CF_EMAIL_API_TOKEN;
  const from = privateEnv.REPORT_EMAIL_FROM || DEFAULT_FROM;
  const to = (args.to ?? []).filter(Boolean);

  if (!to.length) return { sent: false, reason: 'no-recipients' };
  if (!accountId || !token) return { sent: false, reason: 'email-not-configured' };

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        to: to.length === 1 ? to[0] : to,
        from: { address: from, name: args.fromName || DEFAULT_FROM_NAME },
        subject: args.subject,
        html: args.html,
        text: args.text
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { sent: false, reason: `cf-email ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => null)) as
      | { result?: { delivered?: string[]; queued?: string[] } }
      | null;
    const delivered = (data?.result?.delivered?.length ?? 0) + (data?.result?.queued?.length ?? 0);
    return { sent: true, delivered };
  } catch (e) {
    return { sent: false, reason: `email-error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
