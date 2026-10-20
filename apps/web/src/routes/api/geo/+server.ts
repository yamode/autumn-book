// アクセス元の国と、解析の前に同意を聞く必要があるか（2026-10-21 指示）。
// Xserver で配信している施設 HP（hp-yamado）は国が分からないので、ブラウザからここに聞いて同意バナーを出し分ける。
// 返すのは国コードと判定だけ（IP などは返さない・残さない）。結果は端末ごとに違うので保存させない。
import { consentRequiredFor } from '$lib/consent-region';
import { requestCountry } from '$lib/server/geo';
import type { RequestHandler } from './$types';

// 呼び出しを許すサイト（施設 HP）
const ALLOWED_ORIGINS = new Set(['https://www.yamado.co.jp', 'https://yamado.co.jp', 'https://oga.yamado.co.jp']);

function corsHeaders(origin: string | null): Record<string, string> {
	const h: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		h['Access-Control-Allow-Origin'] = origin;
		h['Access-Control-Allow-Methods'] = 'GET';
	}
	return h;
}

export const GET: RequestHandler = async (event) => {
	const country = requestCountry(event);
	return new Response(JSON.stringify({ country, consentRequired: consentRequiredFor(country) }), {
		headers: { 'Content-Type': 'application/json', ...corsHeaders(event.request.headers.get('origin')) }
	});
};

export const OPTIONS: RequestHandler = async ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
