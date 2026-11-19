// 旧会員（以前の予約システム tripla の会員）を Book の会員へ移す（2026-11-19）。
//
// 流れ（DB は autumn-shared 20261119115140・すべて service_role の RPC）:
//   1. /auth/migrate でメールを入力 → inviteLegacyMember。旧会員の一覧（book.legacy_members）にあり・未移行・
//      まだ Book 会員でないときだけ、24 時間有効の専用リンクをメールで送る。トークンは DB にハッシュだけ残す。
//      一覧に無くても画面は同じ表示（会員かどうかを外から探らせない）。
//   2. /auth/migrate/[token] で旧会員の登録内容を入れた画面を出し、パスワードを決めてもらう → completeLegacyMigration:
//      ① legacy_member_prepare … 取込時に照合した PMS の顧客にこのメールを紐づける
//      ② Supabase Auth のユーザーを作る（メールはリンクで受信を確かめたので確認済み）。既にあればパスワードを設定
//      ③ そのパスワードでサインイン（Cookie のセッション）→ register_member（確認済みのメールで ① の顧客と名寄せされる）
//      ④ legacy_member_complete … 移行済みにしてトークンを消し、会員ランクを計算し直す
//         （ランクは通算の公式・直販の利用回数・book._member_lifetime_stays。紐づいた顧客の過去の利用がそのまま入る）
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { sendHtmlEmail } from '$lib/server/mailer';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbRegisterMember, sbUpdateMyProfile } from '$lib/server/supabase-data';
import { combineKana, combineName } from '$lib/name';

export type LegacyProfile = {
	email: string;
	familyName: string;
	givenName: string;
	familyNameKana: string;
	givenNameKana: string;
	phone: string;
	zip: string;
	address: string;
	birthdate: string;
	alreadyMember: boolean;
};

export class LegacyMigrationError extends Error {
	constructor(public code: 'unavailable' | 'invalid' | 'already_member' | 'password' | 'failed', message: string = code) {
		super(message);
	}
}

const bookRpc = (svc: SupabaseClient) => svc.schema('book');

