<script lang="ts">
	// Autumn Live（閲覧専用）。設計: docs/autumn-live.md。見た目は docs/prototypes/autumn-live/index.html（v13）を実データにしたもの。
	// 描画と数字の更新は $lib/live-screen/engine.ts（/live/api/snapshot を数秒ごとに読む）。
	import { onMount } from 'svelte';
	import { startLiveScreen } from '$lib/live-screen/engine';

	let root: HTMLDivElement;
	onMount(() => startLiveScreen(root));
</script>

<svelte:head>
	<title>Autumn Live</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="al" bind:this={root}>
	<canvas class="scene" aria-hidden="true"></canvas>
	<div class="hud">
		<header class="top">
			<div class="id">
				<div class="mark">Autumn Live<small>Autumn Book のいま · 西和賀・男鹿</small></div>
				<div class="clock"><span data-id="hm">--:--</span><small data-id="date">&nbsp;</small><small class="wx" data-id="wx">&nbsp;</small></div>
				<div class="now"><b data-id="liveN">0</b><span>人が いま<br />Book を見ています<em data-id="liveVs"></em></span></div>
			</div>
			<div class="ctrl">
				<span class="chip" data-id="chip"><i></i><span data-id="fresh">つないでいます</span></span>
				<label><span class="vh">空の時刻</span><select data-id="skySel"><option value="">いまの空</option><option value="6.4">朝</option><option value="12">昼</option><option value="17.1">夕</option><option value="22">夜</option></select></label>
				<label><span class="vh">天気</span><select data-id="wxSel"><option value="nishiwaga">いまの西和賀の天気</option><option value="oga">いまの男鹿の天気</option><option value="random">おまかせの天気</option></select></label>
				<label><span class="vh">背景（季節）</span><select data-id="seasonSel"><option value="">いまの季節</option></select></label>
				<button data-id="btnHelp" type="button" aria-expanded="false">見方</button>
				<button data-id="btnGoal" type="button" aria-expanded="false">目標</button>
				<button data-id="btnSound" type="button" aria-pressed="false">音 オフ</button>
				<button data-id="btnFs" type="button">全画面</button>
			</div>
		</header>
		<div></div>
		<section class="kpis" data-id="kpis" aria-label="指標と比較">
			<div class="card" data-k="visits">
				<div class="lab"><span>今日の Book 訪問</span><span class="flag"></span></div>
				<div class="valrow"><div class="val" data-id="v-visits">0<small>人</small></div><div class="vs" data-id="vs-visits"></div></div>
				<div class="bullet"><div class="band"></div><div class="bar"></div><div class="proj"></div><div class="tgt"></div></div>
				<div class="line" data-id="l1-visits"></div>
				<div class="line st" data-id="l2-visits"></div>
			</div>
			<div class="card" data-k="cvr">
				<div class="lab"><span>予約率（直近7日）</span><span class="flag"></span></div>
				<div class="valrow"><div class="val" data-id="v-cvr">—</div><div class="vs" data-id="vs-cvr"></div></div>
				<div class="bullet"><div class="band"></div><div class="bar"></div><div class="tgt"></div></div>
				<div class="line" data-id="l1-cvr"></div>
				<div class="line st" data-id="l2-cvr"></div>
			</div>
			<div class="card" data-k="onhand">
				<div class="lab"><span>オンハンド（先12か月・全チャネル）</span><span class="flag"></span></div>
				<div class="valrow"><div class="val" data-id="v-onhand">—</div><div class="vs" data-id="vs-onhand"></div></div>
				<canvas class="months" data-id="months"></canvas>
				<div class="line" data-id="l1-onhand"></div>
			</div>
			<div class="card" data-k="members">
				<div class="lab"><span>会員（Book）</span><span class="flag"></span></div>
				<div class="valrow"><div class="val" data-id="v-members">—</div><div class="vs" data-id="vs-members"></div></div>
				<dl class="flow" data-id="memFlow"></dl>
				<div class="line" data-id="l1-members"></div>
			</div>
		</section>
	</div>

	<div class="banner" data-id="banner" aria-live="polite"><b data-id="bannerHead"></b><span data-id="bannerText"></span></div>

	<div class="panel" data-id="goalPanel" role="dialog" aria-label="目標を設定" hidden>
		<form data-id="goalForm" novalidate>
			<h2>目標を設定</h2>
			<p class="hint">各指標の金色の目印になります。灰色の帯（いつもの幅）とは別のものです。この端末にだけ保存されます。</p>
			<fieldset>
				<legend>1日</legend>
				<label class="row" for="g_visits">Book 訪問<input id="g_visits" name="visits" type="number" inputmode="numeric" min="0" step="10" /><span class="u">人</span></label>
			</fieldset>
			<fieldset>
				<legend>率</legend>
				<label class="row" for="g_cvr">予約率（直近7日）<input id="g_cvr" name="cvr" type="number" inputmode="decimal" min="0" step="0.1" /><span class="u">%</span></label>
			</fieldset>
			<fieldset>
				<legend>オンハンド</legend>
				<label class="row" for="g_onhand">先12か月の予約額<input id="g_onhand" name="onhand" type="number" inputmode="numeric" min="0" step="1000000" /><span class="u">円</span></label>
			</fieldset>
			<div class="actions">
				<button type="button" data-id="gpReset">初期値に戻す</button>
				<button type="button" data-id="gpClose">閉じる</button>
				<button type="submit" class="primary">保存</button>
			</div>
			<p data-id="gpSaved" class="saved" hidden>保存しました</p>
		</form>
	</div>

	<div class="panel help" data-id="helpPanel" role="dialog" aria-label="この画面の見方" hidden>
		<h2>この画面の見方</h2>
		<p class="hint">Book の公開画面を見ている人の、今日の流れです。数秒ごとに新しくなります。</p>
		<dl>
			<dt>帯の太さ</dt><dd>今日その段まで来た人数です。どの段も同じ縮尺です。施設のページへ直接来た人は「空室検索」も通ったとして数えます。</dd>
			<dt>光の粒</dt><dd>いまその段にいる一人（ブラウザのタブ 1 つ）です。予約入力から先は金色です。空へ上って消える粒は、そこで離れた人です。計測に同意していない人は数えていません。</dd>
			<dt>段の間の％</dt><dd>次の段へ進んだ割合。下の小さな数字は直近28日の値で、前の段を通った人が50人以上になると出ます。</dd>
			<dt>24時間の線</dt><dd>今日の30分ごとの訪問。灰色の帯は直近8週の同じ曜日の真ん中半分で、4週たまると出ます。</dd>
			<dt>オンハンド</dt><dd>全チャネルの、今月から12か月の宿泊分の室料＋食事。各月の横線は前年の同じ月の実績です。</dd>
			<dt>空の天気</dt><dd>西和賀（アメダス湯田）か男鹿の、いまの天気です。10分ごとの観測と今日の予報から決めます。読めないときや「おまかせ」では、その月らしい天気が移り変わります。出典：気象庁（アメダス・天気予報）。</dd>
			<dt>予約・予約率・会員</dt><dd>Book で入った予約と、Book の会員です。予約が入ると、施設・月・人数・泊数・金額だけを知らせます。</dd>
		</dl>
		<div class="actions"><button type="button" data-id="hpClose">閉じる</button></div>
	</div>
