// 管理画面（/admin/partners/**）の入口検証とパスワード設定メール。
// autumn-rms の staff.ts から移設（2026-09-26）。RMS の requireCapability('partners:*')・requireFacilityAccess・
// loadRmsWorkbook は Book には無いので、Book の管理画面の流儀に置き換えた:
//
//   1. 役割: locals.user.role が admin / staff（閲覧）。編集は admin のみ（下の canEditPartners を参照）。
//   2. 施設: 管理画面共通の ab_fac クッキー → FACILITY_UUID。
//   3. 施設へのアクセス: rms_partner_* は service_role 専用なので RLS では守れない。service_role で触る前に、
//      ログイン中スタッフの Supabase クライアントで既存 RPC book.private_bath_contents_admin(p_facility) を呼び、
//      private.has_facility_access を通ることを確かめる（通らなければ 'forbidden' で弾かれる）。
//      読み取り専用の軽い RPC なので、確認のために呼んでも副作用は無い。
//   4. DATA_SOURCE / AUTH_MODE が supabase でない環境では 3 ができないので、閲覧も含めて「この環境では使えません」。
import { fail, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { facilities } from '$lib/server/store';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { sendPartnerMail } from './mail';
import { partnerSetupBrand } from './setup-brand';
import { ONE_PERSON_ONE_ID_NOTICE } from '$lib/partner-passkey';
import { PartnerFormError } from './staff-form';
import {
  loadStaffPartnerView,
  partnerAdminClient,
  PartnerStoreError,
  SETUP_TOKEN_TTL_HOURS,
  type PartnerContext,
  type StaffPartnerView
} from './store';

export type StaffPartnerScope = {
  db: SupabaseClient;
  /** core.facilities.id（UUID） */
  facilityId: string;
  tenantId: string;
  facilityName: string;
  /** Book の施設 ID（'f-nishiwaga' 等・ログインIDの接頭辞などに使う） */
  bookFacilityId: string;
  userId: string | null;
  canEdit: boolean;
};

export class StaffScopeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: 'forbidden' | 'not_live' | 'service_unconfigured' | 'facility_missing'
  ) {
    super(message);
  }
}

export const NOT_LIVE_MESSAGE =
  'この環境では使えません（管理画面が実データに繋がっていません）。取引先の管理は本番でお試しください。';

/**
 * 取引先の編集（保存・削除・ログインID/キーの発行・取消と返金・再請求）は管理者だけ。
 * 取引先機能は金額（特別レート）・カード請求・返金・社外向けの資格情報を扱うため、
 * キャンセル規定（/admin/cancel-policies）と同じく管理者に限る。スタッフは閲覧のみ。
 */
export const canEditPartners = (event: Pick<RequestEvent, 'locals'>) => event.locals.user?.role === 'admin';

/** 管理画面共通の ab_fac クッキーから、いま選んでいる施設（Book の ID）を決める。 */
export function currentBookFacility(event: Pick<RequestEvent, 'cookies'>) {
  const facId = event.cookies.get('ab_fac') ?? facilities[0].id;
  return facilities.find((f) => f.id === facId) ?? facilities[0];
}

// 施設へのアクセスの確認結果（1リクエストの中で同じ施設を何度も RPC で確かめない）
const accessCache = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * ログイン中スタッフが施設（core.facilities.id）にアクセスできるか（private.has_facility_access・上の 3）。
 * 権限が無い・施設が無いなら false。ログイン切れ・その他のエラーは StaffScopeError。
 */
export function staffHasFacilityAccess(event: RequestEvent, facilityId: string): Promise<boolean> {
  let cache = accessCache.get(event);
  if (!cache) {
    cache = new Map();
    accessCache.set(event, cache);
  }
  const hit = cache.get(facilityId);
  if (hit) return hit;
  const p = (async () => {
    const userDb = createSupabaseServerClient(event);
    const { error } = await userDb.schema('book').rpc('private_bath_contents_admin', { p_facility: facilityId });
    if (!error) return true;
    const m = error.message ?? '';
    if (m.includes('not_authenticated')) throw new StaffScopeError('ログインし直してください。', 401, 'forbidden');
    if (m.includes('forbidden') || m.includes('facility_not_found')) return false;
    throw new StaffScopeError(`施設の権限を確かめられませんでした（${m}）。`, 503, 'forbidden');
  })();
  cache.set(facilityId, p);
  p.catch(() => cache.delete(facilityId));
  return p;
}

