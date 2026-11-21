// 旧会員（以前の予約システム tripla の会員）を Book の会員へ移す v3（2026-11-19）。
// 設計: docs/legacy-member-migration-design.md（§10 Fable のレビューを反映）。DB: autumn-shared 20261119132049・20261119132737。
//
// 流れ:
//   1. /auth/migrate でメールを入力 → requestLegacyInvite。画面は常に同じ表示で、メールは応答の後（waitUntil）に送る。
//        invite … 一覧にあり・まだアカウントが無い → 24 時間有効・1 回限りの移行リンク
//        member … 既に Book 会員 → 「ログインしてください」のメール
//        login  … アカウントはあるが会員でない（コードでログインしただけ・LINE・退会など）→ 「ログインしてから引き継いでください」
//        none   … 何も送らない（一覧に無い・スタッフ・回数超過）
//   2. リンク（/auth/migrate/<トークン>）は開いたらトークンを HttpOnly Cookie に移し、URL から消して /auth/migrate/continue へ。
//   3. continue で、氏名・カナ（以前の内容）を確かめ、電話を入力し直し、新しいパスワードを決める → completeLegacyMigration:
//        アカウントを作る（既にあれば作らずに止める＝リンクでは既存のアカウントにパスワードを設定しない）→ サインイン →
//        legacy_member_finish（1 トランザクション。紐づけ先は DB が決める）→ 完了通知のメール。
//   4. 既に会員の人はマイページ（/account/legacy）から claimLegacyMember（電話を入力し直す）。
//   紐づけを誤ると他人の情報がマイページに出るので、PMS の顧客への紐づけは DB の条件（メール・氏名・電話の一致・会員なし）を
//   満たすときだけ。満たさないものは職員の確認待ち（/admin の「旧会員の確認」）。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { sendHtmlEmail } from '$lib/server/mailer';
import { createSupabaseServerClient } from '$lib/server/auth';
import { combineName } from '$lib/name';

/** 同意を取ったプライバシーポリシーの版（/legal/privacy を改定したら変える） */
export const LEGACY_PRIVACY_VERSION = 'privacy-2026-11';
/** リンクから移したトークンの Cookie（/auth/migrate の下だけ） */
export const MIGRATE_COOKIE = 'ab_migrate';

export type LegacyProfile = {
	email: string;
	familyName: string;
	givenName: string;
	familyNameKana: string;
	givenNameKana: string;
	phoneLast4: string;
	mailOptInBefore: boolean;
	hasAccount: boolean;
};

export type LegacyErrorCode = 'unavailable' | 'invalid' | 'has_account' | 'password' | 'failed';
export class LegacyMigrationError extends Error {
	constructor(public code: LegacyErrorCode, message: string = code) {
		super(message);
	}
}

const bookRpc = (svc: SupabaseClient) => svc.schema('book');

function service(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new LegacyMigrationError('unavailable');
	return svc;
}

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

