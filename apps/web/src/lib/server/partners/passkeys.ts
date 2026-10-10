// 取引先ページのパスキー（WebAuthn・docs/auth-hardening.md §6.5・S6）。@simplewebauthn/server の薄い包み。
//
// - 使えるのは本番ドメイン（PASSKEY_RP_ID＝book.yamado.app）とローカル（localhost）だけ。*.pages.dev のプレビューでは無効
//   （passkeyRp が null を返す。画面にもボタンを出さない）
// - チャレンジは rms_partner_mfa_challenges（短命・1 回限り）に置く:
//     登録      kind='passkey_reg'  account_id=本人   有効 5 分
//     本人確認  kind='passkey_auth' account_id=本人   有効 5 分
//     ログイン  kind='passkey_auth' account_id=null・partner_id=限定URLの取引先  有効 10 分（まだ誰のパスキーか分からないため）
//   使うときは「未使用・期限内」の行に used_at を立てられたときだけ使う（同時に 2 回投げられても 1 回しか通らない）。
//   検証に失敗しても使い切り（同じチャレンジで再挑戦させない）。
// - ログイン（セッション無し）のチャレンジは partner_id で持つ（autumn-shared 20261009215711・account_id は null 可、
//   check で「account_id か、partner_id＋kind='passkey_auth'」のどちらか必須）。検証では
//   「チャレンジの partner_id が限定URLの取引先」かつ「パスキーの持ち主がこの取引先の有効なアカウント」を両方確かめる。
//   本人の登録・本人確認のチャレンジは account_id で持ち、partner_id は null（ログイン用と取り違えない）。
// - counter: ライブラリが「保存値以下なら拒否」を確かめ、保存は「読んだ値のままのとき」だけ進める（同時の再利用で戻さない）。
// - userVerification は 'preferred'。パスワード無しで入るログインだけは UV（生体認証・PIN）を必須にする。
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { isCredentialId, loginChallengeMatches, passkeyDeviceName, passkeyRelyingParty, passkeyRemoval, type PasskeyRp } from '$lib/partner-passkey';
import { maskEmail, mfaMethodsFor, normalizeMfaPolicy, type MfaMethod } from '$lib/partner-mfa';
import { formatJst, summarizeUserAgent } from '$lib/partner-login-security';
import { sendPartnerMail } from './mail';
import { partnerSetupBrand } from './setup-brand';
import { findLoginNoticeRecipient, logPartnerAccess, PartnerStoreError, type PartnerContext, type PartnerSessionAccount } from './store';
import { emailOtpStatus, loadMfaAccount, markSessionAal2, type MfaPartner } from './mfa';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const REG_TTL_MINUTES = 5;
const AUTH_TTL_MINUTES = 5;
const LOGIN_TTL_MINUTES = 10;
// ES256・RS256・EdDSA（登録と検証で同じものを渡す）
const SUPPORTED_ALGS = [-7, -257, -8];
const UUID = /^[0-9a-f-]{36}$/i;

/** このリクエストのホストで使う RP（使えなければ null）。本番は PASSKEY_RP_ID（wrangler.jsonc の vars） */
export function passkeyRp(event: Pick<RequestEvent, 'url'>): PasskeyRp | null {
  return passkeyRelyingParty(event.url, env.PASSKEY_RP_ID);
}

export type PasskeyRow = {
  id: string;
  account_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[] | null;
  aaguid: string | null;
  backed_up: boolean;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
};
const PASSKEY_COLUMNS = 'id, account_id, credential_id, public_key, counter, transports, aaguid, backed_up, device_name, created_at, last_used_at';

/** 自分のパスキー（新しい順） */
export async function listPasskeys(db: SupabaseClient, accountId: string): Promise<PasskeyRow[]> {
  const { data, error } = await db.from('rms_partner_passkeys').select(PASSKEY_COLUMNS).eq('account_id', accountId).order('created_at', { ascending: false });
  if (error) throw new PartnerStoreError('パスキーを読み込めませんでした。', 500);
  return ((data ?? []) as PasskeyRow[]).map((r) => ({ ...r, counter: Number(r.counter ?? 0) }));
}

