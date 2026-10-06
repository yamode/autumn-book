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
    expect(t.allergies).toEqual({ label: '食物アレルギー・苦手な食材', placeholder: '例: そば' });
    expect(t.notes.label).toBe('その他ご要望・備考');
  });
});
