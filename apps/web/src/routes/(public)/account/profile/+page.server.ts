import { fail, redirect } from '@sveltejs/kit';
import { memberById, members, withdrawnMembers, avatarByMember } from '$lib/server/store';
import { clearSession } from '$lib/server/session';
import { MEMBER_SUPABASE, createSupabaseServerClient, getSupabaseUser } from '$lib/server/auth';
import { sbUpdateMyProfile, sbWithdrawMember, sbUploadAvatar, sbSetMyAvatar } from '$lib/server/supabase-data';
import { combineName, combineKana } from '$lib/name';
import * as m from '$lib/paraglide/messages';
import type { Actions } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const actions: Actions = {
	update: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const familyName = String(form.get('familyName') ?? '').trim();
		const givenName = String(form.get('givenName') ?? '').trim();
		const middleName = String(form.get('middleName') ?? '').trim();
		const familyNameKana = String(form.get('familyNameKana') ?? '').trim();
		const givenNameKana = String(form.get('givenNameKana') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const mailOptIn = form.get('mailOptIn') === 'on';
		// 姓・名は必須（カナは任意＝海外ゲスト対応）
		if (!familyName || !givenName) return fail(400, { saved: false, message: m.error_name_required() });
		const name = combineName(familyName, givenName);
		const kana = combineKana(familyNameKana, givenNameKana);

		if (MEMBER_SUPABASE) {
			try {
				// 構造化フィールド（core.guests）＋合成 name/kana を RPC 経由で更新。locale は変更しない。
				await sbUpdateMyProfile(createSupabaseServerClient(event), {
					name, kana, phone, mailOptIn,
					familyName, givenName, middleName, familyNameKana, givenNameKana
				});
			} catch {
				return fail(400, { saved: false, message: m.error_name_required() });
			}
			return { saved: true, message: '' };
		}

		const member = memberById(locals.user!.id);
		if (!member) return fail(404, { saved: false, message: '' });
		member.familyName = familyName;
		member.givenName = givenName;
		member.middleName = middleName;
		member.familyNameKana = familyNameKana;
		member.givenNameKana = givenNameKana;
		member.name = name;
		member.kana = kana;
		member.phone = phone;
		member.mailOptIn = mailOptIn;
		return { saved: true, message: '' };
	},

	// プロフィール画像アップロード。supabase=Storage、demo=data URL をメモリ保持。
	uploadAvatar: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const file = form.get('avatar');
		if (!(file instanceof File) || file.size === 0) return fail(400, { avatarError: m.profile_avatar_error_none() });
		if (!file.type.startsWith('image/')) return fail(400, { avatarError: m.profile_avatar_error_type() });
		if (file.size > 3 * 1024 * 1024) return fail(400, { avatarError: m.profile_avatar_error_size() });

		if (MEMBER_SUPABASE) {
			try {
				const got = await getSupabaseUser(event);
				if (!got) return fail(401, { avatarError: m.profile_avatar_error_failed() });
				await sbUploadAvatar(got.client, got.user.id, file);
			} catch {
				return fail(400, { avatarError: m.profile_avatar_error_failed() });
			}
			return { avatarSaved: true };
		}

		// demo: data URL 化してメモリ保持（Cloudflare Workers 実行のため Buffer は使わず btoa）
		const bytes = new Uint8Array(await file.arrayBuffer());
		let bin = '';
		const CHUNK = 0x8000;
		for (let i = 0; i < bytes.length; i += CHUNK) {
			bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
		}
		const dataUrl = `data:${file.type};base64,${btoa(bin)}`;
		avatarByMember.set(locals.user!.id, dataUrl);
		return { avatarSaved: true };
	},

	removeAvatar: async (event) => {
		const { locals } = event;
		if (MEMBER_SUPABASE) {
			try {
				await sbSetMyAvatar(createSupabaseServerClient(event), null);
			} catch {
				return fail(400, { avatarError: m.profile_avatar_error_failed() });
			}
			return { avatarSaved: true };
		}
		avatarByMember.delete(locals.user!.id);
		return { avatarSaved: true };
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
