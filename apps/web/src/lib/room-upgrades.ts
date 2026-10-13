export interface UpgradeOffer {
	id: string; booking_id: string; stay_id: string; room_index: number;
	checkin: string; checkout: string; adults: number; total: number;
	status: 'offered' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'cancelled';
	title: string; description: string; price_basis: 'night' | 'stay'; unit_amount: number;
	expires_at: string; dispatch_at: string; campaign_status: string; booking_code: string; facility_name: string;
	source_name: string; target_name: string; target_description: string | null;
	target_photos: { url: string; caption?: string }[]; target_area: number | null; target_amenities: string[];
	base_total: number; eligible: boolean; remaining: number; option_status: string | null;
	payment_mode: 'online' | 'onsite'; upgrade_paid_amount: number; has_payment_hold: boolean; payment_expires_at: string | null;
}
export interface UpgradeCampaign {
	id: string; facility_id: string; checkin: string; source_room_type_id: string; target_room_type_id: string;
	title: string; description: string; price_basis: 'night' | 'stay'; amount: number; channel: 'email' | 'push' | 'both';
	expires_at: string; dispatch_at: string | null; status: 'draft' | 'published' | 'withdrawn'; created_at: string;
}
export interface UpgradeRecipient {
	booking_id: string; stay_id: string; member_user_id: string; room_index: number;
	checkout: string; adults: number; booking_code: string; guest_name: string; nights: number; total: number;
}
export interface UpgradeReport {
	id: string; room_index: number; status: UpgradeOffer['status']; total: number; booking_code: string;
	guest_name: string; offer_mail_status: string | null; confirmation_mail_status: string | null;
	push_status: string | null; option_status: string | null; payment_mode: string | null; paid_amount: number | null; payment_status: string | null;
}
export const UPGRADE_STATUS = { offered: 'ご提案中', accepted: 'アップグレード確定', declined: '見送り済み', withdrawn: '受付終了', expired: '期限終了', cancelled: '予約取消済み' };
export const UPGRADE_CHANNEL = { email: 'メール', push: 'yamado-oneアプリ通知', both: 'メールとアプリ通知' };
export function upgradeError(e: unknown): string {
	const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e ?? '');
	const messages: [string, string][] = [
		['sold_out', 'ご希望のお部屋が満室になりました。申し込みは確定していません。'],
		['offer_unavailable', 'この提案は受付終了、または予約内容が変更されています。最新のご予約をご確認ください。'],
		['consent_required', '追加料金と条件を確認し、同意してお申し込みください。'],
		['upgrade_payment_required', '予約時のお支払い方法に合わせ、追加料金をオンライン決済してください。'],
		['payment_processing', 'お支払いを確認しています。少し時間をおいて画面を更新してください。'],
		['published_immutable', '送信予約後の提案内容は変更できません。受付を終了し、新しい提案を作成してください。'],
		['recipients_changed', '対象の予約が変わりました。対象者を再確認してください。'],
		['no_recipients', '対象の会員予約がありません。日程・部屋・空室をご確認ください。'],
		['upgrade_not_cancellable_separately', 'アップグレードの追加料金だけを取り消すことはできません。施設へお問い合わせください。'],
		['upgrade_requires_staff', 'アップグレード済みのご予約の変更は施設へお問い合わせください。'],
		['not_found', '提案が見つかりません。'], ['forbidden', 'この操作を行う権限がありません。'],
		['invalid_params', '日程・受付期限・金額・部屋の設定をご確認ください。'],
		['inventory_missing', '空室情報を確認できませんでした。施設へお問い合わせください。']
	];
	return messages.find(([code]) => msg.includes(code))?.[1] ?? '処理できませんでした。時間をおいてもう一度お試しください。';
}
