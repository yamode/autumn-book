import { describe, expect, it } from 'vitest';
import { normalizeFieldOrder, normalizeStandardFields, resolveStandardFields } from './booking-standard-fields';

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
    // 交通手段は選択肢の既定（JR・車・その他）、お迎え時間は JR のときに聞く
    expect(t.transport.choices).toEqual(['JR', '車', 'その他']);
    expect(t.transport.required).toBe(false);
    expect(t.pickup.when).toBe('JR');
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

describe('並び順', () => {
  it('既定は 到着予定 → 交通手段 → アレルギー → 追加の項目 → 備考', () => {
    expect(resolveStandardFields({}).order).toEqual(['arrival', 'transport', 'allergies', 'questions', 'notes']);
  });
  it('知らないキー・重複は捨て、足りないキーは後ろに足す。既定と同じなら保存しない', () => {
    expect(normalizeFieldOrder('notes, questions,notes,x')).toEqual(['notes', 'questions', 'arrival', 'transport', 'allergies']);
    expect(normalizeStandardFields({ order: 'notes,arrival' }).order).toEqual(['notes', 'arrival', 'transport', 'allergies', 'questions']);
    expect(normalizeStandardFields({ order: 'arrival,transport,allergies,questions,notes' }).order).toBeUndefined();
  });
});
