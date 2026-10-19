// 管理画面のメニュー（2026-10-17 モダン化・メニュー整理。ユーザー確認済みの案 docs/mockups/admin-redesign.html）。
// 「誰が・何をきっかけに操作するか」でグループに分け、関係する画面は1つの項目の下（子）にまとめる。
// 画面の URL は変えない（ブックマークはそのまま）。1画面は1箇所にだけ置く。
//
// tenantWide = 施設に紐づかない画面（施設セレクトを出すと「切り替えても変わらない」混乱を生む）
// demoOnly   = まだ本番データに繋がっていない画面（本番では注意を出し、保存はサーバで止める・lib/server/admin-demo-guard.ts）
// adminOnly  = 管理者（admin）だけに出す
// tab        = 同じ URL を ?tab= で切り替える画面（客室案内）。null は ?tab なし（その画面の最初のタブ）
// also       = この項目を「いま開いている」とみなすほかのパス（その下の画面を含む）
import type { AdminIconName } from '$lib/components/admin/AdminIcon.svelte';

export type NavLeaf = {
	href: string;
	label: string;
	tenantWide?: boolean;
	demoOnly?: boolean;
	adminOnly?: boolean;
	badge?: 'groupInquiries';
	tab?: string | null;
	also?: string[];
};
export type NavItem = NavLeaf & { icon: AdminIconName; children?: NavLeaf[] };
export type NavGroup = { label: string | null; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
	{ label: null, items: [{ href: '/admin', label: 'ダッシュボード', icon: 'dashboard' }] },
	{
		label: '予約・販売',
		items: [
			{ href: '/admin/reservations', label: '予約管理', icon: 'calendar' },
			{ href: '/admin/inquiries', label: 'お問い合わせ', icon: 'phone', children: [{ href: '/admin/inquiries', label: '受信トレイ' }, { href: '/admin/inquiries/ai', label: 'AI設定', tenantWide: true }] },
			{ href: '/admin/staff-directory', label: 'スタッフマスタ', icon: 'users' },
			{ href: '/admin/group-inquiries', label: '団体照会', icon: 'users', badge: 'groupInquiries' },
			{ href: '/admin/upgrades', label: 'アップグレード提案', icon: 'upgrade' },
			{
				href: '/admin/partners',
				label: '取引先',
				icon: 'partner',
				children: [
					{ href: '/admin/partners', label: '取引先の一覧' },
					{ href: '/admin/partners/invoices', label: '予定請求書' },
					{ href: '/admin/partners/charges', label: '今後の請求予定' }
				]
			}
		]
	},
	{
		label: '滞在中のお客様',
		items: [
			{
				href: '/admin/inroom',
				label: '客室案内',
				icon: 'phone',
				children: [
					{ href: '/admin/inroom', label: 'きょうの運用', tab: null },
					{ href: '/admin/inroom?tab=guides', label: '館内案内の内容', tab: 'guides' },
					{ href: '/admin/inroom?tab=slips', label: '客室スリップ', tab: 'slips' },
					{ href: '/admin/inroom/billing', label: '精算案内' },
					{ href: '/admin/inroom/settled', label: '精算済み・返金' },
					{ href: '/admin/inroom?tab=settings', label: '表示の設定', tab: 'settings', also: ['/admin/inroom/banners', '/admin/inroom/entry'] },
					{ href: '/admin/inroom/preview', label: 'プレビュー・QR' },
					{ href: '/admin/inroom/access', label: 'アクセスログ' }
				]
			},
			{ href: '/admin/bath', label: '貸切風呂', icon: 'bath' }
		]
	},
	{
		label: '商品・ルール',
		items: [
			{
				href: '/admin/plans',
				label: 'プラン・部屋',
				icon: 'plan',
				children: [
					{ href: '/admin/plans', label: 'プラン' },
					{ href: '/admin/rooms', label: '部屋編集' },
					{ href: '/admin/options', label: 'オプション', demoOnly: true },
					{ href: '/admin/payments', label: '支払方法' }
				]
			},
			{
				href: '/admin/booking-notes',
				label: '予約時のルール',
				icon: 'rules',
				children: [
					{ href: '/admin/booking-notes', label: '予約時の注意事項' },
					{ href: '/admin/booking-questions', label: '予約時に聞く項目' },
					{ href: '/admin/children', label: 'お子様の受け入れ' },
					{ href: '/admin/cancel-policies', label: 'キャンセル規定', tenantWide: true, demoOnly: true }
				]
			}
		]
	},
	{
		label: '会員・サイト',
		items: [
			{
				href: '/admin/members',
				label: '会員・アプリ',
				icon: 'member',
				children: [
					{ href: '/admin/members', label: '会員', tenantWide: true },
					{ href: '/admin/app', label: 'アプリ運用', tenantWide: true },
					{ href: '/admin/push', label: 'アプリ通知', tenantWide: true },
					{ href: '/admin/coupons', label: 'クーポン', tenantWide: true },
					{ href: '/admin/preferences', label: '好み登録項目', tenantWide: true },
					{ href: '/admin/community', label: 'コミュニティ', tenantWide: true },
					{ href: '/admin/otayori', label: 'おたより', tenantWide: true }
				]
			},
			{
				href: '/admin/news',
				label: 'サイト・メール',
				icon: 'globe',
				children: [
					{ href: '/admin/news', label: 'お知らせ' },
					{ href: '/admin/faqs', label: 'FAQ' },
					{ href: '/admin/facility', label: '施設ページ編集', demoOnly: true },
					{ href: '/admin/mail', label: 'メルマガ', demoOnly: true },
					{ href: '/admin/sequences', label: 'ステップメール', demoOnly: true }
				]
			}
		]
	},
	{
		label: 'システム',
		items: [
			{
				href: '/admin/security',
				label: 'ユーザー・セキュリティ',
				icon: 'shield',
				tenantWide: true,
				children: [
					{ href: '/admin/users', label: 'ユーザー管理', tenantWide: true, adminOnly: true },
					{ href: '/admin/security', label: '二段階認証・パスキー', tenantWide: true },
					{ href: '/admin/maintenance', label: 'メンテナンス', tenantWide: true }
				]
			}
		]
	}
];

