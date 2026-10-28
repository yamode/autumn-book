// 事前チェックイン P4（docs/pre-checkin.md §3・§9・§16・§18）の純関数。DB にも環境変数にも触らない（単体テスト用）。
//   - 宛先の判定（携帯番号 → SMS の国際形式）
//   - SMS 本文（短文・1〜2 通に収める）
//   - NTT CPaaS の送信リクエストの組み立てと応答の読み取り（POST /sms/3/messages）
//   - DLR（到達結果）・受信（返信）Webhook の中身の正規化と、Webhook の Basic 認証
//   - 自動送信（cron）の対象の振り分け
//
// NTT CPaaS の仕様（OpenAPI 仕様・docs.nttcpaas.com で確認 2026-10-29）:
//   送信 v3: { messages: [{ sender, destinations: [{ to }], content: { text },
//              options: { validityPeriod: { amount, timeUnit } }, webhooks: { delivery: { url }, contentType, callbackData } }] }
//   応答: { bulkId, messages: [{ messageId, status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED', … }, destination }] }
//   エラー: { requestError: { serviceException: { messageId, text } } }
//   DLR: { results: [{ messageId, to, status: { groupName, name, description }, error: { name, description, permanent }, doneAt, callbackData }] }
//   受信: { results: [{ messageId, from, to, message（または text / cleanText）, receivedAt, pairedMessageId }] }
//   Webhook の認証（サブスクリプションのセキュリティ設定）: BASIC（username / password）・HMAC・OAUTH。ここでは BASIC を使う。
import { timingSafeEqualText } from '$lib/partner-mfa';

// ---------------------------------------------------------------- 宛先

