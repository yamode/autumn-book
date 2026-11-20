<script lang="ts">
	// 客室ごとの入口QR（A6 POP「内線電話・館内情報」）の印刷（2026-11-20）。
	// A4 縦に A6 を 2×2 の 4 面で割り付け、切り取り線を付ける（2026-11-20 指示）。
	import { enhance } from '$app/forms';
	import QrCode from '$lib/components/QrCode.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	let { data, form } = $props();

	// 印刷する部屋（既定は全室）
	let picked = $state<string[] | null>(null);
	const selected = $derived(picked ?? data.rooms.map((r) => r.roomId));
	const printRooms = $derived(data.rooms.filter((r) => selected.includes(r.roomId)));
	// A4 1 枚に 4 部屋ずつ
	const sheets = $derived(Array.from({ length: Math.ceil(printRooms.length / 4) }, (_, i) => printRooms.slice(i * 4, i * 4 + 4)));
	const toggle = (id: string) => {
		picked = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	};
	// 施設のロゴ（男鹿は「山人 -oga-」、それ以外は山人の筆文字）
	const logo = $derived(data.slug === 'oga' ? { src: '/brand/yamado-oga-logo.svg', w: 138, h: 71 } : { src: '/brand/yamado-brush-mark.png', w: 256, h: 122 });
</script>

<svelte:head>
	<title>客室ごとの入口QR ｜ YAMADO</title>
	{@html `<style>@page { size: A4 portrait; margin: 0; }</style>`}
</svelte:head>

<div class="print-shell mx-auto max-w-3xl px-0 py-2 sm:px-4 sm:py-6">
	<div class="print-hide">
		<PageHeader title="客室ごとの入口QR" facility={data.facilityName} description="客室に置く A6 の POP（内線電話・館内情報）の印刷です。A4 1 枚に 4 部屋ずつ割り付けます。" />
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
					<span class="mr-auto text-stone-600">印刷する部屋：<b class="text-stone-800">{printRooms.length}</b> / {data.rooms.length} 室（A4 {sheets.length} 枚・切り取り線で 4 つに切る）</span>
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
			<div class="sheet mx-auto bg-white text-center text-black shadow-md">
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
	/* A4（210×297mm）を A6（105×148.5mm）の 2×2 に分ける。切り取り線は薄い破線 */
	.sheet { width: 210mm; height: 297mm; display: grid; grid-template-columns: 105mm 105mm; grid-template-rows: 148.5mm 148.5mm; position: relative; overflow: hidden; }
	.sheet::before, .sheet::after { content: ''; position: absolute; pointer-events: none; }
	.sheet::before { left: 105mm; top: 0; bottom: 0; border-left: 0.2mm dashed #bbb; }
	.sheet::after { top: 148.5mm; left: 0; right: 0; border-top: 0.2mm dashed #bbb; }
	.pop { width: 105mm; height: 148.5mm; padding: 13mm 8mm 9mm; }
	.title { font-size: 25pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.2; }
	.sub { margin-top: 5mm; font-size: 12.5pt; }
	.qr :global(svg) { width: 45mm; height: 45mm; }
	.room { font-size: 14pt; letter-spacing: 0.02em; }
	.logo { width: 23mm; height: auto; }
	/* 画面では紙の見本を縮めて横にはみ出さないようにする（印刷の大きさは変えない） */
	@media screen {
		.sheet { zoom: 0.9; }
	}
	@media screen and (max-width: 48rem) {
		.sheet { zoom: 0.45; }
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
		.sheet:last-child { break-after: auto; page-break-after: auto; }
	}
</style>
