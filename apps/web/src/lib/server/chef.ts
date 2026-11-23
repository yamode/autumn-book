// 出張シェフ（hp-pchef）の管理画面のサーバー処理（受付枠・予約の読み書きとお客さまへのメール）。
// 設計: yamode/hp-pchef docs/design.md 5章。DB: autumn-shared 20261123043915_chef_private_chef_reservations.sql
//   と 20261123045740_chef_payment_guards.sql（期限後の確定を止める・現地払いへの切り替え to_onsite）
// - 読み取りは chef.slots / chef.reservations / chef.events（スタッフに施設単位の SELECT ポリシーあり）。
// - 変更は chef.admin_slot_set / chef.admin_reservation_action を、ログイン中のスタッフの権限（createSupabaseServerClient）で呼ぶ。
//   DB 側で auth.uid() と private.has_facility_access を確かめる（問い合わせ管理の book.admin_inquiry_edit と同じ形）。
// - 出張シェフは西和賀の施設だけで受ける（hp-pchef も西和賀の施設 ID で枠を引く）。管理画面の施設の切り替えには関係させない。
import { env as privateEnv } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from './supabase-data';
import { sendHtmlEmail } from './mailer';
import { expireCheckoutSession, retrieveCheckoutSession } from './stripe';
import {
	CHEF_AREA_LABEL,
	CHEF_PAY_DEADLINE_MESSAGE,
	CHEF_PAYMENT_LABEL,
	CHEF_STYLE_LABEL,
	chefPayDeadline,
	chefDateLabel,
	chefPartyLabel,
	chefTimeLabel,
	yen,
	type ChefStatus
} from '$lib/chef';

export const CHEF_FACILITY_ID = FACILITY_UUID['f-nishiwaga'];
export const CHEF_REPLY_TO = 'info@yamado.co.jp';

export type ChefSlot = {
	id: string;
	date: string;
	chef_staff_id: string;
	chef_name: string;
	status: 'open' | 'closed';
	note: string;
	updated_at: string;
};

export type ChefReservation = {
	id: string;
	facility_id: string;
	slot_id: string;
	date: string;
	public_token: string;
	status: ChefStatus;
	start_time: string;
	style: string;
	adults: number;
	children: number;
	infants: number;
	area: string;
	address: string;
	name: string;
	kana: string;
	email: string;
	tel: string;
	stove: string;
	allergies: string;
	purpose: string;
	notes: string;
	payment_method: 'online' | 'onsite';
	subtotal: number;
	minimum_applied: boolean;
	travel_fee: number;
	amount_ex_tax: number;
	tax: number;
	amount_total: number;
	stripe_session_id: string | null;
	stripe_payment_intent: string | null;
	paid_at: string | null;
	confirmed_at: string | null;
	declined_reason: string;
	cancel_fee: number | null;
	staff_note: string;
	revision: number;
	created_at: string;
	updated_at: string;
};

export type ChefEvent = { id: number; reservation_id: string | null; slot_id: string | null; actor_id: string | null; action: string; detail: Record<string, unknown>; created_at: string };

export const chefDb = (db: SupabaseClient) => db.schema('chef');

/** DB のエラーを画面の日本語にする */
export function chefErrorMessage(raw: string | null | undefined): string {
	const m = raw ?? '';
	if (m.includes('pay_deadline_passed')) return CHEF_PAY_DEADLINE_MESSAGE;
	if (m.includes('conflict')) return 'ほかの担当者が変更しました。再読み込みしてから操作してください。';
	if (m.includes('slot_has_reservation')) return 'この枠には予約が入っているため閉じられません。先に予約をお断り・取消してください。';
	if (m.includes('past_date')) return '過去の日は開けられません。';
	if (m.includes('invalid_transition')) return 'いまの予約の状態ではその操作はできません。再読み込みしてご確認ください。';
	if (m.includes('forbidden')) return 'この施設の権限がありません。';
	if (m.includes('not_authenticated')) return 'ログインし直してください。';
	// PostgREST の Exposed schemas に chef が無いとき（PGRST106 "The schema must be one of the following: ..."）
	if (/schema must be one of|Invalid schema/i.test(m)) return 'chef スキーマが Data API に公開されていません（Supabase の設定 → Data API → Exposed schemas に chef を追加してください）。';
	return '処理に失敗しました。時間をおいて再度お試しください。';
}

