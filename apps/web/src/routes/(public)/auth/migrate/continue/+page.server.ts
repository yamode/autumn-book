// 会員移行の手続き: 以前の氏名・カナを確かめ、電話を入力し直し、新しいパスワードを決めて会員になる（lib/server/legacy-members.ts）。
// トークンはリンクの着地（/auth/migrate/[token]）で HttpOnly Cookie に移してある。
import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { clientIp, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import {
	completeLegacyMigration,
	LegacyMigrationError,
	legacyProfileByToken,
	MIGRATE_COOKIE,
	migrationPasswordError
} from '$lib/server/legacy-members';
import { legacyMigrationOpen, migrationOrigin } from '$lib/server/legacy-migration-flag';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
	if (locals.user?.role === 'member') redirect(303, '/account/legacy');
	if (!legacyMigrationOpen(url)) return { state: 'invalid' as const };
	const token = cookies.get(MIGRATE_COOKIE) ?? '';
	const profile = token ? await legacyProfileByToken(token).catch(() => null) : null;
	if (!profile) return { state: 'invalid' as const };
	if (profile.hasAccount) return { state: 'login' as const };
	return {
		state: 'ready' as const,
		email: profile.email,
		phoneLast4: profile.phoneLast4,
		mailOptInBefore: profile.mailOptInBefore,
		values: {
			familyName: profile.familyName,
			givenName: profile.givenName,
			familyNameKana: profile.familyNameKana,
			givenNameKana: profile.givenNameKana,
			phone: ''
		}
	};
};

export const actions: Actions = {
	complete: async (event) => {
		const empty = { errors: {} as Record<string, string>, values: undefined, mailOptIn: false };
		if (!legacyMigrationOpen(event.url)) return fail(404, { ...empty, message: m.migrate_unavailable() });
		const token = event.cookies.get(MIGRATE_COOKIE) ?? '';
		if (!token) return fail(410, { ...empty, message: m.migrate_link_invalid() });
		const form = await event.request.formData();
		const values = {
			familyName: String(form.get('familyName') ?? '').trim(),
			givenName: String(form.get('givenName') ?? '').trim(),
			familyNameKana: String(form.get('familyNameKana') ?? '').trim(),
			givenNameKana: String(form.get('givenNameKana') ?? '').trim(),
			phone: String(form.get('phone') ?? '').trim().replace(/[-‐‑‒–—−－\s]/g, '')
		};
		const mailOptIn = form.get('mailOptIn') === 'on';
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('passwordConfirm') ?? '');
		const errors: Record<string, string> = {};
		if (!values.familyName) errors.familyName = m.error_name_required();
		if (!values.givenName) errors.givenName = m.error_name_required();
		if (!/^\+?\d{10,15}$/.test(values.phone)) errors.phone = m.migrate_phone_required();
		const pw = migrationPasswordError(password, confirm);
		if (pw === 'short') errors.password = m.migrate_password_short();
		if (pw === 'long') errors.password = m.migrate_password_long();
		if (pw === 'mismatch') errors.passwordConfirm = m.migrate_password_mismatch();
		if (form.get('privacyConsent') !== 'on') errors.privacyConsent = m.migrate_consent_required();
		if (Object.keys(errors).length > 0) return fail(400, { errors, values, mailOptIn });

		const ipId = ipKey(clientIp(event.request));
		if ((await rateCheck(event.platform, RATE_RULES.legacyCompleteIp, ipId)).locked) {
			return fail(429, { errors, values, mailOptIn, message: m.migrate_too_many() });
		}
		await rateHit(event.platform, RATE_RULES.legacyCompleteIp, ipId);

		let result;
		try {
			result = await completeLegacyMigration(event, token, { ...values, mailOptIn, password, locale: getLocale() }, migrationOrigin(event.url));
		} catch (e) {
			const code = e instanceof LegacyMigrationError ? e.code : 'failed';
			console.error('[auth/migrate/continue]', code, e instanceof Error ? e.message : e);
			if (code === 'invalid') return fail(410, { errors, values, mailOptIn, message: m.migrate_link_invalid() });
			if (code === 'has_account') return fail(409, { errors, values, mailOptIn, message: m.migrate_login_first() });
			if (code === 'password') return fail(400, { errors: { password: m.migrate_password_weak() }, values, mailOptIn });
			return fail(500, { errors, values, mailOptIn, message: m.migrate_failed() });
		}
		event.cookies.delete(MIGRATE_COOKIE, { path: '/auth/migrate' });
		redirect(303, `/account?welcome=1&bonus=${result.bonus}&migrated=${result.claim}`);
	}
};
