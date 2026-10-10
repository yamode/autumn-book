// 取引先ページの団体予約: ブラウザ内の下書き（束）と「同じ条件でもう一度」の受け渡し（docs/partner-group-booking.md §8.1・N7）。
// 下書きはサーバに置かない（localStorage だけ）。読めない・書けない環境（プライベートウィンドウ・保存の無効化）では
// 何もしない（try/catch）。画面は保存できなくても動く。
// 予約者（氏名・電話・メール等）は個人情報なので localStorage に残さない（保存時に外す）。読み戻した束の予約者は空になり、
// 画面が今の入力欄の予約者（初期値はアカウントの予約者情報）で補う（withDraftBooker）。
import { EMPTY_BOOKER, type PartnerBooker } from '$lib/partner-booking';
import { normalizeGroupDraftItem, type GroupDraftItem } from '$lib/partner-group';

/** 束の1行（送る照会1件＋表示用の名前と、追加した時点の自動計算額） */
export type GroupDraftEntry = {
  /** 画面内の識別子（並べ替え・削除用・送信しない） */
  key: string;
  item: GroupDraftItem;
  facilityName: string;
  roomName: string;
  planLabel: string;
  /** 自動計算額（宿泊料金・入湯税）。計算できない・入力を直した後で未計算なら null */
  quote: { total: number; bathTax: number } | null;
  /** 計算できなかった理由（「料金は宿からの回答でご案内します」等） */
  quoteNote: string;
};

const DRAFT_VERSION = 1;

export const newDraftKey = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** 束を読む（無い・壊れている・読めないときは空） */
export function loadGroupDraft(storageKey: string): { entries: GroupDraftEntry[]; form: unknown } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { entries: [], form: null };
    const j = JSON.parse(raw) as { v?: number; entries?: unknown[]; form?: unknown };
    if (j?.v !== DRAFT_VERSION || !Array.isArray(j.entries)) return { entries: [], form: null };
    const entries = j.entries
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => {
        const q = e.quote as { total?: unknown; bathTax?: unknown } | null;
        return {
          key: typeof e.key === 'string' && e.key ? e.key : newDraftKey(),
          // 以前の保存に予約者が残っていても読み戻さない（画面の入力欄の予約者で補う）
          item: { ...normalizeGroupDraftItem(e.item), booker: { ...EMPTY_BOOKER } },
          facilityName: String(e.facilityName ?? ''),
          roomName: String(e.roomName ?? ''),
          planLabel: String(e.planLabel ?? ''),
          quote: q && Number.isFinite(Number(q.total)) ? { total: Number(q.total), bathTax: Number(q.bathTax) || 0 } : null,
          quoteNote: String(e.quoteNote ?? '')
        } satisfies GroupDraftEntry;
      });
    return { entries, form: j.form ?? null };
  } catch {
    return { entries: [], form: null };
  }
}

/** 予約者が空か（氏名・電話・メールのどれも無い） */
export const isEmptyBooker = (b: PartnerBooker | null | undefined) => !b || !(b.name || b.phone || b.email);

/** 束の1件の予約者が空なら、いまの入力欄の予約者で補う（保存から読み戻した行は予約者が空） */
export const withDraftBooker = (item: GroupDraftItem, booker: PartnerBooker): GroupDraftItem =>
  isEmptyBooker(item.booker) ? { ...item, booker: { ...booker } } : item;

/** 保存用に予約者を外す（束の各行と入力中のフォームの booker） */
function stripBookers(entries: GroupDraftEntry[], form: unknown): { entries: GroupDraftEntry[]; form: unknown } {
  const outEntries = entries.map((e) => ({ ...e, item: { ...e.item, booker: { ...EMPTY_BOOKER } } }));
  let outForm = form;
  if (form && typeof form === 'object' && 'booker' in form) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { booker, ...rest } = form as Record<string, unknown>;
    outForm = rest;
  }
  return { entries: outEntries, form: outForm };
}

/** 束（と入力中のフォーム）を保存。束もフォームも空なら消す。予約者は保存しない */
export function saveGroupDraft(storageKey: string, entries: GroupDraftEntry[], form: unknown): void {
  try {
    if (!entries.length && !form) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify({ v: DRAFT_VERSION, ...stripBookers(entries, form) }));
  } catch {
    // 保存できなくても入力は続けられる
  }
}

export function clearGroupDraft(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // 何もしない
  }
}

// ---- 「同じ条件でもう一度」: 一覧・詳細 → 入力画面へ照会の内容を渡す（sessionStorage・1回読んだら消す） ----

const copyKey = (token: string) => `ab:group-copy:${token}`;

/** 照会（一覧・詳細の行）から入力の1件を組み立てる。チェックイン日は入れ直してもらう前提でそのまま */
export function inquiryToDraftItem(r: {
  facility_id: string;
  group_name: string;
  room_code: string;
  plan_code: string;
  plan_name: string;
  check_in_date: string;
  nights: number;
  adult_total: number;
  rooms: { adults: number }[];
  payment_option: string;
  extras: { transport?: { choice?: string; other?: string } | null; dinnerTime?: { choice?: string; other?: string } | null; note?: string | null } | null;
  booker: unknown;
}): GroupDraftItem {
  return normalizeGroupDraftItem({
    facilityId: r.facility_id,
    groupName: r.group_name,
    roomCode: r.room_code,
    planCode: r.plan_code,
    planName: r.plan_name,
    checkIn: r.check_in_date,
    nights: r.nights,
    adults: r.adult_total,
    rooms: r.rooms,
    paymentOption: r.payment_option,
    transport: { choice: r.extras?.transport?.choice ?? '', other: r.extras?.transport?.other ?? '' },
    dinnerTime: { choice: r.extras?.dinnerTime?.choice ?? '', other: r.extras?.dinnerTime?.other ?? '' },
    note: r.extras?.note ?? '',
    booker: r.booker
  });
}

export function stashGroupCopy(token: string, item: GroupDraftItem): void {
  try {
    sessionStorage.setItem(copyKey(token), JSON.stringify(item));
  } catch {
    // 渡せなくても入力画面は空で開く
  }
}

export function takeGroupCopy(token: string): GroupDraftItem | null {
  try {
    const raw = sessionStorage.getItem(copyKey(token));
    if (!raw) return null;
    sessionStorage.removeItem(copyKey(token));
    return normalizeGroupDraftItem(JSON.parse(raw));
  } catch {
    return null;
  }
}
