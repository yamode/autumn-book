// 取引先専用ページ（ブラウザ・サーバ共通）: 連泊のときに「同じ部屋・同じプランで全泊空いているか」と料金を出す。
// 料金カレンダーの日別データ（PartnerRateDay）は1泊ごとなので、チェックイン日から泊数ぶんの日をたどって判定する。
// 確定時の金額・在庫はサーバ（quotePartnerBooking / 予約確定）で改めて確かめる。
import type { PartnerRateDay } from '$lib/partner-pricing';

export type PartnerStayOffer = {
  roomCode: string;
  roomName: string;
  planCode: string;
  planName: string;
  mealType: string | null;
  advance: boolean;
  /** 1名1泊あたり（全泊の平均・円未満四捨五入） */
  perPerson: number;
  /** 1名あたりの全泊合計 */
  totalPerPerson: number;
  /** 全泊の最小残室（残室を見せない取引先・残室が取れない日は null） */
  remaining: number | null;
};

export const addDaysIsoClient = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * checkIn から nights 泊できる部屋×プラン（安い順）。
 * 途中の日のデータがまだ手元に無いときは null（＝判定できない。呼び出し側で月を読んでから出し直す）。
 */
export function partnerStayOffers(
  dayOf: (iso: string) => PartnerRateDay | undefined,
  checkIn: string,
  nights: number,
  guests: number,
  opts: { showInventory: boolean; planCode?: string; planName?: string; roomCode?: string; rooms?: number }
): PartnerStayOffer[] | null {
  const dates = Array.from({ length: Math.max(1, nights) }, (_, i) => addDaysIsoClient(checkIn, i));
  const days: PartnerRateDay[] = [];
  for (const iso of dates) {
    const day = dayOf(iso);
    if (!day) return null;
    if (day.closed) return [];
    days.push(day);
  }
  const g = String(guests);
  const out: PartnerStayOffer[] = [];
  for (const room of days[0].rooms) {
    if (opts.roomCode && room.roomCode !== opts.roomCode) continue;
    for (const plan of room.plans) {
      if (opts.planCode && (plan.planCode !== opts.planCode || plan.planName !== opts.planName)) continue;
      let total = 0;
      let remaining: number | null = null;
      let ok = true;
      for (const day of days) {
        const r = day.rooms.find((x) => x.roomCode === room.roomCode);
        const p = r?.plans.find((x) => x.planCode === plan.planCode && x.planName === plan.planName);
        const price = p?.pricesPerPerson[g];
        // 残室を見せる取引先は、残室が室数に足りない日を除く（残室が取れない日はサーバの確定時に確かめる）
        const short = opts.showInventory && r?.remainingRooms != null && r.remainingRooms < Math.max(1, opts.rooms ?? 1);
        if (!r || !(price != null && price > 0) || short) {
          ok = false;
          break;
        }
        total += price;
        if (r.remainingRooms != null) remaining = remaining == null ? r.remainingRooms : Math.min(remaining, r.remainingRooms);
      }
      if (!ok) continue;
      out.push({
        roomCode: room.roomCode,
        roomName: room.roomName,
        planCode: plan.planCode,
        planName: plan.planName,
        mealType: plan.mealType,
        advance: plan.advance,
        perPerson: Math.round(total / days.length),
        totalPerPerson: total,
        remaining
      });
    }
  }
  return out.sort((a, b) => a.perPerson - b.perPerson);
}

export type PartnerReferencePlan = {
  roomCode: string;
  roomName: string;
  planCode: string;
  planName: string;
  mealType: string | null;
  advance: boolean;
  /** 読み込んだ期間で泊まれる日の最安（1名1泊） */
  minPerPerson: number;
};

/** 日付を選ぶ前に出す、部屋×プランごとの最安（読み込んだ期間・1泊・その人数で泊まれる日だけ） */
export function partnerReferencePlans(days: PartnerRateDay[], guests: number, opts: { showInventory: boolean; from: string }): PartnerReferencePlan[] {
  const g = String(guests);
  const best = new Map<string, PartnerReferencePlan>();
  for (const day of days) {
    if (day.closed || day.date < opts.from) continue;
    for (const room of day.rooms) {
      if (opts.showInventory && room.remainingRooms === 0) continue;
      for (const plan of room.plans) {
        const price = plan.pricesPerPerson[g];
        if (!(price != null && price > 0)) continue;
        const key = `${room.roomCode}|${plan.planCode}|${plan.planName}`;
        const hit = best.get(key);
        if (!hit || price < hit.minPerPerson) {
          best.set(key, { roomCode: room.roomCode, roomName: room.roomName, planCode: plan.planCode, planName: plan.planName, mealType: plan.mealType, advance: plan.advance, minPerPerson: price });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => a.minPerPerson - b.minPerPerson);
}

/** 予約入力画面の「戻る」に使う、取引先ページ内の戻り先（それ以外は料金カレンダー） */
export function partnerBackTarget(token: string, from: string | null | undefined): { href: string; label: string } {
  const base = `/p/${token}/`;
  const path = String(from ?? '');
  if (path.startsWith(base) && !path.includes('//', 1)) {
    const head = path.slice(base.length).split(/[/?#]/)[0];
    if (head === 'plans') return { href: path, label: 'プランのご紹介へ戻る' };
    if (head === 'stay') return { href: path, label: 'お部屋とプランへ戻る' };
    if (head === 'rooms') return { href: path, label: 'お部屋のご紹介へ戻る' };
    if (head === 'calendar') return { href: path, label: '料金カレンダーへ戻る' };
  }
  return { href: `${base}calendar`, label: '料金カレンダーへ戻る' };
}
