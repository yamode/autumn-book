// 旧会員の方（会員移行）の入口: メールを入力すると、旧会員の一覧にあれば移行の案内メールを送る（lib/server/legacy-members.ts）。
// 一覧に無くても・既に会員でも、画面は同じ案内を出す（会員かどうかを外から探らせない）。
import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { legacyMigrationOpen } from '$lib/server/legacy-migration-flag';
import { checkTurnstile } from '$lib/server/turnstile';
import { clientIp, hashKeyPart, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import { inviteLegacyMember } from '$lib/server/legacy-members';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user?.role === 'member') redirect(303, '/account');
	return { available: legacyMigrationOpen() };
};

export const actions: Actions = {
	invite: async (event) => {
		if (!legacyMigrationOpen()) return fail(404, { email: '', message: m.migrate_unavailable() });
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		if (!EMAIL_RE.test(email) || email.length > 254) return fail(400, { email, message: m.error_email_invalid() });
		const ip = clientIp(event.request);
		if (!(await checkTurnstile(form, ip, { action: 'member-migrate', hostname: event.url.hostname })).ok) {
			return fail(400, { email, message: m.auth_turnstile_failed() });
		}
		const limits = [
			[RATE_RULES.legacyInviteIp, ipKey(ip)],
			[RATE_RULES.legacyInviteEmail, await hashKeyPart(email)]
		] as const;
		if ((await Promise.all(limits.map(([rule, key]) => rateCheck(event.platform, rule, key)))).some((r) => r.locked)) {
			return fail(429, { email, message: m.migrate_too_many() });
		}
		await Promise.all(limits.map(([rule, key]) => rateHit(event.platform, rule, key)));
		try {
			await inviteLegacyMember(email, event.url.origin);
		} catch (e) {
			console.error('[auth/migrate]', e instanceof Error ? e.message : e);
			return fail(503, { email, message: m.migrate_unavailable() });
		}
		// 対象かどうかに関係なく同じ案内
		return { sent: true, email };
	}
};