export async function countPasskeys(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from('rms_partner_passkeys').select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// チャレンジ（rms_partner_mfa_challenges）
// ---------------------------------------------------------------------------

/** チャレンジの持ち主: 本人（登録・本人確認）か、限定URLの取引先（ログイン・passkey_auth だけ） */
type ChallengeOwner = { accountId: string } | { partnerId: string };

async function saveChallenge(
  db: SupabaseClient,
  args: { owner: ChallengeOwner; kind: 'passkey_reg' | 'passkey_auth'; challenge: string; ttlMinutes: number; ip: string | null }
): Promise<string> {
  // 1 日より古いチャレンジの掃除（ついでに・失敗は無視）
  await db
    .from('rms_partner_mfa_challenges')
    .delete()
    .lt('created_at', new Date(Date.now() - 86400_000).toISOString())
    .then(
      () => undefined,
      () => undefined
    );
  const id = crypto.randomUUID();
  const { error } = await db.from('rms_partner_mfa_challenges').insert({
    id,
    account_id: 'accountId' in args.owner ? args.owner.accountId : null,
    partner_id: 'partnerId' in args.owner ? args.owner.partnerId : null,
    kind: args.kind,
    challenge: args.challenge,
    expires_at: new Date(Date.now() + args.ttlMinutes * 60_000).toISOString(),
    ip: args.ip
  });
  if (error) throw new PartnerStoreError('パスキーの準備ができませんでした。時間をおいてお試しください。', 500);
  return id;
}

/** チャレンジを使う（未使用・期限内のものに used_at を立てられたときだけ返す＝1 回限り） */
async function takeChallenge(
  db: SupabaseClient,
  args: { id: unknown; kind: 'passkey_reg' | 'passkey_auth'; owner: ChallengeOwner }
): Promise<{ challenge: string; account_id: string | null; partner_id: string | null } | null> {
  const id = String(args.id ?? '');
  if (!UUID.test(id)) return null;
  let q = db
    .from('rms_partner_mfa_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', id)
    .eq('kind', args.kind)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString());
  // 持ち主で絞る（本人用は partner_id が null、ログイン用は account_id が null のものだけ＝互いに使い回せない）
  q = 'accountId' in args.owner ? q.eq('account_id', args.owner.accountId).is('partner_id', null) : q.eq('partner_id', args.owner.partnerId).is('account_id', null);
  const { data, error } = await q.select('challenge, account_id, partner_id');
  if (error) return null;
  const row = (data ?? [])[0] as { challenge: string | null; account_id: string | null; partner_id: string | null } | undefined;
  return row?.challenge ? { challenge: row.challenge, account_id: row.account_id, partner_id: row.partner_id } : null;
}

// ---------------------------------------------------------------------------
// 登録（アカウント → セキュリティ「パスキーを追加」・aal2 が必要。passkey_only の初回だけは設定リンク直後でよい）
// ---------------------------------------------------------------------------

export async function passkeyRegistrationOptions(
  db: SupabaseClient,
  args: { partner: MfaPartner; accountId: string; rp: PasskeyRp; ip: string | null }
) {
  const account = await loadMfaAccount(db, args.partner.id, args.accountId);
  if (!account) throw new PartnerStoreError('アカウントを確認できませんでした。', 403);
  const existing = await listPasskeys(db, account.id);
  if (existing.length >= 20) throw new PartnerStoreError('パスキーは 20 個まで登録できます。使っていないものを削除してください。', 409);
  const brand = partnerSetupBrand(args.partner);
  const options = await generateRegistrationOptions({
    rpName: brand.label,
    rpID: args.rp.rpID,
    userName: account.login_id,
    // パスキーの候補に出る名前（同じ端末に複数の取引先の ID があっても見分けられるように取引先名を添える）
    userDisplayName: `${account.display_name || account.login_id}（${args.partner.name}）`,
    userID: new TextEncoder().encode(account.id),
    timeout: REG_TTL_MINUTES * 60_000,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports ?? undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    supportedAlgorithmIDs: SUPPORTED_ALGS
  });
  const challengeId = await saveChallenge(db, { owner: { accountId: account.id }, kind: 'passkey_reg', challenge: options.challenge, ttlMinutes: REG_TTL_MINUTES, ip: args.ip });
  return { challengeId, options };
}

