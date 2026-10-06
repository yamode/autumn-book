import { describe, expect, it } from 'vitest';
import { bookingNameHolderText, bookingNameLine, ilikeContainsPattern, isPmsPartnerGuestType, legalFormPosition, normalizeBookingNameMode, pmsGuestFormalName, pmsGuestUrl, withLegalForm } from './pms-partner-guest';

describe('withLegalForm', () => {
  it('前株・後株で法人格の位置が変わる', () => {
    expect(withLegalForm('JTB', '株式会社', 'prefix')).toBe('株式会社JTB');
    expect(withLegalForm('山人', '株式会社', 'suffix')).toBe('山人株式会社');
  });
  it('位置が未設定・不明なら前株', () => {
    expect(withLegalForm('JTB', '株式会社', null)).toBe('株式会社JTB');
    expect(withLegalForm('JTB', '株式会社', 'xxx')).toBe('株式会社JTB');
  });
  it('法人格が空なら素の名前、素の名前が空なら空', () => {
    expect(withLegalForm(' JTB ', '', 'prefix')).toBe('JTB');
    expect(withLegalForm('', '株式会社', 'prefix')).toBe('');
    expect(withLegalForm(null, null, null)).toBe('');
  });
});

describe('legalFormPosition', () => {
  it('suffix だけ後株、それ以外は前株', () => {
    expect(legalFormPosition(' suffix ')).toBe('suffix');
    expect(legalFormPosition('prefix')).toBe('prefix');
    expect(legalFormPosition(undefined)).toBe('prefix');
  });
});

describe('pmsGuestFormalName', () => {
  it('旅行会社・法人は corporate_name を基にする', () => {
    expect(pmsGuestFormalName({ guest_type: 'group', name: '担当 太郎', corporate_name: 'JTB', legal_form: '株式会社', legal_form_position: 'prefix' })).toBe('株式会社JTB');
    expect(pmsGuestFormalName({ guest_type: 'corporate', name: 'x', corporate_name: '山人', legal_form: '株式会社', legal_form_position: 'suffix' })).toBe('山人株式会社');
  });
  it('corporate_name が無ければ name', () => {
    expect(pmsGuestFormalName({ guest_type: 'group', name: 'JTB', corporate_name: ' ', legal_form: '株式会社' })).toBe('株式会社JTB');
  });
  it('個人は name をそのまま', () => {
    expect(pmsGuestFormalName({ guest_type: 'individual', name: '山田 太郎', corporate_name: 'X' })).toBe('山田 太郎');
  });
});

describe('isPmsPartnerGuestType', () => {
  it('旅行会社・法人だけ', () => {
    expect(isPmsPartnerGuestType('group')).toBe(true);
    expect(isPmsPartnerGuestType('corporate')).toBe(true);
    expect(isPmsPartnerGuestType('individual')).toBe(false);
    expect(isPmsPartnerGuestType(null)).toBe(false);
  });
});

describe('ilikeContainsPattern', () => {
  it('部分一致のパターンにする', () => {
    expect(ilikeContainsPattern(' JTB ')).toBe('%JTB%');
  });
  it('% _ \\ をエスケープする', () => {
    expect(ilikeContainsPattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%');
  });
  it('半角括弧・カンマはそのまま（列ごとの .ilike() なので壊れない）', () => {
    expect(ilikeContainsPattern('ABC(東京),支店')).toBe('%ABC(東京),支店%');
  });
  it('空白だけなら空', () => {
    expect(ilikeContainsPattern('   ')).toBe('');
  });
});

describe('pmsGuestUrl', () => {
  it('PMS の顧客カルテの URL', () => {
    expect(pmsGuestUrl('abc')).toBe('https://autumn-pms.yamado.app/guests/abc');
  });
});

describe('予約名義（Phase 2）', () => {
  it('normalizeBookingNameMode は partner 以外を guest にする', () => {
    expect(normalizeBookingNameMode('partner')).toBe('partner');
    expect(normalizeBookingNameMode('guest')).toBe('guest');
    expect(normalizeBookingNameMode('PARTNER')).toBe('guest');
    expect(normalizeBookingNameMode(null)).toBe('guest');
    expect(normalizeBookingNameMode(undefined)).toBe('guest');
  });

  it('bookingNameHolderText は名義人と部屋の宿泊者名を1行にする', () => {
    expect(bookingNameHolderText('株式会社JTB', '山田 太郎')).toBe('株式会社JTB（お部屋の宿泊者名: 山田 太郎 様）');
    // 空白のゆれは1つにまとめる
    expect(bookingNameHolderText(' 株式会社JTB ', '  山田　 太郎 ')).toBe('株式会社JTB（お部屋の宿泊者名: 山田 太郎 様）');
    expect(bookingNameHolderText('株式会社JTB', '')).toBe('株式会社JTB');
    expect(bookingNameHolderText('', '山田 太郎')).toBe('');
    expect(bookingNameHolderText(null, null)).toBe('');
  });

  it('bookingNameLine は partner のときだけ行を返す', () => {
    expect(bookingNameLine('partner', '株式会社JTB', '山田 太郎')).toBe('ご予約名義: 株式会社JTB（お部屋の宿泊者名: 山田 太郎 様）');
    expect(bookingNameLine('guest', '株式会社JTB', '山田 太郎')).toBeNull();
    expect(bookingNameLine(null, '株式会社JTB', '山田 太郎')).toBeNull();
  });

  it('bookingNameLine は名義人が読めなければ fallback（取引先名）を使い、それも無ければ null', () => {
    expect(bookingNameLine('partner', null, '山田 太郎', 'JTB 盛岡支店')).toBe('ご予約名義: JTB 盛岡支店（お部屋の宿泊者名: 山田 太郎 様）');
    expect(bookingNameLine('partner', '', '山田 太郎', '')).toBeNull();
  });
});