</div>

<style>
	.al {
		--ink: #ece8dc;
		--ink-dim: rgba(236, 232, 220, 0.62);
		--ink-faint: rgba(236, 232, 220, 0.18);
		--gold: #e6c172;
		--silver: #d4def2;
		--warn: #f1b45a;
		--up: #9fd8b4;
		--card: rgba(9, 12, 26, 0.42);
		--panel: rgba(12, 15, 28, 0.95);
		--f-display: 'Shippori Mincho B1', 'Yu Mincho', 'Hiragino Mincho ProN', serif;
		--f-body: 'Noto Sans JP Variable', 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #0a0e20;
		color: var(--ink);
		font-family: var(--f-body);
		-webkit-font-smoothing: antialiased;
		color-scheme: dark;
	}
	.al:global(.day) {
		--ink: #17213a;
		--ink-dim: rgba(23, 33, 58, 0.66);
		--ink-faint: rgba(23, 33, 58, 0.16);
		--gold: #8a6417;
		--silver: #44587e;
		--warn: #a65a08;
		--up: #2b7a4b;
		--card: rgba(255, 255, 255, 0.55);
		--panel: rgba(250, 251, 253, 0.97);
		color-scheme: light;
	}
	.scene { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
	.hud {
		position: absolute; inset: 0; pointer-events: none; display: grid; grid-template-rows: auto 1fr auto; gap: 12px;
		padding-left: max(20px, env(safe-area-inset-left, 0px)); padding-right: max(20px, env(safe-area-inset-right, 0px));
		padding-block: calc(env(safe-area-inset-top, 0px) + 16px) calc(env(safe-area-inset-bottom, 0px) + 16px);
	}
	.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
	.id { display: flex; align-items: flex-end; gap: clamp(16px, 2.6vw, 40px); flex-wrap: wrap; }
	.mark { font-family: var(--f-display); font-weight: 700; font-size: clamp(20px, 1.9vw, 28px); letter-spacing: 0.04em; line-height: 1; }
	.mark small, .clock small { display: block; font-family: var(--f-body); font-weight: 400; font-size: 11px; letter-spacing: 0.1em; color: var(--ink-dim); margin-top: 7px; }
	.clock .wx { margin-top: 4px; }
	.clock { font-family: var(--f-display); font-weight: 500; font-size: clamp(20px, 1.8vw, 28px); line-height: 1; font-variant-numeric: tabular-nums; }
	.now { display: flex; align-items: baseline; gap: 10px; }
	.now b { font-size: clamp(34px, 3.4vw, 52px); font-weight: 700; line-height: 0.9; font-variant-numeric: tabular-nums; }
	.now span { font-size: 13px; color: var(--ink-dim); line-height: 1.4; }
	.now span em { font-style: normal; display: block; font-size: 11.5px; }
	.ctrl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; pointer-events: auto; max-width: 62vw; }
	.chip { font-size: 11px; letter-spacing: 0.06em; color: var(--ink-dim); border: 1px solid var(--ink-faint); border-radius: 999px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; }
	.chip i { width: 7px; height: 7px; border-radius: 50%; background: #7fd19b; }
	.chip:global(.stale) i { background: #8a8a8a; }
	.ctrl button, .ctrl select, .panel button {
		font: inherit; font-size: 12px; color: var(--ink-dim); background: var(--card); border: 1px solid var(--ink-faint); border-radius: 999px; padding: 5px 12px; cursor: pointer;
	}
	.ctrl button:hover, .ctrl select:hover { color: var(--ink); border-color: var(--ink-dim); }
	.al :global(button:focus-visible), .al :global(select:focus-visible), .al :global(input:focus-visible) { outline: 2px solid var(--gold); outline-offset: 2px; }
	.al :global(button[aria-pressed='true']) { color: var(--gold); border-color: var(--gold); }
	.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	.kpis { display: grid; grid-template-columns: 1fr 1fr 1.45fr 1.5fr; gap: 12px; pointer-events: auto; }
	.card { background: var(--card); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: 12px; padding: 12px 16px 13px; display: flex; flex-direction: column; gap: 7px; min-width: 0; transition: box-shadow 0.6s; }
	.card:global(.bump) { box-shadow: 0 0 0 1px var(--gold), 0 0 28px rgba(230, 193, 114, 0.35); }
	.card[data-k='members']:global(.bump) { box-shadow: 0 0 0 1px var(--silver), 0 0 28px rgba(212, 222, 242, 0.4); }
	.lab { font-size: 11.5px; letter-spacing: 0.08em; color: var(--ink-dim); display: flex; justify-content: space-between; gap: 8px; white-space: nowrap; }
	.lab .flag { display: none; font-size: 11px; letter-spacing: 0; color: var(--warn); }
	.card:global(.warn) .lab .flag { display: inline; }
	.card:global(.good) .lab .flag { display: inline; color: var(--gold); }
	.valrow { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
	.val { font-size: clamp(22px, 2vw, 30px); font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.val :global(small) { font-size: 12px; font-weight: 500; color: var(--ink-dim); margin-left: 3px; }
	.vs { font-size: 12px; color: var(--ink-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
	.vs :global(b) { font-weight: 700; color: var(--ink); }
	.vs :global(b.up) { color: var(--up); }
	.vs :global(b.dn) { color: var(--warn); }
	.bullet { position: relative; height: 12px; border-radius: 2px; background: var(--ink-faint); }
	.bullet .band { position: absolute; top: 0; height: 12px; background: var(--ink-faint); outline: 1px solid var(--ink-faint); }
	.bullet .bar { position: absolute; left: 0; top: 4px; height: 4px; border-radius: 1px; background: var(--ink); transition: width 0.8s; }
	.card:global(.warn) .bullet .bar { background: var(--warn); }
	.bullet .tgt { position: absolute; top: -3px; width: 2px; height: 18px; background: var(--gold); }
	.bullet .proj { position: absolute; top: -1px; height: 14px; border-left: 2px dotted var(--ink); transition: left 0.8s; }
	.line { font-size: 11.5px; color: var(--ink-dim); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.line :global(b) { font-weight: 500; color: var(--ink); }
	.card:global(.warn) .line.st { color: var(--warn); }
	.months { display: block; width: 100%; height: 58px; }
	.flow { display: grid; grid-template-columns: auto 1fr auto; gap: 1px 10px; font-size: 12px; font-variant-numeric: tabular-nums; align-items: center; margin: 0; }
	.flow :global(dt) { color: var(--ink-dim); }
	.flow :global(dd) { margin: 0; text-align: right; }
	.flow :global(.bx) { height: 6px; border-radius: 1px; background: var(--ink); opacity: 0.75; }
	.flow :global(.bx.neg) { background: var(--warn); opacity: 0.85; }
	.flow :global(.net) { border-top: 1px solid var(--ink-faint); padding-top: 3px; font-weight: 700; }
	.banner {
		position: absolute; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 84px); transform: translate(-50%, -6px); opacity: 0; transition: opacity 0.8s, transform 0.8s; pointer-events: none;
		padding: 9px 20px; border-radius: 999px; background: var(--card); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid var(--gold); font-size: 14px; white-space: nowrap; z-index: 5;
	}
	.banner:global(.on) { opacity: 1; transform: translate(-50%, 0); }
	.banner b { color: var(--gold); margin-right: 10px; }
	.banner:global(.member) { border-color: var(--silver); }
	.banner:global(.member) b { color: var(--silver); }
	.panel {
		position: absolute; z-index: 20; top: calc(env(safe-area-inset-top, 0px) + 64px); right: max(16px, env(safe-area-inset-right, 0px)); width: min(400px, calc(100vw - 32px)); max-height: calc(100% - 96px); overflow: auto;
		background: var(--panel); border: 1px solid var(--ink-faint); border-radius: 14px; padding: 20px 20px 16px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
	}
	.panel h2 { margin: 0; font-family: var(--f-display); font-weight: 700; font-size: 20px; }
	.panel .hint { margin: 8px 0 0; font-size: 12px; line-height: 1.65; color: var(--ink-dim); }
	.panel fieldset { border: 0; border-top: 1px solid var(--ink-faint); margin: 16px 0 0; padding: 12px 0 0; display: grid; gap: 8px; }
	.panel legend { font-size: 11px; letter-spacing: 0.14em; color: var(--ink-dim); padding: 0 0 4px; }
	.row { display: grid; grid-template-columns: 1fr auto 2.2em; align-items: center; gap: 8px; font-size: 13px; }
	.row input { width: 8.5em; font: inherit; font-variant-numeric: tabular-nums; text-align: right; color: var(--ink); background: var(--ink-faint); border: 1px solid var(--ink-faint); border-radius: 8px; padding: 6px 8px; }
	.row .u { color: var(--ink-dim); font-size: 12px; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
	.actions .primary { color: #1a160c; background: var(--gold); border-color: var(--gold); }
	.help dl { margin: 14px 0 0; display: grid; gap: 10px; }
	.help dt { font-size: 12px; font-weight: 700; color: var(--gold); }
	.help dd { margin: 2px 0 0; font-size: 12.5px; line-height: 1.7; }
	.saved { margin: 10px 0 0; text-align: right; font-size: 12px; color: var(--gold); }
	[hidden] { display: none !important; }
	@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ctrl { max-width: none; } }
	@media (prefers-reduced-motion: reduce) { .banner, .bullet .bar, .bullet .proj { transition: none; } }
</style>