const trim = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
const pathOf = (href: string) => href.split('?')[0];
const under = (path: string, base: string) => (base === '/admin' ? path === '/admin' : path === base || path.startsWith(base + '/'));

/**
 * いま開いている画面に当たる項目。どの葉（子・子の無い項目）も一致しなければ null。
 * 一致の強さ: ?tab まで一致 ＞ パスが長く一致（/admin/partners/invoices は /admin/partners より強い）＞ also。
 * 客室案内（/admin/inroom）は ?tab で分ける（古い ?all は客室スリップ）。
 */
export function activeNav(pathname: string, search: URLSearchParams): { item: NavItem; leaf: NavLeaf } | null {
	const path = trim(pathname);
	let best: { item: NavItem; leaf: NavLeaf; score: number } | null = null;
	for (const g of ADMIN_NAV) {
		for (const item of g.items) {
			for (const leaf of item.children ?? [item]) {
				let score = -1;
				const base = pathOf(leaf.href);
				if (leaf.tab !== undefined) {
					if (path === base) {
						const tab = search.get('tab') ?? (search.get('all') ? 'slips' : null);
						if ((tab ?? null) === leaf.tab || (leaf.tab === null && !['guides', 'slips', 'settings'].includes(tab ?? ''))) score = 2000;
					}
				} else if (under(path, base)) {
					score = 1000 + base.length;
				}
				if (score < 0 && leaf.also?.some((a) => under(path, a))) score = 500;
				if (score >= 0 && (!best || score > best.score)) best = { item, leaf, score };
			}
		}
	}
	return best ? { item: best.item, leaf: best.leaf } : null;
}

/** 権限で見えない葉を落とす（子が全部消えた項目は出さない） */
export function visibleNav(role: string | null | undefined): NavGroup[] {
	const ok = (l: NavLeaf) => !l.adminOnly || role === 'admin';
	return ADMIN_NAV.map((g) => ({
		...g,
		items: g.items
			.filter(ok)
			.map((i) => (i.children ? { ...i, children: i.children.filter(ok) } : i))
			.filter((i) => !i.children || i.children.length > 0)
	})).filter((g) => g.items.length > 0);
}
