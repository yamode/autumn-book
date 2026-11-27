// Autumn Live の背景（シーン）の形（docs/autumn-live.md §10）
import { describe, expect, it } from 'vitest';
import { inSeason, isMonthDay, liveSceneConfig, parseSceneConfig, pickScene, type LiveScene } from './live-scene';

// autumn-shared 20261127014949_book_live_scenes.sql の初期のシーン（同じ値）
const SEED = [
	{ name: '春（花びら）', starts: '04-01', ends: '05-31', config: {"skyTint":["#78acdc","#f4e3ea"],"layers":[{"type":"particles","preset":"petal","density":30,"size":[1.8,3.8],"speed":[12,28],"sway":0.35,"opacity":[0.5,0.9],"colors":["#f4c6d4","#f7d9e2"]}]} },
	{ name: '夏（ほたる）', starts: '06-01', ends: '08-31', config: {"skyTint":["#3283cf","#d4ecf9"],"layers":[{"type":"particles","preset":"firefly","density":30,"size":[1,1.4],"speed":[0,0],"sway":0.3,"opacity":[0.4,1],"colors":["#e6ff96"],"dayOpacity":0.15}]} },
	{ name: '秋（カラマツ）', starts: '09-01', ends: '10-31', config: {"skyTint":["#5596cf","#f2dfc4"],"layers":[{"type":"treeRow","preset":"larch","colors":["#e7b93a","#d99a2b"]}]} },
	{ name: '11月（初雪とカラマツ）', starts: '11-01', ends: '11-30', config: {"skyTint":["#7d9fc4","#e9e4da"],"layers":[{"type":"treeRow","preset":"larch","colors":["#e7b93a","#d99a2b"]},{"type":"particles","preset":"snow","density":22,"size":[0.6,1.9],"speed":[6,15],"sway":0.8,"opacity":[0.35,0.75]}]} },
	{ name: '12月（クリスマス）', starts: '12-01', ends: '12-31', config: {"skyTint":["#7fa9d2","#e8eff5"],"layers":[{"type":"xmasTree","side":"right"},{"type":"particles","preset":"snow","density":220,"size":[0.7,3.7],"speed":[14,40],"sway":0.25,"opacity":[0.3,0.85]}]} },
	{ name: '冬（雪）', starts: '01-01', ends: '03-31', config: {"skyTint":["#7fa9d2","#e8eff5"],"layers":[{"type":"particles","preset":"snow","density":85,"size":[0.6,2.4],"speed":[10,34],"sway":0.35,"opacity":[0.2,0.65]}]} }
];

describe('初期のシーン', () => {
	it('どれも形が正しい', () => {
		for (const s of SEED) {
			expect(liveSceneConfig.safeParse(s.config).success, s.name).toBe(true);
			expect(isMonthDay(s.starts) && isMonthDay(s.ends)).toBe(true);
		}
	});
	it('1 年のどの日にも、ちょうど 1 つ当たる', () => {
		const scenes = SEED.map((s, i) => ({ id: String(i), name: s.name, starts: s.starts, ends: s.ends, priority: 0, config: liveSceneConfig.parse(s.config), updatedAt: '' })) as LiveScene[];
		for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
			const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			expect(scenes.filter((s) => inSeason(md, s.starts, s.ends)).length, md).toBe(1);
			expect(pickScene(scenes, md)).not.toBeNull();
		}
	});
});

describe('期間と選び方', () => {
	const mk = (id: string, starts: string, ends: string, priority = 0) => ({ id, name: id, starts, ends, priority, config: { layers: [] }, updatedAt: '' }) as LiveScene;
	it('年をまたぐ期間', () => {
		expect(inSeason('12-25', '12-20', '01-05')).toBe(true);
		expect(inSeason('01-03', '12-20', '01-05')).toBe(true);
		expect(inSeason('01-10', '12-20', '01-05')).toBe(false);
	});
	it('重なったら priority、同じなら短い期間', () => {
		const s = [mk('dec', '12-01', '12-31'), mk('eve', '12-24', '12-25'), mk('vip', '12-01', '12-31', 5)];
		expect(pickScene(s, '12-24')?.id).toBe('vip');
		expect(pickScene(s.slice(0, 2), '12-24')?.id).toBe('eve');
		expect(pickScene(s.slice(0, 2), '12-10')?.id).toBe('dec');
		expect(pickScene(s, '06-01')).toBeNull();
	});
});

describe('管理画面の入力', () => {
	it('JSON の誤り・形の誤りを日本語で返す', () => {
		expect(parseSceneConfig('{').ok).toBe(false);
		const bad = parseSceneConfig(JSON.stringify({ layers: [{ type: 'particles', preset: 'snow', density: 9999 }] }));
		expect(bad.ok).toBe(false);
		const img = parseSceneConfig(JSON.stringify({ layers: [{ type: 'image', url: 'http://example.com/a.png' }] }));
		expect(img.ok).toBe(false);
		const ok = parseSceneConfig(JSON.stringify({ layers: [{ type: 'image', url: 'https://example.com/a.png', anchor: 'bottom-right' }] }));
		expect(ok.ok).toBe(true);
	});
	it('既定値が入る', () => {
		const r = parseSceneConfig(JSON.stringify({ layers: [{ type: 'treeRow' }] }));
		expect(r.ok && r.config.layers[0]).toMatchObject({ type: 'treeRow', preset: 'larch', height: 1, spacing: 1 });
	});
});
