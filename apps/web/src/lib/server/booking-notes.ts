// 予約時の注意事項（book.booking_notes・autumn-shared 20261006014729）。施設ごとに1件・Markdown。
// 読み込みは公開情報なので anon（supa()）。書き込みは管理画面からログイン中スタッフの権限で RPC（admin_save_booking_note）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';

/** 施設の注意事項（無い・読めないときは空文字） */
export async function loadBookingNote(facilityUuid: string, client?: SupabaseClient): Promise<string> {
  if (DATA_SOURCE !== 'supabase' && !client) return '';
  try {
    const db = client ? client.schema('book') : supa();
    const { data, error } = await db.from('booking_notes').select('body').eq('facility_id', facilityUuid).maybeSingle();
    if (error) throw error;
    return String((data as { body?: string } | null)?.body ?? '');
  } catch (e) {
    console.error('[booking-notes] load', e instanceof Error ? e.message : String(e));
    return '';
  }
}

export async function saveBookingNote(client: SupabaseClient, facilityUuid: string, body: string): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_save_booking_note', { p_facility_id: facilityUuid, p_body: body });
  if (error) throw error;
}
