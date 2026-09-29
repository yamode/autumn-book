// 客室内線のゲスト側 API（/r の通話シートから fetch で叩く）。
//   start   … Cookie の stay token で呼を作る → { callId, callSecret, ringTimeoutSec }。受電端末へ push（intercom-invite）
//   send    … シグナル（offer / ice / bye）送信
//   fetch   … 相手のシグナルと呼の状態を after 以降だけ取得（store-and-forward の正）
//   hangup  … 取消（呼出中）／終話（通話中）
//   timeout … 呼出の時間切れ（missed）
//   ice     … ICE サーバ（Cloudflare Realtime TURN の短命クレデンシャル。CF_TURN_KEY_ID / CF_TURN_API_TOKEN 未設定なら STUN のみ）
// stay token はブラウザに出さない。call_secret は呼ごとの使い捨てで、この呼の操作にしか使えない。
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { DATA_SOURCE } from '$lib/server/supabase';
import { guestRpc, inviteIntercomDevices } from '$lib/server/intercom';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f-]{36}$/i;
const STUN_ONLY = [{ urls: 'stun:stun.cloudflare.com:3478' }];

// taskul-one one-turn-credentials と同じ呼び方（キーはサーバにだけ置き、1 時間の使い捨てを返す）
async function turnServers(): Promise<unknown[]> {
	const keyId = env.CF_TURN_KEY_ID;
	const token = env.CF_TURN_API_TOKEN;
	if (!keyId || !token) return STUN_ONLY;
	try {
		const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ttl: 3600 })
		});
		if (!res.ok) return STUN_ONLY;
		const data = (await res.json()) as { iceServers?: unknown[] };
		return data.iceServers?.length ? data.iceServers : STUN_ONLY;
	} catch {
		return STUN_ONLY;
	}
}

export const POST: RequestHandler = async ({ request, cookies, platform }) => {
	if (DATA_SOURCE !== 'supabase') return json({ error: 'disabled' }, { status: 400 });
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid_params' }, { status: 400 });
	}
	const action = String(body.action ?? '');

	if (action === 'start') {
		const token = cookies.get('ab_stay');
		if (!token) return json({ error: 'invalid_token' }, { status: 401 });
		const { data, error } = await guestRpc('intercom_start', { p_token: token });
		if (error) return json({ error }, { status: 400 });
		const d = data as Record<string, unknown>;
		// 受電アプリが背面・ロック中でも鳴るよう push（Edge Function intercom-invite）。ゲストは待たせない
		const invite = inviteIntercomDevices(String(d.call_id), String(d.call_secret));
		if (platform?.context?.waitUntil) platform.context.waitUntil(invite);
		else await invite;
		return json({ callId: d.call_id, callSecret: d.call_secret, ringTimeoutSec: Number(d.ring_timeout_sec ?? 30) });
	}

	const callId = String(body.callId ?? '');
	const secret = String(body.callSecret ?? '');
	if (!UUID.test(callId) || !/^[0-9a-f]{64}$/.test(secret)) return json({ error: 'invalid_params' }, { status: 400 });

	let res: { data: unknown; error: string | null };
	switch (action) {
		case 'send': {
			const kind = String(body.kind ?? '');
			if (!['offer', 'ice', 'bye'].includes(kind)) return json({ error: 'invalid_params' }, { status: 400 });
			res = await guestRpc('intercom_signal_send', {
				p_call_id: callId,
				p_secret: secret,
				p_kind: kind,
				p_payload: body.payload ?? {}
			});
			break;
		}
		case 'fetch':
			res = await guestRpc('intercom_signal_fetch', {
				p_call_id: callId,
				p_secret: secret,
				p_after_id: Number(body.after ?? 0) || 0
			});
			break;
		case 'hangup':
			res = await guestRpc('intercom_hangup', { p_call_id: callId, p_secret: secret });
			break;
		case 'ice': {
			// 呼の当事者だけに発行する（call_secret を fetch で検証してから）
			const check = await guestRpc('intercom_signal_fetch', { p_call_id: callId, p_secret: secret, p_after_id: 9e15 });
			if (check.error) return json({ error: check.error }, { status: 400 });
			const st = (check.data as { status?: string } | null)?.status;
			if (st !== 'ringing' && st !== 'active') return json({ error: 'call_closed' }, { status: 400 });
			return json({ iceServers: await turnServers() });
		}
		case 'timeout':
			res = await guestRpc('intercom_timeout', { p_call_id: callId, p_secret: secret });
			break;
		default:
			return json({ error: 'invalid_params' }, { status: 400 });
	}
	if (res.error) return json({ error: res.error }, { status: 400 });
	return json(res.data ?? {});
};
