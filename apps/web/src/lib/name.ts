// 氏名の正規化（グローバル対応: 姓 family / 名 given / ミドルネーム middle + カナ）。
// 表示用の合成名は「姓 名」（日本語慣習・PMS/Travel XML 用の分離値は別途保持）。
// ミドルネームは構造化フィールドとして保持し、短い表示名には含めない。

export interface StructuredName {
	familyName: string;
	givenName: string;
	middleName?: string;
	familyNameKana?: string;
	givenNameKana?: string;
}

/** 表示用の合成氏名（姓 名）。 */
export function combineName(familyName: string, givenName: string): string {
	return [familyName?.trim(), givenName?.trim()].filter(Boolean).join(' ');
}

/** 表示用の合成カナ（セイ メイ）。 */
export function combineKana(familyKana?: string, givenKana?: string): string {
	return [familyKana?.trim(), givenKana?.trim()].filter(Boolean).join(' ');
}
