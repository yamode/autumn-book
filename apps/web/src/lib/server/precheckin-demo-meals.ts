import { normTime, PC_MEAL_TYPES, type PcContext, type PcMealType } from '$lib/precheckin';
import { partnerServiceClient } from '$lib/server/partners/admin-client';

type MealTime = { meal_type: PcMealType; meal_time: string };
type DaySettings = { meal_type: PcMealType; active_times: unknown; extra_times: unknown; metadata: { full_times?: unknown } | null };

function configuredTime(value: unknown): string | null {
  return typeof value === 'string' ? normTime(value.trim().match(/^\d{1,2}:\d{2}/)?.[0]) : null;
}

function configuredTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => configuredTime(item && typeof item === 'object' ? item.time : item))
    .filter((time): time is string => time !== null);
}

/** 本番の選択肢と休止枠を読む。テストに実予約の残室や枠の使用数は混ぜない。 */
export async function loadDemoMealSlots(facilityId: string, checkIn: string, checkOut: string): Promise<PcContext['slots']> {
  const db = partnerServiceClient();
  if (!db || !facilityId) throw new Error('Demo meal configuration unavailable');
  const pms = db.schema('pms');
  const [master, day] = await Promise.all([
    pms.from('facility_meal_timeslots').select('meal_type, meal_time').eq('facility_id', facilityId).eq('is_active', true).eq('is_default', true),
    pms.from('facility_meal_day_settings').select('meal_type, active_times, extra_times, metadata').eq('facility_id', facilityId).eq('meal_date', checkIn)
  ]);
  if (master.error || day.error) throw master.error ?? day.error;
  const defaults = (master.data ?? []) as MealTime[];
  const overrides = (day.data ?? []) as DaySettings[];
  const slots: PcContext['slots'] = { dinner: {}, breakfast: {} };
  for (const type of PC_MEAL_TYPES) {
    const settings = overrides.find((row) => row.meal_type === type);
    const base = Array.isArray(settings?.active_times)
      ? configuredTimes(settings.active_times)
      : configuredTimes(defaults.filter((row) => row.meal_type === type).map((row) => row.meal_time));
    const times = [...new Set([...base, ...configuredTimes(settings?.extra_times)])].sort();
    const full = new Set(configuredTimes(settings?.metadata?.full_times));
    slots[type][type === 'dinner' ? checkIn : checkOut] = times.map((time) => ({
      time, max: null, remaining: full.has(time) ? 0 : null, full: full.has(time)
    }));
  }
  return slots;
}
