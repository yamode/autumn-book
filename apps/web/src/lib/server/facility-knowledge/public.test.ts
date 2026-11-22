// 施設ナレッジの外部向け API（段階5）: 施設名・scope の受け付けと、返す中身の絞り込み
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { knowledgeFacility, parseScope, shapeKnowledge, type UsableRow } from './public';
import { isMaintenanceBypassed } from '../maintenance';

const row = (o: Partial<UsableRow>): UsableRow => ({
	kind: 'fact',
	id: crypto.randomUUID(),
	topic: 'parking',
	title: null,
	body: 'あり（無料・12台）',
	visibility: 'public',
	valid_from: null,
	valid_until: null,
	verified_at: '2026-11-22T00:00:00Z',
	...o
});

describe('施設名と scope', () => {
	it('nishiwaga と、プレスリリースの掲載先タグ yamado は同じ施設', () => {
		expect(knowledgeFacility('yamado')?.uuid).toBe(knowledgeFacility('nishiwaga')?.uuid);
		expect(knowledgeFacility('oga')?.name).toBe('山人-oga-');
		expect(knowledgeFacility('toString')).toBeNull();
	});
	it('scope の既定は press。internal は受け付けない', () => {
		expect(parseScope(null)).toBe('press');
		expect(parseScope('public')).toBe('public');
		expect(parseScope('internal')).toBeNull();
	});
});

describe('shapeKnowledge', () => {
	const f = { slug: 'nishiwaga', name: '山人-yamado-' };
	const rows = [
		row({ topic: 'meal.chef', body: '料理長 及川一久', visibility: 'press' }),
		row({}),
		row({ topic: 'basic.official_name', body: '山人-yamado-' }),
		row({ topic: 'x', visibility: 'internal' }),
		row({ topic: 'y', verified_at: null }),
		row({ kind: 'story', id: 's1', topic: 'experience', title: '雪あかり', body: '1〜3月はほぼ毎晩灯す', valid_until: '2027-03-31' })
	];
	it('press では取材向けまで返し、社内のみ・未承認は返さない', () => {
		const out = shapeKnowledge(f, 'press', rows, { s1: ['winter'] }, new Date('2026-11-22T03:00:00Z'));
		expect(out.facts.map((x) => x.key)).toEqual(['basic.official_name', 'parking', 'meal.chef']);
		expect(out.stories).toEqual([
			{ topic: 'experience', topic_label: '体験', title: '雪あかり', body: '1〜3月はほぼ毎晩灯す', visibility: 'public', seasons: ['winter'], seasons_label: '冬', valid_until: '2027-03-31' }
		]);
		expect(out.as_of).toBe('2026-11-22');
		expect(out.note).toMatch(/料金・空室は含みません/);
	});
	it('public では取材向け（料理長名）も返さない', () => {
		const out = shapeKnowledge(f, 'public', rows, {});
		expect(out.facts.some((x) => x.key === 'meal.chef')).toBe(false);
	});
	it('事実の見出しは画面と同じ日本語', () => {
		const out = shapeKnowledge(f, 'press', [row({})], {});
		expect(out.facts[0]).toMatchObject({ key: 'parking', label: '駐車場', value: 'あり（無料・12台）' });
	});
});

describe('メンテナンス中も API は動く', () => {
	it('/api/knowledge/ はポータルの公開状況と関係なく通す（ルートの中で鍵を確かめる）', () => {
		const event = { url: new URL('https://book.yamado.app/api/knowledge/nishiwaga'), locals: { user: null }, cookies: { get: () => undefined, set: () => {} } };
		expect(isMaintenanceBypassed(event as never)).toBe(true);
	});
});