/** 登録の応答を確かめて保存する。保存したら登録完了のメール（本人・無ければマスタ）とログ passkey_registered */
export async function verifyPasskeyRegistration(
  db: SupabaseClient,
  args: {
    partner: MfaPartner;
    accountId: string;
    challengeId: unknown;
    response: unknown;
    deviceName: unknown;
    userAgent: string | null;
    rp: PasskeyRp;
    ip: string | null;
  }
): Promise<{ ok: true; passkey: { id: string; name: string } } | { ok: false; message: string }> {
  const account = await loadMfaAccount(db, args.partner.id, args.accountId);
  if (!account) return { ok: false, message: 'アカウントを確認できませんでした。もう一度ログインしてください。' };
  const taken = await takeChallenge(db, { id: args.challengeId, kind: 'passkey_reg', owner: { accountId: account.id } });
  if (!taken) return { ok: false, message: '登録の有効期限が切れました。もう一度「パスキーを追加」からお試しください。' };
  const response = args.response as RegistrationResponseJSON;
  if (!response || typeof response !== 'object' || !isCredentialId(response.id)) return { ok: false, message: 'パスキーを登録できませんでした。' };
  let info;
  try {
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: taken.challenge,
      expectedOrigin: args.rp.origin,
      expectedRPID: args.rp.rpID,
      // userVerification は preferred（PIN の無いセキュリティキーも登録できる）。ログインに使うときは UV を求める
      requireUserVerification: false,
      supportedAlgorithmIDs: SUPPORTED_ALGS
    });
    if (!v.verified) return { ok: false, message: 'パスキーを登録できませんでした。' };
    info = v.registrationInfo;
  } catch {
    return { ok: false, message: 'パスキーを登録できませんでした。' };
  }
  const name = passkeyDeviceName(args.deviceName, summarizeUserAgent(args.userAgent));
  const { data, error } = await db
    .from('rms_partner_passkeys')
    .insert({
      account_id: account.id,
      credential_id: info.credential.id,
      public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: info.credential.transports ?? null,
      aaguid: info.aaguid,
      backed_up: info.credentialBackedUp,
      device_name: name
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { ok: false, message: 'このパスキーは既に登録されています。' };
    throw new PartnerStoreError('パスキーを保存できませんでした。', 500);
  }
  const passkeyId = String((data as { id: string }).id);
  await logPartnerAccess(db, {
    partnerId: args.partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'passkey_registered',
    detail: { passkeyId, name, backedUp: info.credentialBackedUp },
    ip: args.ip
  });
  await sendPasskeyRegisteredEmail(db, { partner: args.partner, account, name, ip: args.ip, userAgent: args.userAgent }).catch(() => undefined);
  return { ok: true, passkey: { id: passkeyId, name } };
}

/** 登録完了のお知らせ（勝手に登録されたときに気づけるように・§6.5）。宛先は本人のメール、無ければマスタ（ログイン通知と同じ・M9） */
export async function sendPasskeyRegisteredEmail(
  db: SupabaseClient,
  args: {
    partner: MfaPartner;
    account: { id: string; login_id: string; display_name: string | null; email: string | null };
    name: string;
    ip: string | null;
    userAgent: string | null;
  }
) {
  const recipient = await findLoginNoticeRecipient(db, args.partner.id, { id: args.account.id, email: args.account.email }).catch(() => null);
  if (!recipient) return;
  const brand = partnerSetupBrand(args.partner);
  const who =
    recipient.to === 'self'
      ? `${args.partner.name} ${args.account.display_name ? `${args.account.display_name} 様` : '様'}`
      : `${args.partner.name} マスタユーザー 様`;
  const lines = [
    `${brand.label} の取引先専用ページで、ログインID ${args.account.login_id} にパスキーが登録されました。`,
    `日時: ${formatJst(new Date())}（日本時間）`,
    `パスキーの名前: ${args.name}`,
    `接続元: ${args.ip ?? '不明'}`,
    `ブラウザ: ${summarizeUserAgent(args.userAgent)}`
  ];
  const caution = [
    'お心当たりがない場合は、パスワードが第三者に知られている可能性があります。すぐに貴社のマスタユーザー（または宿）へご連絡ください。宿が第2要素のリセット（パスキーの削除）とログアウトを行います。',
    '※宿がメールや電話でパスワードや認証コードをお尋ねすることはありません。'
  ];
  await sendPartnerMail(db, brand.facilityId, {
    to: [recipient.email],
    subject: `【${brand.subjectName}】取引先専用ページにパスキーが登録されました`,
    text: [who, '', ...lines, '', ...caution].join('\n'),
    html: `<p>${escapeHtml(who)}</p><p>${lines.map(escapeHtml).join('<br>')}</p><p style="color:#666;font-size:12px">${caution.map(escapeHtml).join('<br>')}</p>`
  });
}

