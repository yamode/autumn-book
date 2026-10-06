import { describe, expect, it } from 'vitest';
import { answerLines, mergePartnerQuestions, normalizeBookingQuestions, resolveQuestionAnswers, validateBookingQuestions } from './booking-questions';

describe('normalizeBookingQuestions', () => {
  it('不正な値を補い、空の項目名を落とし、id を重ねない', () => {
    const qs = normalizeBookingQuestions([
      { id: 'a', label: ' 送迎 ', type: 'check' },
      { id: 'a', label: '夕食', type: 'select', choices: ['18:00', '18:00', ' 19:00 '] },
      { id: 'b<x>', label: '', type: 'text' },
      { label: '記念日', type: 'weird', choices: ['x'] },
      null
    ]);
    expect(qs.map((q) => [q.id, q.label, q.type, q.choices])).toEqual([
      ['a', '送迎', 'check', []],
      ['a_', '夕食', 'select', ['18:00', '19:00']],
      ['opt-4', '記念日', 'check', []]
    ]);
  });
  it('配列でなければ空', () => {
    expect(normalizeBookingQuestions(null)).toEqual([]);
  });
});

describe('validateBookingQuestions', () => {
  it('選択肢が2つ未満の select は止める', () => {
    expect(validateBookingQuestions(normalizeBookingQuestions([{ id: 'x', label: '夕食', type: 'select', choices: ['18:00'] }]))).toMatch('選択肢');
  });
});

describe('mergePartnerQuestions / resolveQuestionAnswers', () => {
  const plan = normalizeBookingQuestions([{ id: 'o1', label: '夕食時間', type: 'select', choices: ['18:00', '19:00'], required: true }]);
  const partner = normalizeBookingQuestions([{ id: 'o1', label: '社員番号', type: 'text' }]);
  const merged = mergePartnerQuestions(plan, partner);
  it('プラン → 取引先の順で、id が重ならない', () => {
    expect(merged.map((q) => q.id)).toEqual(['p-o1', 'x-o1']);
  });
  it('回答を「項目名: 回答」にする', () => {
    const r = resolveQuestionAnswers(merged, { 'p-o1': '19:00', 'x-o1': 'A-12' });
    expect(r.ok && answerLines(r.values)).toBe('夕食時間: 19:00\n社員番号: A-12');
  });
  it('必須の未回答・選択肢外は止める', () => {
    expect(resolveQuestionAnswers(merged, {})).toMatchObject({ ok: false });
    expect(resolveQuestionAnswers(merged, { 'p-o1': '20:00' })).toMatchObject({ ok: false });
  });
});
