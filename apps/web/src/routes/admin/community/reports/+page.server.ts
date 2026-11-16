import { error, fail } from '@sveltejs/kit';
import { readStaffReports, resolveStaffReport, REPORT_PAGE_SIZE } from '$lib/server/forum-activity';
import type { Actions, PageServerLoad } from './$types';

function isStaff(locals: App.Locals) {
	return locals.user?.role === 'admin' || locals.user?.role === 'staff';
}

export const load: PageServerLoad = async (event) => {
	if (!isStaff(event.locals)) error(403, '通報の確認には運営権限が必要です。');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	const resolved = event.url.searchParams.get('status') === 'resolved';
	const rawPage = Number(event.url.searchParams.get('page'));
	const page = Number.isSafeInteger(rawPage) ? Math.min(1000, Math.max(1, rawPage)) : 1;
	try {
		const { reports, total } = await readStaffReports(event, resolved, page);
		return { reports, total, page, resolved, hasNext: page * REPORT_PAGE_SIZE < total };
	} catch {
		return { reports: [], total: 0, page, resolved, hasNext: false, loadError: true };
	}
};

export const actions: Actions = {
	resolve: async (event) => {
		if (!isStaff(event.locals)) return fail(403, { message: '通報の確認には運営権限が必要です。' });
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		const resolution = form.get('resolution');
		if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || (resolution !== 'reviewed' && resolution !== 'hidden')) {
			return fail(400, { message: '処理内容をご確認ください。' });
		}
		try {
			await resolveStaffReport(event, id, resolution);
		} catch (cause) {
			if (cause instanceof Error && cause.message.includes('forbidden')) return fail(403, { message: '通報を処理できる運営権限がありません。' });
			return fail(400, { message: '通報を処理できませんでした。画面を更新してお試しください。' });
		}
		return { resolved: true };
	}
};
