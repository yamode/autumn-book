import { navigating, page } from '$app/state';
import * as m from '$lib/paraglide/messages';

type Shell = 'root' | 'public' | 'account' | 'admin' | 'partner' | 'room' | 'checkin';
type Target = NonNullable<typeof navigating.to>;

const under = (route: string, base: string) => route === base || route.startsWith(base + '/');
const normalize = (path: string) => path.replace(/\/$/, '') || '/';

export function transitionShell(from: string, to: string, samePortal: boolean): Shell {
	if (to === '/(public)') return 'root';
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
	const { from, to, willUnload } = navigating;
	if (willUnload || !from?.route.id || !to?.route.id) return null;
	const samePath = normalize(from.url.pathname) === normalize(to.url.pathname);
	// 同じページの中の移動（検索条件・絞り込みの変更、フォーム、アンカー）は、ページの表示を維持する。
	// 検索バーや見出しまで骨組みに置き換えず、結果の欄だけを読み込み表示にする（RefreshingResults・2026-11-18 指示）。
	if (samePath) return null;
	if (normalize(page.url.pathname) === normalize(to.url.pathname) && page.url.search === to.url.search) return null;
	return transitionShell(from.route.id, to.route.id, from.params?.token === to.params?.token) === shell ? to : null;
}

/** 同じページのまま条件（URL の ? 以降）だけ変えて読み込み中か。結果の欄の読み込み表示に使う */
export function refreshingSamePage(): boolean {
	const { to, type, willUnload } = navigating;
	if (willUnload || !to || type === 'form') return false;
	return normalize(to.url.pathname) === normalize(page.url.pathname) && to.url.search !== page.url.search;
}

/**
 * 同じページのまま、URL のうち name の値だけが変わる移動中なら、移動先の値（無ければ ''）。それ以外は null。
 * プラン一覧のお食事の絞り込み（?meal=）で、結果の欄ごと読み込み表示にせず、プランの欄だけを入れ替えるのに使う。
 */
export function pendingParamOnly(name: string, from = page.url): string | null {
	const { to, type, willUnload } = navigating;
	if (willUnload || !to || type === 'form') return null;
	if (normalize(to.url.pathname) !== normalize(from.pathname)) return null;
	const strip = (u: URL) => {
		const q = new URLSearchParams(u.search);
		q.delete(name);
		q.sort();
		return q.toString();
	};
	if (strip(to.url) !== strip(from)) return null;
	const next = to.url.searchParams.get(name) ?? '';
	return next === (from.searchParams.get(name) ?? '') ? null : next;
}

export function transitionTitle(route: string): string {
	const path = route.replace('/(public)', '');
	if (under(path, '/search')) return m.hold_expired_search();
	if (under(path, '/kitakaze')) return m.radio_title();
	if (under(path, '/membership')) return m.membership_heading();
	if (under(path, '/community')) return m.forum_nav();
	if (under(path, '/auth/login')) return m.common_login();
	if (under(path, '/auth/register')) return m.common_register();
	if (under(path, '/booking/lookup')) return m.footer_lookup();
	if (under(path, '/help')) return m.help_heading();
	if (under(path, '/booking/hold')) return m.hold_heading_input();
	if (under(path, '/account/points')) return m.account_nav_points();
	if (under(path, '/account/coupons')) return m.account_nav_coupons();
	if (under(path, '/account/community')) return m.account_nav_community();
	if (under(path, '/account/favorites')) return m.account_nav_favorites();
	if (under(path, '/account/availability-alerts')) return m.account_nav_availability_alerts();
	if (under(path, '/account/upgrades')) return m.account_nav_upgrades();
	if (under(path, '/account')) return m.account_layout_heading();
	// 客室一覧の見出しは「客室一覧」。プラン一覧（施設名）・プラン詳細（プラン名）・客室詳細（部屋名）は行き先の名前なので、帯で見せる
	if (path === '/[brand]/[facility]/rooms') return m.rooms_list_title();
	if (under(path, '/[brand]/[facility]/rooms') || under(path, '/[brand]/[facility]/plans')) return '';
	if (under(path, '/r/bath')) return m.bath_title();
	if (under(path, '/r')) return m.inroom_header();
	if (under(path, '/ci')) return m.ci_title();
	return '';
}

