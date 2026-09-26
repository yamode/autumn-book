// 取引先の予約画面（/p/[token]/book）のフォームを予約の入力に直す。
// 後払い（form action）とオンライン決済（/book/reserve の API）で同じフォームを送るので、解析を1か所にまとめる。
import type { CreateBookingInput } from './booking';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export function parseBookingForm(fd: FormData, optionIds: string[]): CreateBookingInput {
  const roomCount = Math.min(20, Math.max(1, Math.round(Number(str(fd, 'room_count'))) || 1));
  const rooms = Array.from({ length: roomCount }, (_, i) => ({ adults: Math.round(Number(str(fd, `adults_${i}`))) || 0 }));
  const answers: Record<string, string> = {};
  for (const id of optionIds) answers[id] = str(fd, `opt_${id}`);
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
    arrival: str(fd, 'arrival'),
    notes: str(fd, 'notes'),
    answers,
    paymentOption: str(fd, 'payment_option')
  };
}
