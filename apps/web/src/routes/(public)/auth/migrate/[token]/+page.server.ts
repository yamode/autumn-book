// 旧会員の会員移行のリンク先: 以前の登録内容を入れた画面で、パスワードを決めて会員になる（lib/server/legacy-members.ts）。
import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { clientIp, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import {
	completeLegacyMigration,
	LegacyMigrationError,
	legacyProfileByToken,
	migrationPasswordError
} from '$lib/server/legacy-members';
import { legacyMigrationOpen } from '$lib/server/legacy-migration-flag';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	// リンクのトークンを他所に漏らさない（参照元・キャッシュ）
	setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
	if (locals.user?.role === 'member') redirect(303, '/account');
	// 移行の入口を閉じている間は、リンクがあっても進めない（設計の見直し中・lib/server/legacy-migration-flag.ts）
	if (!legacyMigrationOpen()) return { state: 'invalid' as const };
	const profile = await legacyProfileByToken(params.token).catch(() => null);
	if (!profile) return { state: 'invalid' as const };
	if (profile.alreadyMember) return { state: 'already' as const };
	return {
		state: 'ready' as const,
		email: profile.email,
		values: {
			familyName: profile.familyName,
			givenName: profile.givenName,
			familyNameKana: profile.familyNameKana,
			givenNameKana: profile.givenNameKana,
			phone: profile.phone
		}
	};
};

export const actions: Actions = {
	complete: async (event) => {
		if (!legacyMigrationOpen()) return fail(404, { errors: {}, values: undefined, mailOptIn: false, message: m.migrate_unavailable() });
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

		let bonus = 0;
		try {
			({ bonus } = await completeLegacyMigration(event, event.params.token, { ...values, mailOptIn, password, locale: getLocale() }));
		} catch (e) {
			const code = e instanceof LegacyMigrationError ? e.code : 'failed';
			console.error('[auth/migrate/token]', code, e instanceof Error ? e.message : e);
			if (code === 'invalid') return fail(410, { errors, values, mailOptIn, message: m.migrate_link_invalid() });
			if (code === 'already_member') return fail(409, { errors, values, mailOptIn, message: m.migrate_already_member() });
			if (code === 'password') return fail(400, { errors: { password: m.migrate_password_weak() }, values, mailOptIn });
			return fail(500, { errors, values, mailOptIn, message: m.migrate_failed() });
		}
		redirect(303, `/account?welcome=1&bonus=${bonus}&migrated=1`);
	}
};
