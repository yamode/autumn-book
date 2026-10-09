// 取引先ページの添付ファイル API の入口（機能フラグ・確認モード・削除できるか）の確認。
// 入口の実体は portal.ts の requirePortalApi（確認モードは GET 以外 403）。DB・Stripe はモックで切り離す。
import { describe, expect, it, vi, beforeEach } from 'vitest';

const env: Record<string, string> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

class PartnerStoreError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
vi.mock('./store', () => ({
  PartnerStoreError,
  SESSION_TTL_HOURS: 12,
  todayJst: () => '2026-10-07',
  partnerAdminClient: () => ({}),
  // 施設の選択（?f=・クッキー）は portal.ts。束は1施設・合成は固定の取引先を返す（2026-10-09 複数施設化）
  findPartnerBundleByUrlToken: async () => ({ common: { id: 'p1', primary_facility_id: 'f1' }, facilities: [{ facility_id: 'f1', slug: 'oga', enabled: true }] }),
  composePartnerContext: () => ({ id: 'p1', name: '取引先', facility_id: 'f1', facility_slug: 'oga', facility_name: '宿', facility_available: true }),
  defaultPartnerFacilityId: () => 'f1',
  loadPartnerContext: async () => null,
  NO_PARTNER_FACILITY_MESSAGE: '現在ご案内できる施設がありません。',
  getPartnerSession: async () => null,
  partnerUnavailableReason: () => null,
  logPartnerAccess: async () => undefined
}));
vi.mock('./booking', () => ({ isPartnerBookingOpen: () => true }));
vi.mock('./preview', () => ({
  PARTNER_PREVIEW_COOKIE: 'pv',
  PREVIEW_ACCOUNT_ID: '00000000-0000-0000-0000-000000000000',
  PREVIEW_DENIED_MESSAGE: '確認モードでは操作できません。',
  verifyPreviewToken: async () => true
}));

const { requireAttachmentApi, portalAttachmentView } = await import('./portal-attachments');

const eventOf = (method: string) => ({
  params: { token: 't', id: 'x' },
  cookies: { get: (k: string) => (k === 'pv' ? 'signed' : undefined) },
  request: new Request('https://example.test/p/t/book/attachments', { method })
});

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
};

describe('requireAttachmentApi', () => {
  beforeEach(() => {
    env.PARTNER_BOOKING_ATTACHMENTS = 'true';
  });
  it('機能が off なら 404（画面にも API にも出さない）', async () => {
    env.PARTNER_BOOKING_ATTACHMENTS = 'false';
    expect(await status(requireAttachmentApi(eventOf('GET') as never))).toBe(404);
  });
  it('確認モードは GET（一覧・ダウンロード）だけ通り、追加・削除は 403', async () => {
    expect(await status(requireAttachmentApi(eventOf('GET') as never))).toBe(200);
    expect(await status(requireAttachmentApi(eventOf('POST') as never))).toBe(403);
    expect(await status(requireAttachmentApi(eventOf('DELETE') as never))).toBe(403);
  });
});

describe('portalAttachmentView', () => {
  const row = {
    id: 'a1',
    partner_id: 'p1',
    partner_booking_id: 'b1',
    file_name: '名簿.xlsx',
    mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byte_size: 48213,
    storage_path: 'partner-booking/f/p1/x.xlsx',
    uploaded_by_kind: 'partner' as const,
    uploaded_by_account: 'acc1',
    uploaded_by_label: 'jtb-sendai',
    note: null,
    created_at: '2026-10-07T01:00:00Z'
  };
  it('ダウンロードの URL は予約の配下・自分の分は消せる', () => {
    const v = portalAttachmentView('t', { bookingId: 'b1' }, row, { id: 'acc1' }, true);
    expect(v.href).toBe('/p/t/bookings/b1/attachments/a1');
    expect(v.canDelete).toBe(true);
    expect(v.uploader).toBe('貴社（jtb-sendai）');
  });
  it('確認モード・他の子アカウント・予約の状態で消せないときは消せない', () => {
    expect(portalAttachmentView('t', { bookingId: 'b1' }, row, { id: 'acc1', preview: true }, true).canDelete).toBe(false);
    expect(portalAttachmentView('t', { bookingId: 'b1' }, row, { id: 'acc2' }, true).canDelete).toBe(false);
    expect(portalAttachmentView('t', { bookingId: 'b1' }, row, { id: 'acc2', is_master: true }, true).canDelete).toBe(true);
    expect(portalAttachmentView('t', { bookingId: 'b1' }, row, { id: 'acc1' }, false).canDelete).toBe(false);
  });
  it('予約入力の仮置きは /book/attachments の配下', () => {
    expect(portalAttachmentView('t', { stagedFor: 'acc1' }, { ...row, partner_booking_id: null }, { id: 'acc1' }, true).href).toBe('/p/t/book/attachments/a1');
  });
});
