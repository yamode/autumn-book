// 取引先予約の予約者・交通手段・特典（PMS への要望の行・台帳・メールの宛先）のテスト。
import { describe, it, expect } from 'vitest';
import { buildBookingExtras, extraOptionRows, extraSummaryLines, partnerMailRecipients, readBookingExtras, splitExtraOptions } from './booking-extras';

const booker = { name: '山田 太郎', kana: 'ヤマダ タロウ', department: '総務部', phone: '03-1234-5678', email: 'yamada@example.com' };
const perk = { id: 'p1', title: 'ウェルカムドリンク', description: 'ロビーで1杯', planCodes: [] };

describe('extraOptionRows', () => {
  it('予約者 → 交通手段 → 取引先特典 の順に並べる', () => {
    const rows = extraOptionRows(buildBookingExtras(booker, 'JR', [perk, { ...perk, id: 'p2', title: '館内利用券 1,000円' }]));
    expect(rows).toEqual([
      { label: '予約者', value: '山田 太郎（総務部） / 03-1234-5678 / yamada@example.com' },
      { label: '交通手段', value: 'JR' },
      { label: '取引先特典', value: 'ウェルカムドリンク／館内利用券 1,000円' }
    ]);
  });

  it('交通手段・特典が無ければ行を足さない', () => {
    expect(extraOptionRows(buildBookingExtras(booker, '', [])).map((r) => r.label)).toEqual(['予約者']);
  });
});

describe('splitExtraOptions / extraSummaryLines', () => {
  const detail = {
    booker,
    transport: 'その他（バス）',
    perks: [{ title: 'ウェルカムドリンク', description: 'ロビーで\n1杯' }],
    options: [
      { label: '予約者', value: '山田 太郎' },
      { label: '交通手段', value: 'その他（バス）' },
      { label: '取引先特典', value: 'ウェルカムドリンク' },
      { label: '送迎', value: 'あり' }
    ]
  };

  it('構造化した値がある行は入力項目から除く', () => {
    expect(splitExtraOptions(detail)).toEqual([{ label: '送迎', value: 'あり' }]);
  });

  it('旧データ（構造化した値が無い）は入力項目をそのまま出す', () => {
    expect(splitExtraOptions({ options: detail.options })).toHaveLength(4);
    expect(readBookingExtras({})).toEqual({ booker: null, transport: '', perks: [] });
  });

  it('メールの行（予約者・交通手段・特典）', () => {
    expect(extraSummaryLines(detail)).toEqual([
      '予約者: 山田 太郎（ヤマダ タロウ） 総務部',
      '予約者の電話: 03-1234-5678',
      '予約者のメール: yamada@example.com',
      '交通手段: その他（バス）',
      '取引先特典: ウェルカムドリンク（ロビーで 1杯）'
    ]);
    expect(extraSummaryLines(null)).toEqual([]);
  });
});

describe('partnerMailRecipients', () => {
  it('予約者を先頭に、重複（大文字小文字違い）・空・不正な形式を除く', () => {
    expect(partnerMailRecipients(['yamada@example.com', 'YAMADA@example.com', null, '', 'not-an-email', 'soumu@example.com'])).toEqual([
      'yamada@example.com',
      'soumu@example.com'
    ]);
  });
});