// ---------------------------------------------------------------------------
// 認証（ステップアップ /mfa・ログイン画面）
// ---------------------------------------------------------------------------

/** ステップアップ: このアカウントのパスキーで確認するための options */
export async function passkeyStepUpOptions(db: SupabaseClient, args: { accountId: string; rp: PasskeyRp; ip: string | null }) {
  const list = await listPasskeys(db, args.accountId);
  if (!list.length) throw new PartnerStoreError('パスキーが登録されていません。', 400);
  const options = await generateAuthenticationOptions({
    rpID: args.rp.rpID,
    allowCredentials: list.map((p) => ({ id: p.credential_id, transports: p.transports ?? undefined })),
    userVerification: 'preferred',
    timeout: AUTH_TTL_MINUTES * 60_000
  });
  const challengeId = await saveChallenge(db, { owner: { accountId: args.accountId }, kind: 'passkey_auth', challenge: options.challenge, ttlMinutes: AUTH_TTL_MINUTES, ip: args.ip });
  return { challengeId, options };
}

/** 署名を確かめ、counter を進める（読んだ値のままのときだけ）。通れば null、通らなければ理由（ログの detail.reason に残す） */
async function checkAssertion(
  db: SupabaseClient,
  args: { passkey: PasskeyRow; response: AuthenticationResponseJSON; challenge: string; rp: PasskeyRp; requireUserVerification: boolean }
): Promise<string | null> {
  try {
    const v = await verifyAuthenticationResponse({
      response: args.response,
      expectedChallenge: args.challenge,
      expectedOrigin: args.rp.origin,
      expectedRPID: args.rp.rpID,
      credential: {
        id: args.passkey.credential_id,
        publicKey: isoBase64URL.toBuffer(args.passkey.public_key),
        counter: args.passkey.counter,
        transports: args.passkey.transports ?? undefined
      },
      requireUserVerification: args.requireUserVerification
    });
    if (!v.verified) return 'verify_failed:not_verified';
    const { data } = await db
      .from('rms_partner_passkeys')
      .update({ counter: v.authenticationInfo.newCounter, backed_up: v.authenticationInfo.credentialBackedUp, last_used_at: new Date().toISOString() })
      .eq('id', args.passkey.id)
      .eq('counter', args.passkey.counter)
      .select('id');
    // 同時に同じ counter で更新された（＝応答の使い回し）なら通さない
    return (data ?? []).length > 0 ? null : 'verify_failed:counter_conflict';
  } catch (e) {
    // ライブラリの検証エラー（オリジン・RP ID・UV・署名など）。原因を追えるよう理由に残す
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[passkey] 検証に失敗:', msg);
    return `verify_failed:${msg.slice(0, 160)}`;
  }
}

