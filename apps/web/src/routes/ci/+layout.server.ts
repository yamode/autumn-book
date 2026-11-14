import { pcMealMinutes, pcQuestions, resolvePrecheckin } from '$lib/server/precheckin';
import { DEFAULT_MEAL_MINUTES } from '$lib/precheckin-p3';
import { DEMO_PRECHECKIN_CODE, type PcError, type PcQuestion } from '$lib/precheckin';
import type { LayoutServerLoad } from './$types';

// 事前チェックイン（/ci）の共通: Cookie（ab_ci）のトークンでフォームの中身を引く。
// 開けないときは理由（ctx=null・ciError）を返し、レイアウトが案内を出す。
// 食事の所要時間の目安（book.precheckin_settings）も引く（③ 貸切風呂で時間選びの目安に出す）。
// 2026-11-14: 締め切りの表示と OTA 誘導バナーはやめた（ユーザー指示）。
const ERRORS: PcError[] = ['invalid_token', 'expired', 'cancelled', 'locked', 'none'];

export const load: LayoutServerLoad = async (event) => {
	const r = await resolvePrecheckin(event);
	if ('ctx' in r) {
		const [mealMinutes, questions] = await Promise.all([
			pcMealMinutes(r.ctx.facility.id).catch(() => DEFAULT_MEAL_MINUTES),
			// 宿からの質問（施設ごと・回答は必須）。① に出す
			pcQuestions(r.ctx.facility.id, r.ctx.bookingCode === DEMO_PRECHECKIN_CODE).catch(() => [] as PcQuestion[])
		]);
		return { ctx: r.ctx, ciError: null as PcError | null, mealMinutes, questions };
	}
	// /ci/<token> から戻ったときは理由が ?e= に載っている（Cookie は無い）
	const e = event.url.searchParams.get('e') as PcError | null;
	const ciError: PcError = r.error === 'none' && e && ERRORS.includes(e) ? e : r.error;
	return { ctx: null, ciError, mealMinutes: DEFAULT_MEAL_MINUTES, questions: [] as PcQuestion[] };
};
