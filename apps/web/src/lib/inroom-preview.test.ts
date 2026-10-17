import { describe, expect, it } from 'vitest';
import {
	applyPreviewNotices,
	applyPreviewSpring,
	decodePreviewNotice,
	decodePreviewSpring,
	encodePreviewNotice,
	encodePreviewSpring,
	normalizePreviewNotice,
	normalizePreviewSpring
} from './inroom-preview';

const live = [{ id: 'n1', title: '本物', body: 'b', startsAt: '2026-10-17T00:00:00Z', endsAt: null }];
const base = { enabled: false, percent: 80, note: '', updatedAt: null as string | null, bands: null };

describe('プレビューのお知らせ・湯量の見本', () => {
	it('settings は null（本物のまま）・none は出さない・sample は見本1件', () => {
		expect(normalizePreviewNotice('settings', 'a', 'b')).toBeNull();
		expect(applyPreviewNotices(live, null)).toBe(live);
		expect(applyPreviewNotices(live, normalizePreviewNotice('none', '', ''))).toEqual([]);
		const s = applyPreviewNotices(live, normalizePreviewNotice('sample', '清掃', '15時から\r\n清掃します'));
		expect(s).toHaveLength(1);
		expect(s[0].title).toBe('清掃');
		expect(s[0].body).toBe('15時から\n清掃します');
		expect(s[0].id).toMatch(/^preview-/);
		// 中身が変われば別の id（既読でも出る）
		expect(applyPreviewNotices(live, normalizePreviewNotice('sample', '清掃', '別'))[0].id).not.toBe(s[0].id);
	});
	it('Cookie の往復（日本語を含む）', () => {
		const n = normalizePreviewNotice('sample', 'お知らせ', '本文 **太字**')!;
		expect(decodePreviewNotice(encodePreviewNotice(n))).toEqual(n);
		expect(decodePreviewNotice('壊れた値')).toBeNull();
		expect(decodePreviewSpring(encodePreviewSpring(normalizePreviewSpring('sample', 12.6)!))).toEqual({ mode: 'sample', percent: 13 });
		expect(decodePreviewSpring('sample:250')).toEqual({ mode: 'sample', percent: 100 });
		expect(decodePreviewSpring('settings:5')).toBeNull();
	});
	it('湯量: none は出さない・sample は施設の設定（段階など）に残量だけ差し替えて必ず出す', () => {
		expect(applyPreviewSpring(null, base, null)).toBeNull();
		expect(applyPreviewSpring(base, base, normalizePreviewSpring('none', 0))).toBeNull();
		const s = applyPreviewSpring(null, base, normalizePreviewSpring('sample', 5))!;
		expect(s.enabled).toBe(true);
		expect(s.percent).toBe(5);
		expect(s.updatedAt).not.toBeNull();
	});
});

describe('施設ごとに保存する見本（demo_preview）', () => {
	it('DB の jsonb との往復。すべて「設定どおり」なら null', async () => {
		const { normalizeDemoPreview, demoPreviewJson, EMPTY_DEMO_PREVIEW } = await import('./inroom-preview');
		expect(demoPreviewJson(EMPTY_DEMO_PREVIEW)).toBeNull();
		expect(normalizeDemoPreview(null)).toEqual(EMPTY_DEMO_PREVIEW);
		const p = {
			bill: { items: true, front: false, online: true },
			notice: normalizePreviewNotice('sample', '見出し', '本文')!,
			spring: normalizePreviewSpring('sample', 20)!
		};
		expect(normalizeDemoPreview(JSON.parse(JSON.stringify(demoPreviewJson(p))))).toEqual(p);
		// 精算案内を全部外した見本は「出さない」
		expect(normalizeDemoPreview(demoPreviewJson({ ...EMPTY_DEMO_PREVIEW, bill: { items: false, front: false, online: false } })).bill).toEqual({
			items: false,
			front: false,
			online: false
		});
	});
});
