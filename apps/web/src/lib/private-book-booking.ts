// プライベートブック（特別会員の専用ページ経由の予約）を公式マイページから操作するときの判定（docs/private-book.md「マイページ（予約後）」）。
// 純関数だけを置く（テストは private-book-booking.test.ts）。サーバの呼び出しは lib/server/private-book-bookings.ts。
//
//   - 一般の予約（metadata.member_page が無い）は今までどおり公式の RPC（会員の authenticated クライアント）
//   - 専用ページ経由の予約は service_role の入口 book.member_page_*（予約の写しの partnerId × ログイン中の会員）
//   - 取消は「予約した本人」なら通す（対象から外れた方も・DB の変更が要る）。日程・お部屋の変更とアレンジは「今ページを使える方」だけ
import type { MemberPageSnapshot } from '$lib/partner-member-page';

/** book.member_page_* に渡す識別（専用ページ・予約した会員・予約番号） */
export type PrivateBookWho = { partnerId: string; memberUserId: string; code: string };

/** 公式マイページの操作の行き先 */
export type PrivateBookRoute =
  /** 一般の予約（今までどおり公式の RPC） */
  | { kind: 'general' }
  /** 専用ページ経由で、ログイン中の会員が予約した本人 */
  | { kind: 'private_book'; who: PrivateBookWho }
  /** 専用ページ経由だが、本人と確かめられない（ログインしていない・別の会員の予約） */
  | { kind: 'deny' };

/**
 * 予約の写し（my_reservations の member_page）とログイン中の会員から、操作の行き先を決める。
 * 写しの member_user_id が無い古い予約は、my_reservations が本人の予約しか返さないので本人として扱う（DB でも予約した本人を確かめる）
 */
export function privateBookRouteOf(
  r: { code: string; memberPage?: Pick<MemberPageSnapshot, 'partnerId' | 'memberUserId'> | null },
  userId: string | null | undefined
): PrivateBookRoute {
  const mp = r.memberPage;
  if (!mp) return { kind: 'general' };
  if (!userId || !mp.partnerId) return { kind: 'deny' };
  if (mp.memberUserId && mp.memberUserId !== userId) return { kind: 'deny' };
  return { kind: 'private_book', who: { partnerId: mp.partnerId, memberUserId: userId, code: r.code } };
}

/** 対象から外れた方（またはページの公開が止まっている）ときの、変更・アレンジの代わりの案内 */
export const PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE =
  'このご予約の日程・お部屋の変更とアレンジの追加は、現在この画面からお手続きいただけません。お電話でお問い合わせください（お取り消しはこの画面からできます）。';

/** 本人と確かめられないときの文言（B面の forbidden と同じ） */
export const PRIVATE_BOOK_FORBIDDEN_MESSAGE = 'このご予約はお手続きいただけません（ご予約された会員さまのログインでお手続きください）。';

/**
 * 日程・お部屋の変更とアレンジの追加を受けてよいか（今までどおり「ページを使える方」だけ・B面の resolvePortal と同じ条件）。
 * access: rms_member_page_access（本人か家族で、退会していない）。page: 専用ページ（読めなければ null）。today は JST の YYYY-MM-DD。
 * 受けてよければ null、だめなら案内の文言。取消はこれを見ない（予約した本人なら外れた方も取り消せる）
 */
export function privateBookChangeBlock(
  s: { access: boolean; page: { is_active: boolean; valid_from: string | null; valid_until: string | null } | null },
  today: string
): string | null {
  if (!s.access || !s.page || !s.page.is_active) return PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE;
  if (s.page.valid_from && today < s.page.valid_from) return PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE;
  if (s.page.valid_until && today > s.page.valid_until) return PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE;
  return null;
}

/** 部屋の変更の候補の識別（公式の画面の offer=<ratePlanId>__<roomTypeId> に、専用ページの planCode■planName と部屋タイプのコードを入れる） */
export const PRIVATE_BOOK_OFFER_SEP = '__';
export const privateBookOfferKey = (planKey: string, roomCode: string): string => `${planKey}${PRIVATE_BOOK_OFFER_SEP}${roomCode}`;

/** planCode■planName を分ける（planCode に ■ は入らない）。形が違えば null */
export function splitPrivateBookPlanKey(planKey: string): { planCode: string; planName: string } | null {
  const i = planKey.indexOf('■');
  if (i <= 0) return null;
  const planCode = planKey.slice(0, i);
  const planName = planKey.slice(i + 1).trim();
  if (!planName) return null;
  return { planCode, planName };
}
