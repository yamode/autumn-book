import { resolvePrecheckin } from '$lib/server/precheckin';
import type { PcError } from '$lib/precheckin';
import type { LayoutServerLoad } from './$types';

// 事前チェックイン（/ci）の共通: Cookie（ab_ci）のトークンでフォームの中身を引く。
// 開けないときは理由（ctx=null・ciError）を返し、レイアウトが案内を出す。
const ERRORS: PcError[] = ['invalid_token', 'expired', 'cancelled', 'locked', 'none'];

export const load: LayoutServerLoad = async (event) => {
	const r = await resolvePrecheckin(event);
	if ('ctx' in r) return { ctx: r.ctx, ciError: null as PcError | null };
	// /ci/<token> から戻ったときは理由が ?e= に載っている（Cookie は無い）
	const e = event.url.searchParams.get('e') as PcError | null;
	const ciError: PcError = r.error === 'none' && e && ERRORS.includes(e) ? e : r.error;
	return { ctx: null, ciError };
};
