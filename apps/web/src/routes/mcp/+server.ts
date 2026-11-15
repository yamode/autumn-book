import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { bookingAccess, bookingMcpEnabled, bookingPilotEnabled, CONNECTOR_ICON_PATH, PILOT_CLIENT_ID, PILOT_MCP_PATH, PILOT_SCOPE, pilotMemberAllowed, privateHeaders, RESOURCE_METADATA_PATH, SCOPE } from '$lib/server/booking-mcp/oauth';
import { registerOnsiteBooking } from '$lib/server/booking-mcp/onsite';
import { searchBookingOffers, validCheckin } from '$lib/server/booking-mcp/search';
import { STAY_FACILITIES } from '$lib/server/stay-calendar';
import { APP_VERSION } from '$lib/version';
import type { RequestHandler } from './$types';

const DEBUG = dev;
const MAX_BODY_BYTES = 16 * 1024;

export const POST: RequestHandler = async ({ request, url }) => {
	const pilot = url.pathname === PILOT_MCP_PATH;
	if (!(pilot ? bookingPilotEnabled(url) : bookingMcpEnabled(url))) return new Response(null, { status: 404, headers: privateHeaders });
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) return new Response(null, { status: 403, headers: privateHeaders });

	try {
		const access = await bookingAccess(request, pilot ? PILOT_CLIENT_ID : undefined);
		if (!access) return authorizationRequired(url, request.headers.has('authorization'));
		if (pilot && !await pilotMemberAllowed(access.userId)) return new Response(null, { status: 403, headers: privateHeaders });
		if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
			return new Response(null, { status: 415, headers: privateHeaders });
		}
		const reader = request.body?.getReader();
		if (!reader) return new Response(null, { status: 400, headers: privateHeaders });
		const decoder = new TextDecoder();
		let bytes = 0;
		let body = '';
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_BODY_BYTES) {
				await reader.cancel();
				return new Response(null, { status: 413, headers: privateHeaders });
			}
			body += decoder.decode(value, { stream: true });
		}
		const server = new McpServer({
			name: 'yamado',
			title: 'YAMADO',
			version: APP_VERSION,
			icons: [{ src: url.origin + CONNECTOR_ICON_PATH, mimeType: 'image/png', sizes: ['512x512'] }]
		}, {
			instructions: '西和賀・男鹿のYAMADO公式予約。空室数は availableRoomCount を「室」で表示し、プラン候補の数とは区別してください。'
				+ (pilot
					? ' 現地払い候補を本人が選んだ場合は確認カードを開き、本人に確定ボタンを押してもらってください。会話での承諾を予約確定と扱わないでください。事前決済が必要なプランは bookingUrl を案内してください。'
					: 'bookingUrl を利用者に案内してください。予約完了や在庫確保を保証しないでください。')
		});
		server.registerTool('search_stays', {
			title: '山人の空室・料金を検索',
			description: 'チェックイン日・泊数・大人人数を指定して各施設の残室数（availableRoomCount）、1室の全泊分の宿泊料金と公式予約リンクを取得します。プラン候補数と残室数は異なります。対象は大人のみです。',
			inputSchema: {
				facility: z.enum([...STAY_FACILITIES, 'both']).describe('nishiwaga は岩手県西和賀、oga は秋田県男鹿、both は両施設'),
				checkin: z.string().length(10).refine(validCheckin, '日本時間の今日から366日以内の実在する日付（YYYY-MM-DD）を指定してください'),
				nights: z.number().int().min(1).max(7),
				adults: z.number().int().min(1).max(6)
			},
			annotations: { title: '山人の空室・料金を検索', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
		}, async (query) => {
			try {
				const result = await searchBookingOffers(url.origin, query, access.viewer, pilot);
				return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
			} catch {
				if (DEBUG) console.warn('[DBG booking-mcp] availability lookup failed');
				return { isError: true, content: [{ type: 'text', text: '空室と見積もりを取得できませんでした。時間をおいてもう一度お試しください。' }] };
			}
		});
		if (pilot) registerOnsiteBooking(server, url.origin, access);
		const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
		await server.connect(transport);
		try {
			const input = new Request(request.url, { method: 'POST', headers: request.headers, body: body + decoder.decode() });
			const response = await transport.handleRequest(input);
			return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...privateHeaders } });
		} finally {
			await server.close();
		}
	} catch {
		if (DEBUG) console.warn('[DBG booking-mcp] request failed');
		return json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'YAMADO is temporarily unavailable' } }, { status: 503, headers: privateHeaders });
	}
};

function authorizationRequired(url: URL, invalidToken = false): Response {
	const pilot = url.pathname === PILOT_MCP_PATH;
	const metadata = url.origin + RESOURCE_METADATA_PATH + (pilot ? '/pilot' : '');
	const challenge = `Bearer resource_metadata="${metadata}", scope="${pilot ? PILOT_SCOPE : SCOPE}"`;
	return new Response(null, {
		status: 401,
		headers: { ...privateHeaders, 'WWW-Authenticate': invalidToken ? `${challenge}, error="invalid_token"` : challenge }
	});
}

// Allow unauthenticated discovery via GET. Authenticated clients use POST, with no standalone SSE stream.
export const GET: RequestHandler = ({ request, url }) => {
	if (!(url.pathname === PILOT_MCP_PATH ? bookingPilotEnabled(url) : bookingMcpEnabled(url))) {
		return new Response(null, { status: 404, headers: privateHeaders });
	}
	if (!request.headers.has('authorization')) return authorizationRequired(url);
	return new Response(null, { status: 405, headers: { ...privateHeaders, allow: 'POST' } });
};