/** 全角の数字・＋を半角に */
function toHalfWidth(s: string): string {
	return s.replace(/[０-９＋]/g, (c) => (c === '＋' ? '+' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

/**
 * 国内の携帯番号（070 / 080 / 090・+81 表記・ハイフン・空白・全角も可）なら SMS の宛先（国際形式・+ なし、例 819012345678）。
 * 固定電話・海外の番号・空は null（DB の book._pc_sms_to と同じ規則）。
 */
export function smsTarget(phone: string | null | undefined): string | null {
	let d = toHalfWidth(String(phone ?? '')).replace(/[^\d+]/g, '');
	if (d.startsWith('+81')) d = '0' + d.slice(3);
	else if (d.startsWith('+')) return null;
	else if (d.startsWith('81') && d.length === 12) d = '0' + d.slice(2);
	if (!/^0[789]0\d{8}$/.test(d)) return null;
	return '81' + d.slice(1);
}

export type ContactRoute = 'sms' | 'email' | 'none';

/** 送り方: 携帯番号なら SMS、それ以外でメールがあればメール、どちらも無ければ連絡先なし */
export function contactRoute(phone: string | null | undefined, email: string | null | undefined): ContactRoute {
	if (smsTarget(phone)) return 'sms';
	if (String(email ?? '').trim()) return 'email';
	return 'none';
}

// ---------------------------------------------------------------- 本文

/** 2 通（連結 SMS・UCS-2 は 1 通 67 字）に収まる上限 */
export const SMS_MAX_CHARS = 134;

/** SMS の通数の目安（日本語を含む = UCS-2: 70 字 / 連結は 67 字ごと。英数字だけ = GSM: 160 / 153） */
export function smsSegments(text: string): number {
	const ucs2 = /[^\x00-\x7f]/.test(text);
	const single = ucs2 ? 70 : 160;
	const multi = ucs2 ? 67 : 153;
	const n = [...text].length;
	if (n <= single) return 1;
	return Math.ceil(n / multi);
}

export type PrecheckinSmsInput = {
	facilityName: string;
	/** フォームのリンク（https://<公開ホスト>/ci/<token>） */
	url: string;
	/** 施設の電話（送信元番号には折り返しできないため、本文に入れる） */
	phone: string | null;
};

/**
 * 事前チェックインの SMS 本文（日本語のみ）。2 通（134 字）に収まらなければ案内文を短くする。
 *   【山人-yamado-】事前チェックインはこちら（夕食・朝食の時間などをご入力ください）
 *   https://book.yamado.app/ci/<token>
 *   お問合せ 0197-82-2222
 */
export function buildPrecheckinSms(i: PrecheckinSmsInput): string {
	const head = `【${i.facilityName.trim()}】`;
	const tel = i.phone ? `\nお問合せ ${i.phone.trim()}` : '';
	const full = `${head}事前チェックインはこちら（夕食・朝食の時間などをご入力ください）\n${i.url}${tel}`;
	if ([...full].length <= SMS_MAX_CHARS) return full;
	const short = `${head}事前チェックイン（食事の時間のご入力）\n${i.url}${tel}`;
	if ([...short].length <= SMS_MAX_CHARS) return short;
	return `事前チェックイン\n${i.url}${tel}`;
}

// ---------------------------------------------------------------- 送信（NTT CPaaS）

export type NttConfig = { baseUrl: string; apiKey: string; sender: string };

/**
 * 環境変数から接続情報を作る。どれか欠けていれば null（= SMS 未設定）。
 * NTT_CPAAS_BASE_URL は「マイページ → ディベロッパー」のベース URL（サブドメイン部分だけでも、https://… の全体でもよい）
 */
export function nttConfigFrom(env: Record<string, string | undefined>): NttConfig | null {
	const base = String(env.NTT_CPAAS_BASE_URL ?? '').trim();
	const apiKey = String(env.NTT_CPAAS_API_KEY ?? '').trim();
	const sender = String(env.NTT_CPAAS_SENDER ?? '').trim();
	if (!base || !apiKey || !sender) return null;
	const baseUrl = normalizeBaseUrl(base);
	if (!baseUrl) return null;
	return { baseUrl, apiKey, sender };
}

/**
 * NTT_CPAAS_BASE_URL → `https://<サブドメイン>.ibapi.nttcpaas.com`。
 * 受け付ける形: `abc123` / `abc123.ibapi.nttcpaas.com` / `https://abc123.ibapi.nttcpaas.com`（末尾スラッシュ・大文字・前後の空白は吸収）。
 * それ以外（別ホスト・http・パスやポート・認証情報つき・サブドメインが複数段）は null（API キーを別のホストへ送らない = SSRF 対策）。
 */
export function normalizeBaseUrl(raw: string | null | undefined): string | null {
	let v = String(raw ?? '').trim().toLowerCase();
	if (!v) return null;
	if (v.startsWith('https://')) v = v.slice('https://'.length);
	else if (v.includes('://')) return null;
	v = v.replace(/\/+$/, '');
	const sub = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.ibapi\.nttcpaas\.com)?$/.exec(v);
	if (!sub) return null;
	return `https://${sub[1]}.ibapi.nttcpaas.com`;
}

export type NttSmsArgs = {
	/** 国際形式（+ なし） */
	to: string;
	text: string;
	/** DLR の送り先（指定しなければマイページの「サブスクリプション管理」の設定が使われる） */
	notifyUrl?: string;
	/** 届けられなかったときに再送を試みる期間（分）。既定 360 分（当日 9:00 送信 → 15:00 まで） */
	validityMinutes?: number;
	/** DLR に戻ってくる識別子（送信記録の id） */
	callbackData?: string;
};

export function buildNttSmsRequest(cfg: NttConfig, a: NttSmsArgs): { url: string; init: RequestInit } {
	const message: Record<string, unknown> = {
		sender: cfg.sender,
		destinations: [{ to: a.to }],
		content: { text: a.text },
		options: { validityPeriod: { amount: a.validityMinutes ?? 360, timeUnit: 'MINUTES' } },
		webhooks: {
			...(a.notifyUrl ? { delivery: { url: a.notifyUrl } } : {}),
			contentType: 'application/json',
			...(a.callbackData ? { callbackData: a.callbackData } : {})
		}
	};
	return {
		url: `${cfg.baseUrl}/sms/3/messages`,
		init: {
			method: 'POST',
			headers: {
				Authorization: `App ${cfg.apiKey}`,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({ messages: [message] })
		}
	};
}

export type SmsSendResult = {
	sent: boolean;
	reason?: string;
	messageId?: string;
	providerStatus?: string;
	/** 番号が使えない等、送り直しても届かない失敗 */
	permanent?: boolean;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** 送信 API の応答を読む。PENDING / DELIVERED は送信できた扱い。REJECTED / UNDELIVERABLE / EXPIRED は失敗 */
export function parseNttSendResponse(httpStatus: number, body: unknown): SmsSendResult {
	const b = obj(body);
	if (httpStatus < 200 || httpStatus >= 300) {
		const ex = obj(obj(b.requestError).serviceException);
		const detail = [s(ex.messageId), s(ex.text)].filter(Boolean).join(' ');
		return { sent: false, reason: `ntt ${httpStatus}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
	}
	const m = obj(Array.isArray(b.messages) ? b.messages[0] : null);
	const st = obj(m.status);
	const group = s(st.groupName).toUpperCase();
	const name = s(st.name);
	const messageId = s(m.messageId) || undefined;
	if (!messageId) return { sent: false, reason: 'ntt: 応答に messageId がありません' };
	if (group === 'PENDING' || group === 'DELIVERED' || group === 'ACCEPTED') {
		return { sent: true, messageId, providerStatus: name || group };
	}
	return {
		sent: false,
		messageId,
		providerStatus: name || group,
		reason: `ntt: ${name || group || 'UNKNOWN'}${st.description ? ` ${s(st.description).slice(0, 120)}` : ''}`,
		permanent: group === 'UNDELIVERABLE'
	};
}

/** 送信する（fetch を差し替えられる形。設定が無ければ送らない） */
export async function sendSmsWith(
	cfg: NttConfig | null,
	a: NttSmsArgs,
	fetchImpl: typeof fetch = fetch
): Promise<SmsSendResult> {
	if (!cfg) return { sent: false, reason: 'SMS未設定' };
	if (!/^81[789]0\d{8}$/.test(a.to)) return { sent: false, reason: 'SMS の宛先が携帯番号ではありません', permanent: true };
	const { url, init } = buildNttSmsRequest(cfg, a);
	try {
		const res = await fetchImpl(url, init);
		const body = await res.json().catch(() => null);
		return parseNttSendResponse(res.status, body);
	} catch (e) {
		return { sent: false, reason: `ntt-error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
	}
}

// ---------------------------------------------------------------- Webhook

export type DispatchStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'undeliverable';

/** DLR の status.groupName → 送信記録の状態。PENDING（と不明）は据え置き = null */
export function dlrStatusOf(groupName: string | null | undefined): Exclude<DispatchStatus, 'pending' | 'sent'> | null {
	switch (String(groupName ?? '').toUpperCase()) {
		case 'DELIVERED':
			return 'delivered';
		case 'UNDELIVERABLE':
			return 'undeliverable';
		case 'REJECTED':
		case 'EXPIRED':
			return 'failed';
		default:
			return null;
	}
}

/** '2019-11-09T16:00:00.000+0000' のような時刻も ISO に直す。読めなければ null */
export function nttTime(v: unknown): string | null {
	const raw = s(v).trim();
	if (!raw) return null;
	const fixed = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
	const t = Date.parse(fixed);
	return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export type DlrReport = {
	message_id: string;
	status: 'delivered' | 'failed' | 'undeliverable';
	provider_status: string;
	error: string | null;
	done_at: string | null;
};

/** DLR Webhook の本文 → DB に渡す形（PENDING・messageId なしは捨てる） */
export function normalizeDlr(payload: unknown): DlrReport[] {
	const results = obj(payload).results;
	if (!Array.isArray(results)) return [];
	const out: DlrReport[] = [];
	for (const r0 of results.slice(0, 500)) {
		const r = obj(r0);
		const st = obj(r.status);
		const status = dlrStatusOf(s(st.groupName));
		const id = s(r.messageId).trim();
		if (!status || !id) continue;
		const err = obj(r.error);
		const errName = s(err.name);
		const error =
			status === 'delivered'
				? null
				: (errName && errName !== 'NO_ERROR' ? `${errName}${err.description ? ` ${s(err.description)}` : ''}` : s(st.description) || s(st.name)) ||
					null;
		out.push({
			message_id: id.slice(0, 100),
			status,
			provider_status: s(st.name).slice(0, 100),
			error: error ? error.slice(0, 300) : null,
			done_at: nttTime(r.doneAt)
		});
	}
	return out;
}

export type InboundSms = {
	message_id: string;
	paired_message_id: string | null;
	from: string | null;
	to: string | null;
	message: string;
	received_at: string | null;
};

/** 受信（返信）Webhook の本文 → DB に渡す形 */
export function normalizeInbound(payload: unknown): InboundSms[] {
	const results = obj(payload).results;
	if (!Array.isArray(results)) return [];
	const out: InboundSms[] = [];
	for (const r0 of results.slice(0, 500)) {
		const r = obj(r0);
		const id = s(r.messageId).trim();
		if (!id) continue;
		const text = s(r.message ?? r.text ?? r.cleanText);
		out.push({
			message_id: id.slice(0, 100),
			paired_message_id: s(r.pairedMessageId).trim().slice(0, 100) || null,
			from: s(r.from).replace(/[^\d+]/g, '').slice(0, 32) || null,
			to: s(r.to).replace(/[^\dA-Za-z+]/g, '').slice(0, 32) || null,
			message: text.slice(0, 2000),
			received_at: nttTime(r.receivedAt)
		});
	}
	return out;
}

export type WebhookAuth = 'ok' | 'denied' | 'unconfigured';

/**
 * Webhook の Basic 認証。secret は NTT_CPAAS_WEBHOOK_SECRET（「ユーザー名:パスワード」。マイページのサブスクリプションの
 * セキュリティ設定で BASIC に同じ値を登録する）。コロンが無い値はパスワードだけ比べる。比較は時間一定。
 */
export function checkWebhookAuth(authorization: string | null | undefined, secret: string | null | undefined): WebhookAuth {
	const sec = String(secret ?? '');
	if (!sec) return 'unconfigured';
	const h = String(authorization ?? '');
	const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(h);
	if (!m) return 'denied';
	let decoded = '';
	try {
		decoded = atob(m[1]);
	} catch {
		return 'denied';
	}
	if (sec.includes(':')) return timingSafeEqualText(decoded, sec) ? 'ok' : 'denied';
	const i = decoded.indexOf(':');
	const pass = i >= 0 ? decoded.slice(i + 1) : decoded;
	return timingSafeEqualText(pass, sec) ? 'ok' : 'denied';
}

// ---------------------------------------------------------------- 自動送信

/** PRECHECKIN_AUTOSEND が '1' のときだけ実際に送る（未設定・'0' は dry-run） */
export const autosendEnabled = (v: string | null | undefined) => String(v ?? '').trim() === '1';

export type AutosendTarget = {
	facility_id: string;
	stay_id: string;
	check_in_date: string;
	channel: ContactRoute;
	skip_reason: 'answered' | 'already_sent' | null;
};

export type AutosendPlan = {
	send: AutosendTarget[];
	counts: { total: number; sms: number; email: number; no_contact: number; answered: number; already_sent: number };
};

/** 対象を「送る（SMS / メール）」「連絡先なし」「回答済み」「送信済み」に分ける */
export function planAutosend(rows: AutosendTarget[]): AutosendPlan {
	const counts = { total: rows.length, sms: 0, email: 0, no_contact: 0, answered: 0, already_sent: 0 };
	const send: AutosendTarget[] = [];
	for (const r of rows) {
		if (r.skip_reason === 'answered') counts.answered++;
		else if (r.skip_reason === 'already_sent') counts.already_sent++;
		else if (r.channel === 'none') counts.no_contact++;
		else {
			counts[r.channel]++;
			send.push(r);
		}
	}
	return { send, counts };
}

// ---------------------------------------------------------------- 管理画面の表示

/** 送信受付 RPC の失敗理由 → 画面の文言 */
export function dispatchErrorText(code: string): string {
	switch (code) {
		case 'no_mobile':
			return '携帯番号が無いため SMS は送れません。';
		case 'no_email':
			return 'メールアドレスが無いため送れません。';
		case 'partner_booking':
			return '取引先経由のご予約は事前チェックインの対象外です。';
		case 'stay_expired':
			return 'このご滞在は終わっているため送れません。';
		case 'recent':
			return '直近 1 時間以内に SMS を送っています。';
		case 'rate_limited':
			return '同じお客様へ 1 時間に送れる SMS の上限（5 通）に達しました。1 時間ほどあけてください。';
		case 'duplicate':
			return '本日はすでに送っています。';
		case 'answered':
			return 'すでに回答済みです。';
		case 'not_found':
			return '対象のご予約が見つかりません（取消済みの可能性があります）。';
		default:
			return `送れませんでした（${code}）。`;
	}
}

export type SmsStatusRow = {
	precheckin_id: string;
	stay_id: string;
	sms_status: DispatchStatus | null;
	sms_at: string | null;
	sms_error: string | null;
	sms_last_hour: number;
	sms_count: number;
	inbound_count: number;
	last_inbound_at: string | null;
};

export const SMS_STATUS_LABEL: Record<DispatchStatus, string> = {
	pending: 'SMS 送信中',
	sent: 'SMS 送信済',
	delivered: 'SMS 到達',
	failed: 'SMS 失敗',
	undeliverable: 'SMS 未到達'
};

export const SMS_STATUS_CLASS: Record<DispatchStatus, string> = {
	pending: 'bg-stone-50 text-stone-600 ring-stone-200',
	sent: 'bg-sky-50 text-sky-800 ring-sky-200',
	delivered: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	failed: 'bg-red-50 text-red-700 ring-red-200',
	undeliverable: 'bg-red-50 text-red-700 ring-red-200'
};