// ─────────────────────────────── メール（お客さまへ）

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function summaryLines(r: ChefReservation): [string, string][] {
	return [
		['ご利用日時', `${chefDateLabel(r.date)} ${chefTimeLabel(r.start_time)}〜`],
		['人数', chefPartyLabel(r)],
		['形式', CHEF_STYLE_LABEL[r.style] ?? r.style],
		['地域', CHEF_AREA_LABEL[r.area] ?? r.area],
		['お支払い方法', CHEF_PAYMENT_LABEL[r.payment_method] ?? r.payment_method],
		['金額（税込）', yen(r.amount_total)]
	];
}

type Mail = { subject: string; paragraphs: string[]; extra?: [string, string][]; link?: { label: string; url: string } };

function render(r: ChefReservation, mail: Mail) {
	const rows = [...summaryLines(r), ...(mail.extra ?? [])];
	const footer = ['山人-yamado- 出張シェフ', '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10', 'TEL 0197-82-2222 ／ info@yamado.co.jp', 'このメールに返信すると担当者に届きます。'];
	const text = [
		`${r.name} 様`,
		'',
		...mail.paragraphs,
		'',
		'■ ご予約の内容',
		...rows.map(([k, v]) => `${k}：${v}`),
		...(mail.link ? ['', `${mail.link.label}`, mail.link.url] : []),
		'',
		'――',
		...footer
	].join('\n');
	const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.8;color:#222">
<p>${esc(r.name)} 様</p>
${mail.paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
<table style="border-collapse:collapse;margin:12px 0">${rows
		.map(([k, v]) => `<tr><th style="text-align:left;padding:4px 12px 4px 0;color:#666;font-weight:normal;white-space:nowrap;vertical-align:top">${esc(k)}</th><td style="padding:4px 0">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
		.join('')}</table>
${mail.link ? `<p><a href="${esc(mail.link.url)}" style="display:inline-block;background:#1f3a2e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">${esc(mail.link.label)}</a><br><span style="font-size:12px;color:#666">${esc(mail.link.url)}</span></p>` : ''}
<hr style="border:0;border-top:1px solid #ddd;margin:20px 0">
<p style="font-size:12px;color:#666">${footer.map(esc).join('<br>')}</p>
</div>`;
	return { subject: mail.subject, text, html };
}

export type ChefMailAction = 'confirm' | 'decline' | 'cancel' | 'to_onsite';

/** 確定・お断り・取消・現地払いへの切り替えのメール本文を作る。作れない（必要な設定が無い）ときは error */
export function buildChefMail(action: ChefMailAction, r: ChefReservation): { subject: string; text: string; html: string } | { error: string } {
	if (action === 'confirm' && r.payment_method === 'online') {
		const origin = privateEnv.PCHEF_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
		if (!origin) {
			console.warn('[chef] PCHEF_PUBLIC_ORIGIN が未設定のため、支払いのリンク入りの確定メールを送れません');
			return { error: 'PCHEF_PUBLIC_ORIGIN が未設定のため、支払いのリンクを作れません' };
		}
		const deadline = chefPayDeadline(r.date);
		return render(r, {
			subject: '【山人 出張シェフ】ご予約が確定しました（お支払いのお願い）',
			paragraphs: [
				'このたびは山人の出張シェフをお申し込みいただき、ありがとうございます。',
				'ご予約が確定しました。下のリンクからオンラインでお支払いください。',
				`お支払いの期限は ${chefDateLabel(deadline)} です。期限を過ぎるとお支払いいただけなくなりますのでご注意ください。`
			],
			extra: [['お支払い期限', chefDateLabel(deadline)]],
			link: { label: 'お支払いへ進む', url: `${origin}/r/${r.public_token}` }
		});
	}
	if (action === 'confirm') {
		return render(r, {
			subject: '【山人 出張シェフ】ご予約が確定しました',
			paragraphs: [
				'このたびは山人の出張シェフをお申し込みいただき、ありがとうございます。',
				'ご予約が確定しました。お代金は当日、シェフに現地でお支払いください。',
				'当日お会いできることを楽しみにしております。'
			]
		});
	}
	if (action === 'to_onsite') {
		return render(r, {
			subject: '【山人 出張シェフ】お支払い方法の変更について',
			paragraphs: [
				'山人の出張シェフのご予約について、お支払い方法を「当日現地払い」に変更しました。',
				'お代金は当日、シェフに現地でお支払いください。先にお送りしたオンライン決済のリンクはお使いいただけません。',
				'当日お会いできることを楽しみにしております。'
			]
		});
	}
	if (action === 'decline') {
		return render(r, {
			subject: '【山人 出張シェフ】お申し込みについてのご連絡',
			paragraphs: [
				'このたびは山人の出張シェフをお申し込みいただき、ありがとうございます。',
				'誠に申し訳ございませんが、今回のお申し込みはお受けすることができませんでした。',
				`理由：${r.declined_reason || '（記載なし）'}`,
				'またの機会にご利用いただけましたら幸いです。'
			]
		});
	}
	return render(r, {
		subject: '【山人 出張シェフ】ご予約の取消について',
		paragraphs: ['山人の出張シェフのご予約を取り消しました。', `理由：${r.declined_reason || '（記載なし）'}`],
		extra: [['キャンセル料', r.cancel_fee ? yen(r.cancel_fee) : 'なし']]
	});
}

/** お客さまへメールを送る。送れなかったら画面に出す警告の文を返す（操作自体は成功のまま） */
export async function sendChefMail(action: ChefMailAction, r: ChefReservation): Promise<string | null> {
	const mail = buildChefMail(action, r);
	if ('error' in mail) return `お客さまへのメールを送れませんでした（${mail.error}）。別の方法でご連絡ください。`;
	const res = await sendHtmlEmail({ to: [r.email], subject: mail.subject, html: mail.html, text: mail.text, replyTo: CHEF_REPLY_TO });
	if (!res.sent) {
		console.warn('[chef] メール送信に失敗', r.id, res.reason);
		return `お客さまへのメールを送れませんでした（${res.reason ?? '不明'}）。別の方法でご連絡ください。`;
	}
	return null;
}

// ─────────────────────────────── Stripe の決済画面

/**
 * 支払い前の予約の決済画面（Checkout Session）を閉じる（取消・現地払いへの切り替えのあと）。
 * すでに閉じている（expired）・支払い済み（complete）の Session は何もしない。
 * 閉じられなかったら画面に出す警告の文を返す（操作自体は成功のまま）。
 */
export async function closeChefCheckout(r: { id: string; stripe_session_id: string | null }): Promise<string | null> {
	if (!r.stripe_session_id) return null;
	try {
		const session = await retrieveCheckoutSession(r.stripe_session_id);
		if (session.status !== 'open') return null;
		await expireCheckoutSession(r.stripe_session_id);
		return null;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// 確認と閉じるの間に期限切れ・支払い完了になったとき（Only Checkout Sessions with a status in ["open"] can be expired）
		if (/status|expired|complete/i.test(msg) && !/resource_missing/.test(msg)) return null;
		console.warn('[chef] 決済画面を閉じられませんでした', r.id, r.stripe_session_id, msg);
		return `お客さまの決済画面を閉じられませんでした（${msg}）。Stripe のダッシュボードで Checkout Session ${r.stripe_session_id} を期限切れにしてください。`;
	}
}
