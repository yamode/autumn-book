import { fail } from '@sveltejs/kit';
import { emailSequences } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	return { sequences: emailSequences.filter((s) => s.facilityId === currentFacility.id) };
};

export const actions: Actions = {
	toggle: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const seq = emailSequences.find((s) => s.id === String(form.get('sequenceId')));
		if (!seq) return fail(404, {});
		seq.isActive = !seq.isActive;
		return { toggled: true };
	},
	saveStep: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const seq = emailSequences.find((s) => s.id === String(form.get('sequenceId')));
		const step = seq?.steps.find((st) => st.id === String(form.get('stepId')));
		if (!seq || !step) return fail(404, {});
		step.offsetDays = Number(form.get('offsetDays'));
		step.sendHour = Number(form.get('sendHour'));
		step.title = String(form.get('title') ?? step.title);
		step.body = String(form.get('body') ?? step.body);
		return { savedStep: step.id };
	},
	testStep: async () => {
		return { tested: true };
	}
};
