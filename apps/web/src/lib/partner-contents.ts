// 取引先専用ページの「お部屋」「プラン」の紹介（サーバ・画面共通の純関数）。
//
// 紹介の正本は autumn-book の book.room_type_contents / book.plan_contents（2026-09-26 決定）。
// 公式サイト（autumn-book）と同じ文章・写真を、取引先ページでも見せる。編集は autumn-book の管理画面で行う。
// どの部屋・プランを見せるかは、取引先の特別レートのルール（料金を出しているもの）から決める。
import { ADVANCE_PLAN_CODE, type PartnerPricing } from '$lib/partner-pricing';

export type ContentPhoto = { url: string; caption: string; category: string };
export type ContentSpec = { label: string; value: string };
export type ContentSection = { group: string; title: string; text: string; note: string; photo: string | null };

type ContentBody = {
  headline: string;
  description: string;
  photos: ContentPhoto[];
  specs: ContentSpec[];
  sections: ContentSection[];
};

export type PartnerRoomContent = ContentBody & {
  code: string;
  name: string;
  shortName: string;
  capacityMin: number;
  capacityMax: number;
  amenities: string[];
};

export type PartnerPlanContent = ContentBody & {
  planCode: string; // a003 等（料金カレンダーの planCode）
  planLabel: string; // 基本■2食■スタンダード(+20350円)（料金カレンダーの planName）
  name: string; // 公式サイトのプラン名
  mealPlan: string;
  tags: string[];
  anchor: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function normalizePhotos(raw: unknown): ContentPhoto[] {
  return arr(raw)
    .map(obj)
    .map((p) => ({ url: str(p.url), caption: str(p.caption), category: str(p.category) }))
    .filter((p) => /^https:\/\//.test(p.url));
}

export function normalizeSpecs(raw: unknown): ContentSpec[] {
  return arr(raw)
    .map(obj)
    .map((s) => ({ label: str(s.label), value: str(s.value) }))
    .filter((s) => s.label && s.value);
}

export function normalizeSections(raw: unknown): ContentSection[] {
  return arr(raw)
    .map(obj)
    .map((s) => {
      const photo = str(s.photo);
      return { group: str(s.group), title: str(s.title), text: str(s.text), note: str(s.note), photo: /^https:\/\//.test(photo) ? photo : null };
    })
    .filter((s) => s.title || s.text);
}

// 同じ見出し（group）が続く説明ブロックをまとめる（見出しごとに1段落として並べる）。
export function groupSections(sections: ContentSection[]): { group: string; items: ContentSection[] }[] {
  const out: { group: string; items: ContentSection[] }[] = [];
  for (const s of sections) {
    const last = out[out.length - 1];
    if (last && last.group === s.group) last.items.push(s);
    else out.push({ group: s.group, items: [s] });
  }
  return out;
}

const body = (r: Record<string, unknown>): ContentBody => ({
  headline: str(r.headline),
  description: str(r.description),
  photos: normalizePhotos(r.photos),
  specs: normalizeSpecs(r.specs),
  sections: normalizeSections(r.sections)
});

// 紹介として見せる中身があるか（名前だけの行は出さない）。
export const hasContent = (c: ContentBody) => Boolean(c.description || c.photos.length || c.specs.length || c.sections.length);

// ページ内リンクの ID（料金カレンダー・予約入力からプランの紹介へ飛ぶ）。表示名は日本語なので短いハッシュにする。
export function planAnchor(planCode: string, planLabel: string): string {
  let h = 0;
  for (const ch of planLabel) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
  return `plan-${planCode}-${(h >>> 0).toString(36)}`;
}
export const roomAnchor = (code: string) => `room-${code}`;

// 取引先に見せる範囲: 「調整して出す」ルールで指定した部屋・プラン（null = すべて）。先行案内料金は紹介の対象外。
export function partnerContentScope(pricing: Pick<PartnerPricing, 'rules'>): { rooms: Set<string> | null; plans: Set<string> | null } {
  let rooms: Set<string> | null = new Set();
  let plans: Set<string> | null = new Set();
  for (const r of pricing.rules) {
    if (r.action !== 'adjust') continue;
    if (!r.roomCodes.length) rooms = null;
    else if (rooms) for (const c of r.roomCodes) rooms.add(c);
    if (!r.planGroupCodes.length) plans = null;
    else if (plans) for (const c of r.planGroupCodes) if (c !== ADVANCE_PLAN_CODE) plans.add(c);
  }
  return { rooms, plans };
}

export function buildPartnerContents(
  raw: unknown,
  pricing: Pick<PartnerPricing, 'rules'>
): { rooms: PartnerRoomContent[]; plans: PartnerPlanContent[] } {
  const scope = partnerContentScope(pricing);
  const data = obj(raw);
  const rooms = arr(data.rooms)
    .map(obj)
    .map((r) => ({
      ...body(r),
      code: str(r.code),
      name: str(r.name),
      shortName: str(r.short_name),
      capacityMin: Number(r.capacity_min) || 1,
      capacityMax: Number(r.capacity_max) || 1,
      amenities: arr(r.amenities).map(str).filter(Boolean)
    }))
    .filter((r) => r.code && (!scope.rooms || scope.rooms.has(r.code)));
  const plans = arr(data.plans)
    .map(obj)
    .map((p) => {
      const planCode = str(p.plan_code);
      const planLabel = str(p.plan_label);
      return {
        ...body(p),
        planCode,
        planLabel,
        name: str(p.name),
        mealPlan: str(p.meal_plan),
        tags: arr(p.highlight_tags).map(str).filter(Boolean),
        anchor: planAnchor(planCode, planLabel)
      };
    })
    .filter((p) => p.planCode && (!scope.plans || scope.plans.has(p.planCode)) && hasContent(p));
  return { rooms, plans };
}

// 社内向けの調整表記（例: 「(+20350円)」「(-10%)」）と区分の前置きを落として、取引先に見せる名前にする（料金カレンダーと同じ）。
export function displayPlanName(name: string): string {
  const last = name.split('■').map((s) => s.trim()).filter(Boolean).pop() ?? name;
  return last.replace(/[（(][^()（）]*(?:円|%|％)[)）]\s*$/, '').trim() || last;
}

// 部屋名「Yamazumi-山祇-│ジュニアスイート 48平米」を棟と部屋に分ける（料金カレンダーと同じ）。
export function roomParts(name: string): { building: string; room: string } {
  const [a, b] = name.split('│');
  return b ? { building: a.replace(/-+$/, '').trim(), room: b.trim() } : { building: '', room: name };
}
