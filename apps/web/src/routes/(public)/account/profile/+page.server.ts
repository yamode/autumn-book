import { fail, redirect } from '@sveltejs/kit';
import { memberById, members, withdrawnMembers } from '$lib/server/store';
import { clearSession } from '$lib/server/session';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbUpdateMyProfile, sbWithdrawMember } from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import type { Actions } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const actions: Actions = {
	update: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kana = String(form.get('kana') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const mailOptIn = form.get('mailOptIn') === 'on';
		if (!name || !kana) return fail(400, { saved: false, message: m.error_name_kana_required() });

		if (MEMBER_SUPABASE) {
			try {
				// 氏名/カナ/電話は core.guests、メルマガ同意は book.members を RPC 経由で更新。
				// locale はプロフィール画面では変更しない（null で現状維持）。
				await sbUpdateMyProfile(createSupabaseServerClient(event), { name, kana, phone, mailOptIn });
			} catch {
				return fail(400, { saved: false, message: m.error_name_kana_required() });
			}
			return { saved: true, message: '' };
		}

		const member = memberById(locals.user!.id);
		if (!member) return fail(404, { saved: false, message: '' });
		member.name = name;
		member.kana = kana;
		member.phone = phone;
		member.mailOptIn = mailOptIn;
		return { saved: true, message: '' };
	},

	// メールアドレス変更。supabase は Supabase の確認フロー（新アドレスに確認メール）、demo は即時更新。
	changeEmail: async (event) => {
		const { request, locals, url } = event;
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		if (!EMAIL_RE.test(email)) return fail(400, { emailError: m.profile_email_invalid() });

		if (MEMBER_SUPABASE) {
			try {
				const client = createSupabaseServerClient(event);
				// 新アドレスに確認リンクを送る。確認後に login email が変わり、my_profile の表示も追随する。
				const { error } = await client.auth.updateUser(
					{ email },
					{ emailRedirectTo: `${url.origin}/account/profile` }
				);
				if (error) return fail(400, { emailError: m.profile_email_change_failed() });
			} catch {
				return fail(400, { emailError: m.profile_email_change_failed() });
			}
			return { emailPending: true, pendingEmail: email };
		}

		// demo: 重複チェックのうえ即時反映
		const member = memberById(locals.user!.id);
		if (!member) return fail(404, { emailError: m.profile_email_change_failed() });
		if (members.some((me) => me.id !== member.id && me.email.toLowerCase() === email)) {
			return fail(409, { emailError: m.profile_email_duplicate() });
		}
		member.email = email;
		return { emailSaved: true };
	},

	// 退会（論理削除）。データは保持し、以後ログイン・会員機能を不可にする。
	withdraw: async (event) => {
		const { request, locals, cookies } = event;
		const form = await request.formData();
		// 確認テキスト（誤操作防止）: 「退会」を入力
		if (String(form.get('confirm') ?? '').trim() !== m.profile_withdraw_keyword()) {
			return fail(400, { withdrawError: m.profile_withdraw_keyword_error() });
		}

		if (MEMBER_SUPABASE) {
			try {
				const client = createSupabaseServerClient(event);
				await sbWithdrawMember(client); // withdrawn_at をマーク（論理削除）
				// hooks が会員解決しないよう user_metadata.member を落とし、セッションを破棄
				await client.auth.updateUser({ data: { member: false } }).catch(() => {});
				await client.auth.signOut().catch(() => {});
			} catch {
				return fail(400, { withdrawError: m.profile_withdraw_failed() });
			}
			clearSession(cookies);
			redirect(303, '/?withdrawn=1');
		}

		// demo: 退会集合に追加（ログイン不可に）＋セッション破棄
		withdrawnMembers.add(locals.user!.id);
		clearSession(cookies);
		redirect(303, '/?withdrawn=1');
	}
};