async function findPasskeyByCredential(db: SupabaseClient, credentialId: string): Promise<(PasskeyRow & { partner_id: string; is_active: boolean }) | null> {
  const { data, error } = await db
    .from('rms_partner_passkeys')
    .select(`${PASSKEY_COLUMNS}, account:rms_partner_accounts!inner(partner_id, is_active)`)
    .eq('credential_id', credentialId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as PasskeyRow & { account: { partner_id: string; is_active: boolean } };
  return { ...row, counter: Number(row.counter ?? 0), partner_id: row.account.partner_id, is_active: row.account.is_active };
}

/** ステップアップ: パスキーの応答を確かめて、このセッションを aal2（mfa_method='passkey'）にする */
export async function verifyPasskeyStepUp(
  db: SupabaseClient,
  args: { partner: MfaPartner; accountId: string; sessionId: string; challengeId: unknown; response: unknown; rp: PasskeyRp; ip: string | null }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const fail = async (reason: string) => {
    await logPartnerAccess(db, { partnerId: args.partner.id, accountId: args.accountId, channel: 'web', action: 'passkey_failed', detail: { reason }, ip: args.ip });
    return { ok: false as const, message: 'パスキーで確認できませんでした。もう一度お試しください。' };
  };
  const taken = await takeChallenge(db, { id: args.challengeId, kind: 'passkey_auth', owner: { accountId: args.accountId } });
  if (!taken) return { ok: false, message: '確認の有効期限が切れました。もう一度お試しください。' };
  const response = args.response as AuthenticationResponseJSON;
  if (!response || typeof response !== 'object' || !isCredentialId(response.id)) return fail('bad_response');
  const passkey = await findPasskeyByCredential(db, response.id);
  // 自分のパスキーだけ（別のアカウントのパスキーでは通さない）
  if (!passkey || passkey.account_id !== args.accountId || passkey.partner_id !== args.partner.id) return fail('unknown_credential');
  const assertionError = await checkAssertion(db, { passkey, response, challenge: taken.challenge, rp: args.rp, requireUserVerification: false });
  if (assertionError) return fail(assertionError);
  await markSessionAal2(db, { accountId: args.accountId, sessionId: args.sessionId, method: 'passkey' });
  await logPartnerAccess(db, { partnerId: args.partner.id, accountId: args.accountId, channel: 'web', action: 'mfa_ok', detail: { method: 'passkey', passkeyId: passkey.id }, ip: args.ip });
  return { ok: true };
}

/** ログイン画面: 誰のパスキーでもよい options（allowCredentials 無し＝端末に保存されたパスキーから選ぶ・Conditional UI 兼用） */
export async function passkeyLoginOptions(db: SupabaseClient, args: { partnerId: string; rp: PasskeyRp; ip: string | null }) {
  const options = await generateAuthenticationOptions({ rpID: args.rp.rpID, userVerification: 'preferred', timeout: LOGIN_TTL_MINUTES * 60_000 });
  const challengeId = await saveChallenge(db, {
    owner: { partnerId: args.partnerId },
    kind: 'passkey_auth',
    challenge: options.challenge,
    ttlMinutes: LOGIN_TTL_MINUTES,
    ip: args.ip
  });
  return { challengeId, options };
}

/**
 * ログイン画面: パスキーの応答を確かめ、ログインしてよいアカウントの id を返す（だめなら null・理由はログ用）。
 * credential_id → パスキー → アカウント → partner_id が限定URLの取引先と一致すること、アカウントが有効なことを必ず確かめる。
 * セッションを作るのは呼ぶ側（store.ts の loginPartnerWithPasskey）。
 */
export async function verifyPasskeyLogin(
  db: SupabaseClient,
  args: { partnerId: string; challengeId: unknown; response: unknown; rp: PasskeyRp }
): Promise<{ ok: true; accountId: string; passkeyId: string } | { ok: false; reason: string; accountId?: string }> {
  // この取引先（限定URL）で発行したログイン用のチャレンジだけを使う（別の取引先のものは使い切りにもしない）
  const taken = await takeChallenge(db, { id: args.challengeId, kind: 'passkey_auth', owner: { partnerId: args.partnerId } });
  if (!taken) return { ok: false, reason: 'challenge_expired' };
  if (!loginChallengeMatches(taken, args.partnerId)) return { ok: false, reason: 'challenge_partner' };
  const response = args.response as AuthenticationResponseJSON;
  if (!response || typeof response !== 'object' || !isCredentialId(response.id)) return { ok: false, reason: 'bad_response' };
  const passkey = await findPasskeyByCredential(db, response.id);
  // 別の取引先のパスキー・停止中のアカウントは「見つからない」扱い
  if (!passkey || passkey.partner_id !== args.partnerId || !passkey.is_active) return { ok: false, reason: 'unknown_credential' };
  const assertionError = await checkAssertion(db, { passkey, response, challenge: taken.challenge, rp: args.rp, requireUserVerification: true });
  if (assertionError) return { ok: false, reason: assertionError, accountId: passkey.account_id };
  return { ok: true, accountId: passkey.account_id, passkeyId: passkey.id };
}

// ---------------------------------------------------------------------------
// 管理（名前の変更・削除）
// ---------------------------------------------------------------------------

export async function renamePasskey(db: SupabaseClient, args: { partnerId: string; accountId: string; passkeyId: string; name: unknown; ip: string | null }) {
  if (!UUID.test(args.passkeyId)) throw new PartnerStoreError('パスキーが見つかりません。', 404);
  const name = passkeyDeviceName(args.name, '');
  if (!name || name === 'パスキー') throw new PartnerStoreError('名前を入力してください。');
  const { data, error } = await db
    .from('rms_partner_passkeys')
    .update({ device_name: name })
    .eq('id', args.passkeyId)
    .eq('account_id', args.accountId)
    .select('id');
  if (error) throw new PartnerStoreError('名前を変更できませんでした。', 500);
  if (!(data ?? []).length) throw new PartnerStoreError('パスキーが見つかりません。', 404);
  await logPartnerAccess(db, { partnerId: args.partnerId, accountId: args.accountId, channel: 'web', action: 'passkey_renamed', detail: { passkeyId: args.passkeyId, name }, ip: args.ip });
  return name;
}

/** 自分のパスキーを消す。passkey_only で最後の 1 つは消せない（passkeyRemoval） */
export async function removePasskey(
  db: SupabaseClient,
  args: { partner: Pick<PartnerContext, 'id' | 'mfa_policy'>; accountId: string; passkeyId: string; ip: string | null }
) {
  if (!UUID.test(args.passkeyId)) throw new PartnerStoreError('パスキーが見つかりません。', 404);
  const list = await listPasskeys(db, args.accountId);
  const target = list.find((p) => p.id === args.passkeyId);
  if (!target) throw new PartnerStoreError('パスキーが見つかりません。', 404);
  const rule = passkeyRemoval(normalizeMfaPolicy(args.partner.mfa_policy), list.length - 1);
  if (!rule.ok) throw new PartnerStoreError(rule.message ?? '削除できません。', 409);
  const { data, error } = await db.from('rms_partner_passkeys').delete().eq('id', target.id).eq('account_id', args.accountId).select('id');
  if (error) throw new PartnerStoreError('パスキーを削除できませんでした。', 500);
  if (!(data ?? []).length) throw new PartnerStoreError('パスキーが見つかりません。', 404);
  await logPartnerAccess(db, {
    partnerId: args.partner.id,
    accountId: args.accountId,
    channel: 'web',
    action: 'passkey_removed',
    detail: { passkeyId: target.id, name: target.device_name, remaining: list.length - 1 },
    ip: args.ip
  });
  return { name: target.device_name, remaining: list.length - 1 };
}

// ---------------------------------------------------------------------------
// 本人確認の画面（/mfa・予約画面・予約一覧のモーダル）に渡す状態
// ---------------------------------------------------------------------------

export type StepUpState = { maskedEmail: string; methods: MfaMethod[]; waitSec: number; open: boolean; passkeyCount: number };

/** 本人確認の方法と、メールの再送の待ち（パスキーは、このホストで使えるときだけ方法に入れる） */
export async function stepUpState(
  db: SupabaseClient,
  event: Pick<RequestEvent, 'url'>,
  partner: Pick<PartnerContext, 'id' | 'mfa_policy'>,
  session: Pick<PartnerSessionAccount, 'id'>
): Promise<StepUpState> {
  const policy = normalizeMfaPolicy(partner.mfa_policy);
  const rp = passkeyRp(event);
  const [account, passkeyCount] = await Promise.all([
    loadMfaAccount(db, partner.id, session.id).catch(() => null),
    rp ? countPasskeys(db, session.id) : Promise.resolve(0)
  ]);
  const methods = mfaMethodsFor(policy, { email: account?.email ?? null }, passkeyCount);
  const status = methods.includes('email') ? await emailOtpStatus(db, session.id).catch(() => null) : null;
  return { maskedEmail: maskEmail(account?.email), methods, waitSec: status?.waitSec ?? 0, open: status?.open ?? false, passkeyCount };
}
