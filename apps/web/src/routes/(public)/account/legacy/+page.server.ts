// 以前の会員のご利用実績を引き継ぐ（既に Book の会員の人・lib/server/legacy-members.ts の claimLegacyMember）。
// 以前の予約システムの会員の記録（同じメール）があれば、電話を入力し直してもらい、DB の条件を満たせば過去の利用に紐づける。
// 満たさなければ職員の確認待ち。アカウントのメールが受信確認済みでない（LINE で作った等）ときは引き継げない。
import { fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { createSupabaseServerClient } from '$lib/server/auth';
import { claimLegacyMember, legacyClaimable } from '$lib/server/legacy-members';
import { legacyMigrationOpen, migrationOrigin } from '$lib/server/legacy-migration-flag';
import { clientIp, ipKey, rateCheck, rateHit, RATE_RULES } from '$lib/server/login-rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!legacyMigrationOpen(url) || !locals.user) return { open: false as const, claimable: false, phoneLast4: '' };
	const c = await legacyClaimable(locals.user.id).catch(() => ({ claimable: false, phoneLast4: '' }));
	return { open: true as const, ...c };
};

export const actions: Actions = {
	claim: async (event) => {
		const { locals } = event;
		if (!legacyMigrationOpen(event.url) || !locals.user) return fail(404, { message: m.migrate_unavailable() });
		const form = await event.request.formData();
		const phone = String(form.get('phone') ?? '').trim().replace(/[-‐‑‒–—−－\s]/g, '');
		if (!/^\+?\d{10,15}$/.test(phone)) return fail(400, { phone, message: m.migrate_phone_required() });
		if (form.get('privacyConsent') !== 'on') return fail(400, { phone, message: m.migrate_consent_required() });
		const ipId = ipKey(clientIp(event.request));
		if ((await rateCheck(event.platform, RATE_RULES.legacyCompleteIp, ipId)).locked) return fail(429, { phone, message: m.migrate_too_many() });
		await rateHit(event.platform, RATE_RULES.legacyCompleteIp, ipId);
		const { data } = await createSupabaseServerClient(event).auth.getUser();
		const email = data.user?.email ?? '';
		try {
			const claim = await claimLegacyMember(locals.user.id, phone, email, locals.user.name, migrationOrigin(event.url));
			return { done: claim };
		} catch (e) {
			console.error('[account/legacy]', e instanceof Error ? e.message : e);
			return fail(500, { phone, message: m.migrate_failed() });
		}
	}
};
