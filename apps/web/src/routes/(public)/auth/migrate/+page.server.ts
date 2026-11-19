// 旧会員の方（会員移行）の入口（lib/server/legacy-members.ts）。
// 画面は常に同じ表示（会員かどうか・一覧にあるかを、文言でも応答時間でも外から探らせない）。メールは応答の後に送る。
import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { legacyMigrationOpen, migrationOrigin } from '$lib/server/legacy-migration-flag';
import { checkTurnstile } from '$lib/server/turnstile';
import { clientIp, hashKeyPart, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import { sendLegacyInvite } from '$lib/server/legacy-members';
import { waitUntilOf } from '$lib/server/access-log-core';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user?.role === 'member') redirect(303, '/account/legacy');
	return { available: legacyMigrationOpen(url) };
};

export const actions: Actions = {
	invite: async (event) => {
		if (!legacyMigrationOpen(event.url)) return fail(404, { email: '', message: m.migrate_unavailable() });
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, { email, message: m.error_email_invalid() });
		const ip = clientIp(event.request);
		if (!(await checkTurnstile(form, ip, { action: 'member-migrate', hostname: new URL(migrationOrigin(event.url)).hostname })).ok) {
			return fail(400, { email, message: m.auth_turnstile_failed() });
		}
		// 接続元ごとの上限（自分の試行なので、超えたら知らせる）
		const ipId = ipKey(ip);
		if ((await rateCheck(event.platform, RATE_RULES.legacyInviteIp, ipId)).locked) return fail(429, { email, message: m.migrate_too_many() });
		await rateHit(event.platform, RATE_RULES.legacyInviteIp, ipId);
		// メールごとの上限は、超えても同じ表示のまま送らない（第三者が本人を締め出せないように・DB 側にも 1 日 5 通の上限）
		const emailId = await hashKeyPart(email);
		const emailLocked = (await rateCheck(event.platform, RATE_RULES.legacyInviteEmail, emailId)).locked;
		if (!emailLocked) {
			await rateHit(event.platform, RATE_RULES.legacyInviteEmail, emailId);
			const job = sendLegacyInvite(email, migrationOrigin(event.url)).catch((e) =>
				console.error('[auth/migrate]', e instanceof Error ? e.message : e)
			);
			const wait = waitUntilOf(event.platform);
			if (wait) wait(job);
			else await job; // 開発中（waitUntil が無い）
		}
		return { sent: true, email };
	}
};
