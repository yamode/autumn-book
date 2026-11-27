// アンバサダー会員（招待コード・紹介実績）の純関数。設計: docs/ambassador.md
// DB: autumn-shared 20261127005004_book_ambassador.sql

/** 招待コードを開いたときに入れておくクッキー（30日・最後に開いたものが勝つ） */
export const INVITE_COOKIE = 'ab_invite';
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** 招待コードの形（見間違えやすい 0/O/1/I/L を除く 31 字から 8 字） */
const CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/;

/** 入力・URL から受け取ったコードを揃える（空白・ハイフンを除き大文字）。形が違えば null */
export function normalizeInviteCode(raw: unknown): string | null {
	const s = String(raw ?? '')
		.replace(/[^A-Za-z0-9]/g, '')
		.toUpperCase();
	return CODE_RE.test(s) ? s : null;
}

/** 招待 URL（/invite/<コード>。/r は客室向けのページで使っている） */
export function inviteUrl(origin: string, code: string): string {
	return `${origin.replace(/\/$/, '')}/invite/${code}`;
}

/** 割合の表（[2, 1, 0.5]）を「1年目 2%・2年目 1%・3年目 0.5%・4年目以降 0%」にする */
export function shareRatesText(rates: number[]): string {
	const parts = rates.map((r, i) => `${i + 1}年目 ${trimNum(r)}%`);
	parts.push(`${rates.length + 1}年目以降 0%`);
	return parts.join('・');
}

/** 「2, 1, 0.5」のような入力を割合の配列にする（0〜20・最大10年）。不正なら null */
export function parseShareRates(raw: string): number[] | null {
	const t = raw.trim();
	if (!t) return [];
	const parts = t.split(/[,、\s]+/).filter(Boolean);
	if (parts.length > 10) return null;
	const out: number[] = [];
	for (const p of parts) {
		const n = Number(p.replace(/[%％]/g, ''));
		if (!Number.isFinite(n) || n < 0 || n > 20) return null;
		out.push(Math.round(n * 1000) / 1000);
	}
	// 末尾の 0 は「尽きたら 0」と同じなので落とす
	while (out.length && out[out.length - 1] === 0) out.pop();
	return out;
}

function trimNum(n: number): string {
	return String(Math.round(n * 1000) / 1000);
}

/** apply_invite_code の結果（画面の文言を選ぶため） */
export type InviteApplyStatus = 'linked' | 'ineligible' | 'invalid' | 'already' | 'too_late' | 'not_member' | 'error';

export type ReferralStatus = 'active' | 'ineligible' | 'void';

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
	active: '有効',
	ineligible: '対象外（宿泊歴あり）',
	void: '無効'
};
