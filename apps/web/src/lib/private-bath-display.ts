// 貸切風呂のご予約画面（/r/bath・完了画面）に出す「お名前」「お部屋」の組み立て。**純関数だけ**（2026-10-28 指示）。
//
// ■ お名前
//   PMS の館内図で選んだ表示（自動＝部屋ごとの顧客名→予約者名／予約者名／ツアー名）を、トークン発行時に
//   book.stay_access_tokens.display_name / display_kind へ保存している（autumn-shared 20261028085551）。
//   ・display_kind='guest' … お客様名。敬称（日本語の「様」）を付ける
//   ・display_kind='tour'  … ツアー名。敬称を付けない（「〇〇ツアー 様」にしない）
//   ・display_name が無い（旧トークン・migration 前の DB）… 今までどおり guest_name を敬称付きで出す
//
// ■ お部屋
//   「部屋名（部屋番号）」。番号だけをカッコで添え、「号室」「Room」は付けない（2026-10-28 訂正）。
//   日本語・繁体字は全角カッコ（落の蘆（201））、英語は半角（Ochi no Ro (201)）。
//   英語は部屋マスタの英語名、無ければ日本語の部屋名。番号が無い・部屋名と同じなら部屋名だけ。
//   新しい項目（room_label / room_number / room_name_en）が来ない古い DB・見本の滞在は room_code のまま。

export type BathNameSource = {
	guest_name?: string | null;
	display_name?: string | null;
	display_kind?: string | null;
};

export type BathRoomSource = {
	room_code?: string | null;
	room_label?: string | null;
	room_number?: string | null;
	room_name_en?: string | null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 画面に出すお名前。honorific=true のときは呼び出し側で敬称のメッセージに通す。出す名前が無ければ null。 */
export function bathGuestDisplay(ctx: BathNameSource): { name: string; honorific: boolean } | null {
	const display = str(ctx.display_name);
	if (display) return { name: display, honorific: ctx.display_kind !== 'tour' };
	const guest = str(ctx.guest_name);
	return guest ? { name: guest, honorific: true } : null;
}

/** 画面に出すお部屋（言語に合わせた部屋名＋カッコ書きの部屋番号）。 */
export function bathRoomDisplay(ctx: BathRoomSource, locale: string): string {
	const label = str(ctx.room_label);
	const code = str(ctx.room_code);
	const en = locale === 'en' ? str(ctx.room_name_en) : '';
	const name = en || label || code;
	const number = str(ctx.room_number);
	// 新しい項目が来ない（古い DB・見本）ときは、トークンの部屋名をそのまま出す
	if (!label && !en) return code || number;
	if (!number || number === name) return name;
	return locale === 'en' ? `${name} (${number})` : `${name}（${number}）`;
}
