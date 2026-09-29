// 客室内線（ゲスト /r ⇄ 受電アプリ autumn-call）のサーバ側アダプタ。
// 仕様は autumn_book_intercom_contract.md。DB は autumn-shared 20260929120100（book.intercom_*）。
//
//   ゲスト面: stay token は httpOnly Cookie（ab_stay）にしか無いので、start / status はこのサーバで RPC を呼ぶ。
//             以降のシグナル送受・終話は call_id + call_secret（呼ごとの使い捨て）で /r/api/intercom が中継する。
//   管理画面: ログイン中スタッフの権限で RPC（設定・通話ログ）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * 受電端末へ着信の push を送る（autumn-shared Edge Function intercom-invite）。
 * 受電アプリが背面・ロック中でも iPhone を鳴らすため。1 呼 1 回・ringing のときだけ送るのは Function 側で守る。
 * 失敗しても発信は止めない（受電アプリが前面なら Realtime と 15 秒ポーリングで鳴る）。
 */
export async function inviteIntercomDevices(callId: string, callSecret: string): Promise<void> {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const key = publicEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) return;
	try {
		await fetch(`${url}/functions/v1/intercom-invite`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', apikey: key },
			body: JSON.stringify({ call_id: callId, call_secret: callSecret }),
			signal: AbortSignal.timeout(8000)
		});
	} catch {
		/* push は補助。失敗しても呼は鳴っている */
	}
}

export type IntercomStatus = { enabled: boolean; open: boolean; online: boolean; ringTimeoutSec: number };
const OFF: IntercomStatus = { enabled: false, open: false, online: false, ringTimeoutSec: 30 };

/** 客室画面に「フロントを呼ぶ」を出すか。読めなければ出さない（従来の電話ボタンだけ） */
export async function intercomStatusFor(token: string | undefined): Promise<IntercomStatus> {
	if (!token || DATA_SOURCE !== 'supabase') return OFF;
	try {
		const { data, error } = await supa().rpc('intercom_status_for', { p_token: token });
		if (error || !data) return OFF;
		const d = data as Record<string, unknown>;
		return { enabled: d.enabled === true, open: d.open === true, online: d.online === true, ringTimeoutSec: Number(d.ring_timeout_sec ?? 30) || 30 };
	} catch {
		return OFF;
	}
}

/** RPC の例外コード（raise exception 'busy' 等）を取り出す */
export function intercomErrorCode(message: string | undefined): string {
	const known = ['disabled', 'out_of_hours', 'offline', 'busy', 'rate_limited', 'invalid_token', 'forbidden', 'not_found', 'call_closed', 'too_many_signals'];
	return known.find((k) => message?.includes(k)) ?? 'error';
}

export async function guestRpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
	const { data, error } = await supa().rpc(fn, args);
	return { data, error: error ? intercomErrorCode(error.message) : null };
}

// ---------------------------------------------------------------------------
// 管理画面
// ---------------------------------------------------------------------------

export type BusinessHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;
export type AdminIntercom = {
	isEnabled: boolean;
	businessHours: BusinessHours;
	ringTimeoutSec: number;
	rateLimit: number;
	devices: number;
	onlineDevices: number;
	lastSeenAt: string | null;
};
export type IntercomCall = {
	id: string;
	roomCode: string;
	status: string;
	createdAt: string;
	durationSec: number | null;
	deviceLabel: string | null;
};

const uuidOf = (facilityId: string) => FACILITY_UUID[facilityId] ?? facilityId;

export async function sbAdminIntercom(client: SupabaseClient, facilityId: string): Promise<AdminIntercom> {
	const { data, error } = await client.schema('book').rpc('admin_facility_intercom', { p_facility_id: uuidOf(facilityId) });
	if (error) throw new Error('内線の設定を読み込めませんでした（' + error.message + '）');
	const d = (data ?? {}) as Record<string, unknown>;
	return {
		isEnabled: d.is_enabled === true,
		businessHours: (d.business_hours as BusinessHours) ?? {},
		ringTimeoutSec: Number(d.ring_timeout_sec ?? 30),
		rateLimit: Number(d.rate_limit ?? 5),
		devices: Number(d.devices ?? 0),
		onlineDevices: Number(d.online_devices ?? 0),
		lastSeenAt: (d.last_seen_at as string | null) ?? null
	};
}

export async function sbSaveIntercom(
	client: SupabaseClient,
	facilityId: string,
	s: { isEnabled: boolean; businessHours: BusinessHours; ringTimeoutSec: number; rateLimit: number }
): Promise<void> {
	const { error } = await client.schema('book').rpc('facility_intercom_upsert', {
		p_facility_id: uuidOf(facilityId),
		p_is_enabled: s.isEnabled,
		p_business_hours: s.businessHours,
		p_ring_timeout_sec: s.ringTimeoutSec,
		p_rate_limit: s.rateLimit
	});
	if (error) {
		throw new Error(
			error.message.includes('forbidden')
				? '内線の設定は施設の管理者だけが変更できます'
				: error.message.includes('invalid_hours')
					? '受付時間の形式が正しくありません（開始 < 終了）'
					: '内線の設定を保存できませんでした（' + error.message + '）'
		);
	}
}

export async function sbListIntercomCalls(client: SupabaseClient, facilityId: string, days = 7): Promise<IntercomCall[]> {
	const { data, error } = await client.schema('book').rpc('list_intercom_calls', { p_facility_id: uuidOf(facilityId), p_days: days });
	if (error) throw new Error('通話ログを読み込めませんでした（' + error.message + '）');
	return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
		id: String(r.id),
		roomCode: String(r.room_code ?? ''),
		status: String(r.status ?? ''),
		createdAt: String(r.created_at ?? ''),
		durationSec: r.duration_sec == null ? null : Number(r.duration_sec),
		deviceLabel: (r.device_label as string | null) ?? null
	}));
}