export type LoadingShape = 'plain' | 'search-results' | 'plans-results' | 'search' | 'plans' | 'rooms' | 'hold' | 'booking' | 'account' | 'account-profile' |
	'account-list' | 'auth' | 'lookup' | 'membership' | 'community' | 'community-board' | 'community-thread' |
	'home' | 'facility' | 'news-list' | 'article' | 'plan-detail' | 'form' | 'reservation-detail' | 'videos' | 'admin-dashboard' | 'admin-list' | 'admin-cards' | 'admin-split' | 'admin-detail' | 'inroom';

export function loadingShape(route: string): LoadingShape {
	// 客室案内のトップ（上の写真 → 滞在カード → 案内カード 2 列）
	if (route === '/r') return 'inroom';
	// B面（取引先ページ /p/[token]）: メニューの最上位は PartnerPageSkeleton。その下のページの形をここで決める（2026-11-23 総点検）
	if (route === '/p/[token]' || route.startsWith('/p/[token]/')) {
		const rest = route.slice('/p/[token]'.length);
		if (rest === '' || rest === '/mfa' || rest === '/setup') return 'auth';
		// /bookings/[id]/[...rest] は旧・特別会員の変更・アレンジの受け口（転送するだけ・2026-11-27）
		if (rest === '/bookings/[id]' || rest === '/bookings/[id]/[...rest]' || rest === '/group/[id]') return 'reservation-detail';
		if (rest === '/book') return 'hold';
		if (/\/(amend|options)(\/|$)/.test(rest) || rest === '/group/new') return 'form';
		if (rest.startsWith('/legal/') || rest === '/memorandum') return 'article';
		if (rest.startsWith('/account/')) return 'account-list';
		return 'plain';
	}
	if (route === '/admin') return 'admin-dashboard';
	if (/^\/admin\/(login|mfa)(\/|$)/.test(route)) return 'auth';
	if (route === '/admin/plans') return 'admin-cards';
	if (/^\/admin\/(reservations|members|payments|precheckin|partners|upgrades|inquiries|support|group-inquiries|coupons|news|users|rooms|plans|otayori|community)(?:\/(reports|deletions|charges|invoices))?$/.test(route)) return 'admin-list';
	// 右に要約欄がある 2 列の詳細。それ以外の設定・編集はほぼ 1 列
	if (/^\/admin\/(reservations\/\[code\]|members\/\[id\]|group-inquiries\/\[id\])$/.test(route)) return 'admin-split';
	if (under(route, '/admin')) return 'admin-detail';
	const path = route.replace('/(public)', '');
	// A面（公開サイト）: トップ・施設・お知らせ・詳細・規約など（2026-11-23 総点検）
	if (path === '' || path === '/') return 'home';
	if (path === '/kitakaze') return 'videos';
	// 施設のページは一旦非公開でプラン一覧へ転送している（2026-11-23）ので、移る間はプラン一覧の形
	if (/^\/\[brand\]\/\[facility\](\/\[page\])?$/.test(path)) return 'plans';
	if (/^\/\[brand\]\/\[facility\]\/news$/.test(path)) return 'news-list';
	if (/^\/\[brand\]\/\[facility\]\/news\/\[id\]$/.test(path) || path === '/help' || under(path, '/legal')) return 'article';
	if (/^\/\[brand\]\/\[facility\]\/(plans\/\[plan\]|rooms\/\[room\])$/.test(path) || path === '/plan/[token]') return 'plan-detail';
	if (path === '/community/[board]/new' || path === '/community/settings') return 'form';
	if (path === '/account/reservations/[code]') return 'reservation-detail';
	if (/^\/account\/reservations\/\[code\]\/(amend|options)/.test(path) || path === '/account/upgrades/[id]' || path === '/account/bath/[booking]') return 'form';
	if (path === '/search') return 'search';
	if (/^\/\[brand\]\/\[facility\]\/plans$/.test(path)) return 'plans';
	if (/^\/\[brand\]\/\[facility\]\/rooms$/.test(path)) return 'rooms';
	if (path === '/booking/lookup') return 'lookup';
	if (under(path, '/auth')) return 'auth';
	if (under(path, '/booking/hold')) return 'hold';
	if (under(path, '/booking')) return 'booking';
	if (under(path, '/membership')) return 'membership';
	// コミュニティ: トップ（掲示板のカード＋最近の投稿）・板（スレッドのカード）・スレッド（投稿）
	if (path === '/community') return 'community';
	if (path === '/community/[board]') return 'community-board';
	if (path === '/community/threads/[id]') return 'community-thread';
	if (path === '/account' || path === '/account/reservations') return 'account';
	if (path === '/account/profile') return 'account-profile';
	if (under(path, '/account')) return 'account-list';
	return 'plain';
}
