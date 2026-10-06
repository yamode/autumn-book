// 客室案内（/r）のトップに出す食事時間（2026-10-07）。
// SoT は PMS の pms.stay_meals（予約詳細の伺い書で入力）。滞在トークンから RPC book.stay_meal_times で読む
// （autumn-shared 20261006221359）。席番号・メモなどスタッフ向けの情報は RPC 側で返さない。
//
// 将来の事前チェックイン（お客様が食事時間を申請）を見越し、1件ごとに status を持たせている。
// 今は PMS で決まった時間（confirmed）だけ。申請を受けるようになったら、申請中の希望を requested として
// 同じ形で返し、画面は「申請中」と出し分ける（客室案内トップの表示はそのまま使える）。
import { supa } from '$lib/server/supabase';

export type StayMealType = 'dinner' | 'breakfast' | 'lunch';
export type StayMeal = {
  /** 提供日 YYYY-MM-DD（夕食・昼食は宿泊日、朝食は翌朝） */
  date: string;
  type: StayMealType;
  /** 'HH:MM' */
  time: string;
  /** confirmed＝宿で決まった時間 / requested＝お客様の申請中の希望（事前チェックイン・将来） */
  status: 'confirmed' | 'requested';
};

const TYPES = new Set<StayMealType>(['dinner', 'breakfast', 'lunch']);
// 同じ日は 朝食 → 昼食 → 夕食 の順に並べる
const ORDER: Record<StayMealType, number> = { breakfast: 0, lunch: 1, dinner: 2 };

/** RPC の結果を画面用に整える（知らない種別・壊れた行は落とす） */
export function normalizeStayMeals(raw: unknown): StayMeal[] {
  const list = Array.isArray((raw as { meals?: unknown })?.meals) ? (raw as { meals: unknown[] }).meals : [];
  return list
    .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
    .map((r) => ({
      date: String(r.date ?? '').slice(0, 10),
      type: String(r.type ?? '') as StayMealType,
      time: String(r.time ?? '').trim(),
      status: (r.status === 'requested' ? 'requested' : 'confirmed') as StayMeal['status']
    }))
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && TYPES.has(m.type) && /^\d{1,2}:\d{2}$/.test(m.time))
    .sort((a, b) => a.date.localeCompare(b.date) || ORDER[a.type] - ORDER[b.type]);
}

/** 滞在トークンの食事時間。読めなければ空（トップの表示を止めない） */
export async function sbStayMealTimes(token: string): Promise<StayMeal[]> {
  const { data, error } = await supa().rpc('stay_meal_times', { p_token: token });
  if (error) return [];
  return normalizeStayMeals(data);
}
