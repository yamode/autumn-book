// 取引先予約の「予約者・交通手段・取引先特典」（2026-10-01 追加）を、PMS への要望・台帳・メール・一覧の形に直す純関数。
//
// PMS へは rms_partner_create_booking の options（PMS の「事前質問・要望」と備考に載る）の先頭に足して届ける。
// 台帳（rms_partner_bookings.detail）には構造化した値（booker / transport / perks）も残し、メール・一覧はそちらを使う。
// detail.options にも同じ行が入るので、表示側では二重に出さないよう splitExtraOptions で取り除く。
// DB・Stripe に触らないので単体テストできる（booking-extras.test.ts）。
import { describeBooker, describePerks, type PartnerBooker, type PartnerPerk } from '$lib/partner-booking';

export const BOOKER_LABEL = '予約者';
export const TRANSPORT_LABEL = '交通手段';
export const PERKS_LABEL = '取引先特典';
const EXTRA_LABELS = new Set([BOOKER_LABEL, TRANSPORT_LABEL, PERKS_LABEL]);

// 台帳 detail に足す値（特典は予約時点の内容を残す。後で設定を変えても予約の記録は変わらない）
export type BookingExtras = {
  booker: PartnerBooker;
  transport: string;
  perks: { title: string; description: string }[];
};

export function buildBookingExtras(booker: PartnerBooker, transport: string, perks: PartnerPerk[]): BookingExtras {
  return { booker, transport, perks: perks.map((p) => ({ title: p.title, description: p.description })) };
}

// rms_partner_create_booking の options の先頭に足す行（予約者 → 交通手段 → 取引先特典）。値の無いものは足さない。
export function extraOptionRows(x: BookingExtras): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const booker = describeBooker(x.booker);
  if (booker) rows.push({ label: BOOKER_LABEL, value: booker });
  if (x.transport) rows.push({ label: TRANSPORT_LABEL, value: x.transport });
  if (x.perks.length) rows.push({ label: PERKS_LABEL, value: describePerks(x.perks.map((p) => ({ ...p, id: '', planCodes: [] }))) });
  return rows;
}

type ExtraDetail = {
  booker?: Partial<PartnerBooker> | null;
  transport?: string | null;
  perks?: { title?: string; description?: string }[] | null;
  options?: { label: string; value: string }[];
};

// 台帳 detail から予約者・交通手段・特典を取り出す（無い予約＝この機能より前の予約は空）。
export function readBookingExtras(detail: ExtraDetail | null | undefined): {
  booker: PartnerBooker | null;
  transport: string;
  perks: { title: string; description: string }[];
} {
  const b = detail?.booker;
  const booker =
    b && (b.name || b.email)
      ? { name: String(b.name ?? ''), kana: String(b.kana ?? ''), department: String(b.department ?? ''), phone: String(b.phone ?? ''), email: String(b.email ?? '') }
      : null;
  const perks = Array.isArray(detail?.perks)
    ? detail.perks.map((p) => ({ title: String(p?.title ?? ''), description: String(p?.description ?? '') })).filter((p) => p.title)
    : [];
  return { booker, transport: String(detail?.transport ?? ''), perks };
}

// 一覧・メールに出す入力項目から、構造化して別に出す行（予約者・交通手段・取引先特典）を除く。
// 構造化した値が無い予約（旧データ）はそのまま出す。
export function splitExtraOptions(detail: ExtraDetail | null | undefined): { label: string; value: string }[] {
  const opts = detail?.options ?? [];
  const x = readBookingExtras(detail);
  const has = { [BOOKER_LABEL]: !!x.booker, [TRANSPORT_LABEL]: !!x.transport, [PERKS_LABEL]: x.perks.length > 0 } as Record<string, boolean>;
  return opts.filter((o) => !(EXTRA_LABELS.has(o.label) && has[o.label]));
}

// メール本文の行（予約者・交通手段・取引先特典）。宿への通知にも同じ行を載せる。
export function extraSummaryLines(detail: ExtraDetail | null | undefined): string[] {
  const x = readBookingExtras(detail);
  const lines: string[] = [];
  if (x.booker) {
    const kana = x.booker.kana ? `（${x.booker.kana}）` : '';
    lines.push(`${BOOKER_LABEL}: ${x.booker.name}${kana}${x.booker.department ? ` ${x.booker.department}` : ''}`);
    if (x.booker.phone) lines.push(`予約者の電話: ${x.booker.phone}`);
    if (x.booker.email) lines.push(`予約者のメール: ${x.booker.email}`);
  }
  if (x.transport) lines.push(`${TRANSPORT_LABEL}: ${x.transport}`);
  for (const p of x.perks) lines.push(`${PERKS_LABEL}: ${p.title}${p.description ? `（${p.description.replace(/\s*\n\s*/g, ' ')}）` : ''}`);
  return lines;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 取引先宛てメールの宛先: 予約者のメールを先頭に、予約したログインIDのメール・取引先の連絡先メールを足す（大文字小文字違いは1通）。
// 宿泊者のメール（guest_email）はここに入れない＝宿泊者へは何も送らない（2026-10-01 指示）。
export function partnerMailRecipients(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = String(raw ?? '').trim();
    if (!e || !EMAIL_RE.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
