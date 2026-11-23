// 会員特典の説明文のうち、管理画面（/admin/member-benefits）で上書きできるもの（2026-11-23）。
// key は画面の文言（messages/*.json）のキー。上書きは DB の book.site_texts（行が無ければ元の文言）。
// 引数を取る文言（ランクアップ条件の「通算5回以上」など）は、ランクの条件から作るのでここには入れない。

export type BenefitTextItem = { key: string; label: string; multiline?: boolean };
export type BenefitTextGroup = { title: string; items: BenefitTextItem[] };

export const MEMBER_BENEFIT_TEXT_GROUPS: BenefitTextGroup[] = [
	{
		title: '会員特典のページ',
		items: [
			{ key: 'membership_heading', label: '見出し' },
			{ key: 'membership_lead', label: '導入文', multiline: true },
			{ key: 'membership_ranks_heading', label: '表の見出し' },
			{ key: 'membership_table_hint', label: '表の説明', multiline: true },
			{ key: 'membership_benefits_heading', label: '表の「会員特典」列の見出し' }
		]
	},
	{
		title: 'ポイント・ランク',
		items: [
			{ key: 'membership_rate_label', label: 'ポイント還元率（見出し）' },
			{ key: 'membership_how_body', label: 'ポイント還元率（説明）', multiline: true },
			{ key: 'membership_condition_label', label: 'ランクアップ条件（見出し）' },
			{ key: 'membership_rank_note', label: 'ランクアップ条件（説明）', multiline: true },
			{ key: 'membership_rank_grace_title', label: 'ランクの維持（見出し）' },
			{ key: 'membership_rank_grace', label: 'ランクの維持（説明）', multiline: true }
		]
	},
	{
		title: '特典',
		items: [
			{ key: 'membership_booking_cancel_t', label: '予約のキャンセル' },
			{ key: 'membership_booking_cancel_b', label: '予約のキャンセル（説明）', multiline: true },
			{ key: 'membership_onsite_payment_t', label: '現地決済' },
			{ key: 'membership_onsite_payment_b', label: '現地決済（説明）', multiline: true },
			{ key: 'membership_card_only', label: '現地決済（非会員の欄）' },
			{ key: 'membership_early_payment_title', label: '早期決済割引' },
			{ key: 'membership_early_payment_body', label: '早期決済割引（説明）', multiline: true },
			{ key: 'membership_bath_title', label: '貸切風呂の事前予約' },
			{ key: 'membership_bath_body', label: '貸切風呂の事前予約（説明）', multiline: true },
			{ key: 'membership_benefit_personalize_t', label: '冷蔵庫のカスタマイズ' },
			{ key: 'membership_personalize_body', label: '冷蔵庫のカスタマイズ（説明）', multiline: true },
			{ key: 'membership_basic_changes', label: '予約の変更' },
			{ key: 'membership_basic_changes_body', label: '予約の変更（説明）', multiline: true },
			{ key: 'membership_change_date_t', label: '予約の変更：宿泊日' },
			{ key: 'membership_change_date_b', label: '予約の変更：宿泊日（説明）', multiline: true },
			{ key: 'membership_change_guests_t', label: '予約の変更：人数' },
			{ key: 'membership_change_guests_b', label: '予約の変更：人数（説明）', multiline: true },
			{ key: 'membership_change_room_t', label: '予約の変更：お部屋・プラン' },
			{ key: 'membership_change_room_b', label: '予約の変更：お部屋・プラン（説明）', multiline: true },
			{ key: 'membership_benefit_community_t', label: 'コミュニティへの投稿' },
			{ key: 'membership_benefit_community_b', label: 'コミュニティへの投稿（説明）', multiline: true },
			{ key: 'membership_benefit_otayori_t', label: 'クーポン・おたよりポイント' },
			{ key: 'membership_benefit_otayori_b', label: 'クーポン・おたよりポイント（説明）', multiline: true },
			{ key: 'membership_upgrade_title', label: 'お部屋のアップグレード優待' },
			{ key: 'membership_upgrade_body', label: 'お部屋のアップグレード優待（説明）', multiline: true },
			{ key: 'membership_benefit_advance_t', label: '会員限定・先行販売プラン' },
			{ key: 'membership_advance_silver_body', label: '会員限定・先行販売プラン（説明）', multiline: true },
			{ key: 'membership_room_designation', label: 'お気に入り客室の登録・指定' },
			{ key: 'membership_room_designation_body', label: 'お気に入り客室の登録・指定（説明）', multiline: true },
			{ key: 'membership_benefit_cancel_t', label: 'キャンセル条件の優遇' },
			{ key: 'membership_benefit_cancel_b', label: 'キャンセル条件の優遇（説明）', multiline: true }
		]
	}
];

export const MEMBER_BENEFIT_TEXT_KEYS: string[] = MEMBER_BENEFIT_TEXT_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** 上書きの文言の表（key → 文言）。無ければ元の文言 */
export type SiteTexts = Record<string, string>;

/** 上書きがあればそれ、無ければ元の文言（m.xxx） */
export function siteText(texts: SiteTexts | null | undefined, key: string, fallback: () => string): string {
	const v = texts?.[key];
	return v && v.trim() ? v : fallback();
}
