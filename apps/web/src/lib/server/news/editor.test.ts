// お知らせの入力の読み取り: 掲載施設（複数可・2026-11-22）
import { describe, expect, it } from 'vitest';
import { newsInput } from './editor';
import { FACILITY_UUID } from '$lib/server/supabase-data';

const NISHIWAGA = FACILITY_UUID['f-nishiwaga'], OGA = FACILITY_UUID['f-oga'];
function form(extra: [string, string][]) {
	const f = new FormData();
	for (const [k, v] of [['title', 'お知らせ'], ['body', '本文'], ['publishedAt', '2026-11-22'], ...extra]) f.append(k, v);
	return f;
}

describe('newsInput の掲載施設', () => {
	it('両方の施設を選べる（重複は1つに）', () =>
		expect(newsInput(form([['facilityIdsSent', '1'], ['facilityIds', NISHIWAGA], ['facilityIds', OGA], ['facilityIds', OGA]])).facilityIds).toEqual([NISHIWAGA, OGA]));
	it('画面から送ったのに1つも選んでいなければ断る', () =>
		expect(() => newsInput(form([['facilityIdsSent', '1']]))).toThrow('掲載施設を1つ以上'));
	it('知らない施設 ID は落とし、残らなければ断る', () =>
		expect(() => newsInput(form([['facilityIdsSent', '1'], ['facilityIds', '00000000-0000-0000-0000-00000000dead']]))).toThrow('掲載施設を確認'));
	it('古い画面・デモ（送らない）ときは undefined＝今の施設だけ', () => expect(newsInput(form([])).facilityIds).toBeUndefined());
});
