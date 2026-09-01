// 貸切風呂の予約フォーム（/r/bath）の編集できる中身。**純関数だけ**。
//
// 「決まった欄を埋める形」（2026-08-31 決定）。自由なブロックを並べる形にしなかったのは、
// 枠選択の UI との位置関係を編集のたびに決め直すことになるため。
//
// ★ **未入力の欄はアプリの既定文言（Paraglide）がそのまま出る。**
//   施設が何も入れていない状態＝これまでと同じ画面。入れた欄だけが差し替わる。

/** 編集できる欄。増やすときはここと管理画面のラベルだけを足す（DB は jsonb なので変更不要）。 */
export const BATH_CONTENT_FIELDS = [
	{ key: 'title', label: '見出し', hint: '画面のいちばん上。未入力なら「貸切風呂のご予約」' },
	{ key: 'lead', label: '説明文', hint: '見出しの下。未入力なら「ご希望の時間をお選びください。」' },
	{ key: 'price_note', label: '料金の注記', hint: '料金の行に添える一言。未入力なら金額だけを出す' },
	{ key: 'notice', label: '注意事項', hint: 'ご予約中の時間の下。未入力なら電話予約の注意文' },
	{ key: 'done', label: '完了メッセージ', hint: '予約できたときの一行。未入力なら「ご予約を承りました。」' }
] as const;

export type BathContentKey = (typeof BATH_CONTENT_FIELDS)[number]['key'];
export type BathContentFields = Partial<Record<BathContentKey, string>>;

export type BathContentImage = {
	url: string;
	caption: string;
	sort: number;
};

export type BathContent = {
	fields: BathContentFields;
	images: BathContentImage[];
};

export const EMPTY_BATH_CONTENT: BathContent = { fields: {}, images: [] };

const KEYS = BATH_CONTENT_FIELDS.map((f) => f.key) as readonly string[];

/** 保存値・RPC の戻りを、必ず使える形に整える。知らないキー・壊れた写真は落とす。 */
export function normalizeBathContent(v: unknown): BathContent {
	const o = (v ?? {}) as Record<string, unknown>;
	const rawFields = (o.fields ?? {}) as Record<string, unknown>;
	const fields: BathContentFields = {};
	for (const k of KEYS) {
		const s = String(rawFields[k] ?? '').trim();
		if (s) fields[k as BathContentKey] = s;
	}

	const rawImages = Array.isArray(o.images) ? o.images : [];
	const images: BathContentImage[] = rawImages
		.map((x, i) => {
			const r = (x ?? {}) as Record<string, unknown>;
			const url = String(r.url ?? '').trim();
			if (!url) return null;
			const sortRaw = Number(r.sort);
			return {
				url,
				caption: String(r.caption ?? '').trim(),
				sort: Number.isFinite(sortRaw) ? sortRaw : i
			};
		})
		.filter((x): x is BathContentImage => x !== null)
		.sort((a, b) => a.sort - b.sort)
		.slice(0, 12)
		.map((x, i) => ({ ...x, sort: i })); // 並べ替え後に振り直す（保存のたびに詰める）

	return { fields, images };
}

/** その欄の文字（未入力なら null）。画面側は null のとき既定文言を出す。 */
export function bathField(c: BathContent, key: BathContentKey): string | null {
	return c.fields[key] ?? null;
}
