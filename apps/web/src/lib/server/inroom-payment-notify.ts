// 客室案内の精算（オンライン決済）があったとき、施設の共有ID のメールアドレスへ知らせる（2026-10-17 指示）。
//
// 宛先: その施設に PMS と共通の共有ID として割り当てられたアカウント（core.memberships の role='shared_login'）のうち、
//   Book の権限がスタッフ（app_metadata.role='staff'）で、停止されていないもの。2026-10-17 時点で
//   西和賀＝info@yamado.co.jp・男鹿＝info@oga.yamado.co.jp（施設に割り当てた個人のアカウントには送らない）。
// 送るのは決済を確定したとき1回だけ（inroom-bill.ts の confirmInroomIntent が 'paid' / 'test' を受けたとき）。
// 送れなくても決済の流れは止めない（ログに残すだけ）。
import { partnerServiceClient } from './partners/admin-client';
import { sendHtmlEmail } from './mailer';
import { FACILITY_UUID } from './supabase-data';
import { facilities } from './store';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const ADMIN_BILLING_URL = 'https://book.yamado.app/admin/inroom/billing';

export type InroomPaidRow = {
	id: string;
	facility_id: string;
	amount: number;
	room_code: string | null;
	guest_name: string | null;
	payment_intent_id: string | null;
	paid_at?: string | null;
};

/** 施設の共有ID（Book のスタッフ権限）のメールアドレス */
export async function facilitySharedEmails(facilityUuid: string): Promise<string[]> {
	const svc = partnerServiceClient();
	if (!svc) return [];
	const { data, error } = await svc
		.schema('core')
		.from('memberships')
		.select('user_id')
		.eq('tenant_id', TENANT_ID)
		.eq('facility_id', facilityUuid)
		.eq('role', 'shared_login');
	if (error || !data?.length) return [];
	const emails: string[] = [];
	for (const userId of [...new Set((data as Array<{ user_id: string }>).map((m) => m.user_id))]) {
		const { data: got } = await svc.auth.admin.getUserById(userId);
		const u = got?.user;
		if (!u?.email) continue;
		if ((u.app_metadata as { role?: string } | null)?.role !== 'staff') continue;
		const banned = (u as { banned_until?: string | null }).banned_until;
		if (banned && new Date(banned).getTime() > Date.now()) continue;
		emails.push(u.email);
	}
	return emails;
}

const facilityName = (uuid: string) =>
	facilities.find((f) => (FACILITY_UUID[f.id] ?? f.id) === uuid)?.name ?? '';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const jst = (iso: string | null | undefined) =>
	new Date(iso ?? Date.now()).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** 決済のお知らせを作る（純関数・テスト用に分けてある） */
export function buildInroomPaidMail(row: InroomPaidRow, kind: 'paid' | 'test', facility: string) {
	const room = row.room_code || 'お部屋不明';
	const test = kind === 'test';
	const subject = `${test ? '【テスト】' : ''}【客室案内】オンライン決済がありました（${room}・${yen(row.amount)}）`;
	const lines: Array<[string, string]> = [
		['施設', facility || '—'],
		['お部屋', room],
		['お客様', row.guest_name ? `${row.guest_name} 様` : '—'],
		['金額', yen(row.amount)],
		['日時', jst(row.paid_at)],
		['決済番号（Stripe）', row.payment_intent_id ?? '—']
	];
	const note = test
		? '管理画面のプレビュー（見本の滞在）での本番 Stripe のテスト決済です。PMS には入れていません。返金は Stripe の管理画面から手で行ってください。'
		: 'お客様が客室案内（スマホ）から、その時点のご精算額をオンラインでお支払いになりました。PMS の請求書に「客室内オンライン決済」として入金を入れています。このあと追加のご利用があった場合は、その分だけ精算してください。';
	const text = [
		subject,
		'',
		...lines.map(([k, v]) => `${k}: ${v}`),
		'',
		note,
		'',
		`管理画面（精算案内）: ${ADMIN_BILLING_URL}`,
		'',
		'※ このメールは Book から自動で送っています（施設の共有ID 宛て）。'
	].join('\n');
	const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#1c1917">
<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${esc(subject)}</p>
<table style="border-collapse:collapse;margin:0 0 12px">${lines
		.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#78716c">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`)
		.join('')}</table>
<p style="margin:0 0 12px;${test ? 'color:#b91c1c' : ''}">${esc(note)}</p>
<p style="margin:0 0 12px"><a href="${ADMIN_BILLING_URL}">管理画面（精算案内）を開く</a></p>
<p style="margin:0;color:#a8a29e;font-size:12px">※ このメールは Book から自動で送っています（施設の共有ID 宛て）。</p>
</div>`;
	return { subject, text, html };
}

/** 決済のお知らせを送る。失敗しても例外を出さない */
export async function notifyInroomPayment(row: InroomPaidRow, kind: 'paid' | 'test'): Promise<void> {
	try {
		const to = await facilitySharedEmails(row.facility_id);
		if (!to.length) {
			console.warn('[inroom-payment-notify] 宛先（施設の共有ID）が見つかりません', row.facility_id);
			return;
		}
		const facility = facilityName(row.facility_id);
		const mail = buildInroomPaidMail(row, kind, facility);
		const r = await sendHtmlEmail({ to, ...mail, fromName: facility ? `${facility} 客室案内` : '客室案内' });
		if (!r.sent) console.warn('[inroom-payment-notify] 送れませんでした', r.reason);
	} catch (e) {
		console.error('[inroom-payment-notify]', e instanceof Error ? e.message : e);
	}
}
