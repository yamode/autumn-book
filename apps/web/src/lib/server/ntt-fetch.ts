// NTT CPaaS の API へ、Workers の fetch を使わずに TLS の生の接続（cloudflare:sockets）で送る。
//
// 【なぜ】Cloudflare Workers の fetch で *.ibapi.nttcpaas.com へ送ると、依頼が Cloudflare の内部で別の経路へ回され
//   （応答が server: cloudflare・cf-ray つきになる）、本来の API（公開 DNS の先・応答は server: SMS API）に届かず、
//   正しい API キーでも 401 になる（2026-11-15 本番で確認。同じ Worker から生の接続で送ると認証が通る）。
//   生の接続は公開 DNS のとおりにつながるので、こちらを使う。
// cloudflare:sockets が無い環境（vite dev・vitest・Node）では、ふつうの fetch に戻す（手元からは fetch で届く）。
//
// 対応する範囲は NTT の API に要る分だけ: https・1 往復で閉じる（Connection: close）・本文は文字列・
// 応答は Content-Length か chunked。転送（3xx）は追わない。

type Sock = { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array>; close: () => Promise<void> };
type Connect = (addr: { hostname: string; port: number }, opts: { secureTransport: 'on' }) => Sock;

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 256 * 1024;

/** 送る HTTP/1.1 の依頼（バイト列）。Content-Length は本文のバイト数 */
export function buildRawHttpRequest(url: URL, init: { method?: string; headers?: Record<string, string>; body?: string }): Uint8Array {
	const enc = new TextEncoder();
	const body = enc.encode(init.body ?? '');
	const lines = [`${(init.method ?? 'GET').toUpperCase()} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`];
	for (const [k, v] of Object.entries(init.headers ?? {})) {
		// 見出しへの改行の混入（見出しの注入）を防ぐ
		if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) throw new Error('invalid header');
		if (/^(host|content-length|connection|transfer-encoding)$/i.test(k)) continue;
		lines.push(`${k}: ${v}`);
	}
	lines.push(`Content-Length: ${body.length}`, 'Connection: close', '', '');
	const head = enc.encode(lines.join('\r\n'));
	const out = new Uint8Array(head.length + body.length);
	out.set(head, 0);
	out.set(body, head.length);
	return out;
}

function indexOf(hay: Uint8Array, needle: number[], from = 0): number {
	outer: for (let i = from; i <= hay.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
		return i;
	}
	return -1;
}

/** chunked の本文をつなげる。形が崩れていたら、読めたところまで */
function dechunk(b: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = [];
	let pos = 0;
	let total = 0;
	while (pos < b.length) {
		const eol = indexOf(b, [13, 10], pos);
		if (eol < 0) break;
		const size = parseInt(new TextDecoder().decode(b.subarray(pos, eol)).split(';')[0].trim(), 16);
		if (!Number.isFinite(size) || size <= 0) break;
		const start = eol + 2;
		const end = Math.min(start + size, b.length);
		parts.push(b.subarray(start, end));
		total += end - start;
		pos = end + 2;
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** 受け取ったバイト列（見出し＋本文）を読む。読めなければ null */
export function parseRawHttpResponse(raw: Uint8Array): { status: number; headers: Record<string, string>; body: string } | null {
	const sep = indexOf(raw, [13, 10, 13, 10]);
	if (sep < 0) return null;
	const headLines = new TextDecoder().decode(raw.subarray(0, sep)).split('\r\n');
	const m = /^HTTP\/1\.[01] (\d{3})/.exec(headLines[0] ?? '');
	if (!m) return null;
	const headers: Record<string, string> = {};
	for (const l of headLines.slice(1)) {
		const i = l.indexOf(':');
		if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
	}
	let body = raw.subarray(sep + 4);
	if (/chunked/i.test(headers['transfer-encoding'] ?? '')) body = dechunk(body);
	else if (headers['content-length'] && Number.isFinite(Number(headers['content-length']))) body = body.subarray(0, Number(headers['content-length']));
	return { status: Number(m[1]), headers, body: new TextDecoder().decode(body) };
}

async function loadConnect(): Promise<Connect | null> {
	try {
		// 文字列を分けて、ビルド時に解決させない（Workers の実行時にだけある組み込みモジュール）
		const spec = 'cloudflare:' + 'sockets';
		const mod = (await import(/* @vite-ignore */ spec)) as { connect?: Connect };
		return typeof mod.connect === 'function' ? mod.connect : null;
	} catch {
		return null;
	}
}

/** fetch と同じ形で呼べる（sendSmsWith の fetchImpl に渡す）。Workers では生の接続、それ以外は fetch */
export const nttFetch: typeof fetch = async (input, init) => {
	const connect = await loadConnect();
	if (!connect) return fetch(input, init);
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
	if (url.protocol !== 'https:') throw new Error('https only');
	const req = buildRawHttpRequest(url, {
		method: init?.method,
		headers: Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined)),
		body: typeof init?.body === 'string' ? init.body : undefined
	});
	const sock = connect({ hostname: url.hostname, port: Number(url.port) || 443 }, { secureTransport: 'on' });
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const work = (async () => {
			const w = sock.writable.getWriter();
			await w.write(req);
			w.releaseLock();
			const rd = sock.readable.getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			for (;;) {
				const { value, done } = await rd.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					total += value.length;
					if (total > MAX_BYTES) break;
				}
			}
			const raw = new Uint8Array(total);
			let o = 0;
			for (const c of chunks) {
				raw.set(c, o);
				o += c.length;
			}
			return raw;
		})();
		const timeout = new Promise<never>((_, rej) => {
			timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS);
		});
		const parsed = parseRawHttpResponse(await Promise.race([work, timeout]));
		if (!parsed) throw new Error('応答を読めませんでした');
		const h = new Headers();
		for (const [k, v] of Object.entries(parsed.headers)) if (!/^(transfer-encoding|content-length|connection)$/.test(k)) h.set(k, v);
		// 204・304 は本文を持てない
		return new Response([204, 304].includes(parsed.status) ? null : parsed.body, { status: parsed.status, headers: h });
	} finally {
		if (timer) clearTimeout(timer);
		await sock.close().catch(() => {});
	}
};
