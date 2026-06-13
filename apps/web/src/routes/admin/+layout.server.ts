import { redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { isMaintenanceOn } from '$lib/server/maintenance';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	const isLogin = url.pathname === '/admin/login';
	if (!isLogin && locals.user?.role !== 'admin' && locals.user?.role !== 'staff') {
		redirect(303, '/admin/login');
	}
	const facId = cookies.get('ab_fac') ?? facilities[0].id;
	const current = facilities.find((f) => f.id === facId) ?? facilities[0];
	return {
		user: locals.user,
		facilities: facilities.map((f) => ({ id: f.id, name: f.name })),
		currentFacility: { id: current.id, name: current.name },
		maintenanceActive: isMaintenanceOn()
	};
};
