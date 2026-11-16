import { navigating, page } from '$app/state';
import * as m from '$lib/paraglide/messages';

type Shell = 'root' | 'public' | 'account' | 'admin' | 'partner' | 'room' | 'checkin';
type Target = NonNullable<typeof navigating.to>;

const under = (route: string, base: string) => route === base || route.startsWith(base + '/');
const normalize = (path: string) => path.replace(/\/$/, '') || '/';

export function transitionShell(from: string, to: string, samePortal: boolean): Shell {
	if (under(from, '/(public)') && under(to, '/(public)')) {
		return under(from, '/(public)/account') && under(to, '/(public)/account') ? 'account' : 'public';
	}
	if (under(from, '/admin') && under(to, '/admin')) return 'admin';
	if (under(from, '/p/[token]') && under(to, '/p/[token]') && samePortal) return 'partner';
	if (under(from, '/r') && under(to, '/r')) return 'room';
	if (under(from, '/ci') && under(to, '/ci')) return 'checkin';
	return 'root';
}

export function pendingPage(shell: Shell): Target | null {
	const { from, to, type, willUnload } = navigating;
	if (willUnload || !from?.route.id || !to?.route.id) return null;
	const samePath = normalize(from.url.pathname) === normalize(to.url.pathname);
	// 同じページ内の検索フォームとアンカー移動は、そのページの表示を維持する。
	if (samePath && (type === 'form' || from.url.search === to.url.search)) return null;
	if (normalize(page.url.pathname) === normalize(to.url.pathname) && page.url.search === to.url.search) return null;
	return transitionShell(from.route.id, to.route.id, from.params?.token === to.params?.token) === shell ? to : null;
}

export function transitionTitle(route: string): string {
	if (route === '/(public)') return m.home_title();
	const path = route.replace('/(public)', '');
	if (under(path, '/search')) return m.hold_expired_search();
	if (under(path, '/kitakaze')) return m.radio_title();
	if (under(path, '/membership')) return m.nav_membership();
	if (under(path, '/community')) return m.forum_nav();
	if (under(path, '/auth/login')) return m.common_login();
	if (under(path, '/auth/register')) return m.common_register();
	if (under(path, '/booking/lookup')) return m.footer_lookup();
	if (under(path, '/booking/hold')) return m.hold_form_heading();
	if (under(path, '/account/points')) return m.account_nav_points();
	if (under(path, '/account/community')) return m.account_nav_community();
	if (under(path, '/account/favorites')) return m.account_nav_favorites();
	if (under(path, '/account/availability-alerts')) return m.account_nav_availability_alerts();
	if (under(path, '/account/upgrades')) return m.account_nav_upgrades();
	if (under(path, '/account')) return m.account_layout_heading();
	if (under(path, '/[brand]/[facility]/rooms')) return m.room_detail_breadcrumb();
	if (under(path, '/[brand]/[facility]/plans')) return m.plan_detail_breadcrumb_plans();
	if (under(path, '/r/bath')) return m.bath_title();
	if (under(path, '/r')) return m.inroom_header();
	if (under(path, '/ci')) return m.ci_title();
	return '';
}
