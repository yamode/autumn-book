// 特別会員の専用ページのかご（docs/vip-member-page.md §13.4.3・§14.7）。
// 料金カレンダー・プラン詳細の「＋ もう 1 室追加」で入れ、画面下のかごバー（PartnerBookingCart・layout に置く）から
// 「予約へ進む」で POST /p/<token>/book（default action）に rooms JSON を送る。在庫は押さえない（押さえるのは送信のとき）。
// 保存は sessionStorage（キー ab_member_cart_v1・公式の ab_booking_cart_v1 とは別）。読めない・書けない環境でも画面の中では動く。
// 状態はブラウザの中だけ（サーバでは中身を入れない: load はブラウザでだけ呼ぶ）。
import * as m from '$lib/paraglide/messages';
import { canAddToCart, readCartWith, writeCartWith, type CartAddBlock } from '$lib/multi-room';
import {
  isMemberCartItem,
  MEMBER_CART_STORAGE_KEY,
  memberCartPayload,
  normalizeMemberCartItem,
  type MemberCartItem
} from '$lib/partner-member-page';

/** 室数の上限に達したときの注意（4 室目を入れた時点で出す） */
export function memberCartFullNotice(limit: number): string {
  // 公式のかごと同じ文言（/p は URL に言語が無いので日本語で出る）
  return m.cart_full_notice({ max: String(limit), next: String(limit + 1) });
}

/** かごに入れられなかった理由の文言 */
export function memberCartBlockMessage(reason: CartAddBlock, limit: number): string {
  switch (reason) {
    case 'full':
      return memberCartFullNotice(limit);
    case 'mixed_payment':
      return '現地払いだけのプランと事前決済だけのプランは、同じご予約にできません。別のご予約にしてください。';
    case 'no_remaining':
      return 'このお部屋は残りの室数を超えるため、これ以上かごに入れられません。';
    case 'other_stay':
      return 'かごには別の日程・施設のお部屋が入っています。';
  }
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

class MemberCart {
  items = $state<MemberCartItem[]>([]);
  /** バーの上に出す案内（入れた・入れられなかった理由）。空なら出さない */
  message = $state('');
  /** 1 回の予約の室数の上限（料金カレンダーが開いたときに min(4, 最大室数) を入れる） */
  limit = $state(4);
  #token = '';

  /** このページ（限定URL）のかごを読む。別のページのかごは見せない */
  load(token: string) {
    this.#token = token;
    this.items = readCartWith(storage(), MEMBER_CART_STORAGE_KEY, isMemberCartItem, normalizeMemberCartItem).filter((c) => c.partnerToken === token);
    this.message = '';
  }

  #save() {
    writeCartWith(storage(), MEMBER_CART_STORAGE_KEY, this.items);
  }

  /**
   * 1 室を入れる。別の日程・施設のお部屋が入っていれば confirmClear（「かごを空にしますか」）で確かめてから入れ替える。
   * 戻り: 入れたか
   */
  add(item: Omit<MemberCartItem, 'key' | 'partnerToken'>, limit: number, confirmClear: () => boolean): boolean {
    const full: MemberCartItem = { ...item, key: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, partnerToken: this.#token };
    let check = canAddToCart(this.items, full, limit);
    if (!check.ok && check.reason === 'other_stay') {
      if (!confirmClear()) return false;
      this.items = [];
      check = canAddToCart(this.items, full, limit);
    }
    if (!check.ok) {
      this.message = memberCartBlockMessage(check.reason, limit);
      return false;
    }
    this.items = [...this.items, full];
    this.message = this.items.length >= limit ? '' : `かごに入れました（${this.items.length}室）。続けて別のお部屋も選べます。`;
    this.#save();
    return true;
  }

  remove(key: string) {
    this.items = this.items.filter((c) => c.key !== key);
    this.message = '';
    this.#save();
  }

  clear() {
    this.items = [];
    this.message = '';
    this.#save();
  }

  /** 送る形（rooms JSON） */
  payload() {
    return memberCartPayload(this.items);
  }
}

export const memberCart = new MemberCart();
