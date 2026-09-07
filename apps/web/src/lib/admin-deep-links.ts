// アプリ内のディープリンク候補（yamado-one の (tabs) 構成に合わせる）。
// クライアントからも読むため $lib/server には置かない。
export const DEEP_LINK_PRESETS = [
	{ label: 'お知らせ一覧', url: '/news' },
	{ label: 'クーポン', url: '/me/coupons' },
	{ label: 'ご予約の確認', url: '/me/reservations' },
	{ label: '予約する', url: '/book' },
	{ label: 'コミュニティ', url: '/community' }
] as const;
