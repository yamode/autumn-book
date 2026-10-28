// 取引先予約の「お部屋」の表示（複数部屋タイプの予約 P2・docs/partner-multi-room-type.md）。
//   1 予約（1 つのプラン）に部屋ごとに違う部屋タイプを持てる（P1・autumn-shared 20261028125440）。
//   台帳の room_code / room_name / room_count は「1 室目（代表）」の値なので、そのまま「× N室」と出すと
//   「メゾネット × 4室」のように最初の部屋タイプだけになる。部屋ごとの部屋タイプは detail.rooms[i]
//   （予約時に RPC へ渡した rooms・room_code / room_name つき）か、部屋ごとの行 rms_partner_booking_rooms にある。
//   ここでは部屋の並びから「部屋タイプ別の室数」を作り、一覧・詳細・メール・請求書で同じ文言にする。
//   P1 より前の予約（detail.rooms に room_code が無い）は全室が代表の部屋タイプ＝従来どおり。

/** 1 室の部屋タイプ（部屋の順＝room_index の順） */
export type PartnerRoomTypeOfRoom = { code: string; name: string };

/** 部屋タイプ別の室数（最初に出てきた順） */
export type PartnerRoomTypeCount = { code: string; name: string; count: number };

/** 台帳の行のうち、部屋の並びを作るのに読む列 */
export type PartnerRoomTypeSource = {
  room_code?: string | null;
  room_name: string | null;
  room_count: number;
  detail?: { rooms?: unknown } | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * 部屋ごとの部屋タイプ（部屋の順）。detail.rooms[i] の room_code / room_name を使い、無ければ代表の部屋タイプ。
 * 部屋の数は detail.rooms の長さ（無ければ room_count）。
 */
export function partnerRoomTypesOf(b: PartnerRoomTypeSource): PartnerRoomTypeOfRoom[] {
  const baseCode = str(b.room_code);
  const baseName = str(b.room_name) || baseCode;
  const rooms = Array.isArray(b.detail?.rooms) ? (b.detail!.rooms as unknown[]) : [];
  const n = rooms.length || Math.max(1, b.room_count || 1);
  return Array.from({ length: n }, (_, i) => {
    const r = (rooms[i] ?? {}) as { room_code?: unknown; room_name?: unknown };
    const code = str(r.room_code) || baseCode;
    // 部屋の名前は部屋ごとの値 → 代表と同じ部屋タイプなら代表の名前 → コード
    const name = str(r.room_name) || (code === baseCode ? baseName : '') || code;
    return { code, name };
  });
}

/** 部屋の並び（部屋ごとの行など）から部屋タイプ別の室数を作る（最初に出てきた順） */
export function countRoomTypes(rooms: PartnerRoomTypeOfRoom[]): PartnerRoomTypeCount[] {
  const out: PartnerRoomTypeCount[] = [];
  for (const r of rooms) {
    const key = r.code || r.name;
    const hit = out.find((x) => (x.code || x.name) === key);
    if (hit) hit.count += 1;
    else out.push({ code: r.code, name: r.name, count: 1 });
  }
  return out;
}

/** 台帳の行から部屋タイプ別の室数 */
export const partnerRoomTypeCounts = (b: PartnerRoomTypeSource): PartnerRoomTypeCount[] => countRoomTypes(partnerRoomTypesOf(b));

/** 部屋タイプが 2 つ以上の予約か */
export const isMixedRoomTypes = (b: PartnerRoomTypeSource): boolean => partnerRoomTypeCounts(b).length > 1;

/**
 * 「お部屋」の文言。1 つの部屋タイプなら従来どおり「和室 × 2室」、
 * 複数部屋タイプなら「メゾネット × 2室／ハリウッドツイン麓花坊 × 1室」。
 * sep: 部屋タイプの区切り（紙面・メールは既定の「／」）。joiner: 名前と室数の間（請求書の紙面は ' '）
 */
export function roomTypeCountsText(counts: Pick<PartnerRoomTypeCount, 'name' | 'count'>[], opts: { sep?: string; joiner?: string } = {}): string {
  const joiner = opts.joiner ?? ' × ';
  return counts.map((c) => `${c.name}${joiner}${c.count}室`).join(opts.sep ?? '／');
}

/** 台帳の行の「お部屋」の文言（roomTypeCountsText の台帳版） */
export const partnerRoomsText = (b: PartnerRoomTypeSource, opts: { sep?: string; joiner?: string } = {}): string =>
  roomTypeCountsText(partnerRoomTypeCounts(b), opts);

/**
 * 「N室目」の見出しに添える部屋タイプ名（複数部屋タイプの予約だけ。1 つの部屋タイプなら ''）。
 * 例: 人数の行「1室目（メゾネット）2名」
 */
export function roomTypeLabelsByIndex(b: PartnerRoomTypeSource): string[] {
  const rooms = partnerRoomTypesOf(b);
  const mixed = countRoomTypes(rooms).length > 1;
  return rooms.map((r) => (mixed ? r.name : ''));
}
