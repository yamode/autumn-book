// @ts-nocheck — Canvas の描画が中心のため、型は model.ts（数字の読み替え）にだけ付ける。
// Autumn Live の画面の描画と更新（docs/autumn-live.md）。試作 docs/prototypes/autumn-live/index.html（v13）を実データにしたもの。
//   - /live/api/snapshot を 2.5 秒ごとに読む（今日の流れ・いまいる人・Book の予約・オンハンド・会員・いつもの幅）
//   - 帯の太さ＝今日その段まで来た人数、光の粒＝いまいる人（前回と比べて動かす・来た・離れた）
//   - 予約が入ったら金の輪と知らせ。会員が増えたら銀の光が会員のカードへ
import { cumulativeUntil, diffGrains, pctChange, rate28, usualFraction, yenShort } from './model';

export function startLiveScreen(root: HTMLElement): () => void {
	const $ = (id) => root.querySelector(`[data-id="${id}"]`);
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const TAU = Math.PI * 2;
	const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, rnd = (a, b) => a + Math.random() * (b - a);
	const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
	const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
	const hex = (c) => { c = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
	const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join(''); };
	const rgba = (c, a) => { const A = hex(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };
	const pick = (a) => a[Math.floor(Math.random() * a.length)];
	const timers = [];
	const every = (fn, ms) => timers.push(setInterval(fn, ms));
	let stopped = false;

	// ── 時刻 ──
	function jst() {
		const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(new Date());
		const g = (t) => p.find((x) => x.type === t).value;
		return { mo: +g('month'), d: +g('day'), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), h: +g('hour') % 24, mi: +g('minute'), s: +g('second') };
	}
	const WD = '日月火水木金土';
	const realHour = () => { const t = jst(); return t.h + t.mi / 60 + t.s / 3600; };
	let skyOverride = null, seasonOverride = null;
	const skyHour = () => skyOverride ?? realHour();

	// ── 空と季節 ──
	const SKY = [[0, '#060a19', '#141c38'], [4.6, '#0a0f24', '#232a4a'], [5.8, '#1e2852', '#7a5a72'], [6.6, '#3d5a92', '#f0b089'], [8, '#4f86c4', '#bfd8ee'], [12, '#3c7cc6', '#b4d4f0'], [15.5, '#4c80be', '#d9d4c0'], [16.9, '#33467e', '#f09a62'], [17.8, '#1d2652', '#a3607a'], [19, '#0d1430', '#2c2f55'], [24, '#060a19', '#141c38']];
	// 季節ごとの空の色と、降るもの・下に置くもの（2026-11-27 指示）
	//   秋（9〜10 月）… 何も降らない。画面の下にカラマツの黄色い紅葉が並ぶ
	//   11 月          … カラマツの並木に、雪がちらちら舞う
	//   12 月          … クリスマスツリーを置き、雪が深々と降る
	//   冬（1〜3 月）  … 雪
	const SEASONS = {
		winter: { sky: ['#7fa9d2', '#e8eff5'], fall: 'snow' },
		spring: { sky: ['#78acdc', '#f4e3ea'], fall: 'petal' },
		summer: { sky: ['#3283cf', '#d4ecf9'], fall: 'firefly' },
		autumn: { sky: ['#5596cf', '#f2dfc4'], fall: 'none', larch: true },
		nov: { sky: ['#7d9fc4', '#e9e4da'], fall: 'flurry', larch: true },
		xmas: { sky: ['#7fa9d2', '#e8eff5'], fall: 'deep', xmas: true }
	};
	const seasonOf = (m) => m === 12 ? 'xmas' : m === 11 ? 'nov' : m <= 3 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn';
	const curSeason = () => seasonOverride || seasonOf(jst().mo);
	const dayLight = (h) => smooth(5.6, 7.6, h) * (1 - smooth(16.6, 18.4, h));
	function skyCols(h) { const se = SEASONS[curSeason()].sky, d = dayLight(h); for (let i = 0; i < SKY.length - 1; i++) { const a = SKY[i], b = SKY[i + 1]; if (h >= a[0] && h <= b[0]) { const t = (h - a[0]) / (b[0] - a[0]); return [mix(mix(a[1], b[1], t), se[0], d * 0.6), mix(mix(a[2], b[2], t), se[1], d * 0.6)]; } } return [SKY[0][1], SKY[0][2]]; }

	const cv = root.querySelector('canvas.scene'), ctx = cv.getContext('2d');
	let W = 0, H = 0, DPR = 1;
	const stars = [...Array(220)].map(() => ({ x: Math.random(), y: Math.pow(Math.random(), 1.5) * 0.8, r: Math.random() * 1.1 + 0.25, p: Math.random() * TAU }));
	const clouds = [...Array(6)].map(() => ({ x: Math.random(), y: 0.06 + Math.random() * 0.4, s: 0.07 + Math.random() * 0.12, v: 0.003 + Math.random() * 0.004 }));
	let fall = [];
	function newFall(any) {
		const k = SEASONS[curSeason()].fall, z = Math.random();
		if (k === 'firefly') return { k, x: Math.random() * W, y: H * rnd(0.3, 0.95), r: 1.2, ph: Math.random() * 7, a: rnd(0.4, 1) };
		const y = any ? Math.random() * H : -6;
		// ちらちら: 少なく・小さく・ゆっくり、横に揺れながら
		if (k === 'flurry') return { k: 'snow', x: Math.random() * W, y, r: 0.6 + z * 1.3, vy: 6 + z * 9, sway: 0.6 + z * 0.8, ph: Math.random() * 7, a: 0.35 + z * 0.4 };
		// 深々と: 多く・手前ほど大きく、まっすぐ静かに
		if (k === 'deep') return { k: 'snow', x: Math.random() * W, y, r: 0.7 + z * z * 3, vy: 14 + z * 26, sway: 0.25, ph: Math.random() * 7, a: 0.3 + z * 0.55 };
		if (k === 'snow') return { k, x: Math.random() * W, y, r: 0.6 + z * 1.8, vy: 10 + z * 24, sway: 0.35, ph: Math.random() * 7, a: 0.2 + z * 0.45 };
		return { k, x: Math.random() * W, y, r: 1.8 + z * 2, vy: 12 + z * 16, ph: Math.random() * 7, a: 0.5 + z * 0.4, rot: Math.random() * 6, vr: rnd(-2, 2), col: '#f4c6d4' };
	}
	function rebuildFall() {
		const k = SEASONS[curSeason()].fall;
		const n = k === 'none' ? 0 : k === 'flurry' ? (reduce ? 12 : 28) : k === 'deep' ? (reduce ? 60 : Math.round(clamp(W * H / 4500, 120, 380))) : k === 'snow' ? (reduce ? 24 : Math.round(clamp(W * H / 12000, 50, 160))) : (reduce ? 24 : 40);
		fall = [...Array(n)].map(() => newFall(true));
		buildLarches();
		buildXmas();
	}

	// ── カラマツの並木（秋・11 月）。画面の下、カードの後ろから梢がのぞく ──
	let larches = [];
	function buildLarches() {
		larches = [];
		if (!SEASONS[curSeason()].larch || !W) return;
		for (const row of [{ gap: [13, 21], h: [0.55, 0.85], back: true }, { gap: [20, 34], h: [0.75, 1.15], back: false }]) {
			for (let x = -10; x < W + 20; x += rnd(row.gap[0], row.gap[1])) {
				larches.push({ x: x + rnd(-4, 4), h: rnd(row.h[0], row.h[1]), back: row.back, tone: Math.random(), tiers: 7 + Math.floor(Math.random() * 4), lean: rnd(-0.04, 0.04), ph: Math.random() * TAU });
			}
		}
		larches.sort((a, b) => (a.back === b.back ? 0 : a.back ? -1 : 1));
	}
	function drawLarches(t, d, reach) {
		if (!larches.length) return;
		const night = 1 - d;
		for (const L of larches) {
			const h = reach * L.h * (L.back ? 0.8 : 1), w = h * 0.3, x0 = L.x, base = H + 4, topY = base - h;
			// 黄葉: 日なたの金色〜少し橙。手前ほど濃く、奥は空に溶かす。夜は群青に沈める
			let col = mix(L.tone < 0.5 ? '#e7b93a' : '#d99a2b', '#f3d36a', L.back ? 0.25 : 0);
			if (L.back) col = mix(col, skyCols(skyHour())[1], 0.35);
			col = mix(col, '#1c2238', night * 0.78);
			const sway = Math.sin(t * 0.5 + L.ph) * 0.6;
			ctx.fillStyle = col;
			ctx.beginPath();
			ctx.moveTo(x0 + sway + L.lean * h, topY);
			const n = L.tiers;
			for (let i = 1; i <= n; i++) { const yy = topY + (h * 0.88) * (i / n), hw = (w / 2) * Math.pow(i / n, 0.85); ctx.lineTo(x0 + hw + sway * (1 - i / n), yy); ctx.lineTo(x0 + hw * 0.55, yy - (h * 0.88) / n * 0.25); }
			for (let i = n; i >= 1; i--) { const yy = topY + (h * 0.88) * (i / n), hw = (w / 2) * Math.pow(i / n, 0.85); ctx.lineTo(x0 - hw * 0.55, yy - (h * 0.88) / n * 0.25); ctx.lineTo(x0 - hw + sway * (1 - i / n), yy); }
			ctx.closePath(); ctx.fill();
			// 幹
			ctx.fillStyle = rgba(mix('#5d4a36', '#151a2a', night * 0.7), 0.55); ctx.fillRect(x0 - Math.max(1, w * 0.03), base - h * 0.08, Math.max(1.5, w * 0.06), h * 0.08);
		}
	}

	// ── クリスマスツリー（12 月）。右下、カードの後ろから立つ ──
	let xmasLights = [];
	function buildXmas() {
		xmasLights = [];
		if (!SEASONS[curSeason()].xmas) return;
		for (let i = 0; i < 46; i++) xmasLights.push({ u: Math.random(), v: Math.pow(Math.random(), 0.7), col: pick(['#ffe7a3', '#ffd27a', '#ff8a7a', '#fff6e0', '#9fd0ff']), ph: Math.random() * TAU, sp: rnd(0.6, 1.6) });
	}
	function drawXmas(t, d, reach) {
		if (!SEASONS[curSeason()].xmas) return;
		const night = 1 - d;
		const h = clamp(reach + 100, 200, H * 0.42), w = h * 0.56, cx = W - Math.max(70, w * 0.42), base = H + 6, top = base - h;
		// 枝（4 段）。下ほど広く、段の下の縁に雪
		const tiers = 4;
		for (let i = 0; i < tiers; i++) {
			const y0 = top + h * 0.06 + (h * 0.78) * (i / tiers) - h * 0.04, y1 = top + h * 0.06 + (h * 0.78) * ((i + 1) / tiers) + h * 0.02, hw = (w / 2) * (0.38 + 0.62 * ((i + 1) / tiers));
			const g = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
			g.addColorStop(0, mix('#1d4a33', '#0b1420', night * 0.6)); g.addColorStop(0.55, mix('#2c6a47', '#13241f', night * 0.55)); g.addColorStop(1, mix('#173d2a', '#0a121c', night * 0.6));
			ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, y0);
			ctx.quadraticCurveTo(cx + hw * 0.5, y0 + (y1 - y0) * 0.55, cx + hw, y1);
			for (let k = 6; k >= 0; k--) { const xx = cx - hw + (2 * hw) * (k / 6); ctx.quadraticCurveTo(xx + hw / 6, y1 + 7, xx, y1); }
			ctx.quadraticCurveTo(cx - hw * 0.5, y0 + (y1 - y0) * 0.55, cx, y0); ctx.closePath(); ctx.fill();
			ctx.strokeStyle = `rgba(255,255,255,${0.75 - night * 0.25})`; ctx.lineWidth = 2.2; ctx.beginPath();
			for (let k = 0; k <= 6; k++) { const xx = cx - hw + (2 * hw) * (k / 6); k ? ctx.quadraticCurveTo(xx - hw / 6, y1 + 6, xx, y1) : ctx.moveTo(xx, y1); }
			ctx.stroke();
		}
		ctx.fillStyle = mix('#5a4030', '#151a2a', night * 0.6); ctx.fillRect(cx - w * 0.05, top + h * 0.86, w * 0.1, h * 0.16);
		// 灯り（夜ほど強く、ゆっくり瞬く）
		ctx.save(); ctx.globalCompositeOperation = night > 0.45 ? 'lighter' : 'source-over';
		for (const L of xmasLights) {
			const y = top + h * (0.14 + 0.7 * L.v), hw = (w / 2) * (0.38 + 0.62 * L.v) * 0.86, x = cx + (L.u * 2 - 1) * hw;
			const a = (0.55 + 0.45 * Math.sin(t * L.sp + L.ph)) * (0.55 + night * 0.45), r = 2 + night * 1.5;
			const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4); g.addColorStop(0, rgba(L.col, a)); g.addColorStop(1, rgba(L.col, 0)); ctx.fillStyle = g; ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
			ctx.fillStyle = rgba('#fffaf0', a); ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.fill();
		}
		// てっぺんの星
		const sy = top + h * 0.03, sr = Math.max(9, w * 0.07), glow = 0.7 + 0.3 * Math.sin(t * 1.2);
		const sg = ctx.createRadialGradient(cx, sy, 0, cx, sy, sr * 4); sg.addColorStop(0, `rgba(255,226,140,${0.55 * glow})`); sg.addColorStop(1, 'rgba(255,226,140,0)'); ctx.fillStyle = sg; ctx.fillRect(cx - sr * 4, sy - sr * 4, sr * 8, sr * 8);
		ctx.fillStyle = '#f6d36b'; ctx.beginPath();
		for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? sr * 0.45 : sr; ctx.lineTo(cx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr); }
		ctx.closePath(); ctx.fill(); ctx.restore();
	}

	function drawSky(t, hr) {
		const [top, hor] = skyCols(hr), d = dayLight(hr); const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(1, hor); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
		const na = 1 - smooth(5.2, 6.6, hr) * (1 - smooth(17.6, 19, hr));
		if (na > 0.02) for (const s of stars) { ctx.fillStyle = `rgba(255,250,235,${na * (0.4 + 0.4 * Math.sin(t * 1.2 + s.p))})`; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, TAU); ctx.fill(); }
		if (hr > 5.3 && hr < 18.7) { const u = clamp((hr - 5.6) / 12.8, 0, 1), sx = lerp(0.06, 0.94, u) * W, sy = H * (0.9 - Math.sin(u * Math.PI) * 0.8), warm = 1 - Math.sin(u * Math.PI), r = Math.min(W, H) * 0.3; const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r); sg.addColorStop(0, `rgba(255,${Math.round(240 - 60 * warm)},${Math.round(200 - 90 * warm)},.5)`); sg.addColorStop(1, 'rgba(255,220,170,0)'); ctx.fillStyle = sg; ctx.fillRect(sx - r, sy - r, r * 2, r * 2); ctx.fillStyle = `rgba(255,${Math.round(248 - 50 * warm)},${Math.round(228 - 90 * warm)},.92)`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(7, r * 0.05), 0, TAU); ctx.fill(); }
		else { const mx = W * 0.82, my = H * 0.13, r = Math.min(W, H) * 0.16; const mg = ctx.createRadialGradient(mx, my, 0, mx, my, r); mg.addColorStop(0, 'rgba(230,232,255,.2)'); mg.addColorStop(1, 'rgba(230,232,255,0)'); ctx.fillStyle = mg; ctx.fillRect(mx - r, my - r, r * 2, r * 2); ctx.fillStyle = 'rgba(244,242,230,.92)'; ctx.beginPath(); ctx.arc(mx, my, Math.max(6, r * 0.08), 0, TAU); ctx.fill(); }
		if (d > 0.05) for (const c of clouds) { const cx = ((c.x + t * c.v) % 1.3 - 0.15) * W, cy = c.y * H, r = c.s * W; for (let k = 0; k < 3; k++) { const ox = cx + (k - 1) * r * 0.6, oy = cy + (k % 2) * r * 0.08, rr = r * (k === 1 ? 0.75 : 0.55); const cg = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr); cg.addColorStop(0, `rgba(255,255,255,${0.24 * d})`); cg.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = cg; ctx.save(); ctx.translate(ox, oy); ctx.scale(1, 0.42); ctx.translate(-ox, -oy); ctx.fillRect(ox - rr, oy - rr, rr * 2, rr * 2); ctx.restore(); } }
		return d;
	}
	function drawFall(dt, t, day) {
		for (const f of fall) {
			if (f.k === 'firefly') { f.x += Math.sin(t * 0.5 + f.ph) * 0.3; f.y += Math.cos(t * 0.4 + f.ph) * 0.25; const a = f.a * (0.5 + 0.5 * Math.sin(t * 2 + f.ph)) * (1 - day * 0.85); if (a < 0.02) continue; const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 8); g.addColorStop(0, `rgba(230,255,150,${a})`); g.addColorStop(1, 'rgba(230,255,150,0)'); ctx.fillStyle = g; ctx.fillRect(f.x - 8, f.y - 8, 16, 16); continue; }
			f.y += f.vy * dt; f.x += Math.sin(t * 0.7 + f.ph) * (f.sway ?? 0.35); f.rot += (f.vr || 0) * dt; if (f.y > H + 8) Object.assign(f, newFall(false));
			if (f.k === 'snow') { ctx.fillStyle = day > 0.55 ? `rgba(255,255,255,${f.a + 0.2})` : `rgba(240,244,255,${f.a})`; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill(); }
			else { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.fillStyle = rgba(f.col, f.a * 0.85); ctx.beginPath(); ctx.ellipse(0, 0, f.r * 1.4, f.r * 0.7, 0, 0, TAU); ctx.fill(); ctx.restore(); }
		}
	}

	// ── 段・流入元 ──
	const STAGES = ['流入元', 'Book 訪問', '空室検索', '施設を選ぶ', 'プランを見る', '予約入力', '予約'];
	const SOURCES = ['西和賀HP', '男鹿HP', '検索・広告', 'SNS', '直接・その他'];
	const SRC_KEYS = ['nishiwaga_hp', 'oga_hp', 'search', 'sns', 'direct'];
	const LANES = { N: { name: '西和賀', night: '#a9d2e6', day: '#2c6c98', key: 'nishiwaga' }, O: { name: '男鹿', night: '#f0b48a', day: '#b8582a', key: 'oga' } };
	const laneOf = (f) => (f === 'oga' ? 'O' : f === 'nishiwaga' ? 'N' : null);

	// 今日の数（帯）。最初は 0、スナップショットが来たら入れ替える
	const M = { src: [0, 0, 0, 0, 0], visit: 0, search: 0, N: [0, 0, 0, 0], O: [0, 0, 0, 0] };
	const D = JSON.parse(JSON.stringify(M));
	let TODAY30 = new Array(48).fill(0), USUAL = null, RATES = null, TOTALS = null, TODAY = null;
	let lastOk = 0, liveCount = 0;
	const P = [], bursts = [], comets = [];
	const grainIndex = new Map(); // k → 粒
	let prevGrains = new Map();
	const seenBookings = new Set();
	let firstSnapshot = true, lastMembers = null;

	// ── 目標 ──
	const GOAL_DEFAULT = { visits: 3400, cvr: 1.5, onhand: 200000000 };
	const GOAL_STORE = 'autumn-live-goals';
	function loadGoals() { try { const v = JSON.parse(localStorage.getItem(GOAL_STORE) || 'null'); return { ...GOAL_DEFAULT, ...(v || {}) }; } catch { return { ...GOAL_DEFAULT }; } }
	let goals = loadGoals();

	// ── 形 ──
	let G = null;
	function geo() {
		const kp = $('kpis').getBoundingClientRect(), hd = root.querySelector('.top').getBoundingClientRect(), rb = root.getBoundingClientRect();
		const top = hd.bottom - rb.top + 64, stripH = 40, bot = kp.top - rb.top - stripH - 50;
		const L = Math.max(120, W * 0.09), R = Math.max(90, W * 0.07);
		const xs = [...Array(7)].map((_, i) => L + i * (W - L - R) / 6);
		const rh = Math.max(120, bot - top), cy = top + rh * 0.5, total = Math.max(1, M.visit), k = rh * 0.6 / Math.max(total, 40), off = rh * 0.25, gap = Math.max(4, rh * 0.012);
		const n = {}; let y = cy - (total * k + gap * 4) / 2; n.src = M.src.map((v) => { const a = y; y += v * k + gap; return [a, a + v * k]; });
		n.visit = [cy - M.visit * k / 2, cy + M.visit * k / 2]; n.search = [cy - M.search * k / 2, cy + M.search * k / 2];
		const lane = (arr, ly) => arr.map((v) => [ly - v * k / 2, ly + v * k / 2]); n.N = lane(M.N, cy - off); n.O = lane(M.O, cy + off);
		let vy = n.visit[0]; n.vslice = M.src.map((v) => { const a = vy; vy += v * k; return [a, a + v * k]; });
		const outT = (M.N[0] + M.O[0]) * k, s0 = cy - outT / 2; n.sN = [s0, s0 + M.N[0] * k]; n.sO = [s0 + M.N[0] * k, s0 + outT];
		return { xs, n, k, top, bot, cy, stripY: bot + 38, stripH };
	}
	// 帯が 0 の段でも粒が置けるよう、最低 6px の幅を取る
	const widen = (r) => { if (!r) return [0, 0]; const h = r[1] - r[0]; if (h >= 6) return r; const m = (r[0] + r[1]) / 2; return [m - 3, m + 3]; };
	function link(c, lane, src) { const n = G.n; if (c === 0) return [widen(n.src[src]), widen(n.vslice[src])]; if (c === 1) { const s = M.search * G.k, a = G.cy - s / 2; return [widen([a, a + s]), widen(n.search)]; } if (c === 2) return [widen(lane === 'O' ? n.sO : n.sN), widen(n[lane || 'N'][0])]; const L2 = lane || 'N'; const A = n[L2][c - 3], B = n[L2][c - 2], hb = B[1] - B[0], ma = (A[0] + A[1]) / 2; return [widen([ma - hb / 2, ma + hb / 2]), widen(B)]; }
	function nodeAt(c, lane, src) { const n = G.n; if (c === 0) return widen(n.src[src]); if (c === 1) return widen(n.visit); if (c === 2) return widen(n.search); return widen(n[lane || 'N'][c - 3]); }
	const bez = (a, b, t) => { const u = 1 - t, m = (a + b) / 2; return u * u * u * a + 3 * u * u * t * m + 3 * u * t * t * m + t * t * t * b; };
	const bezY = (a, b, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * a + 3 * u * t * t * b + t * t * t * b; };
	function band(c, A, B, col, alpha) { if (A[1] - A[0] < 0.5 && B[1] - B[0] < 0.5) return; const x0 = G.xs[c] + 2, x1 = G.xs[c + 1] - 2, xm = (x0 + x1) / 2; const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, rgba(col, alpha)); g.addColorStop(1, rgba(col, alpha * 0.8)); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, A[0]); ctx.bezierCurveTo(xm, A[0], xm, B[0], x1, B[0]); ctx.lineTo(x1, B[1]); ctx.bezierCurveTo(xm, B[1], xm, A[1], x0, A[1]); ctx.closePath(); ctx.fill(); }

	// ── 粒（実在の人）──
	function grainFor(g) { return { k: g.k, c: g.s, lane: laneOf(g.f), src: Math.max(0, SRC_KEYS.indexOf(g.src)), f: 0.12 + Math.random() * 0.76, st: 'dwell', t: 0, jx: Math.random(), ph: Math.random() * TAU, a: 0, queue: [] }; }
	function applyGrains(list) {
		const { added, moved, left } = diffGrains(prevGrains, list);
		for (const g of added) {
			const p = grainFor(g);
			if (!firstSnapshot && g.s === 1) { p.c = 0; p.queue = [1]; p.st = 'dwell'; p.t = 0; p.dw = 0.2; }
			P.push(p); grainIndex.set(g.k, p);
		}
		for (const m of moved) {
			const p = grainIndex.get(m.k); if (!p) continue;
			if (m.f) p.lane = laneOf(m.f) || p.lane;
			const target = m.to;
			if (target > p.c) { const q = []; for (let s = (p.queue.length ? p.queue[p.queue.length - 1] : p.c) + 1; s <= target; s++) q.push(s); p.queue.push(...q); }
			else { p.queue = []; p.c = target; p.st = 'dwell'; p.t = 0; p.a = 0.3; }
		}
		for (const l of left) {
			const p = grainIndex.get(l.k); if (!p) continue;
			grainIndex.delete(l.k); p.queue = []; p.st = l.s >= 6 ? 'done' : 'leave'; p.t = 0;
		}
		prevGrains = new Map(list.map((g) => [g.k, { s: g.s, f: g.f }]));
		liveCount = list.length;
	}
	function updateGrains(dt) {
		for (const p of P) {
			p.t += dt; p.a = Math.min(1, p.a + dt * 2);
			if (p.st === 'dwell' && p.queue.length && p.t > (p.dw ?? 0.3)) { p.st = 'move'; p.t = 0; p.mv = 1.6; p.dw = 0.3; }
			else if (p.st === 'move' && p.t >= p.mv) { p.c = p.queue.shift(); p.st = 'dwell'; p.t = 0; if (p.c === 6) bursts.push({ lane: p.lane || 'N', t: 0 }); }
		}
		for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; if ((p.st === 'leave' && p.t > 3.2) || (p.st === 'done' && p.t > 4)) P.splice(i, 1); }
		for (let i = bursts.length - 1; i >= 0; i--) { bursts[i].t += dt; if (bursts[i].t > 2.6) bursts.splice(i, 1); }
		for (let i = comets.length - 1; i >= 0; i--) { const c = comets[i]; c.t += dt / c.dur; if (c.t >= 1) { comets.splice(i, 1); bump('members'); } }
		const tw = (a, b) => a + (b - a) * Math.min(1, dt * 3);
		D.visit = tw(D.visit, M.visit); D.search = tw(D.search, M.search); for (const L of ['N', 'O']) for (let i = 0; i < 4; i++) D[L][i] = tw(D[L][i], M[L][i]); for (let i = 0; i < 5; i++) D.src[i] = tw(D.src[i], M.src[i]);
	}

	// ── 描画 ──
	function draw(t, dt) {
		if (!W) return; const hr = skyHour(); const d = drawSky(t, hr); const day = d > 0.55; root.classList.toggle('day', day);
		G = geo();
		// 木の高さ: カードの上端から少し上まで（カードの後ろから梢がのぞく）
		const reach = Math.max(80, H - ($('kpis').getBoundingClientRect().top - root.getBoundingClientRect().top) + 46);
		drawLarches(t, d, reach);
		drawXmas(t, d, reach);
		drawFall(dt, t, d);
		const md = day ? 'day' : 'night'; const ink = day ? '#17213a' : '#f0ece0';
		const txt = (s, x, y, size, al, align, wt, col) => { ctx.font = `${wt || 500} ${size}px "Noto Sans JP Variable","Noto Sans JP",sans-serif`; ctx.textAlign = align || 'left'; ctx.fillStyle = rgba(col || ink, al); ctx.fillText(s, x, y); };
		const halo = (s, x, y, size, al, align, wt, col) => { ctx.save(); ctx.shadowColor = day ? 'rgba(255,255,255,.85)' : 'rgba(5,8,20,.8)'; ctx.shadowBlur = 8; txt(s, x, y, size, al, align, wt, col); ctx.restore(); };
		const trunk = day ? '#1d3a66' : '#ece2c4', ta = day ? 0.15 : 0.22;
		for (let i = 0; i < 5; i++) band(0, G.n.src[i], G.n.vslice[i], trunk, ta * (i < 2 ? 1 : 0.75));
		band(1, link(1)[0], G.n.search, trunk, ta);
		for (const L of ['N', 'O']) { const col = LANES[L][md]; band(2, L === 'N' ? G.n.sN : G.n.sO, G.n[L][0], col, 0.26); for (let c = 3; c < 6; c++) { const A = G.n[L][c - 3], B = G.n[L][c - 2], hb = B[1] - B[0], ma = (A[0] + A[1]) / 2; band(c, [ma - hb / 2, ma + hb / 2], B, col, 0.31); } }
		const bar = (x, r, col, a) => { ctx.fillStyle = rgba(col, a); ctx.fillRect(x - 1.5, r[0], 3, Math.max(1.5, r[1] - r[0])); };
		G.n.src.forEach((r) => bar(G.xs[0], r, trunk, day ? 0.5 : 0.8)); bar(G.xs[1], G.n.visit, trunk, day ? 0.5 : 0.8); bar(G.xs[2], G.n.search, trunk, day ? 0.5 : 0.8);
		const gold = day ? '#a87a1c' : '#e6c172';
		for (const L of ['N', 'O']) G.n[L].forEach((r, i) => bar(G.xs[3 + i], r, i === 3 ? gold : LANES[L][md], 0.9));
		STAGES.forEach((s, i) => halo(s, G.xs[i], G.top - 34, 12, 0.7, 'center'));
		halo(fmt(D.visit), G.xs[1], G.top - 12, 22, 0.95, 'center', 700); halo(fmt(D.search), G.xs[2], G.top - 12, 22, 0.95, 'center', 700);
		SOURCES.forEach((s, i) => { const r = G.n.src[i], y = (r[0] + r[1]) / 2; halo(s, G.xs[0] - 10, y - 1, 12, 0.85, 'right'); halo(fmt(D.src[i]), G.xs[0] - 10, y + 13, 11, 0.6, 'right'); });
		for (const L of ['N', 'O']) G.n[L].forEach((r, i) => { const x = G.xs[3 + i]; if (i === 3) { halo(fmt(D[L][3]) + '件', x + 10, (r[0] + r[1]) / 2 + 7, 19, 0.95, 'left', 700, day ? '#7a5810' : '#f1d48c'); return; } const y = L === 'N' ? r[0] - 9 : r[1] + 19; halo((i === 0 ? LANES[L].name + '　' : '') + fmt(D[L][i]), x, y, 14, 0.95, 'center', 700); });
		if (M.visit === 0) halo('今日はまだ Book への訪問がありません', (G.xs[1] + G.xs[5]) / 2, G.cy + 4, 14, 0.6, 'center');
		// 段の間の％（今日）と 28 日の値（前の段が 50 人以上のときだけ・外れたら矢印と色）
		const rate = (x, y, now, prev, typ) => {
			if (!prev) return; const v = now / prev; let s = (v * 100).toFixed(v < 0.2 ? 1 : 0) + '%', col = ink, al = 0.8;
			const usable = typ != null && prev >= 50;
			if (usable && v / typ < 0.85) { s = '↓ ' + s; col = day ? '#a65a08' : '#f1b45a'; al = 1; } else if (usable && v / typ > 1.18) { s = '↑ ' + s; col = day ? '#2b7a4b' : '#9fd8b4'; al = 1; }
			halo(s, x, y, 12.5, al, 'center', 700, col); if (typ != null) halo('28日 ' + (typ * 100).toFixed(typ < 0.2 ? 1 : 0) + '%', x, y + 14, 10.5, 0.55, 'center');
		};
		const R = RATES || {};
		rate((G.xs[1] + G.xs[2]) / 2, G.cy - 2, M.search, M.visit, rate28(R.s2, R.s1));
		for (const L of ['N', 'O']) {
			const ly = (G.n[L][0][0] + G.n[L][0][1]) / 2, sl = L === 'N' ? G.n.sN : G.n.sO; const pre = L === 'N' ? 'n' : 'o';
			if (M.search) halo(Math.round(M[L][0] / M.search * 100) + '%', (G.xs[2] + G.xs[3]) / 2, ((sl[0] + sl[1]) / 2 + ly) / 2 + 4, 12.5, 0.8, 'center', 700);
			for (let i = 1; i < 4; i++) { const r = G.n[L][i]; rate((G.xs[2 + i] + G.xs[3 + i]) / 2, (r[0] + r[1]) / 2 + (L === 'N' ? -22 : 24), M[L][i], M[L][i - 1], rate28(R[pre + (i + 3)], R[pre + (i + 2)])); }
		}
		// 24 時間の線
		{
			const sy = G.stripY, sh = G.stripH, x0 = G.xs[0], x1 = G.xs[6], sw = x1 - x0; const lo = USUAL ? USUAL.p25 : null, hi = USUAL ? USUAL.p75 : null;
			const mx = Math.max(1, ...(hi || [0]), ...TODAY30) * 1.1; const px = (i) => x0 + sw * (i / 48), py = (v) => sy + sh - v / mx * sh;
			if (hi && lo) { ctx.beginPath(); hi.forEach((v, i) => { const X = px(i + 0.5), Y = py(v); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); for (let i = 47; i >= 0; i--) ctx.lineTo(px(i + 0.5), py(lo[i])); ctx.closePath(); ctx.fillStyle = rgba(ink, day ? 0.12 : 0.14); ctx.fill(); }
			const nh = realHour(), ni = Math.floor(nh * 2); ctx.strokeStyle = rgba(ink, 0.9); ctx.lineWidth = 1.7; ctx.beginPath();
			for (let i = 0; i <= Math.min(47, ni); i++) { const v = i === ni ? TODAY30[i] / Math.max(0.25, (nh * 2 - ni)) : TODAY30[i]; const X = px(i + 0.5), Y = py(v); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); } ctx.stroke();
			const nx = px(nh * 2); ctx.fillStyle = gold; ctx.fillRect(nx - 0.75, sy - 4, 1.5, sh + 6);
			[0, 6, 12, 18, 24].forEach((h) => halo(`${h}時`, px(h * 2), sy + sh + 14, 10.5, 0.6, h === 0 ? 'left' : h === 24 ? 'right' : 'center'));
			const wd = WD[jst().wd];
			if (USUAL) {
				halo(`今日の訪問（30分ごと）　灰色の帯＝直近8週の${wd}曜の幅`, x0, sy - 8, 11.5, 0.75, 'left');
				const uc = cumulativeUntil(USUAL.p50, nh); const pct = uc ? Math.round((M.visit / uc - 1) * 100) : null;
				if (pct != null) halo(`いつもの${wd}曜のこの時刻より ${pct >= 0 ? '+' : ''}${pct}%`, x1, sy - 8, 12.5, 0.95, 'right', 700, pct > 17 ? (day ? '#2b7a4b' : '#9fd8b4') : pct < -14 ? (day ? '#a65a08' : '#f1b45a') : ink);
			} else halo('今日の訪問（30分ごと）　いつもの幅は集計中（同じ曜日が4週たまると出ます）', x0, sy - 8, 11.5, 0.75, 'left');
		}
		// 粒
		ctx.save(); ctx.globalCompositeOperation = day ? 'source-over' : 'lighter';
		for (const p of P) {
			let x, y, al = p.a;
			if (p.st === 'move') { const to = p.queue[0]; const from = to - 1; const [A, B] = link(from, p.lane, p.src); const tt = clamp(p.t / p.mv, 0, 1), e = tt < 0.5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2; x = bez(G.xs[from] + 2, G.xs[to] - 2, e); y = bezY(lerp(A[0], A[1], p.f), lerp(B[0], B[1], p.f), e); }
			else { const r = nodeAt(p.c, p.lane, p.src); x = G.xs[p.c] + 4 + p.jx * 16 + Math.sin(t * 0.6 + p.ph) * 3; y = lerp(r[0], r[1], p.f) + Math.sin(t * 0.9 + p.ph) * 1.2; if (p.st === 'leave') { y -= p.t * p.t * 16 + p.t * 10; x += Math.sin(p.ph + p.t) * 6; al *= 1 - p.t / 3.2; } if (p.st === 'done') { al *= 1 - p.t / 4; x += p.t * 8; } }
			if (al <= 0) continue;
			const isGold = p.c >= 5 || p.st === 'done'; const tint = isGold ? (day ? '#ffc94a' : '#f3cf7a') : (p.lane && p.c >= 3 ? (day ? (p.lane === 'N' ? '#b8e4ff' : '#ffd0ac') : LANES[p.lane].night) : (day ? '#fff3cc' : '#f6efd8'));
			const rr = isGold ? 3 : 2.3, Rr = rr * (day ? 5.5 : 4.2); if (p.st === 'leave') al *= 0.6;
			const gg = ctx.createRadialGradient(x, y, 0, x, y, Rr); gg.addColorStop(0, rgba(tint, (day ? 0.8 : 0.6) * al)); gg.addColorStop(0.35, rgba(tint, (day ? 0.36 : 0.22) * al)); gg.addColorStop(1, rgba(tint, 0)); ctx.fillStyle = gg; ctx.fillRect(x - Rr, y - Rr, Rr * 2, Rr * 2);
			ctx.fillStyle = `rgba(255,253,244,${al})`; ctx.beginPath(); ctx.arc(x, y, p.st === 'leave' ? rr * 0.7 : rr * 0.85, 0, TAU); ctx.fill();
		}
		ctx.restore();
		for (const b of bursts) { const r = G.n[b.lane][3], x = G.xs[6], y = (r[0] + r[1]) / 2, k = b.t / 2.6; ctx.strokeStyle = rgba(day ? '#c8951f' : '#f3cf7a', (1 - k) * 0.9); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6 + k * 60, 0, TAU); ctx.stroke(); }
		for (const c of comets) { const pos = (e) => [lerp(c.sx, c.tx, e), lerp(c.sy, c.ty, e) - Math.sin(e * Math.PI) * 60]; const e = 1 - Math.pow(1 - clamp(c.t, 0, 1), 2); for (let k = 0; k < 10; k++) { const [x2, y2] = pos(Math.max(0, e - k * 0.012)); ctx.fillStyle = rgba(day ? '#ffffff' : '#d4def2', (1 - k / 10) * 0.75); ctx.beginPath(); ctx.arc(x2, y2, Math.max(0.5, 3.2 - k * 0.25), 0, TAU); ctx.fill(); } const [x, y] = pos(e); const g = ctx.createRadialGradient(x, y, 0, x, y, 16); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(212,222,242,0)'); ctx.fillStyle = g; ctx.fillRect(x - 16, y - 16, 32, 32); }
	}

	// ── 知らせ ──
	const banner = $('banner'); let bannerT = 0;
	function showBanner(head, text, member) { $('bannerHead').textContent = head; $('bannerText').textContent = text; banner.classList.toggle('member', !!member); banner.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => banner.classList.remove('on'), 6500); }
	function bump(k) { const el = root.querySelector(`.card[data-k="${k}"]`); if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 2200); }
	function onBookings(list) {
		for (const b of list) {
			if (seenBookings.has(b.k)) continue; seenBookings.add(b.k);
			if (firstSnapshot) continue; // 開いた時点で入っていたものは知らせない
			const lane = laneOf(b.facility) || 'N'; bursts.push({ lane, t: 0 }); bump('onhand');
			const mo = Number(String(b.ym).slice(5, 7));
			showBanner('予約が入りました', `${LANES[lane].name} · ${mo}月 · ${b.guests}名 ${b.nights}泊 · ¥${Math.round(b.amount).toLocaleString('ja-JP')}`);
			chime([784, 1175]);
		}
	}
	function onMembers(total) {
		if (lastMembers != null && total > lastMembers) {
			const el = root.querySelector('.card[data-k="members"] .val').getBoundingClientRect(), rb = root.getBoundingClientRect();
			for (let i = 0; i < Math.min(5, total - lastMembers); i++) comets.push({ sx: rnd(0.2, 0.8) * W, sy: -10, tx: el.left - rb.left + el.width / 2, ty: el.top - rb.top + el.height / 2, t: -i * 0.3, dur: 2.2 });
			showBanner('会員登録がありました', `いまの総数 ${fmt(total)}人`, true); chime([1047, 1319]);
		}
		lastMembers = total;
	}

	// ── カード ──
	const mcv = $('months');
	const cssv = (n) => getComputedStyle(root).getPropertyValue(n).trim();
	function drawMonths() {
		const c = mcv.getContext('2d'), w = mcv.clientWidth, h = mcv.clientHeight; if (!w) return; mcv.width = Math.round(w * DPR); mcv.height = Math.round(h * DPR); c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, w, h);
		const months = TOTALS?.onhand?.months; if (!months?.length) return;
		const mx = Math.max(1, ...months.map((m) => Math.max(m.amount, m.ly))) * 1.08, bw = w / months.length, ink = cssv('--ink'), warn = cssv('--warn'); const ch = h - 14;
		months.forEach((m, i) => { const x = i * bw + bw * 0.18, ww = bw * 0.64, bh = m.amount / mx * ch, ly = m.ly / mx * ch, behind = m.ly > 0 && m.amount < m.ly; c.globalAlpha = 0.75; c.fillStyle = behind ? warn : ink; c.fillRect(x, ch - bh, ww, bh); c.globalAlpha = 1; if (m.ly > 0) { c.strokeStyle = ink; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x - 3, ch - ly + 0.5); c.lineTo(x + ww + 3, ch - ly + 0.5); c.stroke(); } c.fillStyle = ink; c.globalAlpha = 0.6; c.font = '500 10px "Noto Sans JP Variable","Noto Sans JP",sans-serif'; c.textAlign = 'center'; c.fillText(Number(m.ym.slice(5)) + '月', x + ww / 2, h - 2); c.globalAlpha = 1; });
	}
	function bullet(k, { actual, lo, hi, goal, proj, max }) { const el = root.querySelector(`.card[data-k="${k}"] .bullet`); const pc = (v) => clamp(v / max * 100, 0, 100) + '%'; el.querySelector('.bar').style.width = pc(actual); const b = el.querySelector('.band'); if (lo == null || hi == null) { b.hidden = true; } else { b.hidden = false; b.style.left = pc(lo); b.style.width = `calc(${pc(hi)} - ${pc(lo)})`; } el.querySelector('.tgt').style.left = `calc(${pc(goal)} - 1px)`; const pj = el.querySelector('.proj'); if (pj) { if (proj == null) pj.hidden = true; else { pj.hidden = false; pj.style.left = pc(proj); } } }
	function state(k, s, flag) { const el = root.querySelector(`.card[data-k="${k}"]`); el.classList.toggle('warn', s === 'warn'); el.classList.toggle('good', s === 'good'); el.querySelector('.flag').textContent = flag || ''; }
	const pctTxt = (p) => (p == null ? '—' : `<b class="${p >= 0 ? 'up' : 'dn'}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%</b>`);
	const setH = (id, h) => { const e = $(id); if (e && e.innerHTML !== h) e.innerHTML = h; };
	function updateCards() {
		const hr = realHour(), wd = WD[jst().wd];
		// 訪問
		const gv = goals.visits; const frac = usualFraction(USUAL?.p50, hr);
		const uc = USUAL ? cumulativeUntil(USUAL.p50, hr) : null, lo = USUAL ? cumulativeUntil(USUAL.p25, hr) : null, hi = USUAL ? cumulativeUntil(USUAL.p75, hr) : null;
		const proj = frac != null && frac >= 0.15 ? M.visit / frac : null;
		setH('v-visits', `${fmt(M.visit)}<small>人</small>`);
		setH('vs-visits', uc ? `いつもの${wd}曜より ${pctTxt(pctChange(M.visit, uc))}` : '');
		bullet('visits', { actual: M.visit, lo, hi, goal: gv, proj, max: Math.max(gv, proj || 0, hi || 0, M.visit) * 1.12 });
		setH('l1-visits', USUAL ? `いつもの幅（この時刻） <b>${fmt(lo)}〜${fmt(hi)}</b>人` : 'いつもの幅は集計中（同じ曜日が4週たまると出ます）');
		setH('l2-visits', proj != null ? `このペースなら <b>${fmt(Math.round(proj / 10) * 10)}</b>人 · 目標 ${fmt(gv)}人` : `目標 ${fmt(gv)}人`);
		const behind = proj != null && proj < gv * 0.9;
		state('visits', behind || (lo != null && M.visit < lo) ? 'warn' : hi != null && M.visit > hi ? 'good' : '', behind ? '目標に届かないペース' : lo != null && M.visit < lo ? 'いつもより少ない' : hi != null && M.visit > hi ? 'いつもより多い' : '');
		// 予約率（直近 7 日）
		const c7 = TOTALS?.cvr7; const gc = goals.cvr;
		if (c7 && c7.visits >= 50) { const v = c7.bookings / c7.visits * 100; setH('v-cvr', `${v.toFixed(2)}<small>%</small>`); setH('vs-cvr', ''); bullet('cvr', { actual: v, lo: null, hi: null, goal: gc, max: Math.max(gc, v) * 1.3 }); setH('l1-cvr', `直近7日 <b>${fmt(c7.bookings)}</b>件 / ${fmt(c7.visits)}人`); }
		else { setH('v-cvr', '集計中'); setH('vs-cvr', ''); bullet('cvr', { actual: 0, lo: null, hi: null, goal: gc, max: gc * 1.3 }); setH('l1-cvr', `直近7日の訪問が50人を超えると出ます（いま ${fmt(c7?.visits ?? 0)}人）`); }
		setH('l2-cvr', `今日の Book の予約 ${fmt(TODAY?.bookings?.today ?? 0)}件 · 目標 ${gc}%`);
		state('cvr', '', '');
		// オンハンド
		const months = TOTALS?.onhand?.months;
		if (months?.length) {
			const oh = months.reduce((a, m) => a + m.amount, 0), ly = months.reduce((a, m) => a + m.ly, 0); const behindM = months.filter((m) => m.ly > 0 && m.amount < m.ly).map((m) => Number(m.ym.slice(5)) + '月');
			setH('v-onhand', `${(oh / 1e8).toFixed(2)}<small>億円</small>`); setH('vs-onhand', ly ? `前年同月の実績より ${pctTxt(pctChange(oh, ly))}` : '');
			const p7 = TOTALS.onhand.pickup7, pp = TOTALS.onhand.pickup7prev;
			setH('l1-onhand', `直近7日の増加 <b>${yenShort(p7)}</b>（その前の7日 ${yenShort(pp)}）· 目標 ${(goals.onhand / 1e8).toFixed(1)}億円まで ${yenShort(Math.max(0, goals.onhand - oh))}`);
			state('onhand', behindM.length ? 'warn' : '', behindM.length ? `前年実績より少ない：${behindM.join('・')}` : '');
			drawMonths();
		}
		// 会員
		const mem = TOTALS?.members;
		if (mem) {
			const net = mem.new7 - mem.withdrawn7; setH('v-members', `${fmt(mem.total)}<small>人</small>`); setH('vs-members', `今日の登録 <b>${fmt(mem.today)}</b>人`);
			const mxw = Math.max(mem.new7, mem.withdrawn7, 5); const row = (l, v, cls) => `<dt${cls ? ` class="${cls}"` : ''}>${l}</dt><dd${cls ? ` class="${cls}"` : ''}>${cls ? '' : `<div class="bx${v < 0 ? ' neg' : ''}" style="width:${Math.abs(v) / mxw * 100}%"></div>`}</dd><dd${cls ? ` class="${cls}"` : ''}>${v > 0 ? '+' : ''}${v}</dd>`;
			setH('memFlow', row('新規登録（7日）', mem.new7) + row('退会（7日）', -mem.withdrawn7) + row('7日の純増', net, 'net'));
			setH('l1-members', `28日の新規 <b>${fmt(mem.new28)}</b>人（その前の28日 ${fmt(mem.new28prev)}人）· アクティブ率は準備中`);
			state('members', '', '');
		}
		$('liveVs').textContent = '';
	}

	// ── データ ──
	async function poll() {
		if (stopped) return;
		try {
			const res = await fetch('/live/api/snapshot', { cache: 'no-store', credentials: 'same-origin' });
			if (res.status === 403) { setFresh('入場券が切れました。開き直しています', true); return; }
			const j = await res.json(); if (j.status !== 'ok') throw new Error('unavailable');
			TODAY = j.today; TOTALS = j.totals || TOTALS;
			M.src = SRC_KEYS.map((k) => TODAY.src?.[k] ?? 0); M.visit = TODAY.stages?.[0] ?? 0; M.search = TODAY.stages?.[1] ?? 0; M.N = TODAY.lanes?.nishiwaga ?? [0, 0, 0, 0]; M.O = TODAY.lanes?.oga ?? [0, 0, 0, 0];
			TODAY30 = TODAY.by30 || TODAY30; USUAL = TOTALS?.usual || null; RATES = TOTALS?.rates28 || null;
			applyGrains(TODAY.live || []); onBookings(TODAY.bookings?.recent || []); if (TOTALS?.members) onMembers(TOTALS.members.total);
			firstSnapshot = false; lastOk = Date.now(); updateCards(); setFresh();
		} catch {
			setFresh('Book につながりません。自動でやり直します', true);
		}
	}
	function setFresh(msg, stale) { const chip = $('chip'); const age = lastOk ? Math.round((Date.now() - lastOk) / 1000) : null; const isStale = stale || (age != null && age > 30); chip.classList.toggle('stale', !!isStale); $('fresh').textContent = msg || (age == null ? 'つないでいます' : `${age <= 2 ? 'いま' : age + '秒前'}に更新`); }

	// ── 音 ──
	let soundOn = false, AC = null;
	function chime(fr) { if (!soundOn) return; try { AC = AC || new AudioContext(); const t0 = AC.currentTime; fr.forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0 + i * 0.13); g.gain.linearRampToValueAtTime(0.06, t0 + i * 0.13 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.13 + 1.8); o.connect(g).connect(AC.destination); o.start(t0 + i * 0.13); o.stop(t0 + i * 0.13 + 1.9); }); } catch { /* noop */ } }

	// ── 操作 ──
	const gp = $('goalPanel'), gf = $('goalForm'), gb = $('btnGoal'), hp = $('helpPanel'), hb = $('btnHelp');
	const fillGoals = (src) => { for (const k in GOAL_DEFAULT) { const el = gf.elements[k]; if (el) el.value = src[k]; } };
	function openGoals(o) { if (o) openHelp(false); gp.hidden = !o; gb.setAttribute('aria-expanded', String(o)); if (o) { fillGoals(goals); $('gpSaved').hidden = true; gf.elements.visits.focus(); } }
	function openHelp(o) { if (o) openGoals(false); hp.hidden = !o; hb.setAttribute('aria-expanded', String(o)); if (o) $('hpClose').focus(); }
	gb.addEventListener('click', () => openGoals(gp.hidden)); hb.addEventListener('click', () => openHelp(hp.hidden));
	$('gpClose').addEventListener('click', () => openGoals(false)); $('hpClose').addEventListener('click', () => openHelp(false));
	$('gpReset').addEventListener('click', () => fillGoals(GOAL_DEFAULT));
	gf.addEventListener('submit', (e) => { e.preventDefault(); const next = { ...goals }; for (const k in GOAL_DEFAULT) { const el = gf.elements[k]; if (!el) continue; const n = parseFloat(el.value); if (Number.isFinite(n) && n >= 0) next[k] = n; else el.value = goals[k]; } goals = next; try { localStorage.setItem(GOAL_STORE, JSON.stringify(goals)); } catch { /* noop */ } $('gpSaved').hidden = false; updateCards(); });
	[gp, hp].forEach((p) => p.addEventListener('keydown', (e) => { if (e.key === 'Escape') { openGoals(false); openHelp(false); } }));
	$('skySel').addEventListener('change', (e) => { skyOverride = e.target.value === '' ? null : +e.target.value; });
	$('seasonSel').addEventListener('change', (e) => { seasonOverride = e.target.value || null; rebuildFall(); });
	const sb = $('btnSound'); sb.addEventListener('click', () => { soundOn = !soundOn; sb.setAttribute('aria-pressed', String(soundOn)); sb.textContent = soundOn ? '音 オン' : '音 オフ'; if (soundOn) chime([784]); });
	const fs = () => { const bridge = window.autumnLive; if (bridge?.toggleFullscreen) { void bridge.toggleFullscreen(); return; } try { document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen().catch(() => {}); } catch { /* noop */ } };
	$('btnFs').addEventListener('click', fs);
	const onKey = (e) => { if (e.target.closest && e.target.closest('input,select')) return; const k = e.key.toLowerCase(); if (k === 'f') fs(); else if (k === 'g') openGoals(gp.hidden); else if (k === 'h' || k === '?') openHelp(hp.hidden); else if (k === 'escape') { openGoals(false); openHelp(false); } };
	addEventListener('keydown', onKey);

	// ── 大きさ・時計・ループ ──
	let wasDay = null;
	function resize() { const r = root.getBoundingClientRect(); if (!r.width || !r.height) return; DPR = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); rebuildFall(); drawMonths(); }
	function tick() { const t = jst(); $('hm').textContent = `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`; $('date').textContent = `${t.mo}月${t.d}日（${WD[t.wd]}）`; $('liveN').textContent = String(liveCount); setFresh(); }
	const ro = new ResizeObserver(resize); ro.observe(root);
	resize(); tick(); every(tick, 2000); void poll(); every(() => void poll(), 2500); every(updateCards, 15000);
	let last = performance.now(), T = 0, acc = 0, raf = 0;
	function frame(now) {
		if (stopped) return;
		let dt = Math.min(0.05, (now - last) / 1000); last = now;
		if (reduce) { acc += dt; if (acc < 0.5) { raf = requestAnimationFrame(frame); return; } dt = Math.min(acc, 0.5); acc = 0; }
		if (W) { T += dt; updateGrains(dt); draw(T, dt); const isDay = root.classList.contains('day'); if (isDay !== wasDay) { wasDay = isDay; drawMonths(); } }
		raf = requestAnimationFrame(frame);
	}
	raf = requestAnimationFrame(frame);

	return () => { stopped = true; cancelAnimationFrame(raf); timers.forEach(clearInterval); ro.disconnect(); removeEventListener('keydown', onKey); };
}