export async function staffPartnerScope(event: RequestEvent, action: 'view' | 'edit'): Promise<StaffPartnerScope> {
  const role = event.locals.user?.role;
  if (role !== 'admin' && role !== 'staff') throw new StaffScopeError('権限がありません。', 403, 'forbidden');
  const canEdit = canEditPartners(event);
  if (action === 'edit' && !canEdit) throw new StaffScopeError('取引先の編集は管理者だけができます。', 403, 'forbidden');
  if (!ADMIN_SUPABASE) throw new StaffScopeError(NOT_LIVE_MESSAGE, 503, 'not_live');

  const fac = currentBookFacility(event);
  const facilityId = FACILITY_UUID[fac.id];
  if (!facilityId) throw new StaffScopeError('この施設は DB の施設に対応していません。', 404, 'facility_missing');

  // ログイン中スタッフの権限（RLS）で、この施設にアクセスできるかを先に確かめる。
  if (!(await staffHasFacilityAccess(event, facilityId))) {
    throw new StaffScopeError('この施設の取引先を扱う権限がありません。', 403, 'forbidden');
  }

  const db = partnerAdminClient();
  if (!db) {
    throw new StaffScopeError(
      '取引先の管理には Cloudflare のシークレット SUPABASE_SERVICE_ROLE_KEY が必要です（未登録のため利用できません）。',
      503,
      'service_unconfigured'
    );
  }
  const { data: facRow } = await db.schema('core').from('facilities').select('tenant_id, name').eq('id', facilityId).maybeSingle();
  if (!facRow?.tenant_id) throw new StaffScopeError('DB上の施設が見つかりません（core.facilities）。', 404, 'facility_missing');

  return {
    db,
    facilityId,
    tenantId: String(facRow.tenant_id),
    facilityName: String(facRow.name ?? fac.name),
    bookFacilityId: fac.id,
    userId: event.locals.user?.id ?? null,
    canEdit
  };
}

// ---- 取引先の施設タブ（複数施設化 S3・docs/partner-multi-facility.md §7.7・§7.12・2026-10-09） ----

/** 施設の指定（Book の施設 ID 'f-oga' か core.facilities の UUID）を Book の施設に解決する。Book の施設でなければ null */
export function resolveBookFacility(raw: string | null | undefined): { bookFacilityId: string; facilityId: string; name: string } | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const fac = facilities.find((f) => f.id === v && FACILITY_UUID[f.id]) ?? facilities.find((f) => FACILITY_UUID[f.id] === v);
  return fac ? { bookFacilityId: fac.id, facilityId: FACILITY_UUID[fac.id], name: fac.name } : null;
}

/**
 * 施設タブの操作の入口: 施設が Book の施設で、スタッフがその施設にアクセスできることを確かめる（§9 の isBookFacility・§7.7）。
 * ab_fac の施設は staffPartnerScope で確認済み。
 */
export async function requireStaffFacility(event: RequestEvent, scope: StaffPartnerScope, raw: string | null | undefined) {
  const fac = resolveBookFacility(raw);
  if (!fac) throw new StaffScopeError('この施設には取引先の設定を作れません。', 400, 'facility_missing');
  if (fac.facilityId !== scope.facilityId && !(await staffHasFacilityAccess(event, fac.facilityId))) {
    throw new StaffScopeError('この施設の取引先を扱う権限がありません。', 403, 'forbidden');
  }
  return fac;
}

/**
 * 管理画面で取引先を開く（施設タブ facilityId で合成）。テナントが同じで、取引先の施設のどれかにスタッフが
 * アクセスできるときだけ（ab_fac を切り替えても一覧へ戻さない・§7.12）。見せられなければ PartnerStoreError 404。
 */
