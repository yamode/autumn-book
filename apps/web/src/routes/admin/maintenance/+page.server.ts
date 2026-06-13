import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { maintenanceStatus, setMaintenance, isEnvForced, previewLink } from '$lib/server/maintenance';
import { addAuditLog } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, platform }) => {
	const status = await maintenanceStatus(platform);
	return {
		isAdmin: locals.user?.role === 'admin',
		active: status.active,
		envForced: status.envForced,
		toggleOn: status.toggleOn,
		durable: status.durable,
		hasBypassToken: Boolean(env.MAINTENANCE_BYPASS_TOKEN),
		previewLink: previewLink(url.origin)
	};
};

export const actions: Actions = {
	// メンテナンスモードのトグル（admin のみ）。
	// 環境変数 MAINTENANCE_MODE=on による強制 ON は UI からは解除できない。
	toggle: async ({ request, locals, platform }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: 'メンテナンスモードの切替は管理者のみ可能です' });
		if (isEnvForced()) {
			return fail(409, { message: '環境変数 MAINTENANCE_MODE により強制 ON のため、画面からは解除できません' });
		}
		const form = await request.formData();
		const on = form.get('on') === 'true';
		await setMaintenance(platform, on);
		addAuditLog(locals.user.id, 'maintenance_toggle', `${on ? 'on' : 'off'}`);
		return { ok: true, on };
	}
};
