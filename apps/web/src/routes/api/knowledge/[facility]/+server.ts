// GET /api/knowledge/{facility}?scope=press|public … 承認済みの施設ナレッジ（docs/facility-knowledge.md 段階5）。
// taskul-social のプレスリリース AI などがサーバー側から呼ぶ。ブラウザからは呼ばせない（CORS ヘッダを付けない）。
// 認証: Authorization: Bearer <KNOWLEDGE_API_KEY>（Cloudflare の secret）。未設定なら 503。
// facility は nishiwaga / yamado（= nishiwaga）/ oga。scope の既定は press。internal は受け付けない。
import { json, type RequestHandler } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { timingSafeEqualText } from '$lib/partner-mfa';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { knowledgeFacility, parseScope, shapeKnowledge, type UsableRow } from '$lib/server/facility-knowledge/public';

const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };

function authorized(request: Request, secret: string) {
	const header = request.headers.get('authorization') ?? '';
	const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	return presented.length >= 32 && timingSafeEqualText(presented, secret);
}

export const GET: RequestHandler = async ({ request, params, url }) => {
	const secret = privateEnv.KNOWLEDGE_API_KEY?.trim();
	if (!secret || secret.length < 32) return json({ error: 'not_configured' }, { status: 503, headers });
	if (!authorized(request, secret)) return json({ error: 'unauthorized' }, { status: 401, headers });

	const facility = knowledgeFacility(params.facility ?? '');
	if (!facility) return json({ error: 'not_found' }, { status: 404, headers });
	const scope = parseScope(url.searchParams.get('scope'));
	if (!scope) return json({ error: 'invalid_scope' }, { status: 400, headers });

	const svc = partnerServiceClient();
	if (!svc) return json({ error: 'not_configured' }, { status: 503, headers });
	const book = svc.schema('book');
	const [usable, seasons] = await Promise.all([
		book.rpc('facility_knowledge_usable', { p_facility: facility.uuid, p_scope: scope }),
		book.from('facility_stories').select('id, seasons').eq('facility_id', facility.uuid).neq('seasons', '{}')
	]);
	if (usable.error || seasons.error) {
		console.error('knowledge api error:', usable.error?.message ?? seasons.error?.message);
		return json({ error: 'unavailable' }, { status: 503, headers });
	}
	const seasonsById = Object.fromEntries(((seasons.data ?? []) as { id: string; seasons: string[] }[]).map((r) => [r.id, r.seasons ?? []]));
	return json(shapeKnowledge(facility, scope, (usable.data ?? []) as UsableRow[], seasonsById), { headers });
};
