// 管理画面「Autumn Live の端末」（/admin/security/live）のサーバ処理。設計: docs/autumn-live.md §4.3・§4.6
//
// - 登録済みの端末の一覧（種類・登録した人・最後に見えた時刻・止めた理由）
// - 表示専用の端末の登録コード（8 桁・15 分・1 回限り）を出す。DB にはハッシュだけを置く
// - 端末を止める（盗難・廃棄のとき）。止めると、その端末は次の入場券の更新（最長 1 時間後）から入れない
//
// 端末の表 book.live_devices / live_device_codes は service_role だけに grant している（admin-client.ts の例外その16）。
// 呼ぶ側（routes/admin/security/live）は、ログイン中の役割が admin であることを確かめてから使う。操作は監査ログに残す。
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { hashLiveCode } from '$lib/live-pass';

export class LiveDeviceError extends Error {
	constructor(message: string, public status = 500) {
		super(message);
	}
}

export type LiveDeviceView = {
	id: string;
	kind: 'staff' | 'display';
	label: string;
	registeredBy: string | null;
	lastUser: string | null;
	createdAt: string;
	lastSeenAt: string | null;
	revokedAt: string | null;
	revokedReason: 'manual' | 'idle' | 'replaced' | null;
};

type Row = {
	id: string;
	kind: 'staff' | 'display';
	label: string | null;
	registered_by: string | null;
	last_user_id: string | null;
	created_at: string;
	last_seen_at: string | null;
	revoked_at: string | null;
	revoked_reason: 'manual' | 'idle' | 'replaced' | null;
};

/** 監査ログのテナント（admin-passkeys.ts と同じ） */
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const book = (svc: SupabaseClient) => svc.schema('book');

function db(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new LiveDeviceError('サーバの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、使えません。', 503);
	return svc;
}

async function audit(svc: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>) {
	const { error } = await book(svc).from('admin_audit_logs').insert({ tenant_id: TENANT_ID, actor: actorId, action, detail });
	if (error) console.error('[live-devices] 監査ログを書けませんでした:', error.message);
}

/** 人の id → メール（一覧の表示用）。読めなければ id の先頭だけ */
async function emailsOf(svc: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	await Promise.all(
		[...new Set(ids)].map(async (id) => {
			const { data } = await svc.auth.admin.getUserById(id).catch(() => ({ data: null }));
			out.set(id, data?.user?.email ?? `${id.slice(0, 8)}…`);
		})
	);
	return out;
}

/** 一覧。使っている端末を先に、止めた端末は直近 90 日のものだけ */
export async function listLiveDevices(): Promise<LiveDeviceView[]> {
	const svc = db();
	const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
	const { data, error } = await book(svc)
		.from('live_devices')
		.select('id, kind, label, registered_by, last_user_id, created_at, last_seen_at, revoked_at, revoked_reason')
		.or(`revoked_at.is.null,revoked_at.gte.${since}`)
		.order('revoked_at', { ascending: false, nullsFirst: true })
		.order('last_seen_at', { ascending: false, nullsFirst: false })
		.limit(300);
	if (error) throw new LiveDeviceError('端末の一覧を読めませんでした。');
	const rows = (data ?? []) as Row[];
	const emails = await emailsOf(svc, rows.flatMap((r) => [r.registered_by, r.last_user_id]).filter((v): v is string => !!v));
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind,
		label: r.label || (r.kind === 'display' ? '表示専用の端末' : '業務 PC'),
		registeredBy: r.registered_by ? emails.get(r.registered_by) ?? null : null,
		lastUser: r.last_user_id ? emails.get(r.last_user_id) ?? null : null,
		createdAt: r.created_at,
		lastSeenAt: r.last_seen_at,
		revokedAt: r.revoked_at,
		revokedReason: r.revoked_reason
	}));
}

/** 8 桁の登録コード（先頭 0 も含む・偏りなし） */
export function newLiveCode(): string {
	const buf = new Uint32Array(1);
	let n: number;
	do {
		crypto.getRandomValues(buf);
		n = buf[0];
	} while (n >= 4_200_000_000); // 100,000,000 の倍数未満だけを使う
	return String(n % 100_000_000).padStart(8, '0');
}

/** 表示専用の端末の登録コードを出す。返すコードはこの 1 回だけ画面に出す */
export async function issueLiveCode(input: { actorId: string; label: string }): Promise<{ code: string; expiresAt: string; label: string }> {
	const svc = db();
	const label = input.label.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
	const code = newLiveCode();
	const { data, error } = await book(svc).rpc('live_device_issue_code', { p_actor: input.actorId, p_code_hash: await hashLiveCode(code), p_label: label });
	if (error) throw new LiveDeviceError('登録コードを出せませんでした。もう一度お試しください。');
	await audit(svc, input.actorId, 'live_device_code_issued', { label });
	return { code, expiresAt: String(data), label };
}

/** 端末を止める。すでに止まっていれば何もしない */
export async function revokeLiveDevice(input: { actorId: string; deviceId: string }): Promise<{ label: string } | null> {
	if (!/^[0-9a-f-]{36}$/.test(input.deviceId)) throw new LiveDeviceError('端末を選んでください。', 400);
	const svc = db();
	const { data, error } = await book(svc)
		.from('live_devices')
		.update({ revoked_at: new Date().toISOString(), revoked_by: input.actorId, revoked_reason: 'manual' })
		.eq('id', input.deviceId)
		.is('revoked_at', null)
		.select('id, kind, label')
		.maybeSingle<{ id: string; kind: string; label: string | null }>();
	if (error) throw new LiveDeviceError('端末を止められませんでした。');
	if (!data) return null;
	await audit(svc, input.actorId, 'live_device_revoked', { device_id: data.id, kind: data.kind, label: data.label });
	return { label: data.label || '端末' };
}
