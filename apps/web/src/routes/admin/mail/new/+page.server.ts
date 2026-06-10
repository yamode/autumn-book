import { fail, redirect } from '@sveltejs/kit';
import { countSegment, mailCampaigns } from '$lib/server/store';
import type { Actions } from './$types';

function parseForm(form: FormData) {
	return {
		title: String(form.get('title') ?? '').trim(),
		subject: String(form.get('subject') ?? '').trim(),
		body: String(form.get('body') ?? ''),
		ranks: form.getAll('ranks').map(String),
		schedule: String(form.get('schedule') ?? 'now'),
		scheduledAt: String(form.get('scheduledAt') ?? '')
	};
}

export const actions: Actions = {
	count: async ({ request }) => {
		const values = parseForm(await request.formData());
		return { values, count: countSegment({ ranks: values.ranks }) };
	},
	test: async ({ request, locals }) => {
		const values = parseForm(await request.formData());
		return { values, tested: true, testTo: locals.user?.name ?? '' };
	},
	send: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '配信権限がありません' });
		const values = parseForm(await request.formData());
		if (!values.subject || !values.body) return fail(400, { values, message: '件名と本文を入力してください' });
		const count = countSegment({ ranks: values.ranks });
		const now = new Date();
		const isScheduled = values.schedule === 'later' && values.scheduledAt;
		mailCampaigns.push({
			id: `mc-${Date.now()}`,
			title: values.title || values.subject,
			subject: values.subject,
			body: values.body,
			segment: { ranks: values.ranks },
			status: isScheduled ? 'scheduled' : 'sent',
			scheduledAt: isScheduled ? values.scheduledAt.replace('T', ' ') : now.toISOString().slice(0, 16).replace('T', ' '),
			stats: isScheduled ? undefined : { sent: count, opened: 0, failed: 0 },
			createdAt: now.toISOString().slice(0, 10)
		});
		redirect(303, '/admin/mail');
	}
};
