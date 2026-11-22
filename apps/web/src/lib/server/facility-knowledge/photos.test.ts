// 写真の権利（段階6）: フォームの読み取り（1枚の編集・まとめての編集）と、保存する行の作り方・状態の判定
import { describe, expect, it, vi } from 'vitest';
import { photoStatus } from '$lib/facility-knowledge';
import { KnowledgeError } from './index';
import { parseRightsForm, saveRights } from './photos';

function fd(entries: [string, string][]) {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
}

describe('parseRightsForm（1枚の編集）', () => {
	it('すべての欄をそのまま保存する（空欄は消す）', () => {
		const p = parseRightsForm(fd([['usageMode', 'set'], ['rights', 'own'], ['people', 'consented'], ['season', 'winter'], ['usage', 'press'], ['usage', 'web'], ['photographer', ' 山田 '], ['originalPath', ''], ['note', '']]));
		expect(p).toEqual({ rights: 'own', has_people: true, people_consent: true, season: 'winter', usage_scope: ['web', 'press'], photographer: '山田', original_path: null, note: null });
	});
	it('使える範囲を全部外すと空にする', () => expect(parseRightsForm(fd([['usageMode', 'set']])).usage_scope).toEqual([]));
	it('季節を問わない（空）は null', () => expect(parseRightsForm(fd([['usageMode', 'set'], ['season', '']])).season).toBeNull());
	it('おかしな値は受け付けない', () => {
		expect(() => parseRightsForm(fd([['rights', 'stolen']]))).toThrow(KnowledgeError);
		expect(() => parseRightsForm(fd([['usageMode', 'set'], ['usage', 'tv']]))).toThrow(KnowledgeError);
		expect(() => parseRightsForm(fd([['people', 'maybe']]))).toThrow(KnowledgeError);
		expect(() => parseRightsForm(fd([['photographer', 'あ'.repeat(101)]]))).toThrow(/100文字/);
	});
});

describe('parseRightsForm（まとめての編集）', () => {
	it('「変えない」・空欄の項目は入れない', () => {
		const p = parseRightsForm(fd([['usageMode', 'each'], ['rights', 'keep'], ['people', 'keep'], ['season', 'keep'], ['photographer', ''], ['photographerKeep', '1'], ['note', ''], ['noteKeep', '1'], ['usage_web', 'keep']]));
		expect(p).toEqual({});
	});
	it('使える範囲は1つずつ足し引きする', () => {
		const p = parseRightsForm(fd([['usageMode', 'each'], ['rights', 'licensed'], ['usage_press', 'allow'], ['usage_ad', 'deny'], ['photographer', '外部カメラマン'], ['photographerKeep', '1']]));
		expect(p).toEqual({ rights: 'licensed', usage_add: ['press'], usage_remove: ['ad'], photographer: '外部カメラマン' });
	});
	it('人が写っていないを選ぶと、許可の欄は消す', () => expect(parseRightsForm(fd([['people', 'none']]))).toEqual({ has_people: false, people_consent: null }));
});

function fakeClient(existing: Record<string, string[]>) {
	const upserts: Record<string, unknown>[][] = [];
	const table = {
		select: () => table,
		eq: () => table,
		in: async () => ({ data: Object.entries(existing).map(([url, usage_scope]) => ({ url, usage_scope })), error: null }),
		upsert: async (rows: Record<string, unknown>[]) => (upserts.push(rows), { error: null })
	};
	const client = { schema: () => ({ from: vi.fn(() => table) }) };
	return { client: client as never, upserts };
}

describe('saveRights', () => {
	const F = '10000000-0000-0000-0000-000000000001';
	it('使える範囲の足し引きは、写真ごとの今の値に重ねる（並びは web・press・print・ad）', async () => {
		const { client, upserts } = fakeClient({ 'https://x/a.jpg': ['ad', 'web'] });
		const n = await saveRights(client, F, ['https://x/a.jpg', 'https://x/b.jpg', 'https://x/a.jpg'], { usage_add: ['press'], usage_remove: ['ad'] });
		expect(n).toBe(2);
		expect(upserts[0]).toEqual([
			{ facility_id: F, url: 'https://x/a.jpg', usage_scope: ['web', 'press'] },
			{ facility_id: F, url: 'https://x/b.jpg', usage_scope: ['press'] }
		]);
	});
	it('https 以外は落とす。写真が無ければ・変える項目が無ければ止める', async () => {
		const { client } = fakeClient({});
		await expect(saveRights(client, F, ['javascript:alert(1)'], { rights: 'own' })).rejects.toThrow(/写真を選んで/);
		await expect(saveRights(client, F, ['https://x/a.jpg'], {})).rejects.toThrow(/変える項目/);
	});
});

describe('photoStatus（DB の photo_press_ok と同じ条件）', () => {
	const base = { rights: 'own' as const, usageScope: ['press'], hasPeople: false, peopleConsent: null };
	it('権利が分かり・取材を許し・人が写っていなければ取材に出せる', () => expect(photoStatus(base)).toBe('press_ok'));
	it('人が写っていて許可があれば取材に出せる。許可が無ければ出せない', () => {
		expect(photoStatus({ ...base, hasPeople: true, peopleConsent: true })).toBe('press_ok');
		expect(photoStatus({ ...base, hasPeople: true, peopleConsent: false })).toBe('checked');
	});
	it('権利が不明・人の写り込みが未確認なら未確認', () => {
		expect(photoStatus({ ...base, rights: 'unknown' })).toBe('unchecked');
		expect(photoStatus({ ...base, hasPeople: null })).toBe('unchecked');
	});
	it('取材・広報を許していなければ確認済み（取材は不可）', () => expect(photoStatus({ ...base, usageScope: ['web'] })).toBe('checked'));
});
