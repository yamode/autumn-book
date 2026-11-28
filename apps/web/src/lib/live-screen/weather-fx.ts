// @ts-nocheck — Canvas の描画だけ。型と天気の決め方は $lib/live-weather.ts。
// Autumn Live の空の天気の描画（docs/autumn-live.md §11）。engine.ts から使う。
//   - skyTint: 空を灰色に沈める・薄い雲をかける（空のグラデーションの直後）
//   - clouds: 雲（量・暗さ・風で流れる速さ）
//   - front: 雨・雪・霧・稲光（木の並びより手前、帯や数字より奥）
// 見た目の数（WeatherLook）は、いまの値から目標へ 15 秒ほどかけて移す。急に切り替えない。
import { blendLook } from '$lib/live-weather';

export function createWeatherFx(ctx, reduce) {
	const TAU = Math.PI * 2;
	const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, rnd = (a, b) => a + Math.random() * (b - a);
	const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
	const hex = (c) => { c = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
	const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join(''); };
	const rgba = (c, a) => { const A = hex(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; };

	let look = null, target = null;
	// 雲: th（しきい値）が小さい雲から順に出る。雲の量が増えるほど数が増える
	const clouds = [...Array(34)].map((_, i) => ({ x: Math.random(), y: 0.02 + Math.pow(Math.random(), 1.3) * 0.5, s: 0.06 + Math.random() * 0.14, v: 0.002 + Math.random() * 0.004, th: (i + Math.random()) / 34, sq: rnd(0.32, 0.48) }));
	const banks = [...Array(6)].map(() => ({ x: Math.random(), y: rnd(0.45, 0.95), s: rnd(0.25, 0.5), v: rnd(0.004, 0.01) * (Math.random() < 0.5 ? -1 : 1) }));
	const MAX_RAIN = reduce ? 260 : 900, MAX_SNOW = reduce ? 220 : 760;
	const drops = [...Array(MAX_RAIN)].map(() => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
	const flakes = [...Array(MAX_SNOW)].map(() => ({ x: Math.random(), y: Math.random(), z: Math.random(), ph: Math.random() * TAU }));
	let flash = 0, bolt = null, boltT = 0, nextFlick = 0;

	return {
		/** 目標の見た目。immediate なら移さずにすぐ */
		setTarget(l, immediate) { target = { ...l }; if (immediate || !look) look = { ...l }; },
		update(dt) {
			if (!look || !target) return;
			look = blendLook(look, target, Math.min(1, dt / 15 * 3)); // 時定数 5 秒・ほぼ 15 秒で移りきる
			// 稲光
			if (look.lightning > 0.05 && !reduce && Math.random() < look.lightning / 60 * dt) { flash = 1; nextFlick = rnd(0.08, 0.16); boltT = 0.18; bolt = null; }
			if (flash > 0) { flash = Math.max(0, flash - dt * 3.2); if (nextFlick > 0) { nextFlick -= dt; if (nextFlick <= 0 && Math.random() < 0.6) flash = 0.8; } }
			if (boltT > 0) boltT -= dt;
		},
		vis() { const l = look || { sun: 1, stars: 1, cloud: 0, rain: 0, snow: 0 }; return { sun: l.sun, stars: l.stars * (1 - l.cloud * 0.85), precip: l.rain + l.snow, flash }; },
		skyTint(W, H, d) {
			const l = look; if (!l) return;
			if (l.dim > 0.01) { ctx.fillStyle = rgba(mix('#10131c', mix('#9aa2ab', '#555d68', l.dark), d), l.dim * lerp(0.6, 0.95, d)); ctx.fillRect(0, 0, W, H); } // 雨雲ほど暗い灰色
			if (l.veil > 0.01) { const g = ctx.createLinearGradient(0, 0, 0, H); const c = mix('#2a3044', '#eef1f4', d); g.addColorStop(0, rgba(c, l.veil * lerp(0.12, 0.3, d))); g.addColorStop(1, rgba(c, l.veil * lerp(0.05, 0.16, d))); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
		},
		clouds(t, W, H, d) {
			const l = look; if (!l) return;
			const day = mix('#ffffff', '#646d79', l.dark), night = mix('#4a5270', '#1a1e2b', l.dark);
			const col = mix(night, day, d), base = lerp(0.16, 0.3, d) + l.dark * 0.2;
			const sp = 1 + l.wind * 5;
			// 厚い雲は空の上半分をおおう
			if (l.cloud > 0.6) { const g = ctx.createLinearGradient(0, 0, 0, H * 0.75); const a = smooth(0.6, 1, l.cloud) * (0.4 + l.dark * 0.35); g.addColorStop(0, rgba(col, a)); g.addColorStop(1, rgba(col, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.75); }
			for (const c of clouds) {
				const w = smooth(c.th - 0.1, c.th + 0.02, l.cloud); if (w < 0.01) continue;
				const cx = ((c.x + t * c.v * sp) % 1.4 - 0.2) * W, cy = c.y * H, r = c.s * W * (0.8 + l.cloud * 0.5);
				for (let k = 0; k < 3; k++) {
					const ox = cx + (k - 1) * r * 0.6, oy = cy + (k % 2) * r * 0.08, rr = r * (k === 1 ? 0.75 : 0.55);
					const cg = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr); cg.addColorStop(0, rgba(col, base * w)); cg.addColorStop(1, rgba(col, 0));
					ctx.fillStyle = cg; ctx.save(); ctx.translate(ox, oy); ctx.scale(1, c.sq); ctx.translate(-ox, -oy); ctx.fillRect(ox - rr, oy - rr, rr * 2, rr * 2); ctx.restore();
				}
			}
		},
		front(t, dt, W, H, d) {
			const l = look; if (!l) return;
			const area = (W * H) / 1.4e6, slant = l.wind * 0.45;
			// 雨: 斜めの細い線
			const nr = Math.round(clamp(l.rain * MAX_RAIN * area, 0, MAX_RAIN));
			if (nr > 0) {
				// 昼は空より少し暗い線、夜は街明かりを受けた明るい線
				ctx.strokeStyle = d > 0.5 ? `rgba(52,62,80,${0.26 + l.rain * 0.3})` : `rgba(170,190,222,${0.22 + l.rain * 0.22})`;
				ctx.lineWidth = 1.3; ctx.beginPath();
				for (let i = 0; i < nr; i++) {
					const p = drops[i], v = (650 + p.z * 450) / H, len = (9 + p.z * 16) * (0.6 + l.rain * 0.7);
					p.y += v * dt; p.x += v * dt * slant * H / W; if (p.y > 1.05) { p.y = -0.05; p.x = Math.random() * 1.3 - 0.15; }
					if (p.x > 1.05) p.x -= 1.2;
					const x = p.x * W, y = p.y * H; ctx.moveTo(x, y); ctx.lineTo(x - slant * len, y - len);
				}
				ctx.stroke();
			}
			// 雪: 丸い粒が揺れながら落ちる。風が強いと横へ流れる
			const ns = Math.round(clamp(l.snow * MAX_SNOW * area, 0, MAX_SNOW));
			if (ns > 0) {
				ctx.fillStyle = d > 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(232,238,252,0.75)';
				for (let i = 0; i < ns; i++) {
					const p = flakes[i], r = 0.8 + p.z * p.z * 2.4, vy = (22 + p.z * 50) * (1 + l.wind * 0.6), vx = l.wind * 220 * (0.6 + p.z * 0.6) + Math.sin(t * 0.8 + p.ph) * 14;
					p.y += vy * dt / H; p.x += vx * dt / W;
					if (p.y > 1.03) { p.y = -0.03; p.x = Math.random() * 1.2 - 0.1; }
					if (p.x > 1.05) p.x -= 1.1; else if (p.x < -0.05) p.x += 1.1;
					ctx.globalAlpha = 0.45 + p.z * 0.55; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, r, 0, TAU); ctx.fill();
				}
				ctx.globalAlpha = 1;
			}
			// 霧: 下ほど濃く、ゆっくり流れる霧の塊
			if (l.fog > 0.01) {
				const c = mix('#1b2130', '#dde3e9', d);
				const g = ctx.createLinearGradient(0, H * 0.2, 0, H); g.addColorStop(0, rgba(c, 0)); g.addColorStop(1, rgba(c, l.fog * 0.7)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
				ctx.fillStyle = rgba(c, l.fog * 0.18); ctx.fillRect(0, 0, W, H);
				for (const b of banks) {
					const bx = (((b.x + t * b.v * (1 + l.wind * 3)) % 1.6) + 1.6) % 1.6 * W - 0.3 * W, by = b.y * H, rr = b.s * W;
					const bg = ctx.createRadialGradient(bx, by, 0, bx, by, rr); bg.addColorStop(0, rgba(c, l.fog * 0.28)); bg.addColorStop(1, rgba(c, 0));
					ctx.save(); ctx.translate(bx, by); ctx.scale(1, 0.3); ctx.translate(-bx, -by); ctx.fillStyle = bg; ctx.fillRect(bx - rr, by - rr, rr * 2, rr * 2); ctx.restore();
				}
			}
			// 稲光: 空がひかり、ときどき稲妻
			if (flash > 0.01) {
				ctx.fillStyle = `rgba(235,240,255,${flash * 0.42})`; ctx.fillRect(0, 0, W, H);
				if (boltT > 0) {
					if (!bolt) { bolt = []; let x = rnd(0.15, 0.85) * W, y = 0; while (y < H * rnd(0.45, 0.7)) { bolt.push([x, y]); x += rnd(-28, 28); y += rnd(14, 34); } }
					ctx.strokeStyle = `rgba(250,250,255,${Math.min(1, flash + 0.2)})`; ctx.lineWidth = 2; ctx.beginPath(); bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
				}
			}
		}
	};
}
