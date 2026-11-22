// 施設ナレッジのフォーム読み取りと状態の判定（DB の check・facility_knowledge_usable と同じ条件か）
import { describe, expect, it } from 'vitest';
import { knowledgeStatus, tokyoToday } from '$lib/facility-knowledge';
import { KnowledgeError, parseFactForm, parseStoryForm } from './index';
import seed from './seeds/nishiwaga-jalan-2611.json';

function fd(entries: [string, string][]) {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
}

describe('knowledgeStatus', () => {
	const base = { verifiedAt: null as string | null, validFrom: null as string | null, validUntil: null as string | null };
	it('承認が無ければ未承認', () => expect(knowledgeStatus(base, '2026-11-22')).toBe('unverified'));
	it('承認済みで期間内なら承認済み', () =>
		expect(knowledgeStatus({ ...base, verifiedAt: '2026-11-22T00:00:00Z', validUntil: '2026-11-22' }, '2026-11-22')).toBe('verified'));
	it('終了日を過ぎたら承認済みでも期限切れ', () =>
		expect(knowledgeStatus({ ...base, verifiedAt: '2026-01-01T00:00:00Z', validUntil: '2026-11-21' }, '2026-11-22')).toBe('expired'));
	it('開始日前は期間前', () => expect(knowledgeStatus({ ...base, validFrom: '2027-01-01' }, '2026-11-22')).toBe('upcoming'));
	it('日本時間の日付で判定する（UTC 15時以降は翌日）', () => expect(tokyoToday(new Date('2026-11-22T15:30:00Z'))).toBe('2026-11-23'));
});

describe('parseFactForm', () => {
	it('一覧から選んだ項目で読める', () => {
		const r = parseFactForm(fd([['keyPreset', 'parking'], ['keyCustom', ''], ['value', ' あり（無料・12台） '], ['visibility', 'public']]));
		expect(r).toMatchObject({ key: 'parking', value: 'あり（無料・12台）', visibility: 'public', validFrom: null, validUntil: null });
	});
	it('一覧に無い項目は入力したキーを使う', () =>
		expect(parseFactForm(fd([['keyPreset', ''], ['keyCustom', 'access.bus'], ['value', 'x'], ['visibility', 'press']])).key).toBe('access.bus'));
	it('キーの形が違えば断る', () =>
		expect(() => parseFactForm(fd([['key', 'Access Bus'], ['value', 'x'], ['visibility', 'public']]))).toThrow(KnowledgeError));
	it('公開範囲が無ければ断る', () => expect(() => parseFactForm(fd([['key', 'parking'], ['value', 'x']]))).toThrow('公開範囲'));
	it('期間が逆なら断る', () =>
		expect(() =>
			parseFactForm(fd([['key', 'parking'], ['value', 'x'], ['visibility', 'public'], ['validFrom', '2027-03-31'], ['validUntil', '2027-01-01']]))
		).toThrow('期間'));
});

describe('parseStoryForm', () => {
	it('季節は決まった値だけ・重複なし', () => {
		const f = fd([['topic', 'experience'], ['title', '雪あかり'], ['body', '本文'], ['visibility', 'public'], ['seasons', 'winter'], ['seasons', 'winter'], ['seasons', 'snow']]);
		expect(parseStoryForm(f).seasons).toEqual(['winter']);
	});
	it('分類が違えば断る', () =>
		expect(() => parseStoryForm(fd([['topic', 'spa'], ['title', 'a'], ['body', 'b'], ['visibility', 'public']]))).toThrow('分類'));
});

describe('じゃらん回答の初期データ', () => {
	it('事実のキー・公開範囲・説明の分類と季節が DB の決まりに合う', () => {
		for (const f of seed.facts) {
			expect(() => parseFactForm(fd([['key', f.key], ['value', f.value], ['visibility', f.visibility]]))).not.toThrow();
		}
		for (const s of seed.stories) {
			expect(() =>
				parseStoryForm(fd([['topic', s.topic], ['title', s.title], ['body', s.body], ['visibility', s.visibility], ...s.seasons.map((x) => ['seasons', x] as [string, string])]))
			).not.toThrow();
		}
	});
	it('料金・客室数の項目は入れない（正本はプラン・PMS）', () => {
		expect(seed.facts.some((f) => /^(price|rooms)\b/.test(f.key))).toBe(false);
	});
});
