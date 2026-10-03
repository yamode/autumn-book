import { describe, expect, it } from 'vitest';
import { buildPlanTerms, cancellationRows, childrenTerms } from './partner-plan-terms';

describe('cancellationRows', () => {
  it('日数の多い順・0% は出さない・前日／当日の呼び方・不泊は最後', () => {
    const rules = [
      { days_before: 0, rate_percent: 100 },
      { days_before: 15, rate_percent: 0 },
      { days_before: 14, rate_percent: 10 },
      { days_before: 1, rate_percent: 80 }
    ];
    expect(cancellationRows(rules, 100)).toEqual([
      { label: '14日前から', value: '10%' },
      { label: '前日から', value: '80%' },
      { label: '当日から', value: '100%' },
      { label: '不泊', value: '100%' }
    ]);
  });
});

describe('childrenTerms', () => {
  it('子供不可は区分の表、ファミリーは案内文、知らないコードは何も出さない', () => {
    expect(childrenTerms('子供不可').rows.length).toBeGreaterThan(0);
    expect(childrenTerms('ファミリー')).toEqual({ rows: [], note: expect.stringContaining('お子様連れ') });
    expect(childrenTerms('')).toEqual({ rows: [], note: '' });
  });
});

describe('buildPlanTerms', () => {
  it('プラン個別の規定が空なら施設の既定を使う', () => {
    const m = buildPlanTerms({
      plans: [
        { plan_code: 'a003', plan_label: '基本■2食■スタンダード(+20350円)', cancellation_policy: [], child_policy_code: '子供不可' },
        { plan_code: 'a009', plan_label: '特別', cancellation_policy: [{ days_before: 3, rate_percent: 50 }], child_policy_code: 'ファミリー' }
      ],
      default_cancellation: { rules: [{ days_before: 1, rate_percent: 80 }], no_show_rate_percent: 100, body: '' }
    });
    expect(m.get('a003■基本■2食■スタンダード(+20350円)')?.cancellation).toEqual([
      { label: '前日から', value: '80%' },
      { label: '不泊', value: '100%' }
    ]);
    expect(m.get('a009■特別')?.cancellation).toEqual([{ label: '3日前から', value: '50%' }]);
  });
  it('施設のお子様設定があれば全プラン共通でそれを出す（区分コードより優先）', () => {
    const m = buildPlanTerms({
      plans: [{ plan_code: 'a003', plan_label: 'L', cancellation_policy: [], child_policy_code: '子供不可' }],
      default_cancellation: null,
      child_policy: { rows: [{ label: '小学生高学年', value: '大人料金の70%' }, { label: '', value: 'x' }], note: '添い寝は2名まで' }
    });
    expect(m.get('a003■L')?.children).toEqual([{ label: '小学生高学年', value: '大人料金の70%' }]);
    expect(m.get('a003■L')?.childrenNote).toBe('添い寝は2名まで');
  });
  it('施設のお子様設定が空なら区分コードから', () => {
    const m = buildPlanTerms({ plans: [{ plan_code: 'a', plan_label: 'L', child_policy_code: 'ファミリー' }], child_policy: { rows: [], note: '' } });
    expect(m.get('a■L')?.childrenNote).toContain('お子様連れ');
  });
  it('壊れた入力でも落ちない', () => {
    expect(buildPlanTerms(null).size).toBe(0);
  });
});
