// 客室案内フッターの SNS ボタン（施設ごとの URL）。DB は autumn-shared 20260929120000（book.facility_sns_links）。
export const SNS_KINDS = ['instagram', 'x', 'facebook', 'line', 'youtube', 'tiktok'] as const;
export type SnsKind = (typeof SNS_KINDS)[number];
export type SnsLinks = Partial<Record<SnsKind, string>>;

export const SNS_LABEL: Record<SnsKind, string> = {
	instagram: 'Instagram',
	x: 'X（旧Twitter）',
	facebook: 'Facebook',
	line: 'LINE',
	youtube: 'YouTube',
	tiktok: 'TikTok'
};

/** 未知のキー・https 以外・空は落とす（DB にも同じ検査がある） */
export function normalizeSnsLinks(raw: unknown): SnsLinks {
	const out: SnsLinks = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const k of SNS_KINDS) {
		const v = String((raw as Record<string, unknown>)[k] ?? '').trim();
		if (/^https:\/\/[^\s<>"']+$/i.test(v) && v.length <= 500) out[k] = v;
	}
	return out;
}
