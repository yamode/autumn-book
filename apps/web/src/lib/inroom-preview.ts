// 管理画面のプレビュー（/admin/inroom/preview）で、お知らせと全館の湯量を本物の設定とは別に試す見本（2026-10-17 指示
// 「客室への案内メッセージ・全館の湯量も、デモページで独立して設定できるように」）。
// preview/open が Cookie に置き、客室案内（/r）は見本の滞在とコード入力前の表示にだけ使う（本物の滞在には効かない）。
// 精算案内の見本（$lib/inroom-bill.ts PREVIEW_BILL_COOKIE）と同じ考え方。

import { parsePreviewBillFlags, previewBillCookieValue, type BillFlags } from './inroom-bill';

export const PREVIEW_NOTICE_COOKIE = 'ab_preview_notice';
export const PREVIEW_SPRING_COOKIE = 'ab_preview_spring';

/** settings＝管理画面の設定どおり（Cookie なし）／sample＝見本を出す／none＝出さない */
export type PreviewMode = 'settings' | 'sample' | 'none';
export type PreviewNotice = { mode: 'sample' | 'none'; title: string; body: string };
export type PreviewSpring = { mode: 'sample' | 'none'; percent: number };

export const PREVIEW_NOTICE_MAX_TITLE = 60;
export const PREVIEW_NOTICE_MAX_BODY = 600;

export const PREVIEW_NOTICE_DEFAULT = {
	title: '（見本）大浴場の清掃のお知らせ',
	body: '本日 15:00〜16:00 は大浴場を清掃いたします。ご不便をおかけしますが、お部屋のお風呂か貸切風呂をご利用ください。'
};

const b64urlEncode = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s: string) => {
	const b = s.replace(/-/g, '+').replace(/_/g, '/');
	return decodeURIComponent(escape(atob(b + '='.repeat((4 - (b.length % 4)) % 4))));
};

/** フォーム・URL から来た見本のお知らせを整える（モードが settings なら null） */
export function normalizePreviewNotice(mode: unknown, title: unknown, body: unknown): PreviewNotice | null {
	if (mode === 'none') return { mode: 'none', title: '', body: '' };
	if (mode !== 'sample') return null;
	const t = String(title ?? '').trim().slice(0, PREVIEW_NOTICE_MAX_TITLE) || PREVIEW_NOTICE_DEFAULT.title;
	const b = String(body ?? '').replace(/\r\n?/g, '\n').trim().slice(0, PREVIEW_NOTICE_MAX_BODY);
	return { mode: 'sample', title: t, body: b };
}

/** 見本の湯量（モードが settings なら null）。sample の値は 0〜100 の整数にそろえる */
export function normalizePreviewSpring(mode: unknown, percent: unknown): PreviewSpring | null {
	if (mode === 'none') return { mode: 'none', percent: 0 };
	if (mode !== 'sample') return null;
	const n = Math.round(Number(percent));
	return { mode: 'sample', percent: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50 };
}

export const encodePreviewNotice = (p: PreviewNotice) => b64urlEncode(JSON.stringify(p));
export const encodePreviewSpring = (p: PreviewSpring) => `${p.mode}:${p.percent}`;

export function decodePreviewNotice(v: string | null | undefined): PreviewNotice | null {
	if (!v) return null;
	try {
		const o = JSON.parse(b64urlDecode(v)) as Record<string, unknown>;
		return normalizePreviewNotice(o.mode, o.title, o.body);
	} catch {
		return null;
	}
}

export function decodePreviewSpring(v: string | null | undefined): PreviewSpring | null {
	if (!v) return null;
	const [mode, pct] = v.split(':');
	return normalizePreviewSpring(mode, pct);
}

/** 文字列の短いハッシュ（見本のお知らせの id。中身を変えたら別のお知らせ＝既読でも出る） */
function shortHash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

/** 客室案内に出すお知らせ（見本があれば置き換える） */
export function applyPreviewNotices<T extends { id: string; title: string; body: string; startsAt: string; endsAt: string | null }>(
	live: T[],
	preview: PreviewNotice | null,
	now = new Date()
): (T | { id: string; title: string; body: string; startsAt: string; endsAt: null })[] {
	if (!preview) return live;
	if (preview.mode === 'none') return [];
	return [{ id: `preview-${shortHash(preview.title + '\n' + preview.body)}`, title: preview.title, body: preview.body, startsAt: now.toISOString(), endsAt: null }];
}

/**
 * 客室案内に出す湯量（見本があれば置き換える）。visible は本物の表示（出さない設定なら null）、base は施設の設定
 * （段階の言葉・色・説明は施設の設定を使う）。
 */
export function applyPreviewSpring<T extends { enabled: boolean; percent: number | null; updatedAt: string | null }>(
	visible: T | null,
	base: T,
	preview: PreviewSpring | null,
	now = new Date()
): T | null {
	if (!preview) return visible;
	if (preview.mode === 'none') return null;
	return { ...base, enabled: true, percent: preview.percent, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// 施設ごとに DB に持つ見本（book.inroom_settings.demo_preview・2026-10-17 指示「表示先を一緒に」）。
// 見本の滞在（PMS の「見本の館内図」と Book のプレビューで共通の1本）は、どの端末で開いてもこれを使う。
// ---------------------------------------------------------------------------

/** billCount: 見本の請求書の枚数（1＝1枚・2＝連泊と宛名違いの2枚・2026-10-18） */
export type DemoPreview = { bill: BillFlags | null; notice: PreviewNotice | null; spring: PreviewSpring | null; billCount: 1 | 2 };
export const EMPTY_DEMO_PREVIEW: DemoPreview = { bill: null, notice: null, spring: null, billCount: 1 };

/** DB の jsonb → 見本（読めない部分は「本物の設定どおり」） */
export function normalizeDemoPreview(raw: unknown): DemoPreview {
	if (!raw || typeof raw !== 'object') return EMPTY_DEMO_PREVIEW;
	const o = raw as Record<string, unknown>;
	const n = (o.notice ?? null) as Record<string, unknown> | null;
	const s = (o.spring ?? null) as Record<string, unknown> | null;
	return {
		bill: typeof o.bill === 'string' ? parsePreviewBillFlags(o.bill) : null,
		notice: n ? normalizePreviewNotice(n.mode, n.title, n.body) : null,
		spring: s ? normalizePreviewSpring(s.mode, s.percent) : null,
		billCount: o.bill_count === 2 ? 2 : 1
	};
}

/** 見本 → DB に入れる jsonb（すべて「設定どおり」なら null） */
export function demoPreviewJson(p: DemoPreview): Record<string, unknown> | null {
	if (!p.bill && !p.notice && !p.spring && p.billCount !== 2) return null;
	return {
		bill: p.bill ? previewBillCookieValue(p.bill) : null,
		notice: p.notice,
		spring: p.spring,
		bill_count: p.billCount
	};
}
