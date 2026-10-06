// 管理画面: 予約時の注意事項（施設ごと）。予約入力の左カラム下部に、キャンセルポリシー・お子様についてと並べて出す。
import { fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { LIVE, NOT_LIVE, currentFacilityOf, denyIfNotStaff, facilityUuidOf, messageOf } from '$lib/server/admin-content-page';
import { loadBookingNote, saveBookingNote } from '$lib/server/booking-notes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { currentFacility } = await event.parent();
  if (!LIVE) return { live: false, body: '', loadError: NOT_LIVE };
  try {
    return { live: true, body: await loadBookingNote(facilityUuidOf(currentFacility.id), createSupabaseServerClient(event)), loadError: null as string | null };
  } catch (e) {
    return { live: true, body: '', loadError: messageOf(e) };
  }
};

export const actions: Actions = {
  save: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const form = await event.request.formData();
    const body = String(form.get('body') ?? '').replace(/\r\n?/g, '\n');
    if (body.length > 10000) return fail(400, { error: '10,000文字以内にしてください。' });
    try {
      await saveBookingNote(createSupabaseServerClient(event), currentFacilityOf(event).uuid, body);
    } catch (e) {
      return fail(500, { error: messageOf(e) });
    }
    return { saved: true };
  }
};
