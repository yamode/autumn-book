import { fail } from '@sveltejs/kit';
import { normalizeBooker } from '$lib/partner-booking';
import { getBookerProfile, logPartnerAccess, PartnerStoreError, saveBookerProfile } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: アカウント → 担当者情報（ログイン中のアカウントの予約担当者情報。2026-10-01 追加）。
// 読み書きはセッションで確かめたアカウント（session.id）と partner.id の組だけ。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const booker = await getBookerProfile(db, partner.id, session.id);
  return {
    portal: portalHeader(partner, session),
    loginId: session.login_id,
    booker
  };
};

export const actions = {
  default: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const input = normalizeBooker({
      name: fd.get('name'),
      kana: fd.get('kana'),
      department: fd.get('department'),
      phone: fd.get('phone'),
      email: fd.get('email')
    });
    try {
      const saved = await saveBookerProfile(db, partner.id, session.id, input);
      await logPartnerAccess(db, { partnerId: partner.id, accountId: session.id, channel: 'web', action: 'booker_profile_save', ip: requestMeta(event).ip });
      return { saved: true, booker: saved };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 500 ? e.status : 400, { message: e.message, booker: input });
      throw e;
    }
  }
};
