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
	if (under(path, '/booking/hold')) return m.hold_heading_input();
	if (under(path, '/account/points')) return m.account_nav_points();
	if (under(path, '/account/coupons')) return m.account_nav_coupons();
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

export type LoadingShape = 'plain' | 'search' | 'plans' | 'rooms' | 'hold' | 'booking' | 'account' | 'account-profile' |
	'account-list' | 'auth' | 'membership' | 'admin-dashboard' | 'admin-list' | 'admin-cards' | 'admin-split' | 'admin-detail';

export function loadingShape(route: string): LoadingShape {
	if (route === '/admin') return 'admin-dashboard';
	if (/^\/admin\/(login|mfa)(\/|$)/.test(route)) return 'auth';
	if (route === '/admin/plans') return 'admin-cards';
	if (/^\/admin\/(reservations|members|payments|precheckin|partners|upgrades|inquiries|group-inquiries|coupons|news|users|rooms|plans|otayori|community)(?:\/(reports|deletions|charges|invoices))?$/.test(route)) return 'admin-list';
	// 右に要約欄がある 2 列の詳細。それ以外の設定・編集はほぼ 1 列
	if (/^\/admin\/(reservations\/\[code\]|members\/\[id\]|group-inquiries\/\[id\])$/.test(route)) return 'admin-split';
	if (under(route, '/admin')) return 'admin-detail';
	const path = route.replace('/(public)', '');
	if (path === '/search') return 'search';
	if (/^\/\[brand\]\/\[facility\]\/plans$/.test(path)) return 'plans';
	if (/^\/\[brand\]\/\[facility\]\/rooms$/.test(path)) return 'rooms';
	if (under(path, '/auth') || path === '/booking/lookup') return 'auth';
	if (under(path, '/booking/hold')) return 'hold';
	if (under(path, '/booking')) return 'booking';
	if (under(path, '/membership')) return 'membership';
	if (path === '/account' || path === '/account/reservations') return 'account';
	if (path === '/account/profile') return 'account-profile';
	if (under(path, '/account')) return 'account-list';
	return 'plain';
}
