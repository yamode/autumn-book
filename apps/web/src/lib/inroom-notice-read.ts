// 客室案内の全客室へのお知らせの既読（端末ごと・localStorage）。2026-10-17 指示。
// いちど「確認しました」を押した端末には、同じお知らせを次から出さない。
// localStorage が使えない（プライベートブラウズ等）ときは既読を覚えられないだけで、画面は落とさない。

export const NOTICE_READ_KEY = 'ab_inroom_notices_read';
// 覚えておく既読の数（古いものから捨てる）
const MAX_READ = 100;

export function parseReadIds(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}

export function unreadNotices<T extends { id: string }>(notices: T[], readIds: string[]): T[] {
	const read = new Set(readIds);
	return notices.filter((n) => !read.has(n.id));
}

// 既読に足す（重複は除き、新しいものを後ろへ。上限を超えたら古いものから捨てる）
export function addReadIds(readIds: string[], ids: string[]): string[] {
	const add = new Set(ids);
	return [...readIds.filter((id) => !add.has(id)), ...ids].slice(-MAX_READ);
}

export function loadReadIds(): string[] {
	try {
		return parseReadIds(localStorage.getItem(NOTICE_READ_KEY));
	} catch {
		return [];
	}
}

export function saveReadIds(ids: string[]): void {
	try {
		localStorage.setItem(NOTICE_READ_KEY, JSON.stringify(ids));
	} catch {
		// 保存できない端末は、このページを開いている間だけ閉じる
	}
}
