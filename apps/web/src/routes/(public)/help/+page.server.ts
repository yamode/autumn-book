// ヘルプページ（/help・docs/member-support.md「お客様側」）: よくある質問と、いちばん下の問い合わせフォーム。
//   - よくある質問: book.support_faqs_public（anon で読める）。デモ（DATA_SOURCE=demo）は初期データと同じ見本
//   - フォーム: Turnstile → 回数制限（IP・メール）→ book.support_submit（service_role）→ 受付の控え・宿への通知（応答の後）
//     デモでは保存も送信もせず、完了の表示だけ
import { fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { DATA_SOURCE, supa } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { memberById } from '$lib/server/store';
import { checkTurnstile } from '$lib/server/turnstile';
import { clientIp, hashKeyPart, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import { waitUntilOf } from '$lib/server/access-log-core';
import { SUPPORT_BODY_MAX, sendSubmitMails, submitSupportTicket, supportServiceAvailable } from '$lib/server/member-support';
import { DEMO_SUPPORT_FAQS, isSupportCategory, oneLine, SUPPORT_EMAIL, type SupportFaq } from '$lib/support';
import { supportMailEnabled } from '$lib/server/support-mail-flag';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function loadFaqs(): Promise<SupportFaq[]> {
	if (DATA_SOURCE !== 'supabase') return DEMO_SUPPORT_FAQS;
	try {
		const { data, error } = await supa().rpc('support_faqs_public');
		if (error) throw error;
		return (Array.isArray(data) ? data : []) as SupportFaq[];
	} catch (e) {
		console.error('[help] よくある質問を読めませんでした', e instanceof Error ? e.message : e);
		return [];
	}
}

/** ログイン中の会員（メールの初期値と、問い合わせに付ける会員の id）。Supabase では getUser で確かめた値だけを使う */
async function currentMember(event: RequestEvent): Promise<{ userId: string | null; email: string; name: string }> {
	const u = event.locals.user;
	if (u?.role !== 'member') return { userId: null, email: '', name: '' };
	if (MEMBER_SUPABASE) {
		const { data } = await createSupabaseServerClient(event)
			.auth.getUser()
			.catch(() => ({ data: { user: null } }));
		const user = data.user;
		if (!user) return { userId: null, email: '', name: '' };
		return { userId: user.id, email: user.email ?? '', name: u.name ?? '' };
	}
	const demo = memberById(u.id);
	// デモの会員は auth.users に居ないので id は付けない（保存もしない）
	return { userId: null, email: demo?.email ?? '', name: demo?.name ?? u.name ?? '' };
}

export const load: PageServerLoad = async (event) => {
	const [faqs, member] = await Promise.all([loadFaqs(), currentMember(event)]);
	return {
		faqs,
		prefill: { name: member.name, email: member.email },
		isMember: event.locals.user?.role === 'member',
		// support@ の受信が動いているときだけアドレスを出す（SUPPORT_MAIL_ENABLED）
		supportEmail: supportMailEnabled() ? SUPPORT_EMAIL : null
	};
};

export const actions: Actions = {
	submit: async (event) => {
		const form = await event.request.formData();
		const values = {
			// 名前・件名は改行などの制御文字を空白に（控え・通知メールの件名や宛名に改行を持ち込ませない）
			name: oneLine(String(form.get('name') ?? '')).slice(0, 100),
			email: String(form.get('email') ?? '').trim().toLowerCase(),
			category: String(form.get('category') ?? ''),
			subject: oneLine(String(form.get('subject') ?? '')).slice(0, 200),
			body: String(form.get('body') ?? '').replace(/\r\n?/g, '\n').trim()
		};
		const bad = (status: number, message: string, field?: string) => fail(status, { values, message, field });

		if (!values.name) return bad(400, m.support_error_name(), 'name');
		if (!EMAIL_RE.test(values.email) || values.email.length > 254) return bad(400, m.error_email_invalid(), 'email');
		if (!isSupportCategory(values.category)) return bad(400, m.support_error_category(), 'category');
		if (!values.body) return bad(400, m.support_error_body(), 'body');
		if (values.body.length > SUPPORT_BODY_MAX) return bad(400, m.support_error_too_long(), 'body');
		if (form.get('privacyConsent') !== 'on') return bad(400, m.migrate_consent_required(), 'privacyConsent');

		const ip = clientIp(event.request);
		if (!(await checkTurnstile(form, ip, { action: 'support-submit', hostname: event.url.hostname })).ok) {
			return bad(400, m.auth_turnstile_failed());
		}

		// 回数制限（IP・メール）。どちらかに届いていたら送らずに知らせる（自分の送信なので伝えてよい）
		const ipId = ipKey(ip);
		const emailId = await hashKeyPart(values.email);
		const checks = await Promise.all([
			rateCheck(event.platform, RATE_RULES.supportSubmitIp, ipId),
			rateCheck(event.platform, RATE_RULES.supportSubmitEmail, emailId)
		]);
		if (checks.some((c) => c.locked)) return bad(429, m.support_too_many());
		await Promise.all([
			rateHit(event.platform, RATE_RULES.supportSubmitIp, ipId),
			rateHit(event.platform, RATE_RULES.supportSubmitEmail, emailId)
		]);

		// デモ: 保存・送信はしない（完了の表示だけ）
		if (DATA_SOURCE !== 'supabase') {
			return { sent: true as const, demo: true, code: 'YS-DEMO00', email: values.email };
		}
		if (!supportServiceAvailable()) return bad(503, m.support_unavailable());

		const member = await currentMember(event);
		const input = { ...values, memberUserId: member.userId };
		let ticket: { id: string; code: string };
		try {
			ticket = await submitSupportTicket(input);
		} catch (e) {
			console.error('[help] 問い合わせを保存できませんでした', e instanceof Error ? e.message : e);
			return bad(503, m.support_unavailable());
		}
		// メールは応答の後に送る（失敗しても受付は済んでいる）
		const job = sendSubmitMails({ ...input, ...ticket }).catch((e) => console.error('[help] メール', e instanceof Error ? e.message : e));
		const wait = waitUntilOf(event.platform);
		if (wait) wait(job);
		else await job; // 開発中（waitUntil が無い）
		return { sent: true as const, demo: false, code: ticket.code, email: values.email };
	}
};
