// 取引先の合成（共通 × 選んだ施設・docs/partner-multi-facility.md §7.9・決定 N6/N9・2026-10-09）。DB はモックで切り離す。
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/supabase-data', () => ({ FACILITY_UUID: { 'f-nishiwaga': 'fac-n', 'f-oga': 'fac-o' } }));
vi.mock('./admin-client', () => ({ partnerServiceClient: () => null }));
vi.mock('./memorandum', () => ({ removeAllPartnerDocumentFiles: async () => undefined }));
vi.mock('./booking-attachments', () => ({ removeAllBookingAttachmentFiles: async () => undefined }));
vi.mock('./preview', () => ({ PREVIEW_ACCOUNT_ID: 'preview' }));

const { composePartnerContext, defaultPartnerFacilityId } = await import('./store');
type Bundle = Parameters<typeof composePartnerContext>[0];

const facility = (id: string, slug: string, over: Partial<Bundle['facilities'][number]> = {}): Bundle['facilities'][number] => ({
  partner_id: 'p1',
  facility_id: id,
  tenant_id: 't1',
  enabled: true,
  booking_enabled: true,
  max_days_ahead: 365,
  show_inventory: true,
  include_advance: true,
  pricing: { rules: [] } as never,
  payment_method_id: null,
  facility_settings: {},
  sort_order: 0,
  updated_at: null,
  slug,
  name: slug === 'oga' ? '山人-oga-' : '山人-yamado-',
  ...over
});

const bundle = (facilities: Bundle['facilities'], primary: string | null = 'fac-o'): Bundle => ({
  common: {
    id: 'p1',
    tenant_id: 't1',
    primary_facility_id: primary,
    legacy_facility_id: 'fac-o',
    name: '取引先',
    kind: 'agent',
    contact_name: null,
    contact_email: null,
    url_token: 'tok',
    is_active: true,
    valid_from: null,
    valid_until: null,
    note: null,
    common_settings: { leadDays: 3, notice: '共通', planNames: { a: '旧い共通' } },
    pms_guest_id: null,
    booking_name_mode: 'guest',
    credit_over_action: 'warn',
    created_at: '',
    updated_at: ''
  },
  facilities
});

describe('composePartnerContext', () => {
  it('選んだ施設の列と、共通 ‖ 施設 で合成した booking_settings', () => {
    const b = bundle([facility('fac-n', 'yamado'), facility('fac-o', 'oga', { max_days_ahead: 90, facility_settings: { leadDays: 0, planNames: { a: '男鹿向け' } } })]);
    const ctx = composePartnerContext(b, 'fac-o')!;
    expect(ctx.facility_id).toBe('fac-o');
    expect(ctx.facility_slug).toBe('oga');
    expect(ctx.max_days_ahead).toBe(90);
    expect(ctx.booking_settings.leadDays).toBe(0);
    expect(ctx.booking_settings.planNames).toEqual({ a: '男鹿向け' });
    expect(ctx.booking_settings.notice).toBe('共通');
    expect(ctx.facility_available).toBe(true);
    expect(ctx.facilities.map((f) => f.slug)).toEqual(['yamado', 'oga']);
    expect('legacy_facility_id' in ctx).toBe(false);
  });

  it('施設の指定が無い・オフなら既定の施設（primary → オンの先頭）', () => {
    const b = bundle([facility('fac-n', 'yamado'), facility('fac-o', 'oga', { enabled: false })]);
    expect(defaultPartnerFacilityId(b)).toBe('fac-n');
    expect(composePartnerContext(b, 'fac-o')!.facility_id).toBe('fac-n');
    expect(composePartnerContext(b, null)!.facility_id).toBe('fac-n');
  });

  it('管理画面（allowDisabled）はオフの施設でも合成し、予約受付は off', () => {
    const b = bundle([facility('fac-n', 'yamado'), facility('fac-o', 'oga', { enabled: false })]);
    const ctx = composePartnerContext(b, 'fac-o', { allowDisabled: true })!;
    expect(ctx.facility_id).toBe('fac-o');
    expect(ctx.facility_available).toBe(false);
    expect(ctx.booking_enabled).toBe(false);
  });

  it('オンが1つも無い（N9）: primary の施設で合成し、facility_available=false・予約受付 off', () => {
    const b = bundle([facility('fac-n', 'yamado', { enabled: false }), facility('fac-o', 'oga', { enabled: false })]);
    const ctx = composePartnerContext(b, null)!;
    expect(ctx.facility_id).toBe('fac-o');
    expect(ctx.facility_available).toBe(false);
    expect(ctx.booking_enabled).toBe(false);
  });

  it('施設の行が無ければ null', () => {
    expect(composePartnerContext(bundle([]), null)).toBeNull();
  });
});
