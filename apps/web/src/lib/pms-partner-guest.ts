// 取引先 × PMS 顧客マスタ（core.guests の旅行会社・法人）の紐づけで使う純関数（サーバ・画面の両方から読む）。
// 設計: docs/partner-pms-customer-link.md（§5.7・§6.1・Phase 1）
//
// 正式名称（法人格つき）の組み立ては PMS（autumn-pms/sveltekit/src/lib/guests-shared.ts）の
// withLegalForm / legalFormPosition と同じ規則にする。名前の列に法人格は入れない決まりなので、
// ここ以外で `'株式会社' + name` のような連結を書かないこと（前株／後株が壊れる）。

/** 紐づけ対象の顧客種別。group = 旅行会社 / corporate = 法人（個人は対象外・決定 #6）。 */
export type PmsPartnerGuestType = 'group' | 'corporate';
export const PMS_PARTNER_GUEST_TYPES: readonly PmsPartnerGuestType[] = ['group', 'corporate'];
export const PMS_PARTNER_GUEST_TYPE_LABELS: Record<PmsPartnerGuestType, string> = {
  group: '旅行会社',
  corporate: '法人'
};

export const isPmsPartnerGuestType = (v: unknown): v is PmsPartnerGuestType => v === 'group' || v === 'corporate';

/** PMS の顧客カルテ（新しいタブで開く）。 */
export const PMS_GUEST_URL_BASE = 'https://autumn-pms.yamado.app/guests/';
export const pmsGuestUrl = (id: string) => `${PMS_GUEST_URL_BASE}${encodeURIComponent(id)}`;

/** 法人格の位置。prefix=前株（株式会社○○）/ suffix=後株（○○株式会社）。PMS と同じく既定は前株。 */
export type LegalFormPosition = 'prefix' | 'suffix';
export function legalFormPosition(v: string | null | undefined): LegalFormPosition {
  return (v ?? '').trim() === 'suffix' ? 'suffix' : 'prefix';
}

/**
 * 素の名前 + 法人格 → 「株式会社JTB」/「山人株式会社」。
 * - 法人格が空なら素の名前をそのまま返す。素の名前が空なら空を返す（「株式会社」だけを出さない）。
 * - 区切り文字は入れない（日本の法人名に空白は入らない）。
 */
export function withLegalForm(base: string | null | undefined, legalForm: string | null | undefined, position: string | null | undefined): string {
  const b = (base ?? '').trim();
  const lf = (legalForm ?? '').trim();
  if (!b || !lf) return b;
  return legalFormPosition(position) === 'suffix' ? `${b}${lf}` : `${lf}${b}`;
}

/** 正式名称の組み立てに要る core.guests の列。 */
export type PmsGuestNameFields = {
  guest_type?: string | null;
  name?: string | null;
  corporate_name?: string | null;
  legal_form?: string | null;
  legal_form_position?: string | null;
};

/** 正式名称（法人格つき）。法人・旅行会社は corporate_name を基にし、無ければ name。空なら空文字。 */
export function pmsGuestFormalName(g: PmsGuestNameFields): string {
  const base = isPmsPartnerGuestType(g.guest_type) ? (g.corporate_name ?? '').trim() || (g.name ?? '') : (g.name ?? '');
  return withLegalForm(base, g.legal_form, g.legal_form_position);
}

/** 管理画面に出す紐づけ先（候補・紐づけ済み）の形。個人情報（住所・電話・メール等）は持たない。 */
export type PmsPartnerGuest = {
  id: string;
  guestType: PmsPartnerGuestType;
  /** 正式名称（法人格つき）。空なら「（名称未設定）」（表示用） */
  formalName: string;
  /** 請求書の宛名に使う正式名称。空なら ''（宛名は取引先名になる・請求書の発行と同じ判定） */
  recipientName: string;
  kana: string | null;
  branch: string | null;
  guestCode: string | null;
  updatedAt: string | null;
};

/** 検索語を ilike の部分一致パターンにする。% _ \ はエスケープする（検索は列ごとの .ilike() なので , ( ) はそのまま使える）。 */
export function ilikeContainsPattern(raw: string): string {
  const q = raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  if (!q) return '';
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ============================================================================
// 予約名義（Phase 2・docs/partner-pms-customer-link.md §6.1〜§6.3）
//   guest   … 宿泊者名で取る（PMS の代表者＝お客様・予約者＝紐づけ先）。従来どおり
//   partner … 旅行会社名で取る（PMS の代表者＝紐づけ先・お客様は部屋別の宿泊者名。お客様の顧客台帳は作らない）
// 取引先の設定（rms_partners.booking_name_mode）と、予約ごとの実際の名義（rms_partner_bookings.name_mode）の両方に使う。
// ============================================================================

export type BookingNameMode = 'guest' | 'partner';
export const BOOKING_NAME_MODES: readonly BookingNameMode[] = ['guest', 'partner'];

/** 不明な値は 'guest'（従来どおり）に倒す。 */
export const normalizeBookingNameMode = (v: unknown): BookingNameMode => (v === 'partner' ? 'partner' : 'guest');

/**
 * 名義の表示（「ご予約名義: 」の後ろ）: 「株式会社JTB（お部屋の宿泊者名: 山田 太郎 様）」。
 * 名義人が空なら ''（行を出さない）。宿泊者名が空なら名義人だけ。
 */
export function bookingNameHolderText(holder: string | null | undefined, guestName: string | null | undefined): string {
  const h = (holder ?? '').trim();
  if (!h) return '';
  const g = (guestName ?? '').replace(/\s+/g, ' ').trim();
  return g ? `${h}（お部屋の宿泊者名: ${g} 様）` : h;
}

/**
 * 予約1件の名義の行（メール・一覧）。名義が partner のときだけ「ご予約名義: …」、それ以外は null。
 * holder は予約時の紐づけ先（rms_partner_bookings.pms_guest_id）の正式名称。読めなければ fallback（取引先名）。
 */
export function bookingNameLine(
  nameMode: unknown,
  holder: string | null | undefined,
  guestName: string | null | undefined,
  fallback: string | null | undefined = null
): string | null {
  if (normalizeBookingNameMode(nameMode) !== 'partner') return null;
  const text = bookingNameHolderText((holder ?? '').trim() || fallback, guestName);
  return text ? `ご予約名義: ${text}` : null;
}
