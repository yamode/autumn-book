// 旧 tripla マイページへの動線の表示状態（docs/launch-tripla-cutover.md §3・§5）。
// リンク先（LEGACY_MYPAGE_URL*）が空なら段を出さない。LEGACY_MYPAGE_UNTIL を過ぎたら「終了しました」に変わる。
// BOOK_LAUNCH_DATE より前は「現在の予約システム」、以後は「以前の予約システム」の言い回しにする。

export type LegacyFacility = 'nishiwaga' | 'oga';

export type LegacyMypageLink = { facility: LegacyFacility; url: string };

export type LegacyMypageState =
	| { kind: 'hidden' }
	| { kind: 'ended' }
	| { kind: 'active'; phase: 'current' | 'former'; links: LegacyMypageLink[] };

export type LegacyMypageConfig = {
	/** 両施設共通のリンク先（施設別が空のときの代わり） */
	url?: string;
	urlNishiwaga?: string;
	urlOga?: string;
	/** 「YYYY-MM-DD」。この日を過ぎたら終了（当日はまだ表示）。空なら期限なし */
	until?: string;
	/** 「YYYY-MM-DD」。この日から「以前の予約システム」。空なら常に「以前の」 */
	launchDate?: string;
};

/** 日本時間の日付（YYYY-MM-DD）。 */
export function jstDate(now: Date): string {
	return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** https の URL だけ通す（設定ミスで javascript: などを描かない）。 */
export function safeHttpsUrl(value: string | undefined): string {
	const v = (value ?? '').trim();
	if (!v) return '';
	try {
		const u = new URL(v);
		return u.protocol === 'https:' ? u.toString() : '';
	} catch {
		return '';
	}
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function legacyMypageState(now: Date, config: LegacyMypageConfig): LegacyMypageState {
	const common = safeHttpsUrl(config.url);
	const nishiwaga = safeHttpsUrl(config.urlNishiwaga) || common;
	const oga = safeHttpsUrl(config.urlOga) || common;
	if (!nishiwaga && !oga) return { kind: 'hidden' };

	const today = jstDate(now);
	const until = (config.until ?? '').trim();
	if (DATE_RE.test(until) && today > until) return { kind: 'ended' };

	const launch = (config.launchDate ?? '').trim();
	const phase = DATE_RE.test(launch) && today < launch ? 'current' : 'former';

	const links: LegacyMypageLink[] = [];
	if (nishiwaga) links.push({ facility: 'nishiwaga', url: nishiwaga });
	if (oga) links.push({ facility: 'oga', url: oga });
	return { kind: 'active', phase, links };
}
