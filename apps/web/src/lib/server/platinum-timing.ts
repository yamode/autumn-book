import type { RequestEvent } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from './auth';
import * as m from '$lib/paraglide/messages';

export async function savePlatinumTiming(event: RequestEvent, holdId: string, sessionId: string, form: FormData) {
	const choice = form.get('platinumTiming');
	if (choice === null) return null;
	if (!MEMBER_SUPABASE || event.locals.user?.role !== 'member' || !['', 'early', 'late'].includes(String(choice))) {
		return m.hold_platinum_timing_error();
	}
	const { error } = await createSupabaseServerClient(event).schema('book').rpc('set_hold_platinum_timing', {
		p_hold_id: holdId, p_session_id: sessionId, p_choice: choice || null
	});
	return error ? m.hold_platinum_timing_error() : null;
}
