<script lang="ts">
	// 客室ごとの入口QR（A6 POP「内線電話・館内情報」）の印刷（2026-11-20）。
	// A6＝A4 縦に 2×2 の 4 面、A7＝A4 横に 4×2 の 8 面で割り付け、各面に切り取り枠を付ける（2026-11-20 指示）。
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import QrCode from '$lib/components/QrCode.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	let { data, form } = $props();

	// 印刷する部屋（既定は全室）
	let picked = $state<string[] | null>(null);
	const selected = $derived(picked ?? data.rooms.map((r) => r.roomId));
	const printRooms = $derived(data.rooms.filter((r) => selected.includes(r.roomId)));
	// 紙の大きさ（?size=A7 で A7。既定は A6）
	let size = $state<'A6' | 'A7'>(page.url.searchParams.get('size') === 'A7' ? 'A7' : 'A6');
	const perSheet = $derived(size === 'A7' ? 8 : 4);
	// 用紙（A4）の向きと幅。A7 は A4 を横にして 8 面
	const paper = $derived(size === 'A7' ? { orient: 'landscape', w: '297mm' } : { orient: 'portrait', w: '210mm' });
	const sheets = $derived(Array.from({ length: Math.ceil(printRooms.length / perSheet) }, (_, i) => printRooms.slice(i * perSheet, i * perSheet + perSheet)));
	const toggle = (id: string) => {
		picked = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	};
	// 施設のロゴ（男鹿は「山人 -oga-」、それ以外は山人の筆文字）
	const logo = $derived(data.slug === 'oga' ? { src: '/brand/yamado-oga-logo.svg', w: 138, h: 71 } : { src: '/brand/yamado-brush-mark.png', w: 256, h: 122 });
</script>

