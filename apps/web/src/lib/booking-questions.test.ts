import { describe, expect, it } from 'vitest';
import { answerLines, expandQuestions, mergePartnerQuestions, normalizeBookingQuestions, resolveQuestionAnswers, resolveRoomGenders, validateBookingQuestions } from './booking-questions';

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

describe('部屋ごとの項目', () => {
  const qs = normalizeBookingQuestions([
    { id: 'a', label: '記念日', type: 'text' },
    { id: 'b', label: '布団の並び', type: 'select', choices: ['和', '洋'], required: true, scope: 'room' }
  ]);
  it('予約ごと → 部屋ごと（部屋の数だけ・複数室は「n室目」）に並べる', () => {
    expect(expandQuestions(qs, 2).map((q) => [q.key, q.fullLabel])).toEqual([
      ['a', '記念日'],
      ['b@0', '1室目 布団の並び'],
      ['b@1', '2室目 布団の並び']
    ]);
    expect(expandQuestions(qs, 1).map((q) => q.fullLabel)).toEqual(['記念日', '布団の並び']);
  });
  it('部屋ごとの必須は部屋ごとに検証する', () => {
    expect(resolveQuestionAnswers(qs, { 'b@0': '和' }, 2)).toMatchObject({ ok: false });
    const r = resolveQuestionAnswers(qs, { 'b@0': '和', 'b@1': '洋' }, 2);
    expect(r.ok && answerLines(r.values)).toBe('1室目 布団の並び: 和\n2室目 布団の並び: 洋');
  });
});

describe('resolveRoomGenders', () => {
  const get = (o: Record<string, string>) => (k: string) => o[k];
  it('男性の人数から女性を決め、合計を人数に合わせる', () => {
    expect(resolveRoomGenders([2, 3], get({ male_0: '1', male_1: '0' }))).toEqual({ ok: true, rooms: [{ male: 1, female: 1 }, { male: 0, female: 3 }] });
    expect(resolveRoomGenders([2], get({ male_0: '2', female_0: '0' }))).toEqual({ ok: true, rooms: [{ male: 2, female: 0 }] });
  });
  it('未選択・合計違い・不正値は止める', () => {
    expect(resolveRoomGenders([2], get({}))).toMatchObject({ ok: false });
    expect(resolveRoomGenders([2], get({ male_0: '1', female_0: '2' }))).toMatchObject({ ok: false });
    expect(resolveRoomGenders([2], get({ male_0: '3' }))).toMatchObject({ ok: false });
    expect(resolveRoomGenders([2], get({ male_0: 'x' }))).toMatchObject({ ok: false });
  });
});
