import { describe, expect, it } from 'vitest';
import { answersFromForm, missingGender, missingQuestion, normalizeQuestion } from './precheckin';

const fd = (pairs: [string, string][]) => {
	const f = new FormData();
	for (const [k, v] of pairs) f.append(k, v);
	return f;
};

describe('男女人数（2026-11-28）', () => {
	it('部屋ごとに受け取る', () => {
		const a = answersFromForm(
			fd([
				['g|s1|male', '1'],
				['g|s1|female', '2'],
				['g|s2|male', '0'],
				['g|s2|female', '1']
			]),
			'ja'
		);
		expect(a.gender).toEqual([
			{ stay_id: 's1', male: 1, female: 2 },
			{ stay_id: 's2', male: 0, female: 1 }
		]);
	});
	it('空欄は -1（未入力）', () => {
		const a = answersFromForm(fd([['g|s1|male', ''], ['g|s1|female', '2']]), 'ja');
		expect(a.gender).toEqual([{ stay_id: 's1', male: -1, female: 2 }]);
	});
	it('足りない部屋を返す', () => {
		const rooms = [{ stayId: 's1' }, { stayId: 's2' }];
		expect(missingGender(rooms, [{ stay_id: 's1', male: 1, female: 0 }])).toBe('s2');
		expect(missingGender(rooms, [{ stay_id: 's1', male: 1, female: 0 }, { stay_id: 's2', male: 0, female: 0 }])).toBe('s2');
		expect(missingGender(rooms, [{ stay_id: 's1', male: -1, female: 1 }, { stay_id: 's2', male: 0, female: 1 }])).toBe('s1');
		expect(missingGender(rooms, [{ stay_id: 's1', male: 1, female: 1 }, { stay_id: 's2', male: 0, female: 2 }])).toBeNull();
	});
});

describe('宿からの質問の形式（2026-11-28）', () => {
	it('選択肢形式は選択肢を持つ・自由記入は持たない', () => {
		expect(normalizeQuestion({ id: 'q', question: '交通手段', kind: 'choice', options: [' お車 ', '', '電車'] })).toEqual({
			id: 'q',
			question: '交通手段',
			note: '',
			kind: 'choice',
			options: ['お車', '電車']
		});
		expect(normalizeQuestion({ id: 'q', question: '何か', options: ['x'] })).toEqual({ id: 'q', question: '何か', note: '', kind: 'text', options: [] });
		// 補足説明（質問文の下に小さく出す）
		expect(normalizeQuestion({ id: 'q', question: '何か', note: ' 補足です ' }).note).toBe('補足です');
	});
	it('選択肢形式は選択肢にない答えを未回答として扱う', () => {
		const qs = [{ id: 'q', question: '交通手段', kind: 'choice' as const, options: ['お車', '電車'] }];
		expect(missingQuestion(qs, [{ id: 'q', answer: 'お車' }])).toBeNull();
		expect(missingQuestion(qs, [{ id: 'q', answer: '徒歩' }])).toBe('q');
		expect(missingQuestion(qs, [])).toBe('q');
	});
});