/** 推測できない 32 バイトのトークン（URL に載せる。base64url） */
export function newMigrationToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DB に残すのはトークンの SHA-256（16 進 64 桁）だけ */
export async function migrationTokenHash(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL のトークンとして形が正しいか（DB に問い合わせる前に弾く） */
export function isMigrationToken(token: string): boolean {
	return /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

/**
 * 移行の案内メールを送る（対象でなければ何もしない）。戻り値は画面の表示に使わない（常に同じ案内を出す）。
 */
export async function inviteLegacyMember(email: string, origin: string): Promise<{ sent: boolean; reason?: string }> {
	const svc = partnerServiceClient();
	if (!svc) throw new LegacyMigrationError('unavailable');
	const token = newMigrationToken();
	const { data, error } = await bookRpc(svc).rpc('legacy_member_invite', { p_email: email, p_token_hash: await migrationTokenHash(token) });
	if (error) throw new LegacyMigrationError('failed', error.message);
	const r = (data ?? {}) as { eligible?: boolean; reason?: string; name?: string };
	if (!r.eligible) return { sent: false, reason: r.reason };
	const link = `${origin}/auth/migrate/${token}`;
	const mail = await sendHtmlEmail({
		to: [email],
		subject: '【YAMADO】会員移行のご案内',
		text: inviteText(r.name ?? '', link),
		html: inviteHtml(r.name ?? '', link)
	}).catch(() => ({ sent: false }));
	return { sent: mail.sent };
}

function inviteText(name: string, link: string): string {
	return [
		`${name ? `${name} 様` : 'お客様'}`,
		'',
		'山人（YAMADO）の新しい予約システムへの会員移行のお手続きをご案内します。',
		'以前の予約システムでご登録いただいていた内容を引き継いで、新しい会員にご登録いただけます。',
		'',
		'下のリンクを開き、内容をご確認のうえパスワードを決めてください（24時間有効です）。',
		link,
		'',
		'これまでの公式サイト・お電話でのご宿泊は、新しい会員ランクにも反映されます。',
		'',
		'このメールにお心当たりがない場合は、何もせずに破棄してください。リンクを開かなければ登録は行われません。'
	].join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inviteHtml(name: string, link: string): string {
	return inviteText(name, link)
		.split('\n')
		.map((l) =>
			l === link
				? `<p style="margin:12px 0"><a href="${esc(link)}" style="display:inline-block;background:#8a6d2b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">会員移行の手続きへ進む</a></p>`
				: l
					? `<p style="margin:0 0 6px">${esc(l)}</p>`
					: '<p style="margin:0 0 6px">&nbsp;</p>'
		)
		.join('');
}

/** リンク先の表示用（有効期限内・未移行のときだけ） */
export async function legacyProfileByToken(token: string): Promise<LegacyProfile | null> {
	if (!isMigrationToken(token)) return null;
	const svc = partnerServiceClient();
	if (!svc) throw new LegacyMigrationError('unavailable');
	const { data, error } = await bookRpc(svc).rpc('legacy_member_by_token', { p_token_hash: await migrationTokenHash(token) });
	if (error) throw new LegacyMigrationError('failed', error.message);
	if (!data) return null;
	const d = data as Record<string, unknown>;
	const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
	return {
		email: s('email'),
		familyName: s('family_name'),
		givenName: s('given_name'),
		familyNameKana: s('family_name_kana'),
		givenNameKana: s('given_name_kana'),
		phone: s('phone'),
		zip: s('zip'),
		address: s('address'),
		birthdate: s('birthdate'),
		alreadyMember: d.already_member === true
	};
}

/** パスワードの規則（マイページのパスワード設定と同じ: 12 文字以上・UTF-8 で 72 バイト以内） */
export function migrationPasswordError(password: string, confirm: string): 'short' | 'long' | 'mismatch' | null {
	if (password.length < 12) return 'short';
	if (new TextEncoder().encode(password).length > 72) return 'long';
	if (password !== confirm) return 'mismatch';
	return null;
}

export type MigrationInput = {
	familyName: string;
	givenName: string;
	familyNameKana: string;
	givenNameKana: string;
	phone: string;
	mailOptIn: boolean;
	password: string;
	locale: string;
};

/** 移行を完了して会員にする（ログインした状態になる）。戻り値は入会ボーナスのポイント */
export async function completeLegacyMigration(event: RequestEvent, token: string, input: MigrationInput): Promise<{ bonus: number }> {
	const svc = partnerServiceClient();
	if (!svc) throw new LegacyMigrationError('unavailable');
	const profile = await legacyProfileByToken(token);
	if (!profile) throw new LegacyMigrationError('invalid');
	if (profile.alreadyMember) throw new LegacyMigrationError('already_member');
	const hash = await migrationTokenHash(token);
	const email = profile.email;
	const name = combineName(input.familyName, input.givenName);
	const kana = combineKana(input.familyNameKana, input.givenNameKana);

	// ① 照合済みの PMS 顧客にこのメールを紐づける（register_member がその顧客と名寄せする）
	const prep = await bookRpc(svc).rpc('legacy_member_prepare', { p_token_hash: hash });
	if (prep.error) throw new LegacyMigrationError(prep.error.message.includes('invalid_token') ? 'invalid' as const : 'failed' as const, prep.error.message);

	// ② ログイン用のアカウント（メールはリンクで受信を確かめたので確認済み）
	const created = await svc.auth.admin.createUser({
		email,
		password: input.password,
		email_confirm: true,
		user_metadata: { member: true, name }
	});
	if (created.error) {
		const msg = created.error.message ?? '';
		if (/weak|password/i.test(msg) && !/already/i.test(msg)) throw new LegacyMigrationError('password', msg);
		// 既にアカウントがある（ログインしたことはあるが会員登録していない人）→ そのアカウントにパスワードを設定
		const link = await svc.auth.admin.generateLink({ type: 'magiclink', email });
		const userId = link.data?.user?.id;
		if (link.error || !userId) throw new LegacyMigrationError('failed', link.error?.message ?? msg);
		const upd = await svc.auth.admin.updateUserById(userId, { password: input.password, email_confirm: true, user_metadata: { member: true, name } });
		if (upd.error) throw new LegacyMigrationError(/weak|password/i.test(upd.error.message) ? 'password' as const : 'failed' as const, upd.error.message);
	}

	// ③ そのパスワードでサインイン（Cookie のセッション）→ 会員登録
	const client = createSupabaseServerClient(event);
	const signed = await client.auth.signInWithPassword({ email, password: input.password });
	if (signed.error || !signed.data.user) throw new LegacyMigrationError('failed', signed.error?.message ?? 'sign_in_failed');
	let bonus = 0;
	try {
		const reg = await sbRegisterMember(client, {
			name,
			kana,
			phone: input.phone || undefined,
			mailOptIn: input.mailOptIn,
			locale: input.locale,
			familyName: input.familyName,
			givenName: input.givenName,
			familyNameKana: input.familyNameKana,
			givenNameKana: input.givenNameKana
		});
		bonus = Math.max(0, Number(reg.welcome_bonus ?? 0) || 0);
	} catch (e) {
		if (!(e instanceof Error && e.message.includes('already_registered'))) throw new LegacyMigrationError('failed', e instanceof Error ? e.message : String(e));
	}
	// 住所・生年月日（旧会員の登録内容。読めなくても会員登録は終わっている）
	if (profile.zip || profile.address || profile.birthdate) {
		await sbUpdateMyProfile(client, {
			name,
			kana,
			phone: input.phone || undefined,
			zip: profile.zip,
			address: profile.address,
			address2: '',
			birthdate: profile.birthdate,
			mailOptIn: input.mailOptIn,
			familyName: input.familyName,
			givenName: input.givenName,
			familyNameKana: input.familyNameKana,
			givenNameKana: input.givenNameKana
		}).catch((e) => console.error('[legacy-members] 住所・生年月日の引き継ぎに失敗', e instanceof Error ? e.message : e));
	}
	await client.auth.updateUser({ data: { name, member: true } }).catch(() => {});

	// ④ 移行済みにして、会員ランクを計算し直す
	const done = await bookRpc(svc).rpc('legacy_member_complete', { p_token_hash: hash, p_user_id: signed.data.user.id });
	if (done.error) console.error('[legacy-members] 移行済みの記録に失敗（会員登録は完了）', done.error.message);
	return { bonus };
}
