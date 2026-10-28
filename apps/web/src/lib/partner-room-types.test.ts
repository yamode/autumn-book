// 取引先予約の「お部屋」（部屋タイプ別の室数・複数部屋タイプ P2）の純関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  countRoomTypes,
  isMixedRoomTypes,
  partnerRoomsText,
  partnerRoomTypeCounts,
  partnerRoomTypesOf,
  roomTypeCountsText,
  roomTypeLabelsByIndex
} from './partner-room-types';

// 2027-01-12 の実測と同じ形（メゾネット 2・ハリウッドツイン麓花坊 1・ハリウッドツイン麓樹坊 1）。台帳の代表は1室目
const mixed = {
  room_code: 'm',
  room_name: 'メゾネット',
  room_count: 4,
  detail: {
    rooms: [
      { adults: 2, room_code: 'm', room_name: 'メゾネット', nights: [] },
      { adults: 2, room_code: 'h1', room_name: 'ハリウッドツイン麓花坊', nights: [] },
      { adults: 2, room_code: 'm', room_name: 'メゾネット', nights: [] },
      { adults: 2, room_code: 'h2', room_name: 'ハリウッドツイン麓樹坊', nights: [] }
    ]
  }
};

describe('partnerRoomTypeCounts', () => {
  it('複数部屋タイプは部屋タイプ別の室数（最初に出てきた順）', () => {
    expect(partnerRoomTypeCounts(mixed)).toEqual([
      { code: 'm', name: 'メゾネット', count: 2 },
      { code: 'h1', name: 'ハリウッドツイン麓花坊', count: 1 },
      { code: 'h2', name: 'ハリウッドツイン麓樹坊', count: 1 }
    ]);
    expect(isMixedRoomTypes(mixed)).toBe(true);
  });
  it('P1 より前の予約（detail.rooms に部屋タイプが無い）は全室が代表の部屋タイプ', () => {
    const old = { room_code: 'wa', room_name: '和室', room_count: 2, detail: { rooms: [{ adults: 2 }, { adults: 3 }] } };
    expect(partnerRoomTypeCounts(old)).toEqual([{ code: 'wa', name: '和室', count: 2 }]);
    expect(isMixedRoomTypes(old)).toBe(false);
  });
  it('detail.rooms が無ければ room_count 室', () => {
    expect(partnerRoomTypeCounts({ room_code: 'wa', room_name: '和室', room_count: 3, detail: null })).toEqual([{ code: 'wa', name: '和室', count: 3 }]);
    expect(partnerRoomTypesOf({ room_code: null, room_name: null, room_count: 0 })).toEqual([{ code: '', name: '' }]);
  });
  it('部屋ごとの名前が無い部屋はコード（代表と同じコードなら代表の名前）', () => {
    const b = { room_code: 'wa', room_name: '和室', room_count: 2, detail: { rooms: [{ adults: 2, room_code: 'wa' }, { adults: 2, room_code: 'yo' }] } };
    expect(partnerRoomTypesOf(b)).toEqual([
      { code: 'wa', name: '和室' },
      { code: 'yo', name: 'yo' }
    ]);
  });
});

describe('文言', () => {
  it('複数部屋タイプは「名前 × N室」を／でつなぐ', () => {
    expect(partnerRoomsText(mixed)).toBe('メゾネット × 2室／ハリウッドツイン麓花坊 × 1室／ハリウッドツイン麓樹坊 × 1室');
    expect(partnerRoomsText(mixed, { joiner: ' ' })).toBe('メゾネット 2室／ハリウッドツイン麓花坊 1室／ハリウッドツイン麓樹坊 1室');
  });
  it('1つの部屋タイプは従来どおり「和室 × 2室」', () => {
    expect(partnerRoomsText({ room_code: 'wa', room_name: '和室', room_count: 2, detail: { rooms: [{ adults: 2 }, { adults: 2 }] } })).toBe('和室 × 2室');
  });
  it('roomTypeCountsText / countRoomTypes（部屋ごとの行から）', () => {
    const counts = countRoomTypes([
      { code: 'a', name: 'A' },
      { code: 'b', name: 'B' },
      { code: 'a', name: 'A' }
    ]);
    expect(counts).toEqual([
      { code: 'a', name: 'A', count: 2 },
      { code: 'b', name: 'B', count: 1 }
    ]);
    expect(roomTypeCountsText(counts, { sep: '・' })).toBe('A × 2室・B × 1室');
  });
  it('N室目に添える部屋タイプ名は複数部屋タイプのときだけ', () => {
    expect(roomTypeLabelsByIndex(mixed)).toEqual(['メゾネット', 'ハリウッドツイン麓花坊', 'メゾネット', 'ハリウッドツイン麓樹坊']);
    expect(roomTypeLabelsByIndex({ room_code: 'wa', room_name: '和室', room_count: 2, detail: null })).toEqual(['', '']);
  });
});
