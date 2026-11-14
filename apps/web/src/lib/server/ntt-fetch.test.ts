// NTT CPaaS 向けの生の接続（ntt-fetch.ts）の、依頼の組み立てと応答の読み取り。接続そのものは Workers の上でしか試せない
import { describe, expect, it } from 'vitest';
import { buildRawHttpRequest, parseRawHttpResponse } from './ntt-fetch';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('依頼の組み立て', () => {
	it('見出しと本文。Content-Length は日本語でもバイト数', () => {
		const body = JSON.stringify({ text: '【山人】ご案内' });
		const raw = dec(
			buildRawHttpRequest(new URL('https://abc.ibapi.nttcpaas.com/sms/3/messages?x=1'), {
				method: 'post',
				headers: { Authorization: 'App KEY', 'Content-Type': 'application/json', Host: 'evil.example', 'Content-Length': '1' },
				body
			})
		);
		const [head, sent] = raw.split('\r\n\r\n');
		const lines = head.split('\r\n');
		expect(lines[0]).toBe('POST /sms/3/messages?x=1 HTTP/1.1');
		expect(lines[1]).toBe('Host: abc.ibapi.nttcpaas.com');
		expect(lines).toContain('Authorization: App KEY');
		expect(lines).toContain(`Content-Length: ${enc(body).length}`);
		expect(lines).toContain('Connection: close');
		// 呼び出し側の Host・Content-Length は使わない
		expect(lines.filter((l) => /^host:/i.test(l))).toHaveLength(1);
		expect(lines.filter((l) => /^content-length:/i.test(l))).toHaveLength(1);
		expect(sent).toBe(body);
	});

	it('見出しに改行が混ざっていたら送らない', () => {
		expect(() => buildRawHttpRequest(new URL('https://a.ibapi.nttcpaas.com/'), { headers: { X: 'a\r\nEvil: 1' } })).toThrow();
	});
});

describe('応答の読み取り', () => {
	it('Content-Length の応答', () => {
		const r = parseRawHttpResponse(enc('HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: 15\r\nServer: SMS API\r\n\r\n{"errorCode":1}余分'));
		expect(r).toEqual({ status: 400, headers: { 'content-type': 'application/json', 'content-length': '15', server: 'SMS API' }, body: '{"errorCode":1}' });
	});

	it('chunked の応答（日本語を含む）', () => {
		const a = enc('{"messages":[{"t":"');
		const b = enc('山人"}]}');
		const hex = (n: number) => n.toString(16);
		const raw = new Uint8Array([
			...enc('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
			...enc(`${hex(a.length)}\r\n`),
			...a,
			...enc(`\r\n${hex(b.length)};ext=1\r\n`),
			...b,
			...enc('\r\n0\r\n\r\n')
		]);
		const r = parseRawHttpResponse(raw);
		expect(r?.status).toBe(200);
		expect(JSON.parse(r!.body)).toEqual({ messages: [{ t: '山人' }] });
	});

	it('長さの見出しが無ければ、閉じるまでを本文にする', () => {
		expect(parseRawHttpResponse(enc('HTTP/1.1 200 OK\r\n\r\nabc'))?.body).toBe('abc');
	});

	it('見出しが終わっていない・HTTP でないものは null', () => {
		expect(parseRawHttpResponse(enc('HTTP/1.1 200 OK\r\nX: 1\r\n'))).toBeNull();
		expect(parseRawHttpResponse(enc('garbage\r\n\r\n'))).toBeNull();
	});
});
