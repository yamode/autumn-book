// Autumn Live の背景（シーン）の形（docs/autumn-live.md §10）。DB の book.live_scenes.config に入る JSON。
// 画面（live-screen/engine.ts）・管理画面（/admin/security/live/scenes）・テスト（live-scene.test.ts）から使う。
//
// 版の更新なしで差し替えられるよう、背景は「どの種類の層を・どんな値で・いつ出すか」をデータで持つ。
// 層の種類を増やすときだけコード（engine.ts の drawLayer）を足す。知らない種類の層は画面が黙って飛ばす。
import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb で書いてください');
const range = (min: number, max: number) => z.tuple([z.number().min(min).max(max), z.number().min(min).max(max)]);
const httpsUrl = z.string().url().refine((u) => u.startsWith('https://'), '画像は https の URL にしてください');

/** 降るもの・舞うもの */
const particles = z.object({
	type: z.literal('particles'),
	/** 見た目の型: snow（丸い光）／petal（花びら）／leaf（葉）／firefly（ほたる・下の方を漂う）／image（画像） */
	preset: z.enum(['snow', 'petal', 'leaf', 'firefly', 'image']),
	/** 数（画面 100 万画素あたり。1440×900 ならおよそ 1.3 倍） */
	density: z.number().min(0).max(400),
	size: range(0.2, 40).default([0.6, 1.8]),
	/** 落ちる速さ（毎秒の px） */
	speed: range(0, 200).default([10, 30]),
	/** 横の揺れ（0〜3） */
	sway: z.number().min(0).max(3).default(0.35),
	opacity: range(0, 1).default([0.25, 0.7]),
	colors: z.array(color).min(1).max(8).default(['#ffffff']),
	/** preset が image のときの画像 */
	image: httpsUrl.optional(),
	/** 昼の見え方（0＝昼は消す・1＝夜と同じ） */
	dayOpacity: z.number().min(0).max(1).default(1)
});

/** 画面の下に並ぶ木（カードの後ろから梢がのぞく） */
const treeRow = z.object({
	type: z.literal('treeRow'),
	/** larch（カラマツ型の細い円すい） */
	preset: z.enum(['larch']).default('larch'),
	colors: z.array(color).min(1).max(6).default(['#e7b93a', '#d99a2b']),
	/** 高さの倍率（1＝カードの上端から少し上まで） */
	height: z.number().min(0.2).max(3).default(1),
	/** 木の間隔の倍率（小さいほど密） */
	spacing: z.number().min(0.3).max(4).default(1),
	/** 雪をかぶせる */
	snowCap: z.boolean().default(false)
});

/** クリスマスツリー */
const xmasTree = z.object({
	type: z.literal('xmasTree'),
	side: z.enum(['left', 'right']).default('right'),
	scale: z.number().min(0.3).max(2).default(1),
	lights: z.array(color).min(1).max(8).default(['#ffe7a3', '#ffd27a', '#ff8a7a', '#fff6e0', '#9fd0ff'])
});

/** 画像を置く（PNG・SVG など。背景のイラスト・季節の飾り） */
const image = z.object({
	type: z.literal('image'),
	url: httpsUrl,
	/** 置き場所の基準 */
	anchor: z.enum(['bottom-left', 'bottom', 'bottom-right', 'top-left', 'top', 'top-right', 'center']).default('bottom'),
	/** 幅（画面の幅に対する割合） */
	width: z.number().min(0.02).max(2).default(0.3),
	/** 基準からのずらし（画面の幅・高さに対する割合） */
	offset: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]).default([0, 0]),
	opacity: z.number().min(0).max(1).default(1),
	/** 夜の濃さ（夜に暗く沈める） */
	nightOpacity: z.number().min(0).max(1).default(0.6),
	/** ゆっくり上下に揺らす幅（px） */
	bob: z.number().min(0).max(40).default(0)
});

/** 層。知らない種類は画面が飛ばすので、ここでは種類を限ってから受け付ける */
export const liveLayer = z.discriminatedUnion('type', [particles, treeRow, xmasTree, image]);

export const liveSceneConfig = z.object({
	/** 昼の空に混ぜる色（上・地平線） */
	skyTint: z.tuple([color, color]).optional(),
	/** 下から順に描く（後ろの層が先） */
	layers: z.array(liveLayer).max(12).default([])
});

export type LiveLayer = z.infer<typeof liveLayer>;
export type LiveSceneConfig = z.infer<typeof liveSceneConfig>;

/** 画面に渡すシーン（DB の行から） */
export type LiveScene = {
	id: string;
	name: string;
	/** 毎年くり返す期間（MM-DD）。starts > ends なら年をまたぐ（12-20〜01-05 など） */
	starts: string;
	ends: string;
	priority: number;
	config: LiveSceneConfig;
	updatedAt: string;
};

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isMonthDay = (s: string) => MMDD.test(s);

/** 今日（MM-DD）がその期間に入るか */
export function inSeason(today: string, starts: string, ends: string): boolean {
	return starts <= ends ? today >= starts && today <= ends : today >= starts || today <= ends;
}

/** 今日のシーン: 期間に入るもののうち priority が大きいもの（同じなら期間が短いもの） */
export function pickScene(scenes: LiveScene[], today: string): LiveScene | null {
	const span = (s: LiveScene) => {
		const d = (md: string) => Number(md.slice(0, 2)) * 31 + Number(md.slice(3));
		const a = d(s.starts), b = d(s.ends);
		return a <= b ? b - a : 372 - a + b;
	};
	const hit = scenes.filter((s) => inSeason(today, s.starts, s.ends));
	hit.sort((a, b) => b.priority - a.priority || span(a) - span(b));
	return hit[0] ?? null;
}

/** 管理画面の入力（JSON の文字列）を確かめる。だめなら日本語の理由 */
export function parseSceneConfig(text: string): { ok: true; config: LiveSceneConfig } | { ok: false; message: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, message: 'JSON として読めません。括弧・カンマ・引用符を確かめてください。' };
	}
	const r = liveSceneConfig.safeParse(raw);
	if (!r.success) {
		const i = r.error.issues[0];
		return { ok: false, message: `${i.path.join('.') || '全体'}: ${i.message}` };
	}
	return { ok: true, config: r.data };
}
