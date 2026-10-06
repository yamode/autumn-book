// 取引先の予約画面（/p/[token]/book）のフォームを予約の入力に直す。
// 後払い（form action）とオンライン決済（/book/reserve の API）で同じフォームを送るので、解析を1か所にまとめる。
import { normalizeBooker } from '$lib/partner-booking';
import type { CreateBookingInput } from './booking';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

// 予約時に聞く項目の回答は opt_<id> をすべて拾う（どの項目を聞くかはプラン＋取引先で決まり、検証は createPartnerBooking で行う）。
export function parseBookingForm(fd: FormData): CreateBookingInput {
  const roomCount = Math.min(20, Math.max(1, Math.round(Number(str(fd, 'room_count'))) || 1));
  const rooms = Array.from({ length: roomCount }, (_, i) => ({ adults: Math.round(Number(str(fd, `adults_${i}`))) || 0 }));
  const answers: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('opt_') && typeof v === 'string') answers[k.slice(4)] = v.trim();
  return {
    roomCode: str(fd, 'room_code'),
    planCode: str(fd, 'plan_code'),
    planName: str(fd, 'plan_name'),
    checkIn: str(fd, 'check_in'),
    nights: Math.round(Number(str(fd, 'nights'))) || 1,
    rooms,
    guest: {
      familyName: str(fd, 'family_name'),
      givenName: str(fd, 'given_name'),
      familyNameKana: str(fd, 'family_name_kana'),
      givenNameKana: str(fd, 'given_name_kana'),
      phone: str(fd, 'phone'),
      email: str(fd, 'email'),
      zipCode: str(fd, 'zip_code'),
      address: str(fd, 'address'),
      allergies: str(fd, 'allergies')
    },
    // 予約者（ご担当者）。マイページの既定値をその予約の分だけ編集できる
    booker: normalizeBooker({
      name: str(fd, 'booker_name'),
      kana: str(fd, 'booker_kana'),
      department: str(fd, 'booker_department'),
      phone: str(fd, 'booker_phone'),
      email: str(fd, 'booker_email')
    }),
    saveBooker: fd.get('save_booker') === 'on' || fd.get('save_booker') === '1',
    transport: { id: str(fd, 'transport'), other: str(fd, 'transport_other') },
    arrival: str(fd, 'arrival'),
    notes: str(fd, 'notes'),
    answers,
    paymentOption: str(fd, 'payment_option')
  };
}