export function staffPartnerView(event: RequestEvent, scope: StaffPartnerScope, partnerId: string, facilityId = scope.facilityId) {
  return loadStaffPartnerView(scope.db, partnerId, {
    tenantId: scope.tenantId,
    facilityId,
    canAccess: (id) => (id === scope.facilityId ? Promise.resolve(true) : staffHasFacilityAccess(event, id))
  });
}

/**
 * 共通設定（名前・支払条件・紐づけ・覚書など）を変えられるのは、取引先のオンの施設すべてにアクセスできる管理者（§7.7）。
 * 山人は管理者が全施設なので実運用では効かないが、仕組みとして確かめる。
 */
export async function requireCommonEditAccess(event: RequestEvent, scope: StaffPartnerScope, view: StaffPartnerView) {
  for (const f of view.bundle.facilities) {
    if (f.synthetic || !f.enabled || f.facility_id === scope.facilityId) continue;
    if (!(await staffHasFacilityAccess(event, f.facility_id))) {
      throw new StaffScopeError(`共通の設定は、取引先のオンの施設すべて（${f.name}を含む）を扱える管理者だけが変えられます。`, 403, 'forbidden');
    }
  }
}

/** アクション用: 例外を fail() に変換する。 */
export function actionFailure(e: unknown) {
  if (e instanceof StaffScopeError || e instanceof PartnerStoreError || e instanceof PartnerFormError) {
    return fail(e.status, { message: e.message });
  }
  return fail(500, { message: e instanceof Error ? e.message : String(e) });
}

/** 取引先専用ページの URL（取引先ページは Book にあるので、Book 自身のオリジンで作る）。 */
export function partnerPortalUrl(origin: string, urlToken: string, path = '') {
  return `${origin}/p/${urlToken}${path}`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** パスワード設定リンクを取引先へメールで送る（メール送信が未設定なら送らずに理由を返す）。 */
export async function sendSetupEmail(
  db: SupabaseClient,
  args: {
    to: string;
    // 差出人は既定の施設・本文はオンの施設を列挙（複数施設化 S5b・§7.11・2026-10-09。setup-brand.ts）
    partner: Pick<PartnerContext, 'name' | 'facility_id' | 'facility_name' | 'facilities' | 'primary_facility_id'>;
    loginId: string;
    setupUrl: string;
    loginUrl: string;
  }
) {
  const days = Math.round(SETUP_TOKEN_TTL_HOURS / 24);
  const brand = partnerSetupBrand(args.partner);
  const text = [
    `${args.partner.name} 様`,
    '',
    `${brand.label} の料金カレンダー（特別レート）のログインIDを発行しました。`,
    '下記のリンクからパスワードを設定してください。',
    '',
    `ログインID: ${args.loginId}`,
    `パスワード設定: ${args.setupUrl}`,
    `（リンクの有効期限: ${days}日）`,
    '',
    `次回以降のログイン: ${args.loginUrl}`,
    '',
    '※このURLは貴社専用です。社外へは共有しないでください。',
    // 「1人1ID」の案内（docs/auth-hardening.md §6.5・S6）
    `※${ONE_PERSON_ONE_ID_NOTICE}`
  ].join('\n');
  const html = `<p>${escapeHtml(args.partner.name)} 様</p>
<p>${escapeHtml(brand.label)} の料金カレンダー（特別レート）のログインIDを発行しました。<br>下記のリンクからパスワードを設定してください。</p>
<p>ログインID: <strong>${escapeHtml(args.loginId)}</strong><br>
パスワード設定: <a href="${escapeHtml(args.setupUrl)}">${escapeHtml(args.setupUrl)}</a><br>
（リンクの有効期限: ${days}日）</p>
<p>次回以降のログイン: <a href="${escapeHtml(args.loginUrl)}">${escapeHtml(args.loginUrl)}</a></p>
<p style="color:#666;font-size:12px">※このURLは貴社専用です。社外へは共有しないでください。<br>※${escapeHtml(ONE_PERSON_ONE_ID_NOTICE)}</p>`;
  return sendPartnerMail(db, brand.facilityId, {
    to: [args.to],
    subject: `【${brand.subjectName}】料金カレンダーのログインID発行のお知らせ`,
    html,
    text
  });
}
