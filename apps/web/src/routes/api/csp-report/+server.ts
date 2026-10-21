// POST /api/csp-report — CSP（Report-Only）の違反報告を受けてログに出す（2026-10-21 監査で追加）。
//
// svelte.config.js の csp.reportOnly の report-uri。ブラウザが application/csp-report（JSON）で送ってくる。
// 違反を見て正当な読み込み元を足し切ったら、Report-Only から強制へ移す。
// ・本文は 8KB まで・要点（違反した指示・読み込み元・ページ）だけを 1 行で出す（個人情報・クエリは落とす）
// ・常に 204（送り手に何も返さない）
import type { RequestHandler } from './$types';

const MAX_BYTES = 8_000;

/** URL からクエリ・フラグメントを落とす（予約番号やトークンをログに残さない） */
function stripQuery(v: unknown): string {
	const s = typeof v === 'string' ? v : '';
	try {
		const u = new URL(s);
		return `${u.origin}${u.pathname}`.slice(0, 200);
	} catch {
		return s.split(/[?#]/)[0].slice(0, 200);
	}
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const text = (await request.text()).slice(0, MAX_BYTES);
		const body = JSON.parse(text) as Record<string, unknown>;
		const r = (body['csp-report'] ?? body) as Record<string, unknown>;
		console.warn(
			'[csp-report]',
			JSON.stringify({
				directive: String(r['effective-directive'] ?? r['violated-directive'] ?? '').slice(0, 80),
				blocked: stripQuery(r['blocked-uri']),
				page: stripQuery(r['document-uri']),
				source: stripQuery(r['source-file'])
			})
		);
	} catch {
		// 壊れた報告は無視
	}
	return new Response(null, { status: 204 });
};
