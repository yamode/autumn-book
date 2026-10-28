import { describe, expect, it } from 'vitest';
import { parseBookingForm } from './booking-form';

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe('parseBookingForm: 部屋ごとの部屋タイプ', () => {
  it('room_codes が室数と合えば、部屋ごとに roomCode を持つ', () => {
    const input = parseBookingForm(form({ room_code: 'wa', room_count: '3', room_codes: 'wa,wa,yo', adults_0: '2', adults_1: '2', adults_2: '2' }));
    expect(input.rooms.map((r) => r.roomCode)).toEqual(['wa', 'wa', 'yo']);
  });
  it('room_codes が無ければ従来どおり（同じ部屋タイプ N 室・roomCode は付けない）', () => {
    const input = parseBookingForm(form({ room_code: 'wa', room_count: '2', adults_0: '2', adults_1: '3' }));
    expect(input.rooms).toEqual([{ adults: 2 }, { adults: 3 }]);
    expect(input.roomCode).toBe('wa');
  });
  it('room_codes の数が室数と合わなければ無視する', () => {
    const input = parseBookingForm(form({ room_code: 'wa', room_count: '3', room_codes: 'wa,yo', adults_0: '2', adults_1: '2', adults_2: '2' }));
    expect(input.rooms.every((r) => r.roomCode === undefined)).toBe(true);
  });
});
