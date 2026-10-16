// 客室案内のアクセスログを受ける（2026-10-17 指示）。/r のレイアウトが、ページを表示するたびに送る。
// 滞在トークン（ab_stay）と入口QRの施設（ab_facility）は Cookie から読み、ブラウザからは受け取らない。
// 同じ端末かどうかを見るための visitor_id は、無ければここで Cookie に発行する（ランダム値・1年）。
// 記録に失敗してもお客様の画面には関係ないので、常に 204 を返す。
import { getLocale } from '$lib/paraglide/runtime';
import { BROWSE_FACILITY_COOKIE } from '$lib/server/inroom-browse';
import { deviceKind, logInroomAccess, normalizeInroomPath } from '$lib/server/inroom-access-log';
import type { RequestHandler } from './$types';

const VISITOR_COOKIE = 'ab_vid';
const VISITOR_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export const POST: RequestHandler = async ({ request, cookies }) => {
	let body: unknown = null;
	try {
		body = await request.json();
	} catch {
		return new Response(null, { status: 204 });
	}
	const target = normalizeInroomPath((body as { path?: unknown } | null)?.path);
	if (!target) return new Response(null, { status: 204 });

	let visitorId = cookies.get(VISITOR_COOKIE) ?? '';
	if (!/^[0-9a-f-]{36}$/i.test(visitorId)) {
		visitorId = crypto.randomUUID();
		cookies.set(VISITOR_COOKIE, visitorId, { path: '/r', httpOnly: true, sameSite: 'lax', maxAge: VISITOR_MAX_AGE_SEC });
	}

	try {
		await logInroomAccess({
			token: cookies.get('ab_stay') ?? null,
			facilitySlug: cookies.get(BROWSE_FACILITY_COOKIE) ?? null,
			path: target.path,
			guideId: target.guideId,
			locale: getLocale(),
			device: deviceKind(request.headers.get('user-agent')),
			visitorId
		});
	} catch (e) {
		console.warn('[inroom-access-log]', e instanceof Error ? e.message : e);
	}
	return new Response(null, { status: 204 });
};
