import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	isEnvForced,
	isRuntimeOn,
	isMaintenanceOn,
	setRuntimeMaintenance,
	previewLink
} from '$lib/server/maintenance';
import { addAuditLog } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	return {
		isAdmin: locals.user?.role === 'admin',
		active: isMaintenanceOn(),
		envForced: isEnvForced(),
		runtimeOn: isRuntimeOn(),
		hasBypassToken: Boolean(env.MAINTENANCE_BYPASS_TOKEN),
		previewLink: previewLink(url.origin)
	};
};

export const actions: Actions = {
	// メンテナンスモードのランタイムトグル（admin のみ）。
	// 環境変数 MAINTENANCE_MODE=on による強制 ON は UI からは解除できない。
	toggle: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: 'メンテナンスモードの切替は管理者のみ可能です' });
		if (isEnvForced()) {
			return fail(409, { message: '環境変数 MAINTENANCE_MODE により強制 ON のため、画面からは解除できません' });
		}
		const form = await request.formData();
		const on = form.get('on') === 'true';
		setRuntimeMaintenance(on);
		addAuditLog(locals.user.id, 'maintenance_toggle', `runtime=${on ? 'on' : 'off'}`);
		return { ok: true, on };
	}
};
