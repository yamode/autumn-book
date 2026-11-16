import { fail } from '@sveltejs/kit';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { kitakazeEpisodes, kitakazePlaylist } from '$lib/server/kitakaze';
import { RADIO_ACCEPT, RADIO_LIMIT, radioFileError, submitRadioLetter } from '$lib/server/radio-letters';
import { checkTurnstile, clientIpOf } from '$lib/server/turnstile';
import { otayoriSubmit } from '$lib/server/store';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	episodes: kitakazeEpisodes(), playlist: kitakazePlaylist(), accept: RADIO_ACCEPT,
	member: locals.user?.role === 'member', staff: Boolean(locals.user && locals.user.role !== 'member')
});

export const actions: Actions = {
	submit: async (event) => {
		const { request, locals } = event;
		if (locals.user && locals.user.role !== 'member') return fail(403, { message: m.otayori_staff_no_post() });
		if (Number(request.headers.get('content-length')) > RADIO_LIMIT + 64 * 1024) {
			return fail(413, { message: m.radio_file_size() });
		}
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const radioName = String(form.get('radioName') ?? '').trim();
		const details = { body, radioName };
		if (!body || [...body].length > 2000 || [...radioName].length > 40) {
			return fail(400, { ...details, message: m.otayori_error_invalid() });
		}
		if (!locals.user && !(await checkTurnstile(form, clientIpOf(event))).ok) {
			return fail(400, { ...details, message: m.auth_turnstile_failed() });
		}
		const files = form.getAll('media').filter((value): value is File => value instanceof File && value.size > 0);
		const problem = radioFileError(files);
		if (problem) return fail(400, { ...details, message: problem === 'size' ? m.radio_file_size() : m.radio_file_type() });
		try {
			if (MEMBER_SUPABASE) await submitRadioLetter(locals.user?.id ?? null, body, radioName, files);
			else if (locals.user) {
				const result = otayoriSubmit(locals.user.id, body, radioName);
				if ('error' in result) throw new Error(result.error);
			}
		} catch (e) {
			const message = e instanceof Error && e.message.includes('too_many_pending')
				? m.otayori_error_too_many_pending() : m.radio_submit_failed();
			return fail(400, { ...details, message });
		}
		return { submitted: true };
	}
};
