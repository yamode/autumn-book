// 予約管理の一覧で「どの経路の予約か」を表す純関数（事前チェックイン P1・docs/pre-checkin.md §7）。
//
// 元データ: book.admin_list_bookings の source / channel_name / channel_code / channel_category。
//   channel_name は booking.channels（公式・取引先のみ）→ 無ければ販売先マスタ pms.ota_channels の名前。
//   channel_category は pms.ota_channels.category（agency / net / engine / agt = OTA・旅行会社・予約エンジン）。

/** OTA・旅行会社・予約エンジンとみなす販売先マスタの区分（tripla は engine） */
export const OTA_CATEGORIES = ['agency', 'net', 'engine', 'agt'] as const;

export type ChannelRow = {
	source: string | null;
	client?: string | null;
	channel_name: string | null;
	channel_code?: string | null;
	channel_category?: string | null;
	partner_name?: string | null;
};

/** OTA・旅行会社・予約エンジン経由か（直販・取引先・電話・直接は含めない） */
export function isOtaChannel(b: Pick<ChannelRow, 'source' | 'channel_category'>): boolean {
	if (b.source === 'autumn_booking' || b.source === 'rms_partner') return false;
	return (OTA_CATEGORIES as readonly string[]).includes(b.channel_category ?? '');
}

/** 一覧の経路欄の文言。直販はサイト／アプリ、取引先は取引先名、それ以外は販売先の名前（無ければコード） */
export function channelLabel(b: ChannelRow): string {
	if (b.source === 'autumn_booking') return b.client === 'app' ? 'アプリ' : 'サイト';
	if (b.source === 'rms_partner') return b.partner_name ? `取引先：${b.partner_name}` : (b.channel_name ?? '取引先予約');
	return b.channel_name ?? b.channel_code ?? b.source ?? '—';
}

/** 経路の印の色（OTA は目立たせる） */
export function channelBadgeClass(b: Pick<ChannelRow, 'source' | 'channel_category'>): string {
	if (isOtaChannel(b)) return 'bg-sky-50 text-sky-800 ring-1 ring-sky-200';
	if (b.source === 'autumn_booking') return 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200';
	return 'bg-stone-100 text-stone-600 ring-1 ring-stone-200';
}