<svelte:head>
	<title>客室ごとの入口QR ｜ YAMADO</title>
	<!-- 隠した管理画面の部品（横幅の広いナビ等）が幅を取ると、Chrome がページ全体を縮めて左寄せになる。印刷では用紙の幅で切る -->
	{@html `<style>@page { size: A4 ${paper.orient}; margin: 0; } @media print { html, body { width: ${paper.w} !important; min-width: 0 !important; overflow: hidden !important; } }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-0 py-2 sm:px-4 sm:py-6">
	<div class="print-hide">
		<PageHeader title="客室ごとの入口QR" facility={data.facilityName} description="客室に置く POP（内線電話・館内情報）の印刷です。A4 に割り付けます（A6 は 4 部屋・A7 は 8 部屋ずつ）。" />
	</div>
	<div class="print-hide mb-5 space-y-3 text-sm leading-relaxed">
		<p class="text-stone-600">
			QR には部屋ごとの鍵が入っています。読んだお客様は、<b>滞在コードを入れなくても「フロントを呼ぶ」が使え</b>、受電端末には部屋番号が出ます。食事時間・貸切風呂のご予約・Wi-Fi は、従来どおり館内図の 6 桁の滞在コードを入れると出ます。
		</p>
		<p class="text-stone-600">
			QR を撮られた・持ち出されたときは、その部屋の「発行し直す」を押してから POP を刷り直してください（古い QR は使えなくなります）。
		</p>
		{#if data.error}
			<p class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{data.error}</p>
		{/if}
		{#if form?.reissueError}
			<p class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">{form.reissueError}</p>
		{/if}
		{#if data.rooms.length}
			<div class="rounded-xl border border-stone-200 bg-white p-3">
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<span class="mr-auto text-stone-600">印刷する部屋：<b class="text-stone-800">{printRooms.length}</b> / {data.rooms.length} 室（A4 {sheets.length} 枚・切り取り枠で {perSheet} つに切る）</span>
					<div class="flex overflow-hidden rounded-lg border border-stone-300" role="group" aria-label="紙の大きさ">
						{#each ['A6', 'A7'] as const as s (s)}
							<button type="button" onclick={() => (size = s)} aria-pressed={size === s} class="px-3 py-1.5 {size === s ? 'bg-stone-800 text-white' : 'hover:bg-stone-50'}">{s}</button>
						{/each}
					</div>
					<button type="button" class="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50" onclick={() => (picked = data.rooms.map((r) => r.roomId))}>全室</button>
					<button type="button" class="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50" onclick={() => (picked = [])}>解除</button>
					<button type="button" onclick={() => window.print()} disabled={!printRooms.length} class="rounded-lg bg-brand-800 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">印刷する</button>
				</div>
				<ul class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
					{#each data.rooms as r (r.roomId)}
						<li class="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-2 py-1.5">
							<label class="flex min-w-0 items-center gap-2">
								<input type="checkbox" checked={selected.includes(r.roomId)} onchange={() => toggle(r.roomId)} />
								<span class="truncate">{r.roomNumber}{r.name && r.name !== r.roomNumber ? ` ${r.name}` : ''}</span>
							</label>
							<form method="POST" action="?/reissue" use:enhance={({ cancel }) => { if (!confirm(`${r.roomNumber} の QR を発行し直します。今置いてある POP の QR は使えなくなります。よろしいですか？`)) cancel(); }}>
								<input type="hidden" name="room" value={r.roomId} />
								<button class="shrink-0 text-xs text-stone-500 underline hover:text-stone-800">{form?.reissued === r.roomId ? '発行し直しました' : '発行し直す'}</button>
							</form>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<div class="sheets space-y-4">
		{#each sheets as sheet, i (i)}
			<div class="sheet mx-auto bg-white text-center text-black shadow-md" class:a7={size === 'A7'}>
				{#each sheet as r (r.roomId)}
					<div class="pop flex flex-col items-center justify-between">
						<div class="w-full">
							<h2 class="title">内線電話・館内情報</h2>
							<p class="sub">Hotel &amp; Travel information</p>
						</div>
						<div class="qr"><QrCode value={r.qrUrl} px={190} label={`${r.roomNumber} の入口QRコード`} /></div>
						<p class="room">ROOM {r.roomNumber}</p>
						<img class="logo" src={logo.src} width={logo.w} height={logo.h} alt={data.facilityName} />
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	/* A4（210×297mm）を A6（105×148.5mm）の 2×2 に分ける。各面の四辺に切り取り枠（薄い破線） */
	.sheet { width: 210mm; height: 297mm; display: grid; grid-template-columns: 105mm 105mm; grid-template-rows: 148.5mm 148.5mm; position: relative; overflow: hidden; }
	.pop { width: 105mm; height: 148.5mm; padding: 13mm 8mm 9mm; outline: 0.25mm dashed #999; outline-offset: -0.125mm; }
	.title { font-size: 25pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.2; }
	.sub { margin-top: 5mm; font-size: 12.5pt; }
	.qr :global(svg) { width: 45mm; height: 45mm; }
	.room { font-size: 14pt; letter-spacing: 0.02em; }
	.logo { width: 23mm; height: auto; }
	/* A7：A4 横（297×210mm）を A7（74.25×105mm）の 4×2 に分ける。中身は A6 を約 7 割に縮めた大きさ */
	.sheet.a7 { width: 297mm; height: 210mm; grid-template-columns: repeat(4, 74.25mm); grid-template-rows: 105mm 105mm; }
	.a7 .pop { width: 74.25mm; height: 105mm; padding: 9mm 5mm 6mm; }
	.a7 .title { font-size: 17pt; }
	.a7 .sub { margin-top: 3mm; font-size: 9pt; }
	.a7 .qr :global(svg) { width: 32mm; height: 32mm; }
	.a7 .room { font-size: 10pt; }
	.a7 .logo { width: 16mm; }
	/* 画面では紙の見本を縮めて横にはみ出さないようにする（印刷の大きさは変えない） */
	@media screen {
		.sheet { zoom: 0.9; }
		.sheet.a7 { zoom: 0.64; }
	}
	@media screen and (max-width: 48rem) {
		.sheet { zoom: 0.45; }
		.sheet.a7 { zoom: 0.32; }
	}
	/* 印刷：管理画面の枠・余白・帯に関係なく、紙面だけを用紙の左上から並べる（はみ出し防止） */
	@media print {
		:global(html), :global(body) { margin: 0 !important; padding: 0 !important; background: #fff !important; }
		:global(body *) { visibility: hidden; }
		.sheets, .sheets :global(*) { visibility: visible; }
		.sheets { position: absolute; left: 0; top: 0; margin: 0 !important; }
		.sheets > :global(* + *) { margin-top: 0 !important; }
		/* 端数で次のページへ溢れて白紙が出ないよう、わずかに低くする */
		.sheet { height: 296.5mm; box-shadow: none; margin: 0 !important; zoom: 1; break-after: page; page-break-after: always; }
		.sheet.a7 { height: 209.5mm; }
		.sheet:last-child { break-after: auto; page-break-after: auto; }
	}
</style>