/** パスワードの規則（マイページのパスワード設定と同じ: 12 文字以上・UTF-8 で 72 バイト以内） */
export function migrationPasswordError(password: string, confirm: string): 'short' | 'long' | 'mismatch' | null {
	if (password.length < 12) return 'short';
	if (new TextEncoder().encode(password).length > 72) return 'long';
	if (password !== confirm) return 'mismatch';
	return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function mailHtml(lines: string[], button?: { href: string; label: string }): string {
	return lines
		.map((l) => {
			if (button && l === button.href) {
				return `<p style="margin:12px 0"><a href="${esc(button.href)}" style="display:inline-block;background:#8a6d2b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(button.label)}</a></p>`;
			}
			return l ? `<p style="margin:0 0 6px">${esc(l)}</p>` : '<p style="margin:0 0 6px">&nbsp;</p>';
		})
		.join('');
}

const FOOTER = [
	'',
	'山人（YAMADO）は、メールでパスワードや確認コードをお尋ねすることはありません。',
	'このメールにお心当たりがない場合は、何もせずに破棄してください。'
];

async function send(to: string, subject: string, lines: string[], button?: { href: string; label: string }) {
	await sendHtmlEmail({ to: [to], subject, text: lines.join('\n'), html: mailHtml(lines, button) }).catch((e) =>
		console.error('[legacy-members] メールを送れませんでした', e instanceof Error ? e.message : e)
	);
}

/**
 * 案内のメールを送る（画面の表示には使わない。呼び出し側は応答の後に走らせる）。
 */
export async function sendLegacyInvite(email: string, origin: string): Promise<void> {
	const svc = service();
	const token = newMigrationToken();
	const { data, error } = await bookRpc(svc).rpc('legacy_member_invite', { p_email: email, p_token_hash: await migrationTokenHash(token) });
	if (error) {
		console.error('[legacy-members] invite', error.message);
		return;
	}
	const r = (data ?? {}) as { kind?: string; name?: string };
	const greet = r.name ? `${r.name} 様` : 'お客様';
	if (r.kind === 'invite') {
		const link = `${origin}/auth/migrate/${token}`;
		await send(email, '【YAMADO】会員移行のご案内', [
			greet, '',
			'山人（YAMADO）の新しい予約サイトへの会員移行のお手続きをご案内します。',
			'以前の予約システムでのご登録を引き継いで、新しい会員にご登録いただけます。', '',
			'下のボタンから進み、内容をご確認のうえパスワードを決めてください（24時間有効・1回限り）。',
			link, '',
			'これまでの公式サイト・お電話でのご宿泊は、確認のうえ新しい会員ランクに反映されます。',
			...FOOTER
		], { href: link, label: '会員移行の手続きへ進む' });
	} else if (r.kind === 'member') {
		const link = `${origin}/auth/login`;
		await send(email, '【YAMADO】会員移行のお問い合わせについて', [
			'お客様', '',
			'このメールアドレスは、すでに新しい予約サイトの会員にご登録いただいています。',
			'会員移行のお手続きは不要です。ログイン画面からログインしてご利用ください。',
			link, ...FOOTER
		], { href: link, label: 'ログイン画面を開く' });
	} else if (r.kind === 'login') {
		const link = `${origin}/auth/login?next=${encodeURIComponent('/account/legacy')}`;
		await send(email, '【YAMADO】会員移行のご案内', [
			greet, '',
			'このメールアドレスには、新しい予約サイトのアカウントがすでにあります。',
			'ログイン画面でこのメールアドレスを入力し、届く確認コードでログインしてください。',
			'会員登録がまだの方は、続けて会員登録をお済ませください。',
			'そのあと、マイページの「以前の会員のご利用実績を引き継ぐ」からお手続きください。',
			link, ...FOOTER
		], { href: link, label: 'ログインして引き継ぐ' });
	}
}

/** トークン（Cookie から）で表示用の内容を読む（有効期限内・未移行のときだけ） */
export async function legacyProfileByToken(token: string): Promise<LegacyProfile | null> {
	if (!isMigrationToken(token)) return null;
	const { data, error } = await bookRpc(service()).rpc('legacy_member_by_token', { p_token_hash: await migrationTokenHash(token) });
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
		phoneLast4: s('phone_last4'),
		mailOptInBefore: d.mail_opt_in_before === true,
		hasAccount: d.has_account === true
	};
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

export type MigrationResult = { bonus: number; claim: 'linked' | 'pending_review' | 'new' };

/** 移行を完了して会員にする（新しくアカウントを作った人だけ。ログインした状態になる） */
export async function completeLegacyMigration(event: RequestEvent, token: string, input: MigrationInput, origin: string): Promise<MigrationResult> {
	const svc = service();
	const profile = await legacyProfileByToken(token);
	if (!profile) throw new LegacyMigrationError('invalid');
	// 既にアカウントがある人には、リンクでパスワードを設定しない（通常のログインの後にマイページで引き継ぐ）
	if (profile.hasAccount) throw new LegacyMigrationError('has_account');
	const email = profile.email;
	const name = combineName(input.familyName, input.givenName);

	const created = await svc.auth.admin.createUser({
		email,
		password: input.password,
		email_confirm: true, // リンクでメールの受信を確かめた
		user_metadata: { member: true, name }
	});
	if (created.error || !created.data.user) {
		const msg = created.error?.message ?? '';
		if (/already|registered|exists/i.test(msg)) throw new LegacyMigrationError('has_account', msg);
		if (/password/i.test(msg)) throw new LegacyMigrationError('password', msg);
		throw new LegacyMigrationError('failed', msg);
	}
	const userId = created.data.user.id;
	const client = createSupabaseServerClient(event);
	let finished: { welcome_bonus?: number; claim?: MigrationResult['claim'] };
	try {
		const signed = await client.auth.signInWithPassword({ email, password: input.password });
		if (signed.error) throw new Error(signed.error.message);
		const { data, error } = await bookRpc(svc).rpc('legacy_member_finish', {
			p_token_hash: await migrationTokenHash(token),
			p_user_id: userId,
			p_family_name: input.familyName,
			p_given_name: input.givenName,
			p_family_name_kana: input.familyNameKana || null,
			p_given_name_kana: input.givenNameKana || null,
			p_phone: input.phone || null,
			p_mail_opt_in: input.mailOptIn,
			p_privacy_version: LEGACY_PRIVACY_VERSION,
			p_locale: input.locale
		});
		if (error) throw new Error(error.message);
		finished = (data ?? {}) as { welcome_bonus?: number; claim?: MigrationResult['claim'] };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// 会員にできなかった: 作ったアカウントを消して元に戻す（トークンは未使用のまま・もう一度試せる）。
		// 応答が届かなかっただけで会員ができている場合は消さない（会員の行だけ残ってアカウントが消えるのを防ぐ）
		const { data: member } = await bookRpc(svc).from('members').select('user_id').eq('user_id', userId).maybeSingle();
		if (!member) {
			await client.auth.signOut({ scope: 'local' }).catch(() => {});
			await svc.auth.admin.deleteUser(userId).catch(() => {});
			throw new LegacyMigrationError(msg.includes('invalid_token') ? 'invalid' : 'failed', msg);
		}
		console.error('[legacy-members] finish の応答は失敗したが会員はできている', msg);
		finished = { claim: 'new' };
	}
	const claim = finished.claim ?? 'new';
	// 完了メールの失敗で移行を巻き戻さない
	await sendCompletion(email, name, origin, claim).catch((e) => console.error('[legacy-members] 完了メール', e instanceof Error ? e.message : e));
	return { bonus: Math.max(0, Number(finished.welcome_bonus ?? 0) || 0), claim };
}

async function sendCompletion(email: string, name: string, origin: string, claim: MigrationResult['claim']) {
	const link = `${origin}/account`;
	await send(email, '【YAMADO】会員移行が完了しました', [
		`${name} 様`, '',
		'新しい予約サイトへの会員移行が完了しました。次回からは、このメールアドレスとパスワード、または確認コードでログインできます。',
		claim === 'linked'
			? '以前の公式サイト・お電話でのご宿泊を、会員ランクに反映しました。'
			: claim === 'pending_review'
				? '以前のご宿泊の記録は、宿で確認のうえ会員ランクに反映します（数日かかる場合があります）。'
				: '',
		link, '',
		'このお手続きにお心当たりがない場合は、お手数ですが宿までご連絡ください。',
		'山人（YAMADO）は、メールでパスワードや確認コードをお尋ねすることはありません。'
	], { href: link, label: 'マイページを開く' });
}

/** マイページで引き継げる旧会員の記録があるか（会員本人・確認済みのメールだけ） */
export async function legacyClaimable(userId: string): Promise<{ claimable: boolean; phoneLast4: string }> {
	const svc = partnerServiceClient();
	if (!svc) return { claimable: false, phoneLast4: '' };
	const { data } = await bookRpc(svc).rpc('legacy_member_claimable', { p_user_id: userId });
	const d = (data ?? {}) as { claimable?: boolean; phone_last4?: string };
	return { claimable: d.claimable === true, phoneLast4: d.phone_last4 ?? '' };
}

/** 既に会員の人の引き継ぎ（マイページ）。紐づけは DB の条件を満たすときだけ・それ以外は職員の確認待ち */
export async function claimLegacyMember(userId: string, phone: string, email: string, name: string, origin: string): Promise<MigrationResult['claim'] | 'none'> {
	const { data, error } = await bookRpc(service()).rpc('legacy_member_claim', {
		p_user_id: userId,
		p_phone: phone || null,
		p_privacy_version: LEGACY_PRIVACY_VERSION
	});
	if (error) throw new LegacyMigrationError('failed', error.message);
	const claim = ((data ?? {}) as { claim?: string }).claim as MigrationResult['claim'] | 'none' | undefined;
	if (claim && claim !== 'none') await sendCompletion(email, name || 'お客様', origin, claim);
	return claim ?? 'none';
}
