import { describe, expect, it } from 'vitest';
import { normalizeStandardFields, resolveStandardFields } from './booking-standard-fields';

describe('毎回聞く項目の文言', () => {
  it('空・未知のキーは捨て、変えた文言だけ残す', () => {
    expect(normalizeStandardFields({ allergies: { label: ' アレルギー ', placeholder: '' }, notes: { label: '', placeholder: '' }, x: { label: 'y' } })).toEqual({
      allergies: { label: 'アレルギー' }
    });
    expect(normalizeStandardFields(null)).toEqual({});
  });
  it('設定が無ければ既定の文言', () => {
    const t = resolveStandardFields({ allergies: { placeholder: '例: そば' } });
    expect(t.allergies).toEqual({ label: '食物アレルギー・苦手な食材', placeholder: '例: そば', help: '', choices: [] });
    expect(t.notes.label).toBe('その他ご要望・備考');
  });
});

describe('補足の説明', () => {
  it('改行を保ち、前後の空白を落とす', () => {
    expect(resolveStandardFields({ allergies: { help: ' 1行目\r\n2行目 ' } }).allergies.help).toBe('1行目\n2行目');
  });
});

describe('お迎え時間の選択肢', () => {
  it('「、」・改行区切りから重複と空を除く。選択肢は pickup だけが持つ', () => {
    const t = resolveStandardFields({ pickup: { choices: '15:10、16:20,\n16:20、 ' }, allergies: { choices: 'x' } });
    expect(t.pickup.choices).toEqual(['15:10', '16:20']);
    expect(t.allergies.choices).toEqual([]);
    expect(t.pickup.label).toBe('お迎えの時間');
  });
});
